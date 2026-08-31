"""Integration — pre-existing converter routes.

Validation/error paths need no Gotenberg (validation runs before the proxy call).
The success path mocks the Gotenberg call so no container is required.
"""

import asyncio
import io
import zipfile

import converter
import pytest
from data import job_worker


async def _enqueue(client, path, files, data=None):
    """POST to an enqueue route and return (job_id, response) — the 202 +
    Location-header contract every /convert/* route now returns (Phase 3)."""
    r = await client.post(path, files=files, data=data or {})
    assert r.status_code == 202, r.text
    body = r.json()
    job_id = body["job_id"]
    assert body["status"] == "queued"
    assert r.headers["location"] == f"/api/v1/convert/jobs/{job_id}"
    return job_id, r


async def _run_and_finish(client, job_id):
    """Run the job synchronously (no Redis, no loop — job_worker.run_job is
    directly callable, per STRESS_TEST_PHASE3_PLAN.md's test-impact note)
    and return the final GET .../jobs/{id} status body."""
    await job_worker.run_job(job_id)
    r = await client.get(f"/api/v1/convert/jobs/{job_id}")
    assert r.status_code == 200
    return r.json()


async def _enqueue_run_and_download(client, path, files, data=None):
    """Full happy-path cycle: enqueue -> run -> poll (done) -> download.
    Returns the download response."""
    job_id, _ = await _enqueue(client, path, files, data)
    status = await _run_and_finish(client, job_id)
    assert status["status"] == "done", status
    return await client.get(f"/api/v1/convert/jobs/{job_id}/download")


