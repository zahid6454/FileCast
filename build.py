#!/usr/bin/env python3
"""FileCast static site generator.

Reads tool configs (YAML), content (Markdown), and templates (Jinja2),
then outputs a complete static site to dist/.

Usage:
    python build.py              # Build to dist/
    python build.py --serve      # Build + start local preview server
    python build.py --watch      # Watch for changes, auto-rebuild + live reload
"""

import argparse
import base64
import hashlib
import http.server
import os
import re
import shutil
import sys
from datetime import date
from pathlib import Path

import csscompressor
import jinja2
import markdown
import rjsmin
import yaml

# Ensure console output is UTF-8 so non-ASCII characters (e.g. the "→" in
# build logs) don't crash on Windows' default cp1252 stdout.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
TEMPLATES_DIR = ROOT / "templates"
TOOLS_DIR = ROOT / "tools"
STATIC_DIR = ROOT / "static"
ASSETS_DIR = ROOT / "assets"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def parse_file_size(size_str: str) -> int:
    """Convert human-readable size like '20MB' to bytes."""
    size_str = size_str.strip().upper()
    match = re.match(r"^(\d+(?:\.\d+)?)\s*(KB|MB|GB)$", size_str)
    if not match:
        raise ValueError(f"Cannot parse file size: {size_str!r}")
    value = float(match.group(1))
    unit = match.group(2)
    multipliers = {"KB": 1024, "MB": 1024**2, "GB": 1024**3}
    return int(value * multipliers[unit])


def file_hash(content: bytes, length: int = 8) -> str:
    """Return first `length` hex chars of SHA-256 digest."""
    return hashlib.sha256(content).hexdigest()[:length]


def sri_hash(content: bytes) -> str:
    """Return SRI integrity attribute value (sha384)."""
    digest = hashlib.sha384(content).digest()
    return "sha384-" + base64.b64encode(digest).decode()


def format_bytes_filter(value: int) -> str:
    """Jinja2 filter: 1048576 → '1.0 MB'."""
    if value < 1024:
        return f"{value} B"
    elif value < 1024**2:
        return f"{value / 1024:.1f} KB"
    elif value < 1024**3:
        return f"{value / 1024 ** 2:.1f} MB"
    else:
        return f"{value / 1024 ** 3:.1f} GB"


def render_markdown(md_path: Path) -> str:
    """Read a markdown file and return HTML. Returns empty string if missing."""
    if not md_path.exists():
        return ""
    text = md_path.read_text(encoding="utf-8")
    return markdown.markdown(text, extensions=["tables", "fenced_code"])


def parse_faq_pairs(md_path: Path) -> list[dict]:
    """Parse FAQ markdown into structured Q&A pairs for FAQPage schema.

    Expects format:
        ### Question text?
        Answer paragraph(s).
    """
    if not md_path.exists():
        return []
    text = md_path.read_text(encoding="utf-8")
    pairs = []
    current_q = None
    current_a_lines: list[str] = []

    for line in text.splitlines():
        if line.startswith("### "):
            if current_q and current_a_lines:
                answer = " ".join(ln.strip() for ln in current_a_lines if ln.strip())
                pairs.append(
                    {
                        "@type": "Question",
                        "name": current_q,
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": answer,
                        },
                    }
                )
            current_q = line[4:].strip()
            current_a_lines = []
        elif line.startswith("## "):
            continue
        elif current_q is not None:
            current_a_lines.append(line)

    if current_q and current_a_lines:
        answer = " ".join(ln.strip() for ln in current_a_lines if ln.strip())
        pairs.append(
            {
                "@type": "Question",
                "name": current_q,
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": answer,
                },
            }
        )

    return pairs


# ---------------------------------------------------------------------------
# Step 1: Clean dist/
# ---------------------------------------------------------------------------


def clean_dist():
    if DIST.exists():
        for item in DIST.iterdir():
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()
    else:
        DIST.mkdir(parents=True)


# ---------------------------------------------------------------------------
# Step 2: Load site config
# ---------------------------------------------------------------------------


def load_site_config() -> dict:
    config_path = ROOT / "site-config.yaml"
    with open(config_path, encoding="utf-8") as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# Step 3-4: Discover and parse tool configs
