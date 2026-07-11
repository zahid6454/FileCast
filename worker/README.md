# FileCast Worker API + D1

Cloudflare Worker that provides the FileCast data layer (Phase 1): Google OAuth,
JWT sessions, tool state, ratings, conversion counters + per-user history,
announcements, admin stats, and an admin-triggered rebuild proxy. Runs at
`worker.filecast.io` (separate from the FastAPI `api.filecast.io`).

This directory is **pure addition** — it changes nothing in the existing site.

## Layout

```
worker/
  wrangler.toml            Worker + D1 binding + [triggers] cron + vars
  package.json             wrangler (dev) + itty-router (runtime)
  seed.py                  Seed tools table from tools/*.yaml (global sort_order)
  migrations/0001_initial.sql
  src/
    index.js               Router, CORS, fetch() + scheduled() cron handler
    scheduled.js           Daily 30-day purge (user_conversions + errors)
    middleware.js          JWT/admin/build-key guards, Turnstile verify
    auth.js                Google OAuth (CSRF state) + JWT & fc_logged_in cookies
    tools.js ratings.js conversions.js announcements.js stats.js users.js
    favorites.js preferences.js history.js errors.js deploy.js
    utils/ jwt.js fingerprint.js http.js
```

## Local development

Requires Node.js (>=18) + npm. Then:

```bash
cd worker
npm install
wrangler d1 migrations apply filecast-db --local   # create local schema
python seed.py --local                             # seed tools into local D1
wrangler dev                                        # http://localhost:8787
```

Local secrets go in `worker/.dev.vars` (git-ignored), e.g.:

```
JWT_SECRET=dev-secret
GOOGLE_CLIENT_SECRET=...
TURNSTILE_SECRET=1x0000000000000000000000000000000AA   # CF test "always passes"
GITHUB_PAT=...
FINGERPRINT_SALT=dev-salt
BUILD_KEY=dev-build-key
```

Preview the seed SQL without applying it:

```bash
python seed.py --print
```

## Deploy

```bash
wrangler deploy --env staging     # staging first (Verification requirement)
wrangler deploy                   # production
```

All manual, one-time setup (Cloudflare account, D1 create, Google OAuth client,
secrets, GitHub secrets, Turnstile, rate-limit rules, DNS route, first-admin
bootstrap) is documented in
[`../project-docs/overhaul/manual-work.md`](../project-docs/overhaul/manual-work.md).

## Rate limiting (edge-configured, NOT application code)

Workers are stateless distributed isolates, so an in-memory counter provides no
real protection. Configure **Cloudflare Rate Limiting Rules** in the dashboard
(Security → WAF → Rate limiting rules) on these paths — see manual-work.md #6
for the exact recommended thresholds:

| Path | Method | Suggested limit |
|------|--------|-----------------|
| `/api/conversions` | POST | 30 / min / IP |
| `/api/ratings` | POST | 10 / min / IP |
| `/api/errors` | POST | 20 / min / IP |
| `/api/auth/google/callback` | GET | 10 / min / IP |

Turnstile is enforced in application code (server-side siteverify) on
`/api/conversions`, `/api/ratings`, and `/api/errors` on top of the above.
