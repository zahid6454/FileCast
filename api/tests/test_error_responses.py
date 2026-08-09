"""API error response audit (P4 §40).

Verifies malformed requests, oversized files, and unsupported file types never
leak stack traces, internal file paths, or raw exception text to the client —
only the generic, controlled messages `converter.py`/`validation.py` already
construct. This is a verification pass, not a rewrite: `_handle_conversion`
already funnels every failure through a fixed set of generic messages
(`converter.py`), and no route anywhere builds a response from `str(exc)` or
similar (see the module-level audit this file backs). These tests exist so a
future change that accidentally reintroduces a leak fails CI instead of
shipping.
"""

import converter

# Telltale substrings that must never appear in a response body — a real
# leak would surface one of these regardless of which route or exception
# triggered it.
_LEAK_MARKERS = ("Traceback", "site-packages", '  File "', "raise ", "Exception:")


def _assert_no_leak(body_text: str):
    for marker in _LEAK_MARKERS:
        assert marker not in body_text, f"response leaked internal detail: {marker!r}"


async def test_oversized_file_rejected_without_leaking_path(client):
    big = b"PK\x03\x04" + b"\x00" * (converter.MAX_FILE_SIZE + 1)
    r = await client.post(
        "/api/v1/convert/docx-to-pdf",
        files={
            "file": (
                "huge.docx",
                big,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert r.status_code == 400
    body = r.json()
    assert body["error_type"] == "too_large"
    # The limit is stated in human terms (MB), not a raw byte count or path.
    assert "MB limit" in body["error"]
    _assert_no_leak(r.text)


async def test_unsupported_extension_rejected(client):
    r = await client.post(
        "/api/v1/convert/docx-to-pdf",
        files={
            "file": ("virus.exe", b"MZ" + b"\x00" * 100, "application/octet-stream")
        },
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "wrong_format"
    _assert_no_leak(r.text)


async def test_bad_magic_bytes_rejected_generically(client):
    # Right extension, wrong content — validate_upload's magic-byte check.
    r = await client.post(
        "/api/v1/convert/docx-to-pdf",
        files={
            "file": (
                "fake.docx",
                b"this is not a real docx file at all",
                "application/octet-stream",
            )
        },
    )
    assert r.status_code == 400
    body = r.json()
    assert body["error_type"] == "invalid_file"
    assert set(body.keys()) == {"error", "error_type"}
    _assert_no_leak(r.text)


async def test_invalid_html_content_rejected(client):
    r = await client.post(
        "/api/v1/convert/html-to-pdf",
        files={"file": ("page.html", b"not actually html markup", "text/plain")},
    )
    assert r.status_code == 400
    assert r.json()["error_type"] == "invalid_file"
    _assert_no_leak(r.text)


async def test_unexpected_conversion_exception_returns_generic_500(client, monkeypatch):
    """A genuinely unexpected failure inside the conversion path (not a
    ValidationError, not a Gotenberg/timeout path) — the broad `except
    Exception` in `_handle_conversion` must still respond with the fixed
    generic message, never the raised exception's own text."""

    async def boom(content, filename, extra_form=None):
        raise RuntimeError("super secret internal detail: /etc/shadow readable")

    monkeypatch.setattr(converter, "_convert_libreoffice", boom)
    valid_docx = b"PK\x03\x04" + b"\x00" * 200
    r = await client.post(
        "/api/v1/convert/docx-to-pdf",
        files={
            "file": (
                "report.docx",
                valid_docx,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert r.status_code == 500
    body = r.json()
    assert body["error_type"] == "conversion_error"
    assert "secret" not in body["error"]
    assert "/etc/shadow" not in r.text
    assert "RuntimeError" not in r.text
    _assert_no_leak(r.text)


async def test_malformed_json_body_returns_structured_422_not_a_trace(client):
    r = await client.post(
        "/api/v1/auth/login",
        content=b"{not valid json",
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 422
    _assert_no_leak(r.text)


async def test_wrong_field_types_returns_structured_422(client):
    r = await client.post("/api/v1/auth/login", json={"email": 12345, "password": None})
    assert r.status_code == 422
    _assert_no_leak(r.text)


async def test_gotenberg_non_200_does_not_leak_upstream_body(client, monkeypatch):
    """Gotenberg's raw error body is logged server-side (converter.py) but must
    never reach the client — the client only ever sees the fixed generic
    message from `_handle_conversion`'s broad except-clause.

    Raises the exact RuntimeError shape `_gotenberg_request` itself raises on
    a non-200 response (`Gotenberg {endpoint} returned {status}: {body}`) from
    `_convert_libreoffice` directly, rather than mocking `httpx.AsyncClient`
    globally — a class-level httpx mock would also hijack the test `client`
    fixture's own request to the app (same class, same patched method),
    making the assertion check the mock's own text instead of a real
    response.
    """

    async def boom(content, filename, extra_form=None):
        raise RuntimeError(
            "Gotenberg /forms/libreoffice/convert returned 500: "
            "LibreOffice crashed: /root/.config/libreoffice corrupted profile at /tmp/xyz123"
        )

    monkeypatch.setattr(converter, "_convert_libreoffice", boom)
    valid_docx = b"PK\x03\x04" + b"\x00" * 200
    r = await client.post(
        "/api/v1/convert/docx-to-pdf",
        files={
            "file": (
                "report.docx",
                valid_docx,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert r.status_code == 500
    assert "/root/.config" not in r.text
    assert "/tmp/xyz123" not in r.text
    assert "LibreOffice crashed" not in r.text
    _assert_no_leak(r.text)