# ---------------------------------------------------------------------------


def load_tools() -> list[dict]:
    tools = []
    if not TOOLS_DIR.exists():
        return tools
    for yaml_path in sorted(TOOLS_DIR.glob("*.yaml")):
        with open(yaml_path, encoding="utf-8") as f:
            tool = yaml.safe_load(f)
        if not isinstance(tool, dict):
            print(f"  [warn] Skipping invalid tool file: {yaml_path.name}")
            continue
        if "id" not in tool:
            print(f"  [warn] Skipping tool without 'id': {yaml_path.name}")
            continue
        if not tool.get("enabled", True):
            print(f"  [skip] {tool['id']} (disabled)")
            continue
        tool["max_file_size_bytes"] = parse_file_size(tool.get("max_file_size", "20MB"))
        tools.append(tool)
    return tools


# ---------------------------------------------------------------------------
# Step 5: Group tools by category
# ---------------------------------------------------------------------------


def group_tools_by_category(tools: list[dict], categories: list[dict]) -> dict:
    """Return {category_id: {**category_data, 'tools': [...]}} only for non-empty categories."""
    by_cat = {}
    for cat in categories:
        cat_tools = [t for t in tools if t.get("category") == cat["id"]]
        if cat_tools:
            by_cat[cat["id"]] = {**cat, "tools": cat_tools}
    return by_cat


# ---------------------------------------------------------------------------
# Step 6: Load content markdown for each tool
# ---------------------------------------------------------------------------


def load_tool_content(tools: list[dict]):
    """Mutate each tool dict: add 'content_html' with rendered HTML blocks
    and 'faq_structured_data' with parsed Q&A pairs for FAQPage schema."""
    for tool in tools:
        content_config = tool.get("content", {})
        content_html = {}
        for key, rel_path in content_config.items():
            md_path = ROOT / rel_path
            content_html[key] = render_markdown(md_path)
        tool["content_html"] = content_html

        faq_path = content_config.get("faq", "")
        if faq_path:
            tool["faq_structured_data"] = parse_faq_pairs(ROOT / faq_path)
        else:
            tool["faq_structured_data"] = []


# ---------------------------------------------------------------------------
# Step 7: Resolve related tools
# ---------------------------------------------------------------------------


def resolve_related_tools(tools: list[dict]):
    """Filter out related_tools IDs that don't exist in the tool set.

    Stores lightweight copies (id, name, slug, meta, category, type) to avoid
    circular references when templates serialize tool data to JSON.
    """
    tool_map = {t["id"]: t for t in tools}
    RELATED_FIELDS = (
        "id",
        "name",
        "slug",
        "meta",
        "category",
        "type",
        "input_format",
        "output_format",
    )
    for tool in tools:
        raw = tool.get("related_tools", []) or []
        resolved = []
        for tid in raw:
            if tid in tool_map:
                resolved.append(
                    {k: tool_map[tid][k] for k in RELATED_FIELDS if k in tool_map[tid]}
                )
        tool["related_tools_resolved"] = resolved

        reverse_id = tool.get("reverse_tool")
        if reverse_id and reverse_id in tool_map:
            rt = tool_map[reverse_id]
            tool["reverse_tool_resolved"] = {
                k: rt[k] for k in RELATED_FIELDS if k in rt
            }
            target_reverse = tool_map[reverse_id].get("reverse_tool")
            if target_reverse != tool["id"]:
                print(
                    f"  [warn] {tool['id']}: reverse_tool '{reverse_id}' does not point back (has '{target_reverse}')"
                )
        elif reverse_id:
            print(f"  [warn] {tool['id']}: reverse_tool '{reverse_id}' not found")
            tool["reverse_tool_resolved"] = None
        else:
            tool["reverse_tool_resolved"] = None


# ---------------------------------------------------------------------------
# Steps 8-12: Process and copy static assets
# ---------------------------------------------------------------------------