async def test_convert_rejects_wrong_extension(client):
    r = await client.post(
        "/api/v1/convert/docx-to-pdf",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "wrong_format"


async def test_convert_rejects_empty_file(client):
    r = await client.post(
        "/api/v1/convert/docx-to-pdf",
        files={"file": ("empty.docx", b"", "application/octet-stream")},
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "empty_file"


async def test_convert_success_with_mocked_gotenberg(client, monkeypatch):
    async def fake_libreoffice(content, filename, extra_form=None):
        return b"%PDF-1.4 fake pdf bytes"

    monkeypatch.setattr(converter, "_convert_libreoffice", fake_libreoffice)
    valid_docx = b"PK\x03\x04" + b"\x00" * 200  # passes magic-byte check
    r = await _enqueue_run_and_download(
        client,
        "/api/v1/convert/docx-to-pdf",
        files={
            "file": (
                "report.docx",
                valid_docx,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"] == 'attachment; filename="report.pdf"'
    assert r.content == b"%PDF-1.4 fake pdf bytes"
    assert "x-conversion-time" in r.headers


async def test_convert_job_status_reports_queued_with_retry_after(client, monkeypatch):
    # Never actually runs the job — proves the status route itself, while
    # queued, carries the Retry-After header the frontend's backoff depends
    # on (STRESS_TEST_PHASE3_PLAN.md).
    valid_docx = b"PK\x03\x04" + b"\x00" * 200
    job_id, _ = await _enqueue(
        client,
        "/api/v1/convert/docx-to-pdf",
        files={
            "file": (
                "report.docx",
                valid_docx,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    r = await client.get(f"/api/v1/convert/jobs/{job_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "queued"
    assert int(r.headers["retry-after"]) >= 1


async def test_convert_job_status_404_for_unknown_job(client):
    r = await client.get("/api/v1/convert/jobs/does-not-exist")
    assert r.status_code == 404
    assert r.json()["error_type"] == "not_found"


async def test_convert_job_download_404_for_unknown_job(client):
    r = await client.get("/api/v1/convert/jobs/does-not-exist/download")
    assert r.status_code == 404


async def test_convert_job_download_rejects_not_yet_done(client):
    valid_docx = b"PK\x03\x04" + b"\x00" * 200
    job_id, _ = await _enqueue(
        client,
        "/api/v1/convert/docx-to-pdf",
        files={
            "file": (
                "report.docx",
                valid_docx,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    r = await client.get(f"/api/v1/convert/jobs/{job_id}/download")
    assert r.status_code == 409
    assert r.json()["error_type"] == "not_ready"


async def test_convert_job_download_503s_during_maintenance(client, monkeypatch):
    # NEON_FAILOVER_PLAN.md §7.6: a second GET-that-writes in this same file
    # (it stamps `job.downloaded_at` and commits) — must be gated the same
    # as every POST /convert/* enqueue route, alongside the OAuth-callback
    # case (test_auth.py). Finish a real job first so this exercises the
    # actual would-otherwise-succeed download path, not a 404/409 short
    # circuit that would 503 for an unrelated reason.
    async def fake_libreoffice(content, filename, extra_form=None):
        return b"%PDF-1.4 fake pdf bytes"

    monkeypatch.setattr(converter, "_convert_libreoffice", fake_libreoffice)
    valid_docx = b"PK\x03\x04" + b"\x00" * 200
    job_id, _ = await _enqueue(
        client,
        "/api/v1/convert/docx-to-pdf",
        files={
            "file": (
                "report.docx",
                valid_docx,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    status = await _run_and_finish(client, job_id)
    assert status["status"] == "done", status

    from data.node_registry import set_maintenance

    await set_maintenance(True)
    try:
        r = await client.get(f"/api/v1/convert/jobs/{job_id}/download")
        assert r.status_code == 503
    finally:
        await set_maintenance(False)

    # The gate is precise, not a one-way trip — the same, still-finished job
    # downloads normally once maintenance lifts.
    r = await client.get(f"/api/v1/convert/jobs/{job_id}/download")
    assert r.status_code == 200


async def test_pdf_to_xlsx_rejects_wrong_extension(client):
    r = await client.post(
        "/api/v1/convert/pdf-to-xlsx",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "wrong_format"


async def test_pdf_to_xlsx_rejects_empty_file(client):
    r = await client.post(
        "/api/v1/convert/pdf-to-xlsx",
        files={"file": ("empty.pdf", b"", "application/pdf")},
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "empty_file"


async def test_pdf_to_xlsx_success_with_mocked_conversion(client, monkeypatch):
    async def fake_convert(content, filename):
        return b"fake xlsx bytes"

    monkeypatch.setattr(converter, "_convert_pdf_to_xlsx", fake_convert)
    valid_pdf = b"%PDF-1.4" + b"\x00" * 200
    r = await _enqueue_run_and_download(
        client,
        "/api/v1/convert/pdf-to-xlsx",
        files={"file": ("report.pdf", valid_pdf, "application/pdf")},
    )
    assert r.status_code == 200
    assert (
        r.headers["content-type"]
        == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert r.headers["content-disposition"] == 'attachment; filename="report.xlsx"'
    assert r.content == b"fake xlsx bytes"


async def test_pdf_to_pptx_rejects_wrong_extension(client):
    r = await client.post(
        "/api/v1/convert/pdf-to-pptx",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "wrong_format"


async def test_pdf_to_pptx_rejects_empty_file(client):
    r = await client.post(
        "/api/v1/convert/pdf-to-pptx",
        files={"file": ("empty.pdf", b"", "application/pdf")},
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "empty_file"


async def test_pdf_to_pptx_success_with_mocked_conversion(client, monkeypatch):
    async def fake_convert(content, filename):
        return b"fake pptx bytes"

    monkeypatch.setattr(converter, "_convert_pdf_to_pptx", fake_convert)
    valid_pdf = b"%PDF-1.4" + b"\x00" * 200
    r = await _enqueue_run_and_download(
        client,
        "/api/v1/convert/pdf-to-pptx",
        files={"file": ("deck.pdf", valid_pdf, "application/pdf")},
    )
    assert r.status_code == 200
    assert (
        r.headers["content-type"]
        == "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
    assert r.headers["content-disposition"] == 'attachment; filename="deck.pptx"'
    assert r.content == b"fake pptx bytes"


async def test_epub_to_pdf_rejects_wrong_extension(client):
    r = await client.post(
        "/api/v1/convert/epub-to-pdf",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "wrong_format"


async def test_epub_to_pdf_rejects_empty_file(client):
    r = await client.post(
        "/api/v1/convert/epub-to-pdf",
        files={"file": ("empty.epub", b"", "application/epub+zip")},
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "empty_file"


def _make_minimal_epub_bytes(chapters=None):
    """A genuinely valid, minimal EPUB — container.xml -> OPF manifest/spine
    -> XHTML chapters — not just a ZIP-signature stub. Needed because
    epub-to-pdf actually parses this structure now (see
    _flatten_epub_to_html_sync), unlike docx/xlsx/pptx-to-pdf, which only
    ever check the ZIP magic bytes before handing the whole file to
    Gotenberg unopened.
    """
    if chapters is None:
        chapters = [("chap1.xhtml", "<h1>Chapter 1</h1><p>Hello EPUB.</p>")]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/epub+zip", zipfile.ZIP_STORED)
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?>'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" '
            'media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
        items = "".join(
            f'<item id="c{i}" href="{href}" media-type="application/xhtml+xml"/>'
            for i, (href, _) in enumerate(chapters)
        )
        spine = "".join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
        z.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0"?>'
            '<package xmlns="http://www.idpf.org/2007/opf" version="2.0">'
            f"<manifest>{items}</manifest><spine>{spine}</spine></package>",
        )
        for href, body in chapters:
            z.writestr(
                f"OEBPS/{href}",
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head>'
                f"<body>{body}</body></html>",
            )
    return buf.getvalue()


async def test_epub_to_pdf_success_with_mocked_gotenberg(client, monkeypatch):
    async def fake_chromium(content, filename):
        return b"%PDF-1.4 fake pdf bytes"

    monkeypatch.setattr(converter, "_convert_chromium_html", fake_chromium)
    r = await _enqueue_run_and_download(
        client,
        "/api/v1/convert/epub-to-pdf",
        files={
            "file": ("book.epub", _make_minimal_epub_bytes(), "application/epub+zip")
        },
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"] == 'attachment; filename="book.pdf"'
    assert r.content == b"%PDF-1.4 fake pdf bytes"


async def test_png_to_svg_rejects_wrong_extension(client):
    r = await client.post(
        "/api/v1/convert/png-to-svg",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "wrong_format"


async def test_png_to_svg_rejects_empty_file(client):
    r = await client.post(
        "/api/v1/convert/png-to-svg",
        files={"file": ("empty.png", b"", "image/png")},
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "empty_file"


async def test_png_to_svg_rejects_oversized_file(client):
    # png-to-svg caps uploads at 10MB, below the 25MB other Cloud tools
    # allow (tracing is more CPU-intensive) — proves that lower cap is
    # actually enforced, not just the shared default.
    oversized = b"\x89PNG\r\n\x1a\n" + b"\x00" * (10 * 1024 * 1024 + 1)
    r = await client.post(
        "/api/v1/convert/png-to-svg",
        files={"file": ("huge.png", oversized, "image/png")},
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "too_large"


async def test_png_to_svg_rejects_decompression_bomb_with_accurate_message(
    client, monkeypatch
):
    # STRESS_TEST_REPORT.md Finding 7: a genuine, non-malicious but very
    # large image (e.g. 20000x20000) trips Pillow's own DecompressionBombError
    # safety check. Before this fix, that fell into the generic `except
    # Exception` handler and came back as "may be corrupted or
    # password-protected" — false, since the file is completely valid. Must
    # come back as an honest, specific message instead. Shrinks
    # PIL.Image.MAX_IMAGE_PIXELS rather than actually building a 20000x20000
    # PNG, so the test stays fast — the code path exercised (Image.open
    # raising DecompressionBombError) is identical either way.
    #
    # Phase 3: this check only fires once Pillow actually decodes the image,
    # which now happens in data/job_worker.py's execution — not synchronously
    # on the enqueue POST (validate_upload's own checks don't decode the
    # image at all, only magic bytes/size/extension).
    from PIL import Image as PILImage

    monkeypatch.setattr(PILImage, "MAX_IMAGE_PIXELS", 1000)

    img = PILImage.new("RGB", (200, 200), (10, 20, 30))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    job_id, _ = await _enqueue(
        client,
        "/api/v1/convert/png-to-svg",
        files={"file": ("huge.png", buf.getvalue(), "image/png")},
    )
    status = await _run_and_finish(client, job_id)
    assert status["status"] == "failed"
    assert status["error_type"] == "too_large_dimensions"
    assert "corrupted" not in status["error"].lower()
    assert "password" not in status["error"].lower()


async def test_png_to_svg_success_with_mocked_conversion(client, monkeypatch):
    async def fake_trace(content, filename):
        return b"<svg>fake</svg>"

    monkeypatch.setattr(converter, "_trace_png_to_svg", fake_trace)
    valid_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200
    r = await _enqueue_run_and_download(
        client,
        "/api/v1/convert/png-to-svg",
        files={"file": ("logo.png", valid_png, "image/png")},
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/svg+xml"
    assert r.headers["content-disposition"] == 'attachment; filename="logo.svg"'
    assert r.content == b"<svg>fake</svg>"


# --------------------------------------------------------------------------- #
# pdf-compress route — no prior test hit this endpoint at all (unlike every
# other convert route above, which all have wrong-extension/empty-file/
# mocked-success coverage). Adding the same baseline pattern here since this
# PR changes _compress_ghostscript's concurrency behavior.
# --------------------------------------------------------------------------- #


async def test_pdf_compress_rejects_wrong_extension(client):
    r = await client.post(
        "/api/v1/convert/pdf-compress",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "wrong_format"


async def test_pdf_compress_rejects_empty_file(client):
    r = await client.post(
        "/api/v1/convert/pdf-compress",
        files={"file": ("empty.pdf", b"", "application/pdf")},
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "empty_file"


async def test_pdf_compress_success_with_mocked_ghostscript(client, monkeypatch):
    async def fake_compress(content, quality):
        assert quality == "screen"
        return b"%PDF-1.4 compressed"

    monkeypatch.setattr(converter, "_compress_ghostscript", fake_compress)
    valid_pdf = b"%PDF-1.4\n" + b"\x00" * 200
    r = await _enqueue_run_and_download(
        client,
        "/api/v1/convert/pdf-compress",
        files={"file": ("report.pdf", valid_pdf, "application/pdf")},
        data={"quality": "screen"},
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"] == 'attachment; filename="report.pdf"'
    assert r.content == b"%PDF-1.4 compressed"


async def test_pdf_compress_defaults_to_ebook_quality(client, monkeypatch):
    async def fake_compress(content, quality):
        assert quality == "ebook"
        return b"%PDF-1.4 compressed"

    monkeypatch.setattr(converter, "_compress_ghostscript", fake_compress)
    valid_pdf = b"%PDF-1.4\n" + b"\x00" * 200
    r = await _enqueue_run_and_download(
        client,
        "/api/v1/convert/pdf-compress",
        files={"file": ("report.pdf", valid_pdf, "application/pdf")},
    )
    assert r.status_code == 200


async def test_pdf_compress_invalid_quality_falls_back_to_ebook(client, monkeypatch):
    async def fake_compress(content, quality):
        assert quality == "ebook"
        return b"%PDF-1.4 compressed"

    monkeypatch.setattr(converter, "_compress_ghostscript", fake_compress)
    valid_pdf = b"%PDF-1.4\n" + b"\x00" * 200
    r = await _enqueue_run_and_download(
        client,
        "/api/v1/convert/pdf-compress",
        files={"file": ("report.pdf", valid_pdf, "application/pdf")},
        data={"quality": "not-a-real-quality"},
    )
    assert r.status_code == 200


# --------------------------------------------------------------------------- #
# Direct, unmocked tests of the 3 new conversion functions' actual logic.
#
# The route-level tests above all monkeypatch the conversion function itself,
# so they only prove the HTTP plumbing (validation, headers, error mapping) —
# none of them exercise the real table extraction, slide layout, or tracing
# algorithm. These call the _sync functions directly against real generated
# PDFs/PNGs, mirroring this codebase's existing precedent for a newly-added,
# non-trivial algorithm getting its own direct coverage beyond the route
# wrapper (test_pdf_lib_worker_crypto.test.js's RC4 round trip, the ICO
# round-trip test, etc.).
# --------------------------------------------------------------------------- #


def _make_pdf_with_ruled_table():
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    rows = [["Item", "Qty", "Price"], ["Widget", "10", "$5.00"]]
    x0, y0, col_w, row_h = 72, 100, 120, 24
    for r, row in enumerate(rows):
        for c, cell in enumerate(row):
            x, y = x0 + c * col_w, y0 + r * row_h
            page.draw_rect(
                fitz.Rect(x, y, x + col_w, y + row_h), color=(0, 0, 0), width=0.5
            )
            page.insert_text((x + 4, y + 16), cell, fontsize=11)
    content = doc.tobytes()
    doc.close()
    return content


def test_pdf_to_xlsx_extracts_ruled_table_into_real_cells():
    from openpyxl import load_workbook

    xlsx_bytes = converter._convert_pdf_to_xlsx_sync(_make_pdf_with_ruled_table())
    wb = load_workbook(io.BytesIO(xlsx_bytes))
    ws = wb["Page 1"]
    rows = [tuple(r) for r in ws.iter_rows(min_row=1, max_row=2, values_only=True)]
    # "10" comes back as a real int, not the string "10" — a number-looking
    # cell must actually be numeric or Excel's own SUM/sort/filter can't use
    # it. "$5.00" stays text: the currency symbol makes it deliberately not
    # auto-parsed (see _coerce_xlsx_numeric's docstring).
    assert rows == [("Item", "Qty", "Price"), ("Widget", 10, "$5.00")]
    assert ws["B2"].data_type == "n"  # real numeric cell, not text


def test_pdf_to_xlsx_falls_back_to_text_when_no_table():
    import fitz
    from openpyxl import load_workbook

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 72), "Just a plain paragraph, no table here.", fontsize=14)
    content = doc.tobytes()
    doc.close()

    xlsx_bytes = converter._convert_pdf_to_xlsx_sync(content)
    wb = load_workbook(io.BytesIO(xlsx_bytes))
    ws = wb["Page 1"]
    assert ws["A1"].value == "Just a plain paragraph, no table here."


def test_pdf_to_xlsx_detects_borderless_whitespace_aligned_table():
    # The realistic case (bank statements, invoices) — no ruled lines, so the
    # default "lines" table strategy alone finds nothing and everything would
    # otherwise collapse into one unsplit text blob per row. 3 rows, not 2:
    # pdfplumber's text strategy needs >= 3 words aligned in a column
    # (min_words_vertical, its own default) before it infers a vertical
    # divider there at all — a 2-row page finds nothing under either
    # strategy, which is a real, inherent floor of this approach, not
    # something this tool's own code can work around.
    import fitz
    from openpyxl import load_workbook

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    x_cols = [72, 200, 400]
    rows = [
        ("Date", "Description", "Amount"),
        ("01/02", "Coffee Shop", "-4.50"),
        ("01/03", "Paycheck", "2500.00"),
    ]
    for i, row in enumerate(rows):
        for x, cell in zip(x_cols, row, strict=False):
            page.insert_text((x, 120 + i * 22), cell, fontsize=11)
    content = doc.tobytes()
    doc.close()

    xlsx_bytes = converter._convert_pdf_to_xlsx_sync(content)
    wb = load_workbook(io.BytesIO(xlsx_bytes))
    ws = wb["Page 1"]
    values = [
        tuple(r)
        for r in ws.iter_rows(values_only=True)
        if any(c not in (None, "") for c in r)
    ]
    # Real column separation, not one merged "Date Description Amount" cell.
    # The amount is a real negative float, not the text "-4.50" — proves the
    # formula-injection sanitizer (which only ever triggers on a leading
    # "=") didn't also mangle an ordinary negative number along the way.
    assert ("Date", "Description", "Amount") in values
    assert ("01/02", "Coffee Shop", -4.50) in values


def test_pdf_to_xlsx_neutralizes_formula_injection():
    # A crafted PDF whose "table" cell text starts with "=" must not become a
    # live Excel formula in the output — openpyxl auto-marks any raw
    # "="-prefixed string as data_type "f" (a real <f> formula element), so an
    # unsanitized cell here would execute in the victim's Excel on open
    # (CWE-1236). Goes through the plain-text fallback path since building a
    # ruled-table fixture with formula-looking cell text isn't necessary to
    # prove the sanitizer runs on every write path.
    import fitz
    from openpyxl import load_workbook

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 72), '=HYPERLINK("http://evil.example","x")', fontsize=12)
    content = doc.tobytes()
    doc.close()

    xlsx_bytes = converter._convert_pdf_to_xlsx_sync(content)
    wb = load_workbook(io.BytesIO(xlsx_bytes))
    ws = wb["Page 1"]
    cell = ws["A1"]
    assert cell.data_type == "s"  # plain string, not "f" (formula)
    assert cell.value.startswith("'=")


def test_sanitize_xlsx_cell_only_neutralizes_leading_equals():
    # Narrower than the usual CSV-injection "=+-@" prefix set on purpose —
    # openpyxl only auto-formula-types a leading "=" (verified directly
    # against Cell._bind_value), and "-" is the single most common leading
    # character in real extracted table data (negative amounts), so
    # sanitizing it too would corrupt legitimate numbers.
    assert converter._sanitize_xlsx_cell("=cmd|'/c calc'!A1") == "'=cmd|'/c calc'!A1"
    assert converter._sanitize_xlsx_cell("-4.50") == "-4.50"
    assert converter._sanitize_xlsx_cell("+1 555-1234") == "+1 555-1234"
    assert converter._sanitize_xlsx_cell("@handle") == "@handle"
    assert converter._sanitize_xlsx_cell("Widget") == "Widget"
    assert converter._sanitize_xlsx_cell(None) is None


def test_coerce_xlsx_numeric_converts_real_numbers_only():
    assert converter._coerce_xlsx_numeric("-4.50") == -4.50
    assert converter._coerce_xlsx_numeric("1,234") == 1234
    assert converter._coerce_xlsx_numeric("10") == 10
    assert isinstance(converter._coerce_xlsx_numeric("10"), int)
    assert isinstance(converter._coerce_xlsx_numeric("10.0"), float)
    # Not plausibly numeric — left as the original string.
    assert converter._coerce_xlsx_numeric("$5.00") == "$5.00"
    assert converter._coerce_xlsx_numeric("01/02") == "01/02"
    assert converter._coerce_xlsx_numeric("Widget") == "Widget"


def test_prepare_xlsx_cell_value_full_pipeline():
    # Numbers convert (and therefore never reach the string sanitizer at
    # all); non-numeric text only gets the leading-apostrophe treatment when
    # it starts with "=".
    assert converter._prepare_xlsx_cell_value("-4.50") == -4.50
    assert converter._prepare_xlsx_cell_value("=1+1") == "'=1+1"
    assert converter._prepare_xlsx_cell_value("Widget") == "Widget"
    assert converter._prepare_xlsx_cell_value(None) is None


def test_pdf_to_pptx_one_slide_per_page_matching_page_aspect_ratio():
    import fitz
    from pptx import Presentation

    doc = fitz.open()
    doc.new_page(width=595, height=842)  # portrait, A4-ish
    doc.new_page(width=595, height=842)
    content = doc.tobytes()
    doc.close()

    pptx_bytes = converter._convert_pdf_to_pptx_sync(content)
    prs = Presentation(io.BytesIO(pptx_bytes))
    slides = list(prs.slides)
    assert len(slides) == 2
    for slide in slides:
        shapes = list(slide.shapes)
        assert len(shapes) == 1
        assert shapes[0].shape_type == 13  # MSO_SHAPE_TYPE.PICTURE
    # Deck sized to the source page's own aspect ratio, not python-pptx's
    # 10x7.5in default.
    assert abs(prs.slide_width / prs.slide_height - 595 / 842) < 0.01


def test_pdf_to_pptx_letterboxes_mismatched_aspect_ratio_page():
    import fitz
    from pptx import Presentation

    doc = fitz.open()
    doc.new_page(width=595, height=842)  # portrait — drives deck size
    doc.new_page(width=842, height=595)  # landscape page inside that deck
    content = doc.tobytes()
    doc.close()

    pptx_bytes = converter._convert_pdf_to_pptx_sync(content)
    prs = Presentation(io.BytesIO(pptx_bytes))
    landscape_slide = list(prs.slides)[1]
    pic = list(landscape_slide.shapes)[0]
    # Full width, vertically centered — not stretched to fill the whole slide.
    assert pic.width == prs.slide_width
    assert pic.height < prs.slide_height
    assert pic.left == 0
    assert abs(pic.top - (prs.slide_height - pic.height) / 2) <= 1


def test_pdf_to_pptx_bounds_raster_dimension_for_oversized_pages():
    # PDF's MediaBox is spec-legal up to 14,400x14,400pt, and a near-blank
    # page declaring that size costs almost nothing in file bytes — a fixed
    # 150 DPI render with no cap would allocate gigabytes for a single such
    # page (confirmed directly: 522 bytes -> a 6250x6250px raster, ~112MB,
    # in ~20ms at 3000x3000pt; scaling further explodes from there).
    # PDF_TO_PPTX_MAX_RASTER_DIMENSION must bound the actual rendered pixel
    # count regardless of the page's declared size.
    import fitz
    from PIL import Image
    from pptx import Presentation

    doc = fitz.open()
    doc.new_page(width=10000, height=10000)  # spec-legal, tiny file, huge page
    content = doc.tobytes()
    doc.close()
    assert len(content) < 1024  # confirms this is cheap for an attacker to send

    pptx_bytes = converter._convert_pdf_to_pptx_sync(content)
    prs = Presentation(io.BytesIO(pptx_bytes))
    pic = list(list(prs.slides)[0].shapes)[0]
    embedded_img = Image.open(io.BytesIO(pic.image.blob))
    assert max(embedded_img.size) <= converter.PDF_TO_PPTX_MAX_RASTER_DIMENSION


def test_pdf_to_pptx_slide_size_capped_at_powerpoint_maximum():
    # An oversized page also can't drive the deck's own EMU size past what
    # PowerPoint itself allows for a custom slide size, independent of the
    # raster cap above (the embedded image is scaled to fit the slide either
    # way, so a smaller slide with an oversized page's raster would still be
    # a valid, openable file even without this — but an uncapped slide size
    # wouldn't be).
    import fitz
    from pptx import Presentation

    doc = fitz.open()
    doc.new_page(width=10000, height=10000)
    content = doc.tobytes()
    doc.close()

    pptx_bytes = converter._convert_pdf_to_pptx_sync(content)
    prs = Presentation(io.BytesIO(pptx_bytes))
    assert prs.slide_width == converter.PPTX_MAX_SLIDE_EMU
    assert prs.slide_height == converter.PPTX_MAX_SLIDE_EMU


def _make_ring_png_bytes():
    from PIL import Image, ImageDraw

    img = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((20, 20, 180, 180), fill=(220, 30, 30, 255))
    d.ellipse((70, 70, 130, 130), fill=(0, 0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_trace_png_to_svg_ring_shape_has_correct_topology_and_color():
    svg_bytes = converter._trace_png_to_svg_sync(_make_ring_png_bytes())
    svg_text = svg_bytes.decode("utf-8")
    assert svg_text.count("<path") == 3
    assert 'fill="#dc1e1e"' in svg_text  # rgb(220,30,30), the ring's real color
    assert 'fill-rule="evenodd"' in svg_text
    assert 'viewBox="0 0 200 200"' in svg_text


def test_trace_png_to_svg_downscales_oversized_images():
    from PIL import Image

    big = Image.new("RGB", (3000, 1000), (10, 200, 10))
    buf = io.BytesIO()
    big.save(buf, format="PNG")

    svg_bytes = converter._trace_png_to_svg_sync(buf.getvalue())
    svg_text = svg_bytes.decode("utf-8")
    assert 'width="1500" height="500"' in svg_text


def test_trace_png_to_svg_raises_validation_error_on_decompression_bomb(monkeypatch):
    from PIL import Image

    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)

    img = Image.new("RGB", (200, 200), (10, 20, 30))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    with pytest.raises(converter.ValidationError) as exc_info:
        converter._trace_png_to_svg_sync(buf.getvalue())
    assert exc_info.value.error_type == "too_large_dimensions"


def test_flatten_epub_to_html_orders_chapters_and_inserts_page_breaks():
    # epub-to-pdf does NOT reuse _convert_libreoffice (confirmed live against
    # production: two independent spec-compliant EPUBs both failed through
    # Gotenberg's LibreOffice route — it has no built-in EPUB import filter).
    # This flattens the EPUB's own manifest/spine into one HTML document fed
    # to the already-proven Chromium route instead.
    epub_bytes = _make_minimal_epub_bytes(
        chapters=[
            ("c1.xhtml", "<h1>One</h1>"),
            ("c2.xhtml", "<h1>Two</h1>"),
        ]
    )
    html = converter._flatten_epub_to_html_sync(epub_bytes).decode("utf-8")
    assert html.index("<h1>One</h1>") < html.index("<h1>Two</h1>")
    assert "page-break-before:always" in html
    # First chapter must not itself force a break (nothing precedes it).
    assert html.index("<h1>One</h1>") < html.index("page-break-before")


def test_flatten_epub_to_html_inlines_images_as_data_uris():
    png_1x1 = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
        b"\x00\x00\x03\x01\x01\x00\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/epub+zip", zipfile.ZIP_STORED)
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?>'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" '
            'media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
        z.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0"?>'
            '<package xmlns="http://www.idpf.org/2007/opf" version="2.0">'
            '<manifest><item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/></manifest>'
            '<spine><itemref idref="c1"/></spine></package>',
        )
        z.writestr(
            "OEBPS/chap1.xhtml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
            '<img src="images/cover.png"/></body></html>',
        )
        z.writestr("OEBPS/images/cover.png", png_1x1)

    html = converter._flatten_epub_to_html_sync(buf.getvalue()).decode("utf-8")
    assert "data:image/png;base64," in html
    assert "images/cover.png" not in html  # rewritten, not left as a dead relative link


def _build_single_chapter_epub(chapter_body_html: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/epub+zip", zipfile.ZIP_STORED)
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?>'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" '
            'media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
        z.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0"?>'
            '<package xmlns="http://www.idpf.org/2007/opf" version="2.0">'
            '<manifest><item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/></manifest>'
            '<spine><itemref idref="c1"/></spine></package>',
        )
        z.writestr(
            "OEBPS/chap1.xhtml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
            f"{chapter_body_html}</body></html>",
        )
    return buf.getvalue()


def test_flatten_epub_to_html_drops_external_image_src():
    # OWASP A10 — an <img src> that isn't inside the EPUB's own zip must never
    # survive into the HTML handed to Gotenberg's Chromium engine: Chromium
    # will fetch it server-side, which is a blind SSRF vector (an internal
    # host or a cloud metadata address) if the reference is left unresolved.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/epub+zip", zipfile.ZIP_STORED)
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?>'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" '
            'media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
        z.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0"?>'
            '<package xmlns="http://www.idpf.org/2007/opf" version="2.0">'
            '<manifest><item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/></manifest>'
            '<spine><itemref idref="c1"/></spine></package>',
        )
        z.writestr(
            "OEBPS/chap1.xhtml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
            '<img src="http://169.254.169.254/latest/meta-data/"/></body></html>',
        )

    html = converter._flatten_epub_to_html_sync(buf.getvalue()).decode("utf-8")
    assert "169.254.169.254" not in html
    assert 'src=""' in html


def test_flatten_epub_to_html_drops_unquoted_external_image_src():
    # PR #98 review — a valid, unquoted HTML5 src (no characters that require
    # quoting) skipped the old regex entirely and reached Gotenberg untouched.
    epub = _build_single_chapter_epub(
        "<img src=http://169.254.169.254/latest/meta-data/>"
    )
    html = converter._flatten_epub_to_html_sync(epub).decode("utf-8")
    assert "169.254.169.254" not in html
    assert 'src=""' in html


def test_flatten_epub_to_html_drops_single_quoted_external_image_src():
    epub = _build_single_chapter_epub(
        "<img src='http://169.254.169.254/latest/meta-data/'>"
    )
    html = converter._flatten_epub_to_html_sync(epub).decode("utf-8")
    assert "169.254.169.254" not in html
    assert 'src=""' in html


def test_flatten_epub_to_html_still_inlines_quoted_local_image():
    # Regression guard for the rewritten regex/substitution — a real,
    # in-archive image must still resolve to a data URI, not get dropped.
    png_1x1 = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
        b"\x00\x00\x03\x01\x01\x00\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/epub+zip", zipfile.ZIP_STORED)
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?>'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" '
            'media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
        z.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0"?>'
            '<package xmlns="http://www.idpf.org/2007/opf" version="2.0">'
            '<manifest><item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/></manifest>'
            '<spine><itemref idref="c1"/></spine></package>',
        )
        z.writestr(
            "OEBPS/chap1.xhtml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
            '<img data-caption="x" src="images/cover.png" alt="c"/></body></html>',
        )
        z.writestr("OEBPS/images/cover.png", png_1x1)

    html = converter._flatten_epub_to_html_sync(buf.getvalue()).decode("utf-8")
    assert "data:image/png;base64," in html
    assert "images/cover.png" not in html
    assert 'alt="c"' in html  # the rest of the tag survives untouched


def test_flatten_epub_to_html_rejects_doctype_in_control_files():
    # Guards the only server-side arbitrary-XML parsing in this codebase
    # against entity-expansion ("billion laughs") DoS — a real EPUB
    # container.xml never legitimately declares a DOCTYPE.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/epub+zip", zipfile.ZIP_STORED)
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY x "y">]>'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" '
            'media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
    with pytest.raises(ValueError, match="DOCTYPE"):
        converter._flatten_epub_to_html_sync(buf.getvalue())


def test_flatten_epub_to_html_rejects_zip_bomb(monkeypatch):
    # A small compressed file can still declare a huge uncompressed size —
    # every member gets read into memory during flattening, so this must be
    # bounded before any read happens, not discovered partway through one.
    # Shrinks the real 200MB limit down to a few bytes rather than actually
    # generating a huge payload, so the test stays fast and cheap while
    # still exercising the real guard.
    monkeypatch.setattr(converter, "EPUB_MAX_UNCOMPRESSED_BYTES", 10)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("mimetype", "application/epub+zip", zipfile.ZIP_STORED)
        z.writestr("OEBPS/over_the_limit.bin", b"x" * 20)
    with pytest.raises(ValueError, match="limit"):
        converter._flatten_epub_to_html_sync(buf.getvalue())


async def test_metrics_endpoint_shape(admin_client):
    r = await admin_client.get("/api/v1/metrics")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"conversions", "failures", "avg_duration_ms"}


async def test_metrics_endpoint_requires_admin(client, user_client):
    # Anonymous: no session at all.
    assert (await client.get("/api/v1/metrics")).status_code == 401
    # Signed in, but not an admin.
    assert (await user_client.get("/api/v1/metrics")).status_code == 403


async def test_health_endpoint_responds(client):
    # No Gotenberg health signal has ever been probed into Redis in this test
    # environment (only data/job_worker.py's --loop probes it) → degraded, but
    # the endpoint must still respond 200 with a status.
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] in ("healthy", "degraded")
    # P2 §20 — the DB check runs against the same test DB conftest wires every
    # other test to, so it's genuinely reachable here.
    assert body["database"] == "up"


async def test_health_endpoint_reports_db_down(client, monkeypatch):
    import converter

    class _BoomEngine:
        def connect(self):
            raise RuntimeError("connection refused")

    # NEON_FAILOVER_PLAN.md §7.2: _check_db() now resolves the engine
    # dynamically via get_active_engine() (an awaited call) rather than
    # importing a fixed `async_engine` symbol — that symbol's meaning
    # changed (it's now just the dev/test/pre-Bootstrap fallback engine,
    # data/db.py), so the old direct monkeypatch of it no longer reaches
    # _check_db() at all. Patch the accessor converter.py actually calls
    # instead.
    async def _fake_get_active_engine():
        return _BoomEngine()

    monkeypatch.setattr(converter, "get_active_engine", _fake_get_active_engine)
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["database"] == "down"
    assert body["status"] == "degraded"


async def test_health_endpoint_bounds_a_hanging_db_connect(client, monkeypatch):
    # Post-merge audit fix. The static async engine (data/db.py) sets no
    # connect_timeout (only the sync engine does), so an unbounded
    # `.connect()` could hang past an uptime monitor's polling interval on a
    # network partition that drops packets rather than refusing outright —
    # and unlike the one-time startup check this mirrors, /health is now
    # re-triggered by every poll, so a hang here accumulates a stuck task per
    # poll for as long as the partition lasts. Proves the bound actually
    # applies: a connect that never completes still returns within the
    # (shrunk, for a fast test) timeout, degraded rather than hung.
    import asyncio

    import converter

    class _HangingConnectCM:
        async def __aenter__(self):
            await asyncio.sleep(10)  # would hang the request without the bound
            return self

        async def __aexit__(self, *exc):
            return False

    class _HangingEngine:
        def connect(self):
            return _HangingConnectCM()

    # See test_health_endpoint_reports_db_down above: patch the dynamic
    # accessor, not the old `async_engine` symbol it replaced.
    async def _fake_get_active_engine():
        return _HangingEngine()

    monkeypatch.setattr(converter, "get_active_engine", _fake_get_active_engine)
    monkeypatch.setattr(converter, "HEALTH_DB_TIMEOUT_SECONDS", 0.05)

    # wait_for is the assertion, not just a safety net: if the internal bound
    # didn't apply, the hanging connect (sleep(10)) would blow past this and
    # fail loudly with TimeoutError instead of silently passing. 8s margin,
    # not ~0.05s, kept generous even though the Gotenberg check (running
    # concurrently via asyncio.gather) is now a cheap Redis exists() rather
    # than a live HTTP call with its own DNS/connect latency.
    r = await asyncio.wait_for(client.get("/api/v1/health"), timeout=8.0)
    assert r.status_code == 200
    body = r.json()
    assert body["database"] == "down"
    assert body["status"] == "degraded"


async def test_health_endpoint_accepts_head(client):
    # Uptime monitors default to HEAD requests; must not 405.
    r = await client.head("/api/v1/health")
    assert r.status_code == 200
    assert r.content == b""


async def test_health_endpoint_check_db_false_never_calls_check_db(client, monkeypatch):
    # docker-compose.yml's own container healthcheck uses ?check_db=false —
    # this proves it's genuine opt-out, not just a cosmetic label: _check_db()
    # (and therefore Neon) must never be invoked, since the whole point is
    # not waking a suspended Neon compute on Docker's own independent timer.
    import converter

    called = False

    async def _fake_check_db():
        nonlocal called
        called = True
        return True

    monkeypatch.setattr(converter, "_check_db", _fake_check_db)
    r = await client.get("/api/v1/health?check_db=false")
    assert r.status_code == 200
    assert called is False
    body = r.json()
    assert body["database"] == "skipped"
    assert body["status"] in ("healthy", "degraded")


async def test_health_endpoint_check_db_false_status_ignores_db(client, monkeypatch):
    # Skipping the DB check must not silently force "healthy" — status still
    # reflects Gotenberg/worker, it just stops being gated on `database` at all.
    import converter

    class _BoomEngine:
        def connect(self):
            raise RuntimeError("connection refused")

    async def _fake_get_active_engine():
        return _BoomEngine()

    monkeypatch.setattr(converter, "get_active_engine", _fake_get_active_engine)
    r = await client.get("/api/v1/health?check_db=false")
    assert r.status_code == 200
    body = r.json()
    assert body["database"] == "skipped"


# --------------------------------------------------------------------------- #
# Gotenberg request queue (P3 §31) — caps concurrent Gotenberg calls with an
# in-process asyncio.Semaphore. `_gotenberg_request` is exercised directly
# (not through the route) with a fake httpx.AsyncClient, since these tests
# assert on timing/concurrency, not on any particular tool's request shape.
# --------------------------------------------------------------------------- #


class _FakeResponse:
    def __init__(self, status_code=200, content=b"ok"):
        self.status_code = status_code
        self.content = content
        self.text = content.decode()


def _fake_async_client(post_impl):
    class _FakeAsyncClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, files=None, headers=None):
            return await post_impl()

    return _FakeAsyncClient


async def test_gotenberg_semaphore_caps_concurrency(monkeypatch):
    monkeypatch.setattr(converter, "_gotenberg_semaphore", asyncio.Semaphore(1))
    monkeypatch.setattr(converter, "GOTENBERG_QUEUE_TIMEOUT_SECONDS", 5.0)

    in_flight = 0
    max_in_flight = 0

    async def post_impl():
        nonlocal in_flight, max_in_flight
        in_flight += 1
        max_in_flight = max(max_in_flight, in_flight)
        await asyncio.sleep(0.05)
        in_flight -= 1
        return _FakeResponse()

    monkeypatch.setattr(converter.httpx, "AsyncClient", _fake_async_client(post_impl))

    # Three "requests" sharing a single-slot semaphore must never overlap,
    # even though they're all launched at once.
    await asyncio.gather(
        *(
            converter._gotenberg_request("/forms/libreoffice/convert", {}, "test")
            for _ in range(3)
        )
    )
    assert max_in_flight == 1


async def test_gotenberg_queue_timeout_marks_job_failed(client, monkeypatch):
    # Phase 3: this contention no longer happens on a live HTTP connection —
    # both requests enqueue immediately (202), and the semaphore is only
    # ever touched once data/job_worker.py actually runs the jobs.
    monkeypatch.setattr(converter, "_gotenberg_semaphore", asyncio.Semaphore(1))
    monkeypatch.setattr(converter, "GOTENBERG_QUEUE_TIMEOUT_SECONDS", 0.05)

    async def post_impl():
        # Holds the one slot well past the queue timeout so the second
        # job below is forced to wait and expire.
        await asyncio.sleep(1.0)
        return _FakeResponse()

    monkeypatch.setattr(converter.httpx, "AsyncClient", _fake_async_client(post_impl))

    valid_docx = b"PK\x03\x04" + b"\x00" * 200
    files = {
        "file": (
            "report.docx",
            valid_docx,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    }
    job_id_1, _ = await _enqueue(client, "/api/v1/convert/docx-to-pdf", files=files)
    job_id_2, _ = await _enqueue(client, "/api/v1/convert/docx-to-pdf", files=files)

    # Run both concurrently: the first occupies the only Gotenberg slot for
    # 1s (well past the 0.05s queue timeout), so the second must time out
    # waiting rather than queue indefinitely.
    await asyncio.gather(job_worker.run_job(job_id_1), job_worker.run_job(job_id_2))

    statuses = {}
    for job_id in (job_id_1, job_id_2):
        r = await client.get(f"/api/v1/convert/jobs/{job_id}")
        statuses[job_id] = r.json()

    failed = [s for s in statuses.values() if s["status"] == "failed"]
    assert failed, statuses
    assert failed[0]["error_type"] == "queue_timeout"


async def test_gotenberg_own_busy_response_marks_job_failed_not_generic_error(
    client, monkeypatch, caplog
):
    # STRESS_TEST_REPORT.md Finding 1 fix: Gotenberg itself now rejects with
    # 429 once --chromium-max-queue-size/--libreoffice-max-queue-size is full,
    # and can still 503 on its own --api-timeout. STRESS_TEST_PHASE3_REPORT.md
    # Finding 1 (round two) added 500: observed directly under a heavy
    # concurrent-burst repro as a plain 500 ("read tcp ...: i/o timeout")
    # before Gotenberg ever got to render anything — Gotenberg failing for
    # its own resource reasons, not rejecting the file's content (which
    # surfaces as 400, per test_gotenberg_non_busy_rejection_... below). All
    # three must route through the same honest "service busy" queue_timeout
    # classification ``test_gotenberg_queue_timeout_marks_job_failed`` above
    # already verifies for OUR OWN queue timeout — not the generic "may be
    # corrupted" message.
    #
    # Log level differs by status though (PR review follow-up): 429/503 are
    # Gotenberg's own deliberate, configured load-shedding signals, so they
    # log at warning — Sentry's default LoggingIntegration auto-captures
    # every logger.error() as an error event (main.py's sentry_sdk.init() has
    # no explicit integrations=[]), and this queue bound exists specifically
    # to make busy periods resolve in ~200ms instead of hanging, so logging
    # those two as error would flood Sentry with "working as designed" noise.
    # 500 is Gotenberg's generic internal-error status, not something this
    # project configured — the same code covers both the resource-pressure
    # case here AND a genuine persistent bug that 500s on every call, so it
    # still logs at error: the user gets the same honest "busy" message
    # either way, but ops still gets a Sentry alert if it never stops.
    expected_level = {429: "WARNING", 500: "ERROR", 503: "WARNING"}
    for gotenberg_status in (429, 500, 503):

        async def post_impl(status=gotenberg_status):
            return _FakeResponse(status_code=status, content=b"busy")

        monkeypatch.setattr(
            converter.httpx, "AsyncClient", _fake_async_client(post_impl)
        )
        caplog.clear()

        valid_docx = b"PK\x03\x04" + b"\x00" * 200
        job_id, _ = await _enqueue(
            client,
            "/api/v1/convert/docx-to-pdf",
            files={
                "file": (
                    "report.docx",
                    valid_docx,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            },
        )
        with caplog.at_level("WARNING", logger="filecast.converter"):
            status = await _run_and_finish(client, job_id)

        assert status["status"] == "failed", gotenberg_status
        assert status["error_type"] == "queue_timeout"
        assert "corrupted" not in (status["error"] or "").lower()
        gotenberg_records = [r for r in caplog.records if "Gotenberg" in r.getMessage()]
        assert gotenberg_records, gotenberg_status
        assert all(
            r.levelname == expected_level[gotenberg_status] for r in gotenberg_records
        ), [(r.levelname, r.getMessage()) for r in gotenberg_records]


async def test_gotenberg_non_busy_rejection_marks_job_failed_with_accurate_message(
    client, monkeypatch
):
    # STRESS_TEST_REPORT.md Finding 4: a file with a valid extension/magic
    # bytes but broken internals (e.g. a docx whose XML is garbage past the
    # ZIP header) makes Gotenberg itself reject the request with a genuine,
    # non-busy error status. Must come back as the honest "conversion_error"
    # ValidationError message _gotenberg_request raises for this case — not
    # the generic "may be corrupted or password-protected" catch-all, and
    # never leaking Gotenberg's raw response body.
    async def post_impl():
        return _FakeResponse(
            status_code=400,
            content=b"Internal LibreOffice stack trace: /root/.config/libreoffice blew up",
        )

    monkeypatch.setattr(converter.httpx, "AsyncClient", _fake_async_client(post_impl))

    job_id, _ = await _enqueue(
        client,
        "/api/v1/convert/docx-to-pdf",
        files={
            "file": (
                "report.docx",
                b"PK\x03\x04" + b"\x00" * 200,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    status = await _run_and_finish(client, job_id)
    assert status["status"] == "failed"
    assert status["error_type"] == "conversion_error"
    assert "corrupted or password-protected" not in status["error"]
    assert "/root/.config" not in status["error"]
    assert "LibreOffice" not in status["error"]


async def test_gotenberg_connection_failure_marks_job_failed_with_busy_error(
    client, monkeypatch
):
    # Boundary check for the Finding 4 fix above: only an actual HTTP-level
    # rejection from a *running* Gotenberg (the `resp.status_code != 200`
    # branch inside _gotenberg_request) should map to the specific
    # conversion_error ValidationError message. A genuine connectivity
    # failure (Gotenberg's container down/unreachable) never reaches that
    # branch at all — the exception happens at `await client.post(...)`
    # itself, before there's any `resp` to check the status of.
    #
    # Phase 3 stress test, Finding 3: this used to fall through all the way to
    # converter._classify_conversion_error's generic catch-all — "The file may
    # be corrupted or password-protected" — for what is actually a server-side
    # problem, not a bad file. httpx.ConnectError (and the TimeoutException
    # family) now get their own honest "busy, try again" mapping instead, the
    # same one ConversionQueueTimeout already used for our own queue giving
    # up.
    async def post_impl():
        raise converter.httpx.ConnectError("Connection refused")

    monkeypatch.setattr(converter.httpx, "AsyncClient", _fake_async_client(post_impl))

    job_id, _ = await _enqueue(
        client,
        "/api/v1/convert/docx-to-pdf",
        files={
            "file": (
                "report.docx",
                b"PK\x03\x04" + b"\x00" * 200,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    status = await _run_and_finish(client, job_id)
    assert status["status"] == "failed"
    assert status["error_type"] == "queue_timeout"
    assert "busy" in status["error"].lower()


@pytest.mark.parametrize(
    "exc",
    [
        converter.httpx.WriteTimeout("timed out mid-upload"),
        converter.httpx.ReadTimeout("timed out waiting for response"),
        converter.httpx.ConnectTimeout("timed out connecting"),
        converter.httpx.PoolTimeout("timed out waiting for a pool connection"),
        converter.httpx.ConnectError("connection refused"),
    ],
)
def test_classify_conversion_error_maps_network_failures_to_busy(exc):
    # Direct unit check for the exact exception class the Phase 3 stress
    # test's Finding 1/3 logged (httpx.WriteTimeout, raised while uploading to
    # an overloaded Gotenberg) — and its siblings. All of these are the same
    # "Gotenberg unreachable or too slow" situation as ConversionQueueTimeout,
    # just caught one layer down; none of them say anything about the
    # visitor's own file.
    message, error_type = converter._classify_conversion_error(exc)
    assert error_type == "queue_timeout"
    assert "busy" in message.lower()
    assert "corrupted" not in message.lower()


# --------------------------------------------------------------------------- #
# Ghostscript concurrency cap (STRESS_TEST_REPORT.md Finding 3) — caps
# concurrent `gs` subprocesses, and bounds how long a request queues for a
# free slot, with the same in-process asyncio.Semaphore + queue-timeout
# pattern _gotenberg_semaphore/GOTENBERG_QUEUE_TIMEOUT_SECONDS already use
# above. `_compress_ghostscript_sync` is faked rather than run for real: it
# shells out to the `gs` binary, which isn't installed in this test
# environment (only inside the api/gotenberg Docker images) — same reason
# the Gotenberg tests above fake httpx instead of hitting a real Gotenberg.
# --------------------------------------------------------------------------- #


async def test_ghostscript_semaphore_caps_concurrency(monkeypatch):
    import threading
    import time as time_module

    monkeypatch.setattr(converter, "_ghostscript_semaphore", asyncio.Semaphore(1))

    in_flight = 0
    max_in_flight = 0
    lock = threading.Lock()

    def fake_compress_sync(content, quality):
        nonlocal in_flight, max_in_flight
        with lock:
            in_flight += 1
            max_in_flight = max(max_in_flight, in_flight)
        time_module.sleep(0.05)
        with lock:
            in_flight -= 1
        return b"%PDF-1.4 compressed"

    monkeypatch.setattr(converter, "_compress_ghostscript_sync", fake_compress_sync)

    # Three "compressions" sharing a single-slot semaphore must never
    # overlap, even though they're all launched at once — mirrors
    # test_gotenberg_semaphore_caps_concurrency above.
    await asyncio.gather(
        *(converter._compress_ghostscript(b"content", "ebook") for _ in range(3))
    )
    assert max_in_flight == 1


async def test_ghostscript_queue_timeout_marks_job_failed(client, monkeypatch):
    # Mirrors test_gotenberg_queue_timeout_marks_job_failed: a bare semaphore
    # with no bound on the wait would let a pile-up of pdf-compress jobs
    # queue indefinitely instead of failing fast, once the worker actually
    # runs them (Phase 3 — this no longer happens on a live connection).
    import time as time_module

    monkeypatch.setattr(converter, "_ghostscript_semaphore", asyncio.Semaphore(1))
    monkeypatch.setattr(converter, "GHOSTSCRIPT_QUEUE_TIMEOUT_SECONDS", 0.05)

    def slow_compress_sync(content, quality):
        # Holds the one slot well past the queue timeout so the second
        # job below is forced to wait and expire.
        time_module.sleep(1.0)
        return b"%PDF-1.4 compressed"

    monkeypatch.setattr(converter, "_compress_ghostscript_sync", slow_compress_sync)

    valid_pdf = b"%PDF-1.4\n" + b"\x00" * 200
    files = {"file": ("report.pdf", valid_pdf, "application/pdf")}
    job_id_1, _ = await _enqueue(client, "/api/v1/convert/pdf-compress", files=files)
    job_id_2, _ = await _enqueue(client, "/api/v1/convert/pdf-compress", files=files)

    await asyncio.gather(job_worker.run_job(job_id_1), job_worker.run_job(job_id_2))

    statuses = []
    for job_id in (job_id_1, job_id_2):
        r = await client.get(f"/api/v1/convert/jobs/{job_id}")
        statuses.append(r.json())

    failed = [s for s in statuses if s["status"] == "failed"]
    assert failed, statuses
    assert failed[0]["error_type"] == "queue_timeout"


# --------------------------------------------------------------------------- #
# CPU-bound tool concurrency cap (pr-review follow-up on Phase 3): pdf2docx,
# pdf-to-xlsx, pdf-to-pptx, and png-to-svg have no Gotenberg/Ghostscript
# backing of their own — before this, they ran via loop.run_in_executor with
# no cap at all. data/job_worker.py's discovery loop claims and spawns a
# task for every currently-queued row on each wake with no cap of its own,
# relying entirely on each tool's own semaphore to bound real concurrency —
# these four tools never had one, unlike Gotenberg/Ghostscript above.
# --------------------------------------------------------------------------- #


async def test_cpu_bound_semaphore_caps_concurrency(monkeypatch):
    import threading
    import time as time_module

    monkeypatch.setattr(converter, "_cpu_bound_semaphore", asyncio.Semaphore(1))

    in_flight = 0
    max_in_flight = 0
    lock = threading.Lock()

    def fake_sync(content):
        nonlocal in_flight, max_in_flight
        with lock:
            in_flight += 1
            max_in_flight = max(max_in_flight, in_flight)
        time_module.sleep(0.05)
        with lock:
            in_flight -= 1
        return b"fake output"

    # Three "conversions" sharing a single-slot semaphore must never
    # overlap, even though they're all launched at once — mirrors
    # test_ghostscript_semaphore_caps_concurrency above.
    await asyncio.gather(
        *(converter._run_cpu_bound(fake_sync, b"content") for _ in range(3))
    )
    assert max_in_flight == 1


async def test_cpu_bound_queue_timeout_raises_conversion_queue_timeout(monkeypatch):
    import time as time_module

    monkeypatch.setattr(converter, "_cpu_bound_semaphore", asyncio.Semaphore(1))
    monkeypatch.setattr(converter, "CPU_BOUND_QUEUE_TIMEOUT_SECONDS", 0.05)

    def slow_sync(content):
        # Holds the one slot well past the queue timeout so the second call
        # below is forced to wait and expire.
        time_module.sleep(1.0)
        return b"fake output"

    async def first_call():
        await converter._run_cpu_bound(slow_sync, b"content")

    async def second_call():
        with pytest.raises(converter.ConversionQueueTimeout):
            await converter._run_cpu_bound(slow_sync, b"content")

    await asyncio.gather(first_call(), second_call())


# --------------------------------------------------------------------------- #
# Enqueue-time orphan file cleanup (pr-review follow-up on Phase 3): a
# job_results/{id}.input file written before the row-creating db.commit()
# must not survive a commit that then fails — nothing else ever sweeps a
# file with no matching row (data/job_worker.py's GC sweep only inspects
# ConversionJob rows, never lists the directory).
# --------------------------------------------------------------------------- #


class _FakeUploadFile:
    """Minimal async-read stand-in — mirrors test_validation.py's
    _FakeUploadFile. Single read returns the whole (small) payload, second
    read signals EOF, matching _read_capped's chunked-read loop."""

    def __init__(self, content: bytes, filename: str):
        self.filename = filename
        self._content = content
        self._served = False

    async def read(self, size: int) -> bytes:
        if self._served:
            return b""
        self._served = True
        return self._content


async def test_enqueue_conversion_cleans_up_input_file_when_commit_fails(
    db, monkeypatch
):
    async def boom_commit():
        raise RuntimeError("connection lost")

    monkeypatch.setattr(db, "commit", boom_commit)

    valid_docx = b"PK\x03\x04" + b"\x00" * 200
    upload = _FakeUploadFile(valid_docx, "report.docx")

    before = set(converter.JOB_RESULTS_DIR.glob("*.input"))
    with pytest.raises(RuntimeError):
        await converter._enqueue_conversion(
            upload, "docx-to-pdf", converter.MAX_FILE_SIZE, db
        )
    after = set(converter.JOB_RESULTS_DIR.glob("*.input"))

    assert after == before  # no new orphaned .input file left behind


# --------------------------------------------------------------------------- #
# Worker liveness in /health (pr-review follow-up on Phase 3): every
# server-side tool now depends on data/job_worker.py, but /health previously
# only checked Gotenberg and Postgres — a dead worker was invisible to both
# uptime monitors and server-upload.js's checkHealth() upload gate.
# --------------------------------------------------------------------------- #


async def test_health_endpoint_reports_worker_down_with_no_heartbeat(client):
    # No heartbeat key set in the isolated test Redis DB — matches this test
    # environment, where no worker process ever runs against it.
    r = await client.get("/api/v1/health")
    body = r.json()
    assert body["worker"] == "down"
    assert body["status"] == "degraded"


async def test_health_endpoint_reports_worker_up_with_fresh_heartbeat(client):
    from data.redis_client import redis_client

    await redis_client.set(converter.WORKER_HEARTBEAT_KEY, "1", ex=60)
    try:
        r = await client.get("/api/v1/health")
        assert r.json()["worker"] == "up"
    finally:
        await redis_client.delete(converter.WORKER_HEARTBEAT_KEY)


async def test_check_worker_fails_closed_when_redis_unreachable(monkeypatch):
    class _BoomRedis:
        async def exists(self, *a, **kw):
            raise ConnectionError("redis down")

    monkeypatch.setattr(converter, "redis_client", _BoomRedis())
    assert await converter._check_worker() is False


# --------------------------------------------------------------------------- #
# Gotenberg liveness in /health (Phase 3 stress test, Finding 1's health-check
# half): _check_gotenberg() used to make its own live, blocking HTTP call to
# Gotenberg on every single /health request — so once Gotenberg wedged under
# load, /health took 5+ seconds on every poll for as long as the wedge
# lasted, reading to an uptime monitor as the whole site being down. It now
# reads a cached signal data/job_worker.py's loop probes into Redis on its
# own timer, the same pattern _check_worker() already used for the worker
# heartbeat.
# --------------------------------------------------------------------------- #


async def test_health_endpoint_reports_gotenberg_down_with_no_cached_signal(client):
    # No GOTENBERG_HEALTH_KEY set in the isolated test Redis DB — matches this
    # test environment, where data/job_worker.py's --loop probe never runs.
    r = await client.get("/api/v1/health")
    body = r.json()
    assert body["gotenberg"] == "down"
    assert body["status"] == "degraded"


async def test_health_endpoint_reports_gotenberg_up_with_fresh_cached_signal(client):
    from data.redis_client import redis_client

    await redis_client.set(converter.GOTENBERG_HEALTH_KEY, "1", ex=60)
    try:
        r = await client.get("/api/v1/health")
        assert r.json()["gotenberg"] == "up"
    finally:
        await redis_client.delete(converter.GOTENBERG_HEALTH_KEY)


async def test_check_gotenberg_fails_closed_when_redis_unreachable(monkeypatch):
    class _BoomRedis:
        async def exists(self, *a, **kw):
            raise ConnectionError("redis down")

    monkeypatch.setattr(converter, "redis_client", _BoomRedis())
    assert await converter._check_gotenberg() is False


async def test_health_endpoint_never_touches_gotenberg_over_the_network(
    client, monkeypatch
):
    # Reproduces Finding 1's burst-test observation directly: before this fix,
    # _check_gotenberg() made its own live httpx call on every /health
    # request, so a wedged/unresolvable Gotenberg cost every poll up to its
    # full 5s timeout. Proves the fix by making that live call an error if
    # /health ever reaches it — /health must resolve fast regardless, using
    # only the cached Redis signal.
    import asyncio
    import time

    was_called = {"value": False}

    class _AsyncClientMustNotBeUsed:
        def __init__(self, *a, **kw):
            was_called["value"] = True

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, *a, **kw):
            raise AssertionError("unreachable")

    monkeypatch.setattr(converter.httpx, "AsyncClient", _AsyncClientMustNotBeUsed)

    start = time.monotonic()
    r = await asyncio.wait_for(client.get("/api/v1/health"), timeout=1.0)
    elapsed = time.monotonic() - start

    assert r.status_code == 200
    assert r.json()["gotenberg"] == "down"
    assert elapsed < 1.0
    assert was_called["value"] is False
