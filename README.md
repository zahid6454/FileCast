# FileCast

FileCast (`filecast.org`) is a privacy-first, free, ad-supported file conversion platform built around a simple, powerful promise: **"Your Files Stay Yours."** 

Unlike traditional file converters that upload all files to remote servers, FileCast utilizes a dual-system architecture. It runs **28 client-side tools** directly inside the user's browser (meaning files never leave their device) and reserves a secure, ephemeral **FastAPI backend** for **6 server-side tools** (where files are processed in-memory and immediately deleted).

---

## Table of Contents
1. [Core Philosophy](#core-philosophy)
2. [Architecture Overview](#architecture-overview)
3. [The Conversion Tools Suite](#the-conversion-tools-suite)
4. [Security & Privacy Safeguards](#security--privacy-safeguards)
5. [Project Structure](#project-structure)
6. [Local Development & Setup](#local-development--setup)
7. [Pluggable Tool Architecture (How to Add a Tool)](#pluggable-tool-architecture-how-to-add-a-tool)
8. [Deployment & Monitoring](#deployment--monitoring)
9. [License](#license)

---

## Core Philosophy

- **Zero-Barrier Use:** Free to use, no signup, no usage limits, and no paywalls.
- **Privacy-First Design:** Complete transparency. Conversions run client-side by default.
- **Minimal Cost Structure:** Designed to cost $0/month to run at launch by utilizing free-tier static hosting and serverless/free VPS layers.
- **No Framework Bloat:** Hand-crafted using Python, Jinja2, vanilla CSS, and pure vanilla JavaScript. No heavy Node.js tools or React runtimes.
- **Highly Extensible:** A metadata-driven plug-and-play architecture. Adding a tool requires only a YAML configuration, custom JS logic (if client-side), and Markdown content.

---

## Architecture Overview

FileCast splits its workload into two independent systems:

```
                    ┌─────────────────────────────┐
                    │  Cloudflare Pages (Static)  │
User ──────────────→│  Static HTML/CSS/JS Assets  │
                    │  (28 Client-Side tools)     │
                    └─────────────────────────────┘
                                 │
                                 │ (Only for DOCX/PPTX/XLSX/PDF-Compress/PDF-to-DOCX)
                                 │ Encrypted HTTPS POST API Request
                                 ▼
                    ┌─────────────────────────────┐
                    │     API Server (Docker)     │
                    │  FastAPI + Gotenberg Engine  │
                    │   (Ephemeral in-memory)     │
                    └─────────────────────────────┘
```

### System 1: Static Site Frontend (Cloudflare Pages)
A Python-based static site generator (`build.py`) compiles YAML definitions, Markdown SEO copy, and Jinja2 templates into a flat, production-ready website in `dist/`.
- **Pre-rendered Pages:** Every category page, tool page, terms, privacy, and homepage is precompiled.
- **Zero JS Framework overhead:** Vanilla JS manages the files. Only the script/library relevant to the active tool is loaded.
- **Performance Optimized:** Clean CSS variables, automatic system dark mode support, and zero external CDNs (all library JS is self-hosted with SRI hashes).

### System 2: Backend API Server (Oracle Cloud Free Tier)
A FastAPI backend wraps Gotenberg (LibreOffice + Chromium headless) and Ghostscript for conversions that cannot be performed in the browser.
- **No Persistence:** Files are received via HTTPS, converted in memory, returned to the client, and immediately purged from the container space.
- **Decoupled Fallback:** If the API server experiences downtime, the frontend remains fully functional, and 28 of the 34 tools continue to operate.

---

## The Conversion Tools Suite

FileCast lists **34 tools** across three categories. 28 run entirely in the browser, and 6 run on the backend.

### 1. Image Conversions & Operations (14 Tools - 100% Client-Side)
*File size limit: 20MB (browser memory constraint)*

| # | Tool | Library / API Used | Notes |
|---|---|---|---|
| 1 | **HEIC → JPG** | `heic2any.min.js` | Decodes Apple HEIC photos inside browser |
| 2 | **PNG → JPG** | HTML5 Canvas API | Replaces transparent backgrounds with solid white |
| 3 | **JPG → PNG** | HTML5 Canvas API | Cross-linked with PNG to JPG |
| 4 | **WebP → JPG** | HTML5 Canvas API | Replaces transparency with white background |
| 5 | **WebP → PNG** | HTML5 Canvas API | Seamless client-side format change |
| 6 | **JPG → WebP** | HTML5 Canvas API | Encodes to WebP format directly in browser |
| 7 | **PNG → WebP** | HTML5 Canvas API | Encodes PNG to modern web formats |
| 8 | **SVG → PNG** | FileReader + Canvas | Renders vector graphics to a raster canvas |
| 9 | **BMP → JPG** | HTML5 Canvas API | Simple canvas redraw and export |
| 10| **GIF → JPG** | HTML5 Canvas API | Extracts the first frame of the GIF as a static JPG |
| 11| **TIFF → JPG** | `utif.min.js` | Employs custom canvas decoding for TIFF streams |
| 12| **Image Compressor** | `browser-image-compression` | Interactive slider to adjust compression quality |
| 13| **Image Resizer** | HTML5 Canvas API | Allows width/height inputs with aspect ratio locks |
| 14| **Bulk Image Compressor** | `browser-image-compression` | Processes up to 10 files (max 10MB each) sequentially |

### 2. Document & PDF Workflows (12 Tools - 6 Client-Side, 6 Server-Side)

| # | Tool | Execution | Engine / Library | Notes | File Limit |
|---|---|---|---|---|---|
| 15| **PDF Merge** | Client-Side | `pdf-lib.min.js` | Merges 2+ PDF files into one | 50MB |
| 16| **PDF Split** | Client-Side | `pdf-lib.min.js` | Splits PDF pages into individual files | 50MB |
| 17| **PDF Rotate** | Client-Side | `pdf-lib.min.js` | Rotates pages by 90/180/270 degrees | 50MB |
| 18| **PDF → PNG** | Client-Side | `pdf.js` / Canvas | Renders each page into a downloadable image | 50MB |
| 19| **PDF → JPG** | Client-Side | `pdf.js` / Canvas | Renders pages into JPG files | 50MB |
| 20| **Image → PDF** | Client-Side | `pdf-lib.min.js` | Packs multiple images into a single PDF doc | 50MB |
| 21| **DOCX → PDF** | Server-Side | Gotenberg / LibreOffice | Retains formatting and layout structure | 25MB |
| 22| **XLSX → PDF** | Server-Side | Gotenberg / LibreOffice | Converts tabular layout to print-ready page | 25MB |
| 23| **PPTX → PDF** | Server-Side | Gotenberg / LibreOffice | Turns slide presentation into PDF slides | 25MB |
| 24| **HTML → PDF** | Server-Side | Gotenberg / Chromium | Headless rendering of HTML syntax to PDF | 25MB |
| 25| **PDF → DOCX** | Server-Side | Gotenberg / LibreOffice | Converts PDF layers back into editable doc | 25MB |
| 26| **PDF Compress** | Server-Side | Ghostscript | Quality options: Screen, Ebook, Printer, Prepress | 25MB |

### 3. Developer Tools (8 Tools - 100% Client-Side)
*File size limit: 5MB (browser parsing is memory intensive)*

| # | Tool | Engine | UI Type | Features |
|---|---|---|---|---|
| 27 | **JSON → CSV** | Pure JS | `text-input` | Formats data tables with column headers |
| 28 | **CSV → JSON** | Pure JS | `text-input` | Parses CSV rows into structured JSON arrays |
| 29 | **JSON → YAML** | Pure JS | `text-input` | Converts syntax styles; includes swap options |
| 30 | **YAML → JSON** | Pure JS | `text-input` | Re-parses YAML strings back into standard JSON |
| 31 | **JSON → XML** | Pure JS | `text-input` | Recursive XML serializer |
| 32 | **XML → JSON** | Pure JS | `text-input` | Employs DOMParser to map XML tags to objects |
| 33 | **Markdown → HTML** | Pure JS | `text-input` | Instantly converts Markdown styling to HTML nodes |
| 34 | **HTML → Markdown** | Pure JS | `text-input` | Traverses DOM elements to generate markdown equivalents |

---

## Security & Privacy Safeguards

### Client-Side Tools
1. **Zero Data Upload:** The files are processed using browser-resident Web Assembly (Wasm) or Javascript scripts. No remote request is ever sent with file payloads.
2. **Memory Isolation:** Files live only in the browser's active tab RAM. Closing the tab immediately destroys the object pointers. Blob URLs created for download are explicitly revoked after use.
3. **Script Sandboxing:** Conversion libraries are isolated from analytics and ad scripts. Ad units load inside standard separate frame contexts to prevent access to input files.
4. **Self-Hosted Dependency Trees:** Every library (e.g., `pdf-lib`, `heic2any`) is hosted locally in `/static/lib/` and verification hashes (**Subresource Integrity / SRI**) are generated during the build step. No third-party script CDN is used.
5. **Security Headers:** The project injects custom Content Security Policies (CSP) via Cloudflare `_headers` configuration.

### Server-Side Tools
1. **Magic Bytes Verification:** The API reads magic bytes (first few bytes of files) to verify file types before processing. Renaming an executable `.exe` file to `.docx` is flagged and rejected.
2. **Hardened Containerization:** The Gotenberg Docker container is locked down:
   - Configured with `--security-opt=no-new-privileges`
   - Bound to a read-only filesystem where possible
   - RAM utilization is capped at 1GB to prevent resource exhaustion attacks
3. **No Storage State:** The FastAPI server writes the payload to temporary system buffers, runs the converter engine, pipes the output to the HTTP client response, and immediately cleans the temporary buffer inside a `finally:` block.
4. **Rate Limiting:** A strict rate limit of 20 conversions per hour per IP address is enforced to prevent automated scraping or denial-of-service, returning `429 Too Many Requests`.

---

## Project Structure

```
FileCast/
├── api/                   # FastAPI Server Codebase
│   ├── main.py            # API App entry point, CORS, and Middlewares
│   ├── converter.py       # Core conversion routes (LibreOffice, Ghostscript, Chromium)
│   ├── validation.py      # Magic bytes and size checkers
│   ├── middleware.py      # Rate limiting logic (20/hour/IP)
│   ├── log.py             # Custom logging settings (anonymizes filenames)
│   ├── Dockerfile         # Python slim environment with Ghostscript
│   ├── docker-compose.yml # Main compose setup for FastAPI + Gotenberg containers
│   └── requirements.txt   # FastAPI dependencies
├── assets/                # Design assets (logo, SVG graphics)
├── content/               # SEO and Help Content for each tool
│   └── {tool-id}/         # 1 folder per tool (contains what-is.md, faq.md, etc.)
├── static/                # Static assets copied to dist/
│   ├── css/
│   │   └── style.css      # Core design system stylesheet
│   ├── js/
│   │   ├── shared.js      # Main uploader, search, and progress events
│   │   ├── shared-text.js # Handler for text-input conversion tools
│   │   ├── shared-multi.js# Batch/multi-file conversion coordinator
│   │   ├── server-upload.js# API bridge handler for server-side tools
│   │   └── converters/    # Browser-side converters (e.g., heic-to-jpg.js)
│   └── lib/               # Self-hosted JavaScript libraries
├── templates/             # Jinja2 Templates
│   ├── base.html          # Standard site layout (nav, headers, footer)
│   ├── home.html          # Homepage with category sections
│   ├── tool.html          # Standard upload UI tool template
│   ├── tool-text.html     # Textarea/prettier tool template
│   ├── tool-multi.html    # Batch operation tool template
│   ├── category.html      # Category listing page template
│   └── 404.html           # 404 page template
├── tools/                 # YAML Tool Configurations
│   └── {tool-id}.yaml     # Tool-specific definitions (type, limits, title, routes)
├── build.py               # Site generator, assets compiler, and SRI builder
├── site-config.yaml       # Core global configuration (base URL, ads settings)
├── requirements.txt       # Frontend build engine dependencies
└── LICENSE                # Apache 2.0 License file
```

---

## Local Development & Setup

### Setting Up the Static Site Builder
1. **Create and Activate a Virtual Environment:**
   ```bash
   python -m venv .venv
   ```
   *On Windows (PowerShell):*
   ```powershell
   .venv\Scripts\Activate.ps1
   ```
   *On macOS/Linux:*
   ```bash
   source .venv/bin/activate
   ```

2. **Install Site Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Build the Static Site Output:**
   To output the static files directly into the `/dist/` folder:
   ```bash
   python build.py
   ```

4. **Run Live Development Server:**
   This starts a local development server on `http://localhost:8000` and watches for files changes to rebuild automatically:
   ```bash
   python build.py --watch
   ```

### Running the API Server
1. **Navigate to the API folder:**
   ```bash
   cd api
   ```

2. **Install Local Dependencies (optional, for IDE autocompletion):**
   ```bash
   pip install -r requirements.txt
   ```

3. **Start with Docker Compose:**
   Run the backend locally via Docker. This starts FastAPI on port `8000`, a sandboxed
   Gotenberg instance, and a local Postgres:
   ```bash
   GIT_SHA=$(git rev-parse HEAD) docker compose --profile dev-only up -d --build
   ```
   `--build` matters: plain `docker compose up -d` reuses whatever image exists, so
   after a `git pull` the containers keep serving the old code while the static site
   is rebuilt fresh — the page then silently falls back for any API field the running
   container doesn't return yet. `GIT_SHA` stamps the image so `GET /` reports the
   commit it was built from, which is what makes that skew visible instead of silent.
   `--profile dev-only` starts the bundled local `postgres` service — omitted in
   production, where `api`/`purge` connect to Neon instead (see
   `docker-compose.prod.yml`).

4. **Verify Health Check:**
   Access the server health status:
   ```bash
   curl http://localhost:8000/health
   ```

---

## Pluggable Tool Architecture (How to Add a Tool)

Adding a tool is automated and requires no modifications to the core generation script.

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
Create `tools/my-tool.yaml`:
```yaml
id: my-tool
name: My Format Converter
slug: /convert/my-format-converter
category: image-conversion # or document-tools, data-text-tools
type: client-side          # or "server-side" for API tools
input_format: MYF
output_format: JPG
accept_extensions: [.myf]
output_extension: .jpg
js_module: converters/my-tool.js
max_file_size: 20MB
bulk_support: true
ui_type: standard
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

### Step 2: Implement the JS Converter (For Client-Side Tools)
Create `static/js/converters/my-tool.js`:
```javascript
/**
 * Conversion logic module.
 * @param {File} file - The file object loaded from upload zone.
 * @returns {Promise<Blob>} The converted result file as a Blob.
 */
window.convertFile = async function(file) {
    // Implement your file conversion parsing logic here
    // Example: Using a canvas or loaded Wasm module
    return new Blob([/* output bytes */], { type: 'image/jpeg' });
};
```

### Step 3: Write the Content Files
Create the directory `content/my-tool/` containing exactly 4 files:
- `what-is.md` — What the format is and how the tool processes it.
- `comparison.md` — A comparison table mapping source characteristics to target format.
- `when-to-use.md` — 5 common conversion scenarios.
- `faq.md` — 5 Q&A pairs (parsed automatically into structured Q&A for the tool page).

Finally, run `python build.py` to compile the changes. The tool will automatically appear on the homepage, category navigation, sitemap, and breadcrumbs.

---

## Deployment & Monitoring

### Static Site (Cloudflare Pages)
- **CI/CD:** Connecting the project repository to Cloudflare Pages triggers an automatic rebuild of `/dist/` using Python on every git branch merge.
- **Sitemap Submission:** The `/sitemap.xml` is automatically generated and submitted to Google Search Console to speed up indexing.

### API Server (Docker on Oracle VPS)
- **Deployment Script:** Run via docker-compose, layering the production overlay
  (explicit env vars pointing at Neon + the Cloudflare Tunnel sidecar — no
  `--profile dev-only`, so the bundled local Postgres never starts):
  ```bash
  GIT_SHA=$(git rev-parse HEAD) docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
  ```
- **Drift Check:** The API deploys separately from Cloudflare Pages, so the site can
  ship a commit the API hasn't. The `api-drift` job in `deploy.yml` reads the commit
  from `GET /` and annotates the run when the live API is missing `api/**` changes.
  It is deliberately `continue-on-error` — the admin panel reports this workflow's
  conclusion, so failing the run would show "Publish failed" for a publish that
  succeeded. An image built without `GIT_SHA` reports `unknown` and the check
  reports that it cannot verify, rather than passing silently.
- **Error Tracking & Logging:**
  - **Frontend / Backend Errors:** Monitored using Sentry's free tier.
  - **Uptime Monitoring:** UptimeRobot polls `/health` endpoints every 5 minutes.
  - **Analytics:** Google Analytics 4 tracks client event metrics (`conversion_started`, `conversion_completed`, `conversion_failed`).

---

## License

This project is open-source and licensed under the **Apache License 2.0**. See the [LICENSE](file:///F:/Workstation/Projects/FileCast/LICENSE) file for the full text.
