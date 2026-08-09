"""Integration — pre-existing converter routes.

Validation/error paths need no Gotenberg (validation runs before the proxy call).
The success path mocks the Gotenberg call so no container is required.
"""

import asyncio

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

    monkeypatch.setattr(converter, "async_engine", _BoomEngine())
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["database"] == "down"
    assert body["status"] == "degraded"


async def test_health_endpoint_bounds_a_hanging_db_connect(client, monkeypatch):
    # Post-merge audit fix. `async_engine` sets no connect_timeout (only the
    # sync engine does — data/db.py), so an unbounded `.connect()` could hang
    # past an uptime monitor's polling interval on a network partition that
    # drops packets rather than refusing outright — and unlike the one-time
    # startup check this mirrors, /health is now re-triggered by every poll,
    # so a hang here accumulates a stuck task per poll for as long as the
    # partition lasts. Proves the bound actually applies: a connect that
    # never completes still returns within the (shrunk, for a fast test)
    # timeout, degraded rather than hung.
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

    monkeypatch.setattr(converter, "async_engine", _HangingEngine())
    monkeypatch.setattr(converter, "HEALTH_DB_TIMEOUT_SECONDS", 0.05)

    # wait_for is the assertion, not just a safety net: if the internal bound
    # didn't apply, the hanging connect (sleep(10)) would blow past this and
    # fail loudly with TimeoutError instead of silently passing. 8s, not
    # ~0.05s, because the Gotenberg check runs concurrently (asyncio.gather)
    # and unrelatedly — its httpx timeout only bounds the CONNECT phase, and a
    # DNS failure for the unresolvable test-env hostname can itself take a
    # couple of seconds; the margin absorbs that without weakening what this
    # test actually proves (nowhere near the 10s the hanging connect would
    # take unbounded).
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


async def test_gotenberg_queue_timeout_returns_503_with_retry_after(
    client, monkeypatch
):
    monkeypatch.setattr(converter, "_gotenberg_semaphore", asyncio.Semaphore(1))
    monkeypatch.setattr(converter, "GOTENBERG_QUEUE_TIMEOUT_SECONDS", 0.05)

    async def post_impl():
        # Holds the one slot well past the queue timeout so the second
        # request below is forced to wait and expire.
        await asyncio.sleep(1.0)
        return _FakeResponse()

    monkeypatch.setattr(converter.httpx, "AsyncClient", _fake_async_client(post_impl))

    valid_docx = b"PK\x03\x04" + b"\x00" * 200

    async def _convert_request():
        return await client.post(
            "/api/v1/convert/docx-to-pdf",
            files={
                "file": (
                    "report.docx",
                    valid_docx,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            },
        )

    # Fire two conversions at once: the first occupies the only slot for 1s
    # (well past the 0.05s queue timeout), so the second must time out
    # waiting rather than queue indefinitely.
    first, second = await asyncio.gather(_convert_request(), _convert_request())
    timed_out = [r for r in (first, second) if r.status_code == 503]
    assert timed_out, (first.status_code, second.status_code)
    body = timed_out[0].json()
    assert body["error_type"] == "queue_timeout"
    assert timed_out[0].headers["retry-after"] == "10"