def process_assets() -> dict:
    """Copy, minify, hash, and SRI all static assets.

    Returns an asset_map:
        {
            "css/style.css": {"path": "css/style.a1b2c3d4.css", "sri": "sha384-..."},
            "js/shared.js": {"path": "js/shared.e5f6g7h8.js", "sri": "sha384-..."},
            ...
        }
    """
    asset_map = {}

    # --- CSS ---
    css_src = STATIC_DIR / "css"
    if css_src.exists():
        for css_file in css_src.glob("*.css"):
            raw = css_file.read_text(encoding="utf-8")
            minified = csscompressor.compress(raw)
            content_bytes = minified.encode("utf-8")
            h = file_hash(content_bytes)
            hashed_name = f"{css_file.stem}.{h}.css"
            out_path = DIST / "css" / hashed_name
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(content_bytes)
            rel_key = f"css/{css_file.name}"
            asset_map[rel_key] = {
                "path": f"css/{hashed_name}",
                "sri": sri_hash(content_bytes),
            }

    # --- JS (our code) ---
    js_src = STATIC_DIR / "js"
    if js_src.exists():
        for js_file in js_src.rglob("*.js"):
            raw = js_file.read_text(encoding="utf-8")
            minified = rjsmin.jsmin(raw)
            content_bytes = minified.encode("utf-8")
            h = file_hash(content_bytes)
            rel = js_file.relative_to(STATIC_DIR / "js")
            hashed_name = f"{rel.stem}.{h}{rel.suffix}"
            out_rel = Path("js") / rel.parent / hashed_name
            out_path = DIST / out_rel
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(content_bytes)
            rel_key = f"js/{rel.as_posix()}"
            asset_map[rel_key] = {
                "path": out_rel.as_posix(),
                "sri": sri_hash(content_bytes),
            }

    # --- Third-party JS libs (already minified, just hash + SRI) ---
    lib_src = STATIC_DIR / "lib"
    if lib_src.exists():
        for lib_file in lib_src.rglob("*.js"):
            content_bytes = lib_file.read_bytes()
            h = file_hash(content_bytes)
            rel = lib_file.relative_to(STATIC_DIR / "lib")
            hashed_name = f"{rel.stem}.{h}{rel.suffix}"
            out_rel = Path("lib") / rel.parent / hashed_name
            out_path = DIST / out_rel
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(content_bytes)
            rel_key = f"lib/{rel.as_posix()}"
            asset_map[rel_key] = {
                "path": out_rel.as_posix(),
                "sri": sri_hash(content_bytes),
            }

    # --- Images/SVGs ---
    img_src = STATIC_DIR / "images"
    if img_src.exists():
        img_dst = DIST / "images"
        shutil.copytree(img_src, img_dst, dirs_exist_ok=True)

    # --- Favicon to root ---
    favicon_src = ASSETS_DIR / "favicon.svg"
    if favicon_src.exists():
        shutil.copy2(favicon_src, DIST / "favicon.svg")

    # --- Copy logo SVGs to dist/images/ for templates ---
    for logo in ["logo-light.svg", "logo-dark.svg", "icon.svg"]:
        src = ASSETS_DIR / logo
        if src.exists():
            dst = DIST / "images" / logo
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    return asset_map


# ---------------------------------------------------------------------------
# Step 13: Set up Jinja2 environment
# ---------------------------------------------------------------------------


def create_jinja_env(
    site_config: dict, asset_map: dict, categories_with_tools: dict
) -> jinja2.Environment:
    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=True,
        undefined=jinja2.StrictUndefined,
    )
    env.filters["format_bytes"] = format_bytes_filter
    env.globals["site"] = site_config.get("site", {})
    env.globals["adsense"] = site_config.get("adsense", {})
    env.globals["ga4"] = site_config.get("ga4", {})
    env.globals["sentry"] = site_config.get("sentry", {})
    api_config = site_config.get("api", {})
    api_url_override = os.environ.get("API_URL")
    if api_url_override:
        api_config["base_url"] = api_url_override.rstrip("/")
    env.globals["api"] = api_config
    env.globals["assets"] = asset_map
    env.globals["nav_categories"] = categories_with_tools
    env.globals["build_date"] = date.today().isoformat()
    return env


# ---------------------------------------------------------------------------
# Step 14: Render pages
# ---------------------------------------------------------------------------


