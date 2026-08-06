"""Integration — pre-existing converter routes.

Validation/error paths need no Gotenberg (validation runs before the proxy call).
The success path mocks the Gotenberg call so no container is required.
"""

import converter


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
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"] == 'attachment; filename="report.pdf"'
    assert r.content == b"%PDF-1.4 fake pdf bytes"


async def test_metrics_endpoint_shape(client):
    r = await client.get("/api/v1/metrics")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"conversions", "failures", "avg_duration_ms"}


async def test_health_endpoint_responds(client):
    # Gotenberg host isn't resolvable from the test process → degraded, but the
    # endpoint must still respond 200 with a status.
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] in ("healthy", "degraded")


async def test_health_endpoint_accepts_head(client):
    # Uptime monitors default to HEAD requests; must not 405.
    r = await client.head("/api/v1/health")
    assert r.status_code == 200
    assert r.content == b""
