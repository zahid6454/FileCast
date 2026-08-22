# FileCast

FileCast (`filecast.org`) is a privacy-first, free file conversion platform built around
a simple promise: **"Your Files Stay Yours."**

Unlike traditional file converters that upload every file to a remote server, FileCast
runs **89 of its 99 tools** entirely inside the browser (files never leave the device)
and reserves a small, ephemeral FastAPI backend for the **10 tools** that genuinely
need server-side engines (LibreOffice, Chromium, Ghostscript, or a Python library with
no browser equivalent). It also has accounts
(Google sign-in), per-tool ratings, an admin panel, and a 30-day data-retention policy
with a GDPR self-export/self-delete flow.

For local setup, VS Code configuration, CI/CD, and production operations, see
**[DEVELOPMENT.md](DEVELOPMENT.md)**.

---

## Table of Contents
1. [Core Philosophy](#core-philosophy)
2. [Architecture Overview](#architecture-overview)
3. [The Conversion Tools Suite](#the-conversion-tools-suite)
4. [Accounts, Ratings & Admin Panel](#accounts-ratings--admin-panel)
5. [Security & Privacy Safeguards](#security--privacy-safeguards)
6. [Project Structure](#project-structure)
7. [Local Development](#local-development)
8. [Pluggable Tool Architecture (How to Add a Tool)](#pluggable-tool-architecture-how-to-add-a-tool)
9. [Deployment & Monitoring](#deployment--monitoring)
10. [Tech Stack](#tech-stack)
11. [License](#license)

---

## Core Philosophy

- **Zero-Barrier Use:** Free to use, no signup required, no paywalls.
- **Privacy-First Design:** Conversions run client-side wherever technically possible;
  the ten that can't (Office/HTML/EPUB→PDF, PDF→DOCX/PPTX/XLSX, PDF compression,
  PNG→SVG) still hold nothing — files are converted in memory and discarded, never
  written to disk or a database.
- **Minimal Cost Structure:** Runs on free-tier infrastructure end to end (Cloudflare
  Pages, Oracle Cloud Always Free, Neon free tier, UptimeRobot free, Sentry free/trial).
- **No Framework Bloat:** Hand-crafted Python, Jinja2, vanilla CSS, and vanilla
  JavaScript for the site itself. No React/Vue runtime shipped to visitors.
- **Highly Extensible:** A metadata-driven, plug-and-play tool architecture — adding a
  tool is a YAML file + optional JS module + four Markdown files, no core code changes.

---

## Architecture Overview

```
    User
        |
        v
    +-----------------------------+
    | Cloudflare Pages (Static)   |  filecast.org
    | dist/ - 99 tool pages, etc. |
    +-----------------------------+
                  |
                  |  HTTPS - only for the 10 server-side tools + auth/ratings/admin calls
                  v
    +-----------------------------+
    | Cloudflare Tunnel           |  api.filecast.org
    +-----------------------------+
                  |
                  v
    +-----------------------------+
    | FastAPI + Gotenberg         |  Oracle Cloud (Docker)
    | (ephemeral, in-memory)      |
    +-----------------------------+
                  |
                  v
    +-----------------------------+
    | Neon Postgres (managed)     |
    +-----------------------------+
```

That's just the request path a file conversion takes. The rest of the system — how
code ships, what watches it, what it's connected to — looks like this:

```
+----------------------------+  +----------------------------+  +----------------------------+
| Frontend & Edge            |  | Backend & Data             |  | Auth & CI/CD               |
| ---------------            |  | --------------             |  | ------------               |
| Cloudflare Pages           |  | Oracle Cloud VPS (Docker)  |  | Google OAuth               |
| Cloudflare Tunnel          |  | Neon Postgres              |  | GitHub Actions (5          |
| Cloudflare DNS + Registrar |  | Gotenberg + Ghostscript    |  | workflows)                 |
+----------------------------+  +----------------------------+  +----------------------------+

+----------------------------+  +----------------------------+  +----------------------------+
| Analytics & SEO            |  | Monitoring                 |  | Other                      |
| ---------------            |  | ----------                 |  | -----                      |
| Google Analytics 4         |  | UptimeRobot                |  | Buy Me a Coffee            |
| Google Search Console      |  | Sentry (frontend +         |  | (donations)                |
| AdSense (built, not        |  | backend)                   |  |                            |
| enabled)                   |  |                            |  |                            |
+----------------------------+  +----------------------------+  +----------------------------+
```

Full detail on every piece — deploy triggers, monitoring cadence, what's live vs.
still planned — is in [DEVELOPMENT.md](DEVELOPMENT.md#production-architecture).

### System 1: Static Site Frontend (Cloudflare Pages)
A Python static site generator (`build.py`) compiles YAML tool definitions, Markdown
SEO copy, and Jinja2 templates into a flat, production-ready site in `dist/`. Every
tool page, category page, and legal page is pre-rendered. No third-party script CDNs —
every library is self-hosted under `static/lib/` with build-time SRI hashes.

### System 2: Backend API (Oracle Cloud, behind Cloudflare Tunnel)
A FastAPI backend wraps Gotenberg (LibreOffice + Chromium headless) and Ghostscript
for the handful of conversions a browser genuinely can't do. It also owns everything
that needs a database: accounts, sessions, ratings, announcements, admin actions, and
the retention/purge job. Files are received over HTTPS, converted in memory, streamed
back, and never persisted. If the API is down, the 89 client-side tools keep working —
only the 10 server-side tools and account features degrade.

See [DEVELOPMENT.md § Production Architecture](DEVELOPMENT.md#production-architecture)
for the full infrastructure diagram (Cloudflare, Oracle VM, Neon, deploy paths).

---

## The Conversion Tools Suite

**99 tools** across 3 categories — **89 run entirely in the browser**, **10 run on the
backend**.

| Category | Tools | Client-side | Server-side |
|---|---|---|---|
| Developer Tools | 35 | 35 | 0 |
| Document Conversion | 32 | 23 | 9 |
| Image Conversion | 32 | 31 | 1 |

### Document Conversion (32 tools)

| Tool | Execution | Engine | Max size |
|---|---|---|---|
| DOCX → PDF | Server | Gotenberg / LibreOffice | 25MB |
| XLSX → PDF | Server | Gotenberg / LibreOffice | 25MB |
| PPTX → PDF | Server | Gotenberg / LibreOffice | 25MB |
| HTML → PDF | Server | Gotenberg / Chromium | 25MB |
| EPUB → PDF | Server | Custom EPUB flattener → Gotenberg / Chromium | 25MB |
| PDF → DOCX | Server | `pdf2docx` | 25MB |
| PDF → PPTX | Server | PyMuPDF + `python-pptx` | 25MB |
| PDF → XLSX | Server | `pdfplumber` + `openpyxl` | 25MB |
| PDF Compressor | Server | Ghostscript | 25MB |
| PDF Merge | Client | pdf-lib (Web Worker) | 50MB |
| PDF Split | Client | pdf-lib | 50MB |
| PDF Rotate | Client | pdf-lib | 50MB |
| PDF Extract Pages | Client | pdf-lib | 50MB |
| PDF Remove Pages | Client | pdf-lib | 50MB |
| PDF Organize (reorder) | Client | pdf-lib | 50MB |
| PDF Crop | Client | pdf-lib | 50MB |
| PDF Flatten | Client | pdf-lib | 50MB |
| PDF Page Numbers | Client | pdf-lib | 50MB |
| PDF Protect (add password) | Client | pdf-lib | 50MB |
| PDF Unlock (remove password) | Client | pdf-lib | 50MB |
| PDF Watermark | Client | pdf-lib | 50MB |
| PDF → PDF/A | Client | pdf-lib | 50MB |
| PDF → JPG | Client | pdf.js / Canvas | 50MB |
| PDF → PNG | Client | pdf.js / Canvas | 50MB |
| PDF → HTML | Client | pdf.js | 50MB |
| PDF → Text | Client | pdf.js | 50MB |
| Image → PDF | Client | pdf-lib | 20MB |
| JPG → PDF | Client | pdf-lib | 20MB |
| PNG → PDF | Client | pdf-lib | 20MB |
| TXT → PDF | Client | pdf-lib | 5MB |
| Markdown → PDF | Client | pdf-lib | 5MB |
| Markdown → DOCX | Client | Custom DOCX/OOXML writer | 5MB |

### Image Conversion (32 tools — 31 client-side, 1 server-side)

31 client-side, mostly a 20MB limit (10MB for Bulk Image Compressor, Image to Base64,
and SVG Optimizer): AVIF↔JPG/PNG/WebP, HEIC→JPG/PNG/WebP, BMP→JPG, GIF→JPG/PNG,
ICO→PNG, PNG↔ICO/JPG/WebP, JPG↔PNG/WebP, WebP→JPG/PNG, SVG→JPG/PNG, SVG Optimizer,
TIFF→JPG/PNG, Image Compressor, Image Cropper, Image Resizer, Image Rotate/Flip,
Image EXIF/Metadata Remover, Image to Base64, Bulk Image Compressor.

1 server-side: **PNG → SVG** (vectorize), via OpenCV, 10MB.

### Developer Tools (35 tools — all client-side, 5MB limit)

**Format converters:** CSV↔JSON, CSV→XLSX, CSV→XML, TSV→CSV, JSON↔YAML, JSON↔XML,
XML↔YAML, JSON→CSV, JSON→TypeScript interface, HTML→Markdown, Markdown→HTML,
HTML→Text, Base64 Encode/Decode, Base64→Image, URL Encode/Decode.

**Formatters / minifiers / validators:** JSON Formatter, JSON Minifier, JSON
Validator, JSON Diff, XML Formatter, XML Validator, HTML Formatter, HTML Minifier,
CSS/JS Minifier, YAML Validator.

**Generators / decoders:** UUID Generator, Hash Generator (MD5/SHA-256), QR Code
Generator, Barcode Generator, JWT Decoder, Unix Timestamp Converter, Number Base
Converter.

The full, always-current list is the source of truth in [tools/](tools/) — one YAML
file per tool.

---

## Accounts, Ratings & Admin Panel

FileCast has a real backend behind the "convert files" surface:

- **Accounts** — Google OAuth sign-in only (no password flow — see
  [DEVELOPMENT.md](DEVELOPMENT.md#third-party-services) for why). Signed-in users get
  a 2× file-size limit, conversion history, favorites (up to 100), and saved
  preferences.
- **Ratings** — anonymous per-tool yes/no voting (deduped by browser fingerprint, not
  account), plus optional free-text "what went wrong" feedback.
- **Announcements** — admin-managed site-wide banners with scheduling (`starts_at`/
  `ends_at`).
- **GDPR** — signed-in users can export (`GET /api/v1/users/me/export`) or fully
  delete (`DELETE /api/v1/users/me`) their account data at any time; anonymous
  ratings are detached (kept, unlinked) rather than deleted, since they carry no PII.
- **Retention** — a background purge job deletes per-user conversion history and
  error logs older than 30 days, and expired sessions, automatically. Anonymous
  aggregate counters are kept indefinitely.
- **Admin panel** (`/admin`) — a staff-only SPA with tabs for a stats dashboard, tool
  registry (enable/disable/reorder/maintenance mode, plus a "Sync Tools" button that
  re-seeds the DB from `tools/*.yaml`), announcements CRUD, user list/detail, error
  log viewer, site settings (AdSense/GA4/Sentry toggles + site copy overrides), staff
  management (grant/revoke admin), and a "Publish" button that triggers a full
  frontend deploy via GitHub Actions.
- **Staff/RBAC** — a small allow-list of "config owner" emails are always admin on
  login (a break-glass path, not revocable via the UI); further admins are granted
  in-app by an existing admin.

---

## Security & Privacy Safeguards

### Client-Side Tools
1. **Zero Data Upload:** Files are processed with browser-resident WebAssembly or
   JavaScript. No file payload is ever sent over the network for these 89 tools.
2. **Memory Isolation:** Files live only in the active tab's RAM; download Blob URLs
   are explicitly revoked after use. Several PDF tools run inside a dedicated Web
   Worker to keep the main thread responsive on large files.
3. **Self-Hosted Dependencies:** Every library (`pdf-lib`, `pdf.js`, `heic2any`, ...)
   is hosted under `static/lib/` with build-time Subresource Integrity (SRI) hashes.
   No third-party script CDN is used anywhere.
4. **Security Headers:** CSP, HSTS (`max-age=31536000; includeSubDomains; preload`),
   X-Frame-Options, X-Content-Type-Options, and Referrer-Policy are generated by
   `build.py` and shipped via Cloudflare Pages' native `_headers` support.

### Server-Side Tools & API
1. **Magic-Byte Verification:** The API checks a file's actual binary signature
   before processing — renaming an `.exe` to `.docx` is rejected, not converted.
2. **Hardened Containerization:** Gotenberg runs with `no-new-privileges`, dropped
   capabilities, tmpfs scratch space, and a memory cap.
3. **No Storage:** Uploaded files are read into a capped in-memory buffer, converted,
   streamed back to the client, and discarded — nothing is written to disk or a DB.
4. **Rate Limiting:** Per-IP, per-endpoint limits (e.g. 20/hour on the ten conversion
   endpoints, tighter still on auth endpoints) return `429` on abuse.
5. **No Public Ingress:** The API server has no public inbound port at all — it's
   reached exclusively through a Cloudflare Tunnel, which is also what makes it safe
   for the app to trust Cloudflare's client-IP header for rate limiting.
6. **Sessions:** DB-backed, `httponly`/`secure`/`samesite=lax` cookies, session
   tokens stored server-side only as a SHA-256 hash of the actual cookie value.

---

## Project Structure

```
FileCast/
├── api/                    FastAPI backend — see DEVELOPMENT.md for the full layout
│   ├── main.py             App entrypoint, middleware stack, router registration
│   ├── converter.py        The 10 server-side conversion endpoints
│   ├── data/
│   │   ├── models.py       14 SQLAlchemy models (users, sessions, tools, ratings, ...)
│   │   ├── security.py     Sessions, cookies, Google OAuth, admin bootstrap
│   │   ├── tasks.py        Retention purge job + canary check
│   │   └── routers/        auth, tools, admin_deploy, staff, site_settings, ...
│   ├── migrations/         Alembic migrations
│   ├── tests/               pytest suite
│   ├── docker-compose.yml       Base compose (api, purge, gotenberg, dev-only postgres)
│   └── docker-compose.prod.yml  Prod overlay (Neon, Cloudflare Tunnel)
├── assets/                 Design assets (logo, SVG graphics)
├── content/                SEO/help content — content/{tool-id}/{4 markdown files}
├── e2e/                    Playwright specs
├── scripts/                Ops scripts (prod deploy hook, resource monitor)
├── static/
│   ├── css/style.css       Core design system stylesheet
│   ├── js/
│   │   ├── shared*.js      Uploader, search, batch/multi-file coordination
│   │   ├── server-upload.js  API bridge for the 10 server-side tools
│   │   ├── admin/           Admin panel SPA modules (dashboard, tools, users, ...)
│   │   └── converters/      One JS module per client-side tool
│   └── lib/                 Self-hosted third-party JS libraries + SRI
├── templates/               Jinja2 templates (base, home, tool, tool-text, admin, ...)
├── test/                    Vitest unit specs
├── tools/                   One YAML per tool — the catalogue source of truth (99 files)
├── build.py                 Site generator, SRI builder, headers/redirects generator
├── seed.py                  Seeds tools/*.yaml into the tools table
├── site-config.yaml         Global config (base URL, categories, integration defaults)
└── LICENSE                  Apache 2.0
```

---

## Local Development

Full setup instructions — virtual environment, Docker Compose for the API, VS Code
Testing/Debug configuration, running each test suite, and linting — live in
**[DEVELOPMENT.md](DEVELOPMENT.md)**. Quick start:

```bash
# Static site
python -m venv .venv && .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python build.py --watch                              # http://localhost:8000

# API (separate terminal)
cd api
GIT_SHA=$(git rev-parse HEAD) docker compose --profile dev-only up -d --build
```

Or on Windows, `dev.bat` does both in one step.

---

## Pluggable Tool Architecture (How to Add a Tool)

Adding a tool requires no changes to the core generation script.

```
Step 1: Write tool YAML      Step 2: Add JS Converter      Step 3: Write Content Files
┌─────────────────────┐      ┌──────────────────────┐      ┌───────────────────────┐
│ tools/my-tool.yaml  │ ───→ │ static/js/converters │ ───→ │ content/my-tool/      │
│                     │      │ /my-tool.js          │      │ {4 markdown files}    │
└─────────────────────┘      └──────────────────────┘      └───────────────────────┘
                                                                       │
                                                                       ▼
                                                           Run: python build.py
```

### Step 1: Create a YAML Config
`tools/my-tool.yaml`:
```yaml
id: my-tool
name: My Format Converter
slug: /convert/my-format-converter
category: image-conversion   # or document-conversion, developer-tools
type: client-side             # or server-side, for API-backed tools
input_format: MYF
output_format: JPG
accept_extensions: [.myf]
output_extension: .jpg
js_module: converters/my-tool.js
max_file_size: 20MB
bulk_support: true
ui_type: standard              # or text-input, multi-file, text-diff
meta:
  title: "Convert MYF to JPG — Free, Private"
  description: "Convert MYF to JPG inside your browser instantly."
  keywords: ["myf to jpg", "myf converter"]
content:
  what_is: "content/my-tool/what-is.md"
  comparison: "content/my-tool/comparison.md"
  when_to_use: "content/my-tool/when-to-use.md"
  faq: "content/my-tool/faq.md"
related_tools: [png-to-jpg, webp-to-jpg]
```

### Step 2: Implement the JS Converter (client-side tools)
`static/js/converters/my-tool.js`:
```javascript
window.convertFile = async function(file) {
    // conversion logic here (canvas, wasm module, pdf-lib worker, etc.)
    return new Blob([/* output bytes */], { type: 'image/jpeg' });
};
```

### Step 3: Write the Content Files
`content/my-tool/` needs exactly 4 files: `what-is.md`, `comparison.md`,
`when-to-use.md`, `faq.md` (5 Q&A pairs, parsed into structured FAQ markup).

Run `python build.py`. The tool appears automatically on the homepage, category nav,
sitemap, and breadcrumbs — and, once the deploy's admin trigger runs `seed.py` (or the
next full seed), in the admin panel's tool registry.

---

## Deployment & Monitoring

Full detail — the two independent deploy paths, every GitHub Actions workflow,
backup strategy, and the complete third-party-service status table — lives in
**[DEVELOPMENT.md](DEVELOPMENT.md#github-actions-cicd)**. Summary:

- **Frontend:** Cloudflare Pages, deployed by a GitHub Actions workflow that the
  admin panel's "Publish" button (or a manual dispatch) triggers.
- **Backend:** Docker Compose on an Oracle Cloud VM, behind a Cloudflare Tunnel
  (no public inbound port), redeployed via SSH on GitHub Release publish.
- **Database:** Neon (managed Postgres), with nightly `pg_dump` backups retained
  7 days in GitHub Actions artifacts, on top of Neon's own point-in-time restore.
- **CI:** every PR runs Python lint, JS lint, JS unit + E2E tests, and the full
  pytest suite against a real Postgres service container.
- **Monitoring:** UptimeRobot (hourly checks on the homepage and `/api/v1/health`),
  Sentry (separate frontend and backend projects, error tracking only).
- **Analytics/SEO:** Google Analytics 4 and Google Search Console are live; Bing
  Webmaster Tools is not yet configured; AdSense is built end-to-end but
  deliberately not enabled yet.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Static site generator | Python, Jinja2, PyYAML, Markdown |
| Frontend | Vanilla JS + CSS (no framework), self-hosted libraries |
| Backend | FastAPI, SQLAlchemy (async), Alembic, Pydantic Settings |
| Conversion engines | Gotenberg (LibreOffice + Chromium), Ghostscript, pdf2docx |
| Database | Postgres (Neon in production) |
| Auth | Google OAuth 2.0, DB-backed sessions |
| Error tracking | Sentry |
| Hosting | Cloudflare Pages (static) + Oracle Cloud VM (API), Cloudflare Tunnel |
| JS testing | Vitest, Playwright (+ axe-core for accessibility) |
| Python testing | pytest, pytest-asyncio |
| Linting | ruff (Python), Biome (JS/CSS/JSON) |
| CI/CD | GitHub Actions |

---

## License

This project is licensed under the **Apache License 2.0**. See [LICENSE](LICENSE)
for the full text.