def render_page(
    env: jinja2.Environment, template_name: str, out_path: Path, **ctx
) -> bool:
    """Render a template to a file inside dist/. Returns False if template missing."""
    try:
        tmpl = env.get_template(template_name)
    except jinja2.TemplateNotFound:
        print(f"  [skip] Template not found: {template_name}")
        return False
    html = tmpl.render(**ctx)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    return True


def render_all_pages(
    env: jinja2.Environment, tools: list[dict], categories_with_tools: dict
):
    # Homepage
    if render_page(
        env,
        "home.html",
        DIST / "index.html",
        categories=categories_with_tools,
        tools=tools,
    ):
        print("  [ok] index.html")

    # Tool pages
    for tool in tools:
        template_name = "tool.html"
        ui = tool.get("ui_type", "standard")
        if ui == "text-input":
            template_name = "tool-text.html"
        elif ui == "multi-file":
            template_name = "tool-multi.html"

        slug = tool.get("slug", f"/convert/{tool['id']}").strip("/")
        out_path = DIST / slug / "index.html"
        cat_id = tool.get("category", "")
        category = categories_with_tools.get(cat_id, {})
        if render_page(env, template_name, out_path, tool=tool, category=category):
            print(f"  [ok] {slug}/index.html")

    # Category pages
    for _cat_id, cat_data in categories_with_tools.items():
        slug = cat_data["slug"]
        out_path = DIST / slug / "index.html"
        if render_page(env, "category.html", out_path, category=cat_data):
            print(f"  [ok] {slug}/index.html")

    # Privacy page
    if render_page(env, "privacy.html", DIST / "privacy" / "index.html"):
        print("  [ok] privacy/index.html")

    # Terms page
    if render_page(env, "terms.html", DIST / "terms" / "index.html"):
        print("  [ok] terms/index.html")

    # About page
    if render_page(env, "about.html", DIST / "about" / "index.html"):
        print("  [ok] about/index.html")

    # Contact page
    if render_page(env, "contact.html", DIST / "contact" / "index.html"):
        print("  [ok] contact/index.html")

    # 404 page
    if render_page(env, "404.html", DIST / "404.html", tools=tools):
        print("  [ok] 404.html")


# ---------------------------------------------------------------------------
# Step 15: Generate sitemap.xml
# ---------------------------------------------------------------------------


