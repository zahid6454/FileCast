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
11. [Production Deployment](#production-deployment)
12. [Monitoring & Backups](#monitoring--backups)
13. [Third-Party Services](#third-party-services)
14. [Troubleshooting / Known Gotchas](#troubleshooting--known-gotchas)

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
├── converter.py            The 6 server-side conversion endpoints (Gotenberg/Ghostscript/pdf2docx)
├── validation.py           Magic-byte / size validation
├── middleware.py           Rate limiting, CORS, request logging
├── data/
│   ├── models.py           SQLAlchemy models (13 tables — see README)
│   ├── security.py         Sessions, cookies, Google OAuth, admin bootstrap
│   ├── tasks.py            Retention purge job + canary check
│   ├── netutil.py          Client-IP resolution (trusts CF-Connecting-IP — tunnel-dependent)
│   └── routers/            One router per admin/user-facing feature (auth, tools, admin_deploy, staff, ...)
├── migrations/              Alembic migrations
├── tests/                   pytest suite (19 files, 374 tests)
├── docker-compose.yml       Base compose: api, purge, gotenberg, postgres (dev-only profile)
├── docker-compose.prod.yml  Prod overlay: Neon, Cloudflare Tunnel, no dev-only postgres
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

The API, Gotenberg, and a local Postgres all run via Docker Compose:

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
- **gotenberg** — LibreOffice/Chromium conversion engine on `http://localhost:3000`
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
of invoking uvicorn directly on Windows.

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
4. **test** — pytest against a real `postgres:16` service container; runs
   `alembic upgrade head` + `alembic check` first (migration/model drift check),
   then `pytest -q` from `api/`

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
    |   - purge (retention loop)           |
    |   - gotenberg (LibreOffice/Chromium) |
    |   - cloudflared                      |
    +--------------------------------------+
                       |  pooled TLS connection
                       v
    +--------------------------------------+
    | Neon Postgres                        |  managed, AWS us-east-2
    | (serverless, autosuspend)            |  free tier: 0.5GB / 100 CU-h/mo
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
| site)                        |  |   api / purge / gotenberg    |  | DB-backed sessions           |
| Cloudflare Tunnel (API       |  | Neon Postgres (managed)      |  |                              |
| ingress)                     |  | Ghostscript (PDF compress)   |  |                              |
| Cloudflare DNS + Registrar   |  |                              |  |                              |
| Cloudflare Web Analytics     |  |                              |  |                              |
| beacon                       |  |                              |  |                              |
+------------------------------+  +------------------------------+  +------------------------------+

+------------------------------+  +------------------------------+  +------------------------------+
| CI/CD (GitHub Actions)       |  | Analytics & SEO              |  | Monitoring                   |
| ----------------------       |  | ---------------              |  | ----------                   |
| ci.yml - lint + tests, every |  | Google Analytics 4           |  | UptimeRobot (hourly checks)  |
| PR                           |  | Google Search Console        |  | Sentry - frontend + backend  |
| deploy.yml - admin-triggered |  | Bing Webmaster (not set up)  |  | Retention purge + canary job |
| publish                      |  | AdSense (built, not enabled) |  |                              |
| release.yml - SSH redeploy   |  |                              |  |                              |
| on release                   |  |                              |  |                              |
| db-backup.yml - nightly      |  |                              |  |                              |
| pg_dump backup               |  |                              |  |                              |
| seed-tools.yml - admin tool  |  |                              |  |                              |
| sync                         |  |                              |  |                              |
+------------------------------+  +------------------------------+  +------------------------------+
```

Every workflow in the CI/CD box is detailed in [GitHub Actions (CI/CD)](#github-actions-cicd)
above; every service in the other five boxes is detailed in
[Third-Party Services](#third-party-services) below, with current status
(live / not configured / built-but-disabled) for each.

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
- **Database**: Neon (managed Postgres, serverless/autosuspend). Production uses a
  pooled read-write connection (`PROD_DATABASE_URL`, deliberately named differently
  from the dev `DATABASE_URL` so the two are never confused); CI/backups use a
  separate read-only role.
- **Retention**: the `purge` Compose service runs `python -m data.tasks purge --loop`
  continuously (24h interval) in the same image as the API — this replaced an
  earlier host-cron design that was never actually installed in production.
  Deletes `user_conversions`/`errors` older than `RETENTION_DAYS` (30 by default)
  and expired sessions; anonymous aggregate `conversions` and anonymous `ratings`
  are never purged. `python -m data.tasks canary` independently verifies the purge
  is actually running (fails if the oldest `user_conversions` row exceeds
  `retention_days + 2` days).

## Production Deployment

Two independent deploy paths — the frontend and backend are **not** deployed
together, and can drift (that's what the `api-drift` CI job watches for):

1. **Frontend (static site)** — the admin panel's "Publish" button (or a manual
   `workflow_dispatch`) triggers `deploy.yml`, which builds `dist/` fresh from
   `master` and pushes it to Cloudflare Pages. Admin trigger flow:
   `POST /api/v1/admin/deploy` → GitHub Actions API dispatch (`workflow_dispatch`
   on `deploy.yml`, ref `master`, always — never a client-supplied ref) using a
   fine-grained PAT scoped to this repo only (`Actions: read/write`) → the panel
   polls run status via a second endpoint. The PAT lives only in the VM's
   `api/.env`; it is never a GitHub Actions secret, since the backend is the thing
   *dispatching* the workflow, not consuming it.
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
| Uptime | UptimeRobot (free) | 2 HTTP(S) monitors — homepage, `/api/v1/health` — checked hourly |
| Frontend errors | Sentry | Browser JS project, Error Monitoring only, DSN configured via the admin panel (DB-driven — see below) |
| Backend errors | Sentry | Separate FastAPI project, DSN configured via `api/.env` (`SENTRY_DSN`), `include_local_variables=False` set explicitly to keep uploaded file bytes out of captured stack frames |
| DB backups | GitHub Actions (`db-backup.yml`) | Nightly `pg_dump`, gzipped, stored as a workflow artifact, 7-day retention — supplements Neon's own point-in-time restore |
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
| Neon | Managed Postgres | Live |
| Google Analytics 4 | Client event analytics | Live, DB-driven toggle (see above) |
| Google Search Console | Sitemap submission, indexing | Live (Domain property, DNS-verified) |
| Bing Webmaster Tools | Search indexing | **Not configured** |
| Google AdSense | Ad revenue | Config plumbing exists end-to-end (DB fields, admin UI, CSP widening, two ad slots — leaderboard + in-content); deliberately not enabled — no publisher ID yet, holding off applying until organic traffic/indexing builds up |
| Sentry | Error tracking (frontend + backend) | Live, separate projects for each |
| UptimeRobot | Uptime monitoring | Live |
| Google OAuth | Sign-in | Live, `openid email profile` scopes only (no Google verification review required) |
| Buy Me a Coffee | Donation link | Live (outbound link only, footer) |
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
