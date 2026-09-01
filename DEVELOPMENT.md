# FileCast — Development Guide

This is the practical guide to running FileCast locally, wiring up VS Code, understanding
the CI/CD pipeline, and operating the production system. For what FileCast *is* — the
product, the tools, the architecture at a glance — see [README.md](README.md).

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Repo Layout](#repo-layout)
3. [Local Setup — Static Site](#local-setup--static-site)
4. [Local Setup — API](#local-setup--api)
5. [VS Code Setup](#vs-code-setup)
6. [Running Tests](#running-tests)
7. [Linting & Formatting](#linting--formatting)
8. [Adding a Tool](#adding-a-tool)
9. [GitHub Actions (CI/CD)](#github-actions-cicd)
10. [Production Architecture](#production-architecture)
11. [Database Architecture — Multi-Node Neon Pool](#database-architecture--multi-node-neon-pool)
12. [Production Deployment](#production-deployment)
13. [Monitoring & Backups](#monitoring--backups)
14. [Third-Party Services](#third-party-services)
15. [Troubleshooting / Known Gotchas](#troubleshooting--known-gotchas)

---

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Python | 3.12+ (repo's `.venv` may run newer; CI/prod use 3.12) | `build.py`, API, tests |
| Node.js | 20+ | Vitest, Playwright, Biome |
| Docker Desktop | current | API + Gotenberg + local Postgres |
| Git | current | obviously |

## Repo Layout

```
FileCast/
├── api/                    FastAPI backend (see api/ section below)
├── assets/                 Design assets (logo, SVG)
├── content/                Per-tool SEO/help Markdown (content/{tool-id}/*.md)
├── e2e/                    Playwright specs
├── scripts/                Ops scripts (VM deploy hook, resource monitor)
├── static/                 CSS/JS copied into dist/ (converters, admin panel, libs)
├── templates/               Jinja2 templates
├── test/                   Vitest unit specs (JS)
├── tools/                  One YAML per tool — the source of truth for the catalogue
├── build.py                Static site generator
├── seed.py                 Seeds tools/*.yaml into Postgres (tools table)
├── site-config.yaml        Global site config (committed defaults; DB can override — see below)
├── dev.bat                 One-shot local dev launcher (Windows)
└── requirements.txt        build.py's own dependencies (not the API's)
```

```
api/
├── main.py                 App entrypoint, middleware stack, router registration
├── converter.py            The 6 server-side conversion endpoints (Gotenberg/Ghostscript/pdf2docx),
│                            plus /health and /pool-health
├── validation.py           Magic-byte / size validation
├── middleware.py           Rate limiting, CORS, request logging
├── data/
│   ├── models.py           SQLAlchemy models (16 tables — see README)
│   ├── db.py               Engines/sessions — N-way dynamic resolution against the active Neon node
│   ├── node_registry.py    Redis-backed Neon node pool state (registry, active pointer, locks, settings)
│   ├── node_ops.py         Switch/provision execution — dispatched to and run inside job_worker.py
│   ├── neon_api.py         Thin client for Neon's console API (usage polling, project visibility check)
│   ├── redis_client.py     Shared async/sync Redis clients (rate limits, job queue, node registry)
│   ├── job_worker.py       Async conversion worker + usage-poll loop + proactive/keep-alive triggers
│   ├── security.py         Sessions, cookies, Google OAuth, admin bootstrap
│   ├── tasks.py            Retention purge job + canary check
│   ├── netutil.py          Client-IP resolution (trusts CF-Connecting-IP — tunnel-dependent)
│   └── routers/            One router per admin/user-facing feature (auth, tools, admin_deploy,
│                            admin_nodes, staff, ...)
├── scripts/
│   ├── node_sync.py                pg_dump/pg_restore data sync + schema catch-up between two nodes
│   ├── resolve_active_db_url.py    Resolves the active node's URL for the Dockerfile's migration step
│   └── bootstrap_node_registry.py  One-time script that seeds the registry from the first node (§ below)
├── migrations/              Alembic migrations
├── tests/                   pytest suite
├── docker-compose.yml       Base compose: api, worker, purge, gotenberg, redis, postgres (dev-only profile)
├── docker-compose.prod.yml  Prod overlay: Neon, Redis, Cloudflare Tunnel, no dev-only postgres
└── Dockerfile
```

## Local Setup — Static Site

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1        # Windows PowerShell
# source .venv/bin/activate       # macOS/Linux

pip install -r requirements.txt
python build.py                   # one-shot build into dist/
python build.py --watch           # rebuild on change + serve http://localhost:8000
```

`build.py` reads `tools/*.yaml`, `content/**/*.md`, `templates/*.html`, and
`site-config.yaml`, and additionally tries to pull a `site_settings` DB overlay
(see [Third-Party Services](#third-party-services)) — if the DB is unreachable it
silently falls back to YAML-only, which is exactly what CI does (no DB secret there).

## Local Setup — API

The API, its async conversion worker, Gotenberg, Redis, and a local Postgres all run
via Docker Compose:

```bash
cd api
GIT_SHA=$(git rev-parse HEAD) docker compose --profile dev-only up -d --build
```

- `--build` is not optional day-to-day: plain `up -d` reuses whatever image already
  exists, so after a `git pull` the container can silently keep serving old code
  while the static site rebuilds fresh from the working tree.
- `GIT_SHA` stamps the image so `GET /` reports the commit it was built from — this
  is what makes that skew *visible* instead of silent (see the `api-drift` CI job).
- `--profile dev-only` is what starts the bundled local `postgres` service. Never
  used in production, where `api`/`purge` connect to Neon instead.

This starts:
- **api** — FastAPI on `http://localhost:8090` (alembic migrations run automatically
  on container start, before uvicorn starts serving)
- **worker** — the async conversion job worker (Phase 3), sharing the api image;
  discovers `ConversionJob` rows via Redis and runs them through Gotenberg/Ghostscript.
  In production, this same process also runs the Neon usage-poll loop and executes
  every node switch/provisioning operation (see
  [Database Architecture](#database-architecture--multi-node-neon-pool)) — locally,
  with no nodes registered, that half of the loop is a no-op
- **gotenberg** — LibreOffice/Chromium conversion engine on `http://localhost:3000`
- **redis** — shared rate-limit store, job-worker wake-up queue, and (production
  only — nothing is registered locally) the Neon node pool registry, on
  `localhost:6379`
- **postgres** — local dev DB on `localhost:5432` (`filecast`/`filecast_dev`)
- **purge** — the retention-purge loop, sharing the api image

Copy `api/.env.example` to `api/.env` first — dev defaults work as-is; Google OAuth
and the GitHub deploy trigger are optional locally and degrade gracefully (503/501)
when unset.

**One-shot local dev** (both systems together): `dev.bat` on Windows does the whole
sequence above plus `build.py --watch`, and tears the API containers down on exit.

### Running the API without Docker (for debugging)

Docker is required for Gotenberg, but the FastAPI process itself can run directly on
the host against the same Postgres/Gotenberg containers (needed for interactive
debugging — see [VS Code Setup](#vs-code-setup)). On Windows this needs one extra
step: psycopg's async driver cannot use the default `ProactorEventLoop`, so a plain
`python -m uvicorn main:app` fails to reach the DB. `api/dev_server.py` sets
`WindowsSelectorEventLoopPolicy` before importing uvicorn and should be used instead
of invoking uvicorn directly on Windows. It also runs `alembic upgrade head` first,
mirroring the Docker image's `alembic upgrade head && uvicorn ...` entrypoint, so it
works against a fresh database too — not just one the `api` container already migrated.

## VS Code Setup

Two files under `.vscode/` wire up the Testing panel and the Run & Debug panel
against this repo's actual layout (pytest root is `api/`, not the repo root):

**`.vscode/settings.json`**
```json
{
  "python.defaultInterpreterPath": "${workspaceFolder}/.venv/Scripts/python.exe",
  "python.testing.pytestEnabled": true,
  "python.testing.unittestEnabled": false,
  "python.testing.cwd": "${workspaceFolder}/api",
  "python.testing.pytestArgs": []
}
```

**`.vscode/launch.json`** — one debug config, "FastAPI: main.py (uvicorn)", which
launches `api/dev_server.py` (see above) with `envFile` pointed at `api/.env` and
`GOTENBERG_URL` overridden to `http://localhost:3000` (the compose network hostname
`gotenberg` only resolves inside Docker). `--reload` is deliberately **not** used —
uvicorn's autoreload spawns a subprocess the debugger can't attach to, so breakpoints
would silently stop firing. Restart the debug session after code changes instead.

**Requirements for both to work:**
- `.venv` has `api/requirements.txt` + `api/requirements-dev.txt` installed (not just
  the root `requirements.txt` — that only covers `build.py`).
- The `postgres` and `gotenberg` containers from `docker compose --profile dev-only up`
  are running, and a `filecast_test` database exists on that Postgres instance for the
  pytest side (created automatically the first time `api/conftest.py`'s schema fixture
  runs — the *database itself* has to already exist first; `CREATE DATABASE` needs a
  connection to an existing DB. `filecast_test` is a sibling DB, not `filecast`, so the
  test suite never touches your dev data).

The Testing panel discovers everything under `api/tests/*.py` once
`python.testing.cwd` points at `api/` (matching `api/pytest.ini`'s `testpaths = tests`).
JS tests (Vitest in `test/`, Playwright in `e2e/`) are separate and not part of this —
run them via `npm test` / `npm run test:e2e` (see below); Playwright's suite runs via
CI, not typically locally.

## Running Tests

| Suite | Command | Needs |
|---|---|---|
| Python (pytest) | `cd api && pytest -q` | Postgres reachable (`filecast_test` DB) |
| JS unit (Vitest) | `npm test` | nothing extra |
| JS unit, watch mode | `npm run test:watch` | nothing extra |
| E2E (Playwright) | `npm run test:e2e` | `dist/` built (`python build.py`); runs against the static preview server, not a live API |

pytest resolves its DB via `TEST_DATABASE_URL`, falling back to
`postgresql+psycopg://filecast:filecast_dev@localhost:5432/filecast_test` if unset —
matching the dev-only Postgres container above.

## Linting & Formatting

| Language | Check | Fix |
|---|---|---|
| Python | `ruff check .` | `ruff format .` |
| JS/CSS/JSON | `npm run check` (or `npx biome ci .` to match CI exactly) | `npm run check:fix` |

Run these on touched files before pushing — CI enforces both (`lint` and `js-lint`
jobs) and fails the PR otherwise.

## Adding a Tool

See [README.md § Pluggable Tool Architecture](README.md#pluggable-tool-architecture-how-to-add-a-tool)
for the YAML/JS/content-files walkthrough. Short version: `tools/{id}.yaml` +
(client-side only) `static/js/converters/{id}.js` + `content/{id}/{4 markdown files}`,
then `python build.py`.

---

## GitHub Actions (CI/CD)

Five workflows in `.github/workflows/`:

### `ci.yml` — runs on every PR and every push to `master`
Four independent jobs, all `permissions: contents: read`:
1. **lint** — `ruff check .` + `ruff format --check .`
2. **js-lint** — `biome ci .`
3. **js-test** — Vitest unit tests → `python build.py` (build `dist/` with no live
   API/DB — exercises the graceful-degradation path) → Playwright e2e against the
   built static preview server (`--project=chromium --workers=2`)
4. **test** — pytest against a real `postgres:16` service container (the app's own
   DB); runs `alembic upgrade head` + `alembic check` first (migration/model drift
   check), then `pytest -q` from `api/`. A second, pinned `postgres:18` service
   container also runs alongside it, matching Neon's actual Postgres version, so the
   real `pg_dump`/`pg_restore` node-sync test (`node_sync.py`) exercises a genuinely
   matching client/server pair rather than being skipped — `postgresql-client-18` is
   installed via the PGDG apt repo as a job step for this.

### `deploy.yml` — the "Publish" pipeline
Two triggers: manually via `workflow_dispatch` (with a `deploy_id` input), or
dispatched programmatically by the admin panel's "Publish" button (see
[Production Deployment](#production-deployment)). Builds the static site and
deploys it to Cloudflare Pages via `wrangler pages deploy` (direct-upload project,
not Git-integration — deploys only ever arrive through this workflow).
`concurrency: {group: pages-deploy, cancel-in-progress: false}` queues overlapping
Saves instead of racing them. A companion `api-drift` job compares the live API's
reported commit (`GET /`) against the frontend commit just deployed and **warns**
(never fails — `continue-on-error: true`) if `api/**` changed but the API container
hasn't been rebuilt to match.

### `release.yml` — backend redeploy, on `release: published`
SSH's into the Oracle VM (via a repo secret holding the deploy key, and a repo
variable holding the host) and runs a fixed script, `scripts/ci-deploy.sh`, which
always deploys `git tag --sort=-creatordate | head -1` — never a client-supplied ref.
The VM's `authorized_keys` entry is a forced-command entry (no port/agent/X11
forwarding, no PTY) restricted to exactly that script, so the SSH key can't be used
for anything else even if it leaked.

### `db-backup.yml` — nightly Postgres backup
Cron `0 7 * * *` (07:00 UTC) + manual dispatch. Runs `pg_dump` (via a pinned
`postgres:18` container, matching Neon's Postgres version) against a **read-only**
DB role, gzips the output, and uploads it as a GitHub Actions artifact with a
**7-day retention** (auto-deleted by GitHub, no separate cleanup job). This is a
second, independent backup layer on top of Neon's own point-in-time restore —
meant to cover platform-incident/operator-mistake scenarios PITR doesn't.

### `seed-tools.yml` — admin-triggered tool-registry sync
Structurally identical dispatch pattern to `deploy.yml`'s admin trigger, but syncs
`tools/*.yaml` into the `tools` Postgres table via `seed.py --only-new` (never
reshuffles an admin's manual sort order). Uses a separate write-capable DB secret
from the read-only one `deploy.yml`/`db-backup.yml` use.

---

## Production Architecture

```
    Browser
           |
           v
    +--------------------------------------+
    | Cloudflare Pages                     |  filecast.org / www.filecast.org
    | (static dist/, direct-upload,        |  DNS + registrar: Cloudflare
    | no Git integration)                  |
    +--------------------------------------+
                       |  HTTPS (server-side tools only)
                       v
    +--------------------------------------+
    | Cloudflare Tunnel                    |  api.filecast.org
    | (cloudflared sidecar)                |  no public inbound port on the VM
    +--------------------------------------+
                       |
                       v
    +--------------------------------------+
    | Oracle Cloud VPS                     |  Always Free tier, Ampere A1 (arm64)
    | Docker Compose:                      |  Ubuntu, US East (Ashburn)
    |   - api (FastAPI, 4 workers)         |
    |   - worker (async conversions +      |
    |     Neon usage-poll/failover loop)   |
    |   - purge (retention loop)           |
    |   - redis (queue + node pool state)  |
    |   - gotenberg (LibreOffice/Chromium) |
    |   - cloudflared                      |
    +--------------------------------------+
                       |  pooled TLS connection to whichever
                       |  node Redis says is "active"
                       v
    +--------------------------------------+
    | Neon Postgres — a POOL of projects   |  each node: managed, AWS us-east-2
    | exactly one "active" at a time,      |  free tier: 0.5GB / 100 CU-h/mo each
    | the rest kept warm as reserves       |  (see § below for the full design)
    +--------------------------------------+
```

That diagram is only the runtime request path — it leaves out everything that isn't
in the direct line of a page load: how code actually gets deployed, what watches the
system, and what's connected for analytics/auth. The full picture:

```
+------------------------------+  +------------------------------+  +------------------------------+
| Frontend & Edge              |  | Backend & Data               |  | Auth & Accounts              |
| ---------------              |  | --------------               |  | ---------------              |
| Cloudflare Pages (static     |  | Oracle Cloud VPS (Docker)    |  | Google OAuth (sign-in)       |
| site)                        |  |   api / worker / purge /     |  | DB-backed sessions           |
| Cloudflare Tunnel (API       |  |   gotenberg / autoheal       |  |                              |
| ingress)                     |  | Redis (queue + node pool     |  |                              |
| Cloudflare DNS + Registrar   |  |   state)                     |  |                              |
| Cloudflare Web Analytics     |  | Neon Postgres (N-node        |  |                              |
| beacon                       |  |   failover pool, managed)    |  |                              |
|                              |  | Ghostscript (PDF compress)   |  |                              |
+------------------------------+  +------------------------------+  +------------------------------+

+------------------------------+  +------------------------------+  +------------------------------+
| CI/CD (GitHub Actions)       |  | Analytics & SEO              |  | Monitoring                   |
| ----------------------       |  | ---------------              |  | ----------                   |
| ci.yml - lint + tests,       |  | Google Analytics 4           |  | UptimeRobot (3 monitors:     |
|   every PR                   |  | Google Search Console        |  |   homepage, /health,         |
| deploy.yml - admin-          |  | Bing Webmaster (not set up)  |  |   /pool-health)              |
|   triggered publish (also    |  | AdSense (built, not enabled) |  | Sentry - frontend + backend  |
|   rotates DATABASE_URL* to   |  |                              |  | Retention purge + canary     |
|   the active Neon node)      |  |                              |  |   job                        |
| release.yml - SSH redeploy   |  |                              |  | Weekly Neon keep-alive sync  |
|   on release                 |  |                              |  |                              |
| db-backup.yml - nightly      |  |                              |  |                              |
|   pg_dump backup             |  |                              |  |                              |
| seed-tools.yml - admin       |  |                              |  |                              |
|   tool sync                  |  |                              |  |                              |
+------------------------------+  +------------------------------+  +------------------------------+
```

Every workflow in the CI/CD box is detailed in [GitHub Actions (CI/CD)](#github-actions-cicd)
above; the Neon pool itself is detailed in
[Database Architecture](#database-architecture--multi-node-neon-pool) below; every
service in the other boxes is detailed in [Third-Party Services](#third-party-services)
below, with current status (live / not configured / built-but-disabled) for each.

- **Static frontend**: Cloudflare Pages, deployed only via `deploy.yml`
  (`wrangler pages deploy`), production branch `master`. `_headers` (CSP, HSTS,
  X-Frame-Options, etc.) and `_redirects` (www→apex) are generated by
  `build.py`'s `generate_headers()`/`generate_redirects()` and picked up natively
  by Pages — not configured in the Cloudflare dashboard.
- **Backend**: Oracle Cloud Always Free VM, reached exclusively through a
  Cloudflare Tunnel — there is no public inbound HTTP(S)/port-443 path to the VM
  at all, which is what makes it safe for `api/data/netutil.py` to trust the
  `CF-Connecting-IP` header unconditionally for rate limiting / abuse detection.
  Losing the tunnel (not the origin) is therefore the actual availability
  dependency for the API.
- **Database**: Neon (managed Postgres, serverless/autosuspend) — not one project but
  a small, expandable **pool** of them, exactly one "active" at a time, with automatic
  usage-based failover to a reserve node. Production uses a pooled read-write
  connection (`PROD_DATABASE_URL`, deliberately named differently from the dev
  `DATABASE_URL` so the two are never confused) to whichever node is currently active;
  CI/backups use a separate read-only role. Full design in
  [Database Architecture](#database-architecture--multi-node-neon-pool) below.
- **Retention**: the `purge` Compose service runs `python -m data.tasks purge --loop`
  continuously (24h interval) in the same image as the API — this replaced an
  earlier host-cron design that was never actually installed in production.
  Deletes `user_conversions`/`errors` older than `RETENTION_DAYS` (30 by default)
  and expired sessions; anonymous aggregate `conversions` and anonymous `ratings`
  are never purged. `python -m data.tasks canary` independently verifies the purge
  is actually running (fails if the oldest `user_conversions` row exceeds
  `retention_days + 2` days).

## Database Architecture — Multi-Node Neon Pool

Neon's free tier hard-suspends a project once it uses 100 CU-hours of compute in a
calendar month — connections refused outright, no degraded mode, until the next
billing cycle. FileCast has no budget for a paid plan, so instead of running on a
single Neon project, it runs on a **pool of independent Neon projects ("nodes")**,
with exactly one **active** (serving live traffic) at any time and the rest kept as
warm **reserves**. When the active node's usage climbs, or it fails outright, the app
automatically fails over to a reserve node — no downtime, no code change, no
redeploy. The full design rationale, alternatives considered, and a phase-by-phase
implementation log live in `project-docs/Done/NEON_FAILOVER_PLAN.md` (gitignored,
local-only); this section is the durable summary of what actually shipped.

**Non-goals, explicitly**: this is not active-active (only one node ever takes
writes), not zero-data-loss on an unplanned failover (a small, bounded staleness
window is accepted — see Accepted Risks below), and not cross-region (every node
lives in the same Neon region, `us-east-2`).

### Where pool state lives

All pool state — which node is active, the registry of every node, in-flight
switch/provisioning status, cached usage figures, and the six tunable settings below
— lives in **Redis**, under a `filecast:nodes:*` key namespace (`api/data/node_registry.py`),
not in Postgres. That's deliberate: the active database is exactly the thing that
might be unreachable when this state needs to be read. A node's connection string is
stored in the registry too (an explicit tradeoff — Redis previously held only
low-sensitivity data); no read endpoint, including authenticated admin ones, ever
returns it back to a browser.

If Redis itself is unreachable, every process that resolves the active node falls
back to the last value it successfully read (an in-process cache), not a fixed
default — there is no "primary" in an N-node pool. A process that has never
successfully read the registry (a cold start with Redis already down) surfaces a
clear error rather than guessing. `filecast:nodes:settings` gets the same treatment:
unreadable Redis falls back to the hardcoded defaults in the Configuration Reference
table below.

### Dynamic database access (`api/data/db.py`)

The app does not bind to a fixed engine. `get_session()` (the FastAPI dependency) and
`sync_session()` (used by scripts/tasks) resolve the currently active node via
`node_registry.get_active_node()` on every call and use a lazily-constructed, cached
engine for that node. Engines are built on first use and cached by `node_id` — never
eagerly for every registered node, since the pool can grow at runtime and a dev/CI
environment has zero nodes registered at all.

**Dev, test, and CI never register any Neon node.** With nothing in the registry,
every dynamic accessor falls back to the same static `async_engine`/`sync_engine`
pair built from `settings.database_url` that the app always had — so local Postgres
and CI's Postgres service container work completely unchanged; the multi-node
machinery is inert until a real node is registered in Redis (production only).

Every other place in the codebase that opens its own DB session — `job_worker.py`
(six call sites), `security.py`'s degrade-on-exception `/convert` auth check,
`converter.py`'s `/health` DB probe, `main.py`'s startup check and shutdown
`dispose()` — goes through this same dynamic resolution rather than importing a
module-level engine directly. `conftest.py` and `data/tasks.py`'s purge loop are the
only intentional exceptions (a fixed test DB, and an existing accessor that already
covers the dynamic path automatically).

### Usage monitoring

`api/data/neon_api.py` polls Neon's project-detail endpoint
(`GET /projects/{project_id}`, available on every plan) every 15 minutes (configurable)
from `job_worker.py`'s own loop, for **every** node in the pool, not just the active
one — this is a control-plane call that never connects to a node's Postgres endpoint
and costs no CU-hours, so checking idle reserves is free. The usage ratio is
`compute_time_seconds / quota_seconds`, where `quota_seconds` comes from the
admin-configurable `monthly_quota_compute_hours` setting (**not** from Neon's own
response — Neon only populates a `quota` field when a project has a custom quota
override, which FileCast's projects never have; confirmed live in production, an
earlier version of this design had assumed otherwise). Results are cached in Redis
with a checked-at timestamp; a single failed poll just keeps the last cached value
and retries next cycle — it is never treated as a "node is down" signal.

### Switch triggers

Three independent triggers, all converging on the same switch execution
(`api/data/node_ops.py`, run inside `job_worker.py` — never inside an `api` request
worker, since `api` runs 4 parallel processes and a node switch needs single-instance,
Redis-visible state):

1. **Proactive** (primary mechanism) — at `warmup_threshold_pct` (default 70%) usage
   on the active node, a background data sync to the best reserve node begins while
   the active node keeps serving traffic unaffected. At `cutover_threshold_pct`
   (default 80%), the final cutover runs: drain in-flight work, one more short
   top-up sync, flip.
2. **Reactive** — `N` consecutive `/health` DB-check failures (default 2,
   `reactive_failure_count`, tracked via a shared Redis counter since 4 worker
   processes could each see a different subset of failures) trigger an immediate
   switch to the best available reserve. No warm-up sync is possible here (the
   source is unreachable); the target serves whatever it had from its last sync, and
   that bounded staleness is the accepted cost of this path.
3. **Manual** — an admin picks a target node in the Database tab and confirms. Since
   the source node is presumed healthy, this follows the exact same
   sync-then-drain-then-flip sequence as the proactive trigger, not the reactive
   no-sync path.

The switch target is always the reserve node with the lowest cached usage ratio
(tie-broken by longest time since last active). Only one pool operation (a switch, or
a node-provisioning sync) can run at a time, enforced by an atomic, TTL-expiring Redis
lock — a crashed `job_worker.py` mid-operation can't permanently wedge the pool, and
the guarded operations carry their own hard timeouts shorter than the lock's TTL so
the TTL only ever fires on a genuine crash.

### Data sync (`api/scripts/node_sync.py`)

One shared implementation — parameterized by `(source_node_id, target_node_id)` — used
for warm-up syncs, the final cutover top-up, the weekly keep-alive sync, and initial
data seeding when a node is provisioned. `pg_dump --format=custom` from the source,
then a `TRUNCATE` + `pg_restore` into the target — the whole database, every table,
no curated subset (session rows live in Postgres too; a partial sync would silently
log users out on every switch). Runs via `asyncio.create_subprocess_exec` and is
scheduled as a background task from `job_worker.py`'s main loop, so a multi-second
dump/restore never stalls real conversion-job pickup. Every sync brings the target's
schema current first (`alembic upgrade head` against the target — idempotent, safe to
run on every invocation regardless of the target's prior state). Postgres client
tools are pinned to **v18** in the `api`/`worker` Dockerfile (via the PGDG apt repo)
to match Neon's actual project version — Debian's default package resolves to v17,
which is incompatible with a v18 server's dump format.

**Weekly keep-alive sync**: independent of any switch — Neon deletes free projects
after 90 days of zero activity, and a usage poll doesn't count as activity (it never
touches the node's compute). Once a week, every reserve node gets a real sync from
the active node, which both prevents deletion and keeps standby data reasonably fresh
for an emergency reactive failover.

### Write safety during a cutover

A `is_maintenance()` Redis-backed gate (fail-open on a Redis read failure, never
cached — its whole purpose is precise timing around a multi-second window) blocks
every route that writes, applied by "does this route write" rather than by HTTP verb
— this specifically includes two GET routes that write as a side effect (the OAuth
callback, and the job-download route that stamps `downloaded_at`). Reads are never
blocked. A blocked write returns `503` with a "try again shortly" message.

Separately, because `job_worker.py` is a non-HTTP process that writes a conversion
job's final status directly, the maintenance gate alone doesn't cover it. Before the
final top-up sync in every planned cutover, the worker stops claiming new `queued`
rows and waits (capped at the conversion-engine queue timeout, not the much longer
stuck-job timeout) for every `converting` row to finish, so no job's result can land
on the wrong node. The claim-pause is cleared once maintenance mode lifts.

From a user's perspective: a conversion already running finishes normally, typically
before the flip even happens. Only a brand-new submission in the same few-second
window sees the maintenance `503`.

### Schema migrations

Reserve/target nodes get their schema brought current as part of every
`node_sync.py` run (above). The **active** node is different: the Dockerfile's `CMD`
used to run `alembic upgrade head` against the static `DATABASE_URL` env var on every
deploy — correct when there was only one database, but silently wrong the moment a
switch happens, since the env var never moves. `api/scripts/resolve_active_db_url.py`
fixes this: before `alembic upgrade head` runs, it resolves the real active node from
Redis the same way the app does everywhere else, falling back to the static
`DATABASE_URL` when the registry can't be read (Redis down, or the narrow
pre-Bootstrap window) — so migrations always target the node actually serving traffic,
not whichever node happened to be node #1.

### Public pool-health signal

`GET /pool-health` (public, unauthenticated, same posture as `/health`) returns a
bare `healthy`/`degraded` signal — degraded exactly when no reserve node has
meaningfully more headroom than the active one — computed from the same logic used
for switch-target selection. No per-node numbers, counts, or names; that detail stays
behind admin login. A **second**, separate UptimeRobot monitor watches this route
(see [Monitoring & Backups](#monitoring--backups)) so a "pool is getting tight" alert
never reads the same as "the site is down."

### Admin panel — Database tab

`/admin`'s **Database** tab (`static/js/admin/nodes.js`, backed by
`api/data/routers/admin_nodes.py`) is the operator's entire interface to the pool:

- **Overview** — a pool-health banner, four stat tiles (active node + usage, node
  count, current threshold settings, most recent switch), and a table of every node
  (status, usage meter, health, last-activity) with status-dependent row actions
  ("Switch to this", "Retry", or plain text for the active node).
- **Node detail slide-out** — per-node stats, an editable display name, "Switch to
  this node" and "Retire node" (both disabled for the currently-active node — retiring
  it is rejected outright by the API too, not just discouraged in the UI, since
  `status` and the active pointer are independent state).
- **Switch flow** — a confirm step, then a live 4-step progress view (pause pickup →
  top-up sync → flip → resume), polling `GET /api/v1/admin/nodes/{run_id}/status`.
- **Add Node flow** — a form (display name, pooled connection string, Neon project
  ID) plus a collapsed checklist of the manual Neon-console steps (region
  `us-east-2`, Postgres **version 18** explicitly, free-tier compute defaults, the
  *pooled* connection string). Submitting dispatches provisioning
  (connectivity check → schema migrate → full initial sync → confirm the Neon API key
  can see the project → mark `ready`) as a background operation the panel can be
  closed without cancelling.
- **History tab** — one card per switch, tagged proactive/reactive/manual.
- **Settings tab** — the six tunables below, each auto-saving on change (no batch
  submit — these are live Redis reads, not a static-site rebuild input).

Every route in `admin_nodes.py` requires `Depends(require_admin)`. A `POST` never
does the actual switch/sync work itself — `api` runs 4 uvicorn workers, so an
in-process background task would be invisible to 3 of them. It instead pushes a
typed JSON task onto the same Redis wake-queue `job_worker.py` already `BRPOP`s from
for conversion jobs, and persists run status in Redis so any of the 4 `api`
processes can answer a status poll correctly.

### Configuration reference (`filecast:nodes:settings`, admin-editable)

| Setting | Default | Meaning |
|---|---|---|
| `warmup_threshold_pct` | 70 | Usage % on the active node that starts a background warm-up sync to the next target. |
| `cutover_threshold_pct` | 80 | Usage % that triggers the final top-up sync + drain + flip. |
| `usage_poll_interval_minutes` | 15 | How often every node's usage is checked. |
| `inactivity_warning_days` | 14 | Days since last activity before a node is flagged in the admin panel. |
| `reactive_failure_count` | 2 | Consecutive `/health` DB-check failures before the reactive trigger fires. |
| `monthly_quota_compute_hours` | 100 | The usage-ratio denominator, in CU-hours — must match your actual Neon plan (100 on Free). |

All six are also the Redis-unavailable fallback values, not just initial defaults.

### Adding a node (operator runbook)

Manual, in Neon's console: create a new project in `us-east-2`, explicitly select
**Postgres 18** (Neon's default for new projects is 17), leave compute on free-tier
defaults, copy the **pooled** connection string and the project ID. Then, in
`/admin`'s Database tab, use "Add node" with those three values — FileCast validates
connectivity, migrates the schema, copies current data, and marks it `ready`,
entirely without a code change or redeploy. **Removing** a node only sets it
`retired` in the registry; it never deletes the underlying Neon project — that stays
a separate, deliberate action in Neon's own console.

### A real bug this surfaced: pooled connections and `search_path`

Neon's pooled connection string runs PgBouncer-style transaction-mode pooling: the
client-facing connection SQLAlchemy holds onto can be silently reassigned to a
different backend Postgres session between transactions, without the DBAPI connection
object ever "closing" from SQLAlchemy's point of view. A project created straight
from Neon's console (not via `neonctl init`) can leave its owner role's `search_path`
empty, which surfaced in production as `UndefinedTable: relation "users" does not
exist` on live requests, self-resolving after a few minutes as connections cycled.
The fix (`db.py`'s `_register_search_path_fix()`) forces `SET SESSION search_path =
public` on **both** the pool's `"connect"` event (fires once per new physical
connection) **and** its `"checkout"` event (fires every time a connection is handed
out for use) — `"connect"` alone isn't enough, since a pooled connection's backend
session can change without SQLAlchemy ever seeing a new `"connect"` event.
`pool_pre_ping=True` does not substitute for this: its liveness check doesn't touch
session state when the connection is already alive, just possibly reassigned.

### Accepted risks

Not eliminated by this design, and worth knowing before touching it: Neon's Terms of
Service give Neon broad discretion to suspend an entire *account* (not just one
project) for a usage pattern it judges unreasonable — there's no clause naming "one
active project among several free ones" specifically, but the risk exists regardless
and is accepted, not mitigated, given that paying for hosting is currently ruled out.
Separately, Redis is now a harder dependency than it was before this design — a
Redis outage that coincides with an in-flight switch has a narrow, bounded window
where a process could keep serving the pre-switch node. Both are discussed in full in
`project-docs/Done/NEON_FAILOVER_PLAN.md` §10.

## Production Deployment

Two independent deploy paths — the frontend and backend are **not** deployed
together, and can drift (that's what the `api-drift` CI job watches for):

1. **Frontend (static site)** — the admin panel's "Publish" button (or a manual
   `workflow_dispatch`) triggers `deploy.yml`, which builds `dist/` fresh from
   `master` and pushes it to Cloudflare Pages. Admin trigger flow:
   `POST /api/v1/admin/deploy` → GitHub Actions API dispatch (`workflow_dispatch`
   on `deploy.yml`, ref `master`, always — never a client-supplied ref) using a
   fine-grained PAT scoped to this repo only (`Actions: read/write`, plus
   `Secrets: read/write` — PR #153: the same dispatch also rotates the
   `DATABASE_URL`/`DATABASE_URL_WRITE` GitHub secrets to whichever Neon node is
   currently active before triggering `deploy.yml`/`seed-tools.yml`, so a node
   switch doesn't leave the build/seed pipeline reading a stale node) → the
   panel polls run status via a second endpoint. The PAT lives only in the VM's
   `api/.env`; it is never a GitHub Actions secret, since the backend is the thing
   *dispatching* the workflow, not consuming it. `db-backup.yml`'s nightly dump
   reads this same `DATABASE_URL` secret, so it also targets whichever node was
   active as of the last admin deploy — it is **not** independently rotated on a
   switch that happens between deploys, only kept in sync as a side effect of the
   next one.
2. **Backend (API container)** — redeployed via `release.yml` on `release:
   published`, over SSH with a forced-command key restricted to
   `scripts/ci-deploy.sh`. That script always checks out the latest git tag and runs:
   ```bash
   GIT_SHA=$(git rev-parse HEAD) docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```
   The prod overlay (`docker-compose.prod.yml`) replaces the base file's port
   mapping with `127.0.0.1:8090:8090` (loopback-only — reachable over SSH for
   on-box debugging, never from the public internet) and injects every runtime
   secret as an explicit environment variable rather than relying on `.env`
   surviving into the built image (it doesn't; see `.dockerignore`). It also adds
   the `cloudflared` tunnel service, absent from the dev compose file.

## Monitoring & Backups

| What | Tool | Detail |
|---|---|---|
| Uptime | UptimeRobot (free) | 3 HTTP(S) monitors — homepage, `/api/v1/health`, and `/pool-health` (Neon pool headroom — a distinct, lower-urgency alert from the other two) — checked hourly |
| Frontend errors | Sentry | Browser JS project, Error Monitoring only, DSN configured via the admin panel (DB-driven — see below) |
| Backend errors | Sentry | Separate FastAPI project, DSN configured via `api/.env` (`SENTRY_DSN`), `include_local_variables=False` set explicitly to keep uploaded file bytes out of captured stack frames |
| DB backups | GitHub Actions (`db-backup.yml`) | Nightly `pg_dump` of the active Neon node, gzipped, stored as a workflow artifact, 7-day retention — supplements Neon's own point-in-time restore |
| Neon pool health | `job_worker.py`'s usage-poll loop + `/pool-health` | Automatic — every node polled every 15 min (configurable); see [Database Architecture](#database-architecture--multi-node-neon-pool) |
| Retention integrity | `python -m data.tasks canary` | Not currently wired into any external scheduler/alert — exists, meant to be invoked periodically |
| Host resources | `scripts/monitor-resources.sh` | RAM/disk/CPU check with optional Slack-webhook alerting; **not currently installed as a cron job on the VM** |

## Third-Party Services

FileCast's site copy and integration toggles (AdSense, GA4, Sentry DSN) live in two
places that get merged at build time: `site-config.yaml` (committed defaults, all
integrations off) and a `site_settings` DB table (singleton row, admin-editable via
the panel). **The DB row wins whenever the DB is reachable at build time** — so
`site-config.yaml`'s `ga4.enabled: false` is the safe fallback for CI/local builds
(no DB secret there), not necessarily what's live in production. Check the admin
panel's Settings tab for what's actually enabled at any given time, rather than
trusting the YAML file alone.

Known integrations and current status:

| Service | Purpose | Status |
|---|---|---|
| Cloudflare Registrar + DNS | Domain (`filecast.org`) + DNS | Live |
| Cloudflare Pages | Static frontend hosting | Live |
| Cloudflare Tunnel | Backend ingress (no public port on the VM) | Live |
| Cloudflare Web Analytics | Cookieless page-view beacon | Live (gated on a build-time token, absent in CI/local builds) |
| Oracle Cloud (Always Free) | API server VM | Live |
| Neon | Managed Postgres — run as a multi-project failover pool (see [Database Architecture](#database-architecture--multi-node-neon-pool)) | Live. Account-level API key (`NEON_API_KEY`, `worker`-only) powers usage polling and node provisioning checks — Neon does not offer a read-only personal API key outside an Organization account, so this is a full-access key in practice; `neon_api.py` only ever issues `GET` requests as its own self-imposed limit, not an enforced scope |
| Google Analytics 4 | Client event analytics | Live, DB-driven toggle (see above) |
| Google Search Console | Sitemap submission, indexing | Live (Domain property, DNS-verified) |
| Bing Webmaster Tools | Search indexing | **Not configured** |
| Google AdSense | Ad revenue | Config plumbing exists end-to-end (DB fields, admin UI, CSP widening, two ad slots — leaderboard + in-content); deliberately not enabled — no publisher ID yet, holding off applying until organic traffic/indexing builds up |
| Sentry | Error tracking (frontend + backend) | Live, separate projects for each |
| UptimeRobot | Uptime monitoring | Live |
| Google OAuth | Sign-in | Live, `openid email profile` scopes only (no Google verification review required) |
| Email delivery | — | **None** — no email-sending service anywhere in the stack; this is why auth is Google-only (an email/password flow was built and then reverted specifically because there was nothing to send verification/reset emails with) |
| CAPTCHA | Bot mitigation | **None** — deliberately deferred until abuse is actually observed |

---

## Troubleshooting / Known Gotchas

- **Windows + psycopg async**: use `api/dev_server.py`, not a bare
  `uvicorn main:app`, when running the API on a Windows host outside Docker (see
  [VS Code Setup](#vs-code-setup)).
- **`docker compose up -d` without `--build`** silently keeps serving a stale image
  after `git pull`. Always `--build` locally; `GIT_SHA` stamps the image so a
  mismatch is at least visible via `GET /`.
- **Cookie domain**: locally, use `localhost` consistently — a cookie set for host
  `localhost` is not sent to `127.0.0.1` and vice versa.
- **`GITHUB_WORKFLOW` is a reserved env var name** inside GitHub Actions runners —
  the admin-deploy config reads a differently-named var
  (`FILECAST_GITHUB_WORKFLOW`-aliased) to avoid colliding with it.
- **`seed.py` must run with `ENVIRONMENT=production`** in prod — otherwise it also
  inserts two fake dev accounts.
- **Migration history**: `0006_password_auth` is a no-op tombstone (both
  `upgrade()`/`downgrade()` are `pass`) — it's there so any environment whose
  `alembic_version` still points at it doesn't break `alembic upgrade head`. Don't
  delete it.
- **`INITIAL_ADMIN_EMAILS` empty in production** leaves no path to a first admin
  account (dev-login is 404'd outside `ENVIRONMENT=development`, and promoting a
  new admin already requires an existing admin). The only recovery path is a
  direct SQL `UPDATE users SET role='admin' WHERE email='...'` against prod.
- **Local dev/CI always use the static `DATABASE_URL` engine**, never the Neon
  pool — no node is ever registered in a dev/CI Redis, so `db.py`'s dynamic
  accessors fall back to the same single-database engine the app always had. The
  multi-node failover machinery (see
  [Database Architecture](#database-architecture--multi-node-neon-pool)) is a
  production-only behavior; there is nothing to configure locally to exercise it.
- **`UndefinedTable` errors that self-resolve after a few minutes** on an
  otherwise-healthy Neon connection are the pooled-connection `search_path` issue
  described in [Database Architecture](#database-architecture--multi-node-neon-pool)
  — already fixed in `db.py`, but worth recognizing if it ever recurs on a new code
  path that opens a DB connection without going through `get_session()`/`sync_session()`.