def generate_sitemap(site_config: dict, tools: list[dict], categories_with_tools: dict):
    base = (
        site_config.get("site", {}).get("base_url", "https://filecast.io").rstrip("/")
    )
    today = date.today().isoformat()
    urls = []

    urls.append({"loc": f"{base}/", "priority": "1.0"})

    for tool in tools:
        slug = tool.get("slug", f"/convert/{tool['id']}")
        if not slug.startswith("/"):
            slug = f"/{slug}"
        if not slug.endswith("/"):
            slug += "/"
        urls.append({"loc": f"{base}{slug}", "priority": "0.8"})

    for cat_data in categories_with_tools.values():
        urls.append({"loc": f"{base}/{cat_data['slug']}/", "priority": "0.6"})

    urls.append({"loc": f"{base}/privacy/", "priority": "0.3"})
    urls.append({"loc": f"{base}/terms/", "priority": "0.3"})
    urls.append({"loc": f"{base}/about/", "priority": "0.4"})
    urls.append({"loc": f"{base}/contact/", "priority": "0.3"})

    lines = ['<?xml version="1.0" encoding="UTF-8"?>']
    lines.append('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    for u in urls:
        lines.append("  <url>")
        lines.append(f"    <loc>{u['loc']}</loc>")
        lines.append(f"    <lastmod>{today}</lastmod>")
        lines.append(f"    <priority>{u['priority']}</priority>")
        lines.append("  </url>")
    lines.append("</urlset>")

    (DIST / "sitemap.xml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("  [ok] sitemap.xml")


# ---------------------------------------------------------------------------
# Step 16: Generate robots.txt
# ---------------------------------------------------------------------------


def generate_robots(site_config: dict):
    base = (
        site_config.get("site", {}).get("base_url", "https://filecast.io").rstrip("/")
    )
    content = f"User-agent: *\nAllow: /\n\nSitemap: {base}/sitemap.xml\n"
    (DIST / "robots.txt").write_text(content, encoding="utf-8")
    print("  [ok] robots.txt")


# ---------------------------------------------------------------------------
# Step 17: Generate _headers (Cloudflare Pages)
# ---------------------------------------------------------------------------


def generate_headers(site_config: dict):
    api_url = "https://api.filecast.io"
    adsense_enabled = site_config.get("adsense", {}).get("enabled", False)
    ga4_enabled = site_config.get("ga4", {}).get("enabled", False)
    sentry_enabled = site_config.get("sentry", {}).get("enabled", False)

    script_src = "'self'"
    connect_src = f"'self' {api_url}"
    frame_src = "'none'"

    if adsense_enabled:
        script_src += (
            " https://pagead2.googlesyndication.com https://www.googletagmanager.com"
        )
        frame_src = "https://googleads.g.doubleclick.net"
    if ga4_enabled:
        if "googletagmanager" not in script_src:
            script_src += " https://www.googletagmanager.com"
        connect_src += " https://www.google-analytics.com https://analytics.google.com"
    if sentry_enabled:
        script_src += " https://browser.sentry-cdn.com"
        connect_src += " https://*.ingest.sentry.io"

    csp = (
        f"default-src 'self'; "
        f"script-src {script_src}; "
        f"style-src 'self' 'unsafe-inline'; "
        f"img-src 'self' data: blob:; "
        f"connect-src {connect_src}; "
        f"frame-src {frame_src}"
    )

    lines = [
        "/*",
        f"  Content-Security-Policy: {csp}",
        "  X-Content-Type-Options: nosniff",
        "  X-Frame-Options: DENY",
        "  Referrer-Policy: strict-origin-when-cross-origin",
        "",
        "/css/*",
        "  Cache-Control: public, max-age=31536000, immutable",
        "",
        "/js/*",
        "  Cache-Control: public, max-age=31536000, immutable",
        "",
        "/lib/*",
        "  Cache-Control: public, max-age=31536000, immutable",
        "",
        "/images/*",
        "  Cache-Control: public, max-age=86400",
        "",
    ]
    (DIST / "_headers").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("  [ok] _headers")


# ---------------------------------------------------------------------------
# Step 18: Local preview server
# ---------------------------------------------------------------------------


class CORSHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, format, *args):
        pass


def serve(port: int = 8000):
    os.chdir(DIST)
    handler = CORSHandler
    with http.server.HTTPServer(("", port), handler) as httpd:
        print(f"\nServing dist/ at http://localhost:{port}")
        print("Press Ctrl+C to stop.\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


# ---------------------------------------------------------------------------
# Step 19: Watch mode (file watcher + live reload)
# ---------------------------------------------------------------------------

LIVE_RELOAD_SNIPPET = (
    b"<script>(function(){"
    b"var es=new EventSource('/__reload');"
    b"es.onmessage=function(){location.reload();};"
    b"es.onerror=function(){setTimeout(function(){location.reload();},1000);};"
    b"})()</script>"
)


class LiveReloadHandler(http.server.SimpleHTTPRequestHandler):
    """Serves dist/ files and an SSE endpoint for live reload."""

    _reload_event = None  # set by watch()

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def do_GET(self):
        if self.path == "/__reload":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            try:
                while True:
                    self.__class__._reload_event.wait()
                    self.__class__._reload_event.clear()
                    self.wfile.write(b"data: reload\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            return

        # For HTML files, inject the live-reload script before </body>
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        if path.endswith(".html") and os.path.isfile(path):
            self._serve_html(path, 200)
            return

        # Check if the file exists for non-HTML requests
        raw_path = self.translate_path(self.path)
        if not os.path.exists(raw_path):
            four04 = os.path.join(os.getcwd(), "404.html")
            if os.path.isfile(four04):
                self._serve_html(four04, 404)
                return

        super().do_GET()

    def _serve_html(self, filepath, status):
        with open(filepath, "rb") as f:
            content = f.read()
        content = content.replace(b"</body>", LIVE_RELOAD_SNIPPET + b"\n</body>")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, format, *args):
        pass


def watch(port: int = 8000):
    """Watch source files for changes, rebuild, and trigger browser reload."""
    import contextlib
    import io
    import threading
    import time

    reload_event = threading.Event()
    LiveReloadHandler._reload_event = reload_event

    watch_dirs = [TEMPLATES_DIR, TOOLS_DIR, STATIC_DIR, ROOT / "content"]
    watch_files = [ROOT / "site-config.yaml"]

    def get_mtimes():
        mtimes = {}
        for d in watch_dirs:
            if d.exists():
                for f in d.rglob("*"):
                    if f.is_file():
                        mtimes[str(f)] = f.stat().st_mtime
        for f in watch_files:
            if f.exists():
                mtimes[str(f)] = f.stat().st_mtime
        return mtimes

    build()

    os.chdir(DIST)
    httpd = http.server.ThreadingHTTPServer(("", port), LiveReloadHandler)
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()

    print(f"\n🔄 Watching for changes... (http://localhost:{port})")
    print("   Edit templates, CSS, JS, YAML, or content → auto-rebuild + reload")
    print("   Press Ctrl+C to stop.\n")

    prev_mtimes = get_mtimes()

    try:
        while True:
            time.sleep(0.5)
            curr_mtimes = get_mtimes()
            if curr_mtimes != prev_mtimes:
                changed = set(curr_mtimes.keys()) ^ set(prev_mtimes.keys())
                for k in set(curr_mtimes.keys()) & set(prev_mtimes.keys()):
                    if curr_mtimes[k] != prev_mtimes[k]:
                        changed.add(k)
                names = [os.path.basename(c) for c in changed]
                print(f"  [change] {', '.join(names[:5])}")
                prev_mtimes = curr_mtimes
                try:
                    with contextlib.redirect_stdout(io.StringIO()):
                        build()
                    os.chdir(DIST)
                    reload_event.set()
                    print("  [rebuilt] ✓")
                except Exception as e:
                    print(f"  [error] Build failed: {e}")
    except KeyboardInterrupt:
        print("\nStopped.")
        httpd.shutdown()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def build():
    print("FileCast build starting...\n")

    # 1. Clean
    print("[1/10] Cleaning dist/")
    clean_dist()

    # 2. Load config
    print("[2/10] Loading site-config.yaml")
    site_config = load_site_config()

    # 3-4. Load tools
    print("[3/10] Discovering tools")
    tools = load_tools()
    print(f"       Found {len(tools)} tool(s)")

    # 5. Group by category
    print("[4/10] Grouping tools by category")
    categories = site_config.get("categories", [])
    categories_with_tools = group_tools_by_category(tools, categories)
    active_cats = list(categories_with_tools.keys())
    print(f"       Active categories: {active_cats if active_cats else '(none yet)'}")

    # 6. Load content
    print("[5/10] Loading content markdown")
    load_tool_content(tools)

    # 7. Resolve related tools
    print("[6/10] Resolving related tools")
    resolve_related_tools(tools)

    # 8-12. Process assets
    print("[7/10] Processing static assets")
    asset_map = process_assets()
    for key, info in asset_map.items():
        print(f"       {key} → {info['path']}")

    # 13. Jinja2 environment
    print("[8/10] Setting up Jinja2")
    env = create_jinja_env(site_config, asset_map, categories_with_tools)

    # 14. Render pages
    print("[9/10] Rendering pages")
    render_all_pages(env, tools, categories_with_tools)

    # 15-17. Generate support files
    print("[10/10] Generating sitemap, robots.txt, _headers")
    generate_sitemap(site_config, tools, categories_with_tools)
    generate_robots(site_config)
    generate_headers(site_config)

    print(f"\nBuild complete. Output: {DIST}/")


def main():
    parser = argparse.ArgumentParser(description="FileCast static site generator")
    parser.add_argument(
        "--serve", action="store_true", help="Start local preview server after build"
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Watch for changes, auto-rebuild + live reload",
    )
    parser.add_argument(
        "--port", type=int, default=8000, help="Port for preview server (default: 8000)"
    )
    args = parser.parse_args()

    if args.watch:
        watch(args.port)
    else:
        build()
        if args.serve:
            serve(args.port)


if __name__ == "__main__":
    main()
