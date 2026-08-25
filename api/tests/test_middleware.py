"""Integration — CORS credentials, per-path rate limiting, docs gating.

The limiter is reset per test (conftest ``_reset_rate_limiter`` flushes the
isolated test Redis DB), so counts are deterministic even though the store
itself (Phase 3) is shared, not in-process.
"""

import asyncio

import main
import middleware
from data.config import settings
from data.redis_client import redis_client
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


async def test_cors_credentials_on_normal_request(client):
    r = await client.get(
        "/api/v1/announcements/active", headers={"Origin": "http://localhost:8000"}
    )
    assert r.headers["access-control-allow-origin"] == "http://localhost:8000"
    assert r.headers["access-control-allow-credentials"] == "true"


async def test_cors_exposes_retry_after_to_cross_origin_javascript(client):
    # Phase 3 regression: browsers only expose a small safelisted set of
    # response headers to JS on a cross-origin request unless the server
    # opts more in via Access-Control-Expose-Headers — confirmed live in a
    # real browser (console: "Refused to get unsafe header 'Retry-After'")
    # that server-upload.js's poll loop was silently never able to read the
    # header its own backoff schedule depends on, on the real
    # filecast.org -> api.filecast.org cross-origin deployment.
    r = await client.get(
        "/api/v1/convert/jobs/does-not-exist",
        headers={"Origin": "http://localhost:8000"},
    )
    assert "retry-after" in r.headers.get("access-control-expose-headers", "").lower()


async def test_cors_preflight_answered_not_rate_limited(client):
    r = await client.request(
        "OPTIONS",
        "/api/v1/conversions",
        headers={
            "Origin": "http://localhost:8000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:8000"
    assert "PUT" in r.headers.get("access-control-allow-methods", "")


async def test_errors_rate_limited_at_60(client):
    codes = []
    for _ in range(61):
        codes.append(
            (await client.post("/api/v1/errors", json={"error_type": "x"})).status_code
        )
    assert codes.count(200) == 60
    assert codes[-1] == 429


async def test_messages_rate_limited_at_10(client):
    codes = []
    for _ in range(11):
        codes.append(
            (
                await client.post("/api/v1/messages", json={"title": "t", "body": "b"})
            ).status_code
        )
    assert codes.count(200) == 10
    assert codes[-1] == 429


async def test_conversions_higher_budget_than_errors(client):
    # 61 conversion tracking posts (one more than errors' 60/hr) must NOT be
    # rate limited (conversions' budget is 120).
    codes = [
        (
            await client.post(
                "/api/v1/conversions",
                json={
                    "tool_id": "t",
                    "input_format": "A",
                    "output_format": "B",
                    "status": "success",
                },
            )
        ).status_code
        for _ in range(61)
    ]
    assert all(c == 200 for c in codes)


# --------------------------------------------------------------------------- #
# X-RateLimit-* headers (P2 §22)
# --------------------------------------------------------------------------- #


async def test_rate_limit_headers_on_allowed_response(client):
    r = await client.post("/api/v1/errors", json={"error_type": "x"})
    assert r.status_code == 200
    assert r.headers["x-ratelimit-limit"] == "60"
    assert r.headers["x-ratelimit-remaining"] == "59"  # one request just spent
    assert 0 < int(r.headers["x-ratelimit-reset"]) <= middleware.RATE_WINDOW


async def test_rate_limit_headers_count_down(client):
    remaining = []
    for _ in range(3):
        r = await client.post("/api/v1/errors", json={"error_type": "x"})
        remaining.append(int(r.headers["x-ratelimit-remaining"]))
    assert remaining == [59, 58, 57]


async def test_rate_limit_headers_on_429(client):
    codes_and_headers = [
        await client.post("/api/v1/errors", json={"error_type": "x"}) for _ in range(61)
    ]
    last = codes_and_headers[-1]
    assert last.status_code == 429
    assert last.headers["x-ratelimit-limit"] == "60"
    assert last.headers["x-ratelimit-remaining"] == "0"
    # Retry-After and X-RateLimit-Reset agree — both describe the same "wait
    # this long" number, not an independent hardcoded value.
    assert last.headers["retry-after"] == last.headers["x-ratelimit-reset"]


async def test_no_rate_limit_headers_on_an_unmatched_path(client):
    # /api/v1/favorites carries no PATH_LIMITS entry — nothing to report.
    # (/api/v1/tools moved into PATH_LIMITS — see the admin-budget tests below.)
    r = await client.get("/api/v1/favorites")
    assert "x-ratelimit-limit" not in r.headers
    assert "x-ratelimit-remaining" not in r.headers
    assert "x-ratelimit-reset" not in r.headers


# --------------------------------------------------------------------------- #
# Admin-surface rate limits (OWASP A05) — /admin, /tools, /stats are fully
# require_admin-gated but previously carried no budget of their own.
# --------------------------------------------------------------------------- #


async def test_admin_surfaces_have_rate_limit_headers(admin_client):
    r = await admin_client.get("/api/v1/tools")
    assert r.status_code == 200
    assert r.headers["x-ratelimit-limit"] == "200"

    r = await admin_client.get("/api/v1/stats/dashboard")
    assert r.headers["x-ratelimit-limit"] == "200"

    r = await admin_client.get("/api/v1/admin/staff")
    assert r.headers["x-ratelimit-limit"] == "300"


# --------------------------------------------------------------------------- #
# Phase 3: /convert/jobs polling budget (nested under /convert, longest-
# prefix wins — see test_unit.py's test_rate_limit_path_matching)
# --------------------------------------------------------------------------- #


async def test_convert_jobs_polling_has_its_own_higher_budget(client):
    r = await client.get("/api/v1/convert/jobs/does-not-exist")
    assert r.status_code == 404  # unknown job, but still rate-limit-headered
    assert r.headers["x-ratelimit-limit"] == "400"


async def test_rate_limit_remaining_is_race_free_under_concurrency(client):
    # Post-merge audit fix. RateLimitMiddleware.dispatch() used to compute
    # X-RateLimit-Remaining from `len(self.requests[key])` AFTER `await
    # call_next(request)` — but that await suspends the coroutine, and
    # `self.requests` is one dict shared by every in-flight request on this
    # worker. N concurrent requests on the SAME bucket (same IP/path — here,
    # one test client hitting one endpoint) can all append to `key` while
    # each other's `call_next()` is still pending, so reading the length back
    # afterward reports whatever the bucket grew to by then, not the slot
    # this particular request actually claimed.
    #
    # Correct behaviour: N concurrent, all-successful requests each claim a
    # DISTINCT slot, so their reported `remaining` values are N distinct
    # numbers with no duplicates. The buggy version tends to report the same
    # (larger) length to several responses that raced past the read at
    # similar times, producing duplicates instead of a clean 1:1 mapping.
    n = 10
    responses = await asyncio.gather(
        *(client.post("/api/v1/errors", json={"error_type": "x"}) for _ in range(n))
    )
    assert all(r.status_code == 200 for r in responses)
    remaining = [int(r.headers["x-ratelimit-remaining"]) for r in responses]
    assert len(set(remaining)) == n, remaining  # no two requests reported the same slot
    assert set(remaining) == set(range(60 - n, 60))  # exactly slots 50..59, no gaps


async def test_rate_limit_shared_exactly_across_two_app_instances(client):
    # The actual point of Phase 3 (STRESS_TEST_PHASE3_PLAN.md): the old
    # in-memory limiter was enforced per uvicorn worker (STRESS_TEST_REPORT.md
    # Finding 2 measured ~4x the advertised limit getting through). Two
    # separate ``RateLimitMiddleware`` instances stand in for two separate
    # workers here — both must draw from the SAME Redis-backed count for the
    # SAME client IP, proving the limit is exact across processes now, not
    # just within one.
    second_app = FastAPI()

    @second_app.post("/api/v1/errors")
    async def _errors():
        return {"ok": True}

    second_app.add_middleware(middleware.RateLimitMiddleware)

    async with AsyncClient(
        transport=ASGITransport(app=second_app), base_url="http://test"
    ) as second_client:
        # errors/hr budget is 60 — exhaust it split across both "workers".
        codes = []
        for i in range(61):
            c = client if i % 2 == 0 else second_client
            r = await c.post("/api/v1/errors", json={"error_type": "x"})
            codes.append(r.status_code)
        assert codes.count(200) == 60
        assert codes[-1] == 429


async def test_rate_limit_fails_open_when_redis_unreachable(client, monkeypatch):
    # Redis being briefly unavailable degrades to "no rate limiting", not a
    # broken/503'd API — a broken rate limiter is defense-in-depth, not a
    # hard quota, and Redis must not become a new single point of total
    # failure the way Gotenberg was in Finding 1.
    async def boom(*args, **kwargs):
        raise ConnectionError("Redis is down")

    from middleware import RateLimitMiddleware

    if main.app.middleware_stack is None:
        main.app.middleware_stack = main.app.build_middleware_stack()
    node = main.app.middleware_stack
    while node is not None:
        if isinstance(node, RateLimitMiddleware):
            monkeypatch.setattr(node, "_script", boom)
            break
        node = getattr(node, "app", None)

    r = await client.post("/api/v1/errors", json={"error_type": "x"})
    assert r.status_code == 200
    assert "x-ratelimit-limit" not in r.headers


async def test_rate_limit_ttl_refreshes_on_every_call_not_just_key_creation(client):
    # TTL replaces the old in-memory `_sweep`'s manual idle-bucket eviction
    # entirely — but only if EXPIRE is reissued on every call, not just when
    # the key is first created (see RateLimitMiddleware's docstring). A
    # one-shot EXPIRE at key-birth would let a bucket seeing fresh activity
    # right up to its TTL vanish early, silently truncating a still-active
    # window.
    await client.post("/api/v1/errors", json={"error_type": "x"})
    keys = [k async for k in redis_client.scan_iter(match="ratelimit:/api/v1/errors:*")]
    zkey = next(k for k in keys if not k.endswith(":seq"))

    # Simulate a bucket that's about to expire.
    await redis_client.expire(zkey, 5)
    assert await redis_client.ttl(zkey) <= 5

    await client.post("/api/v1/errors", json={"error_type": "x"})
    assert await redis_client.ttl(zkey) > 5


async def test_docs_enabled_in_development():
    # ENVIRONMENT=development in tests → docs surface exposed (404 in prod, gated)
    assert main.app.openapi_url == "/openapi.json"
    assert main.app.docs_url == "/docs"


# --------------------------------------------------------------------------- #
# CORS origin gating (Phase 9 §5 item 4)
# --------------------------------------------------------------------------- #


def test_dev_origins_only_in_development():
    # localhost was allow-listed in every environment. SameSite=Lax meant a
    # cross-site request from localhost carried no fc_session, so it was never
    # exploitable — but "loose but mitigated" isn't worth keeping.
    prod = middleware.allowed_origins("production")
    assert "https://filecast.org" in prod
    assert "http://localhost:8000" not in prod
    assert "http://127.0.0.1:8000" not in prod

    dev = middleware.allowed_origins("development")
    assert "http://localhost:8000" in dev
    assert "http://127.0.0.1:8000" in dev


def test_unrecognised_environment_fails_closed():
    # Exact match on "development", same as dev-login (§16-R1) — a typo or a new
    # environment name must not quietly re-allow localhost.
    for env in ("staging", "prod", "Development", ""):
        assert "http://localhost:8000" not in middleware.allowed_origins(env), env


def test_live_origin_list_is_derived_from_the_configured_environment():
    # Guards the wiring, not just the helper.
    assert middleware.ALLOWED_ORIGINS == middleware.allowed_origins(
        settings.environment
    )


# --------------------------------------------------------------------------- #
# X-Robots-Tag (api.filecast.org must never be indexed)
# --------------------------------------------------------------------------- #


async def test_noindex_header_on_root(client):
    r = await client.get("/")
    assert r.headers["x-robots-tag"] == "noindex, nofollow"


async def test_noindex_header_on_429(client):
    codes_and_headers = [
        await client.post("/api/v1/errors", json={"error_type": "x"}) for _ in range(61)
    ]
    last = codes_and_headers[-1]
    assert last.status_code == 429
    assert last.headers["x-robots-tag"] == "noindex, nofollow"


# --------------------------------------------------------------------------- #
# SecurityHeadersMiddleware (OWASP A05) — nosniff always, HSTS production-only
# --------------------------------------------------------------------------- #


async def test_nosniff_header_always_present(client):
    r = await client.get("/")
    assert r.headers["x-content-type-options"] == "nosniff"


async def test_hsts_absent_outside_production(client):
    r = await client.get("/")
    assert "strict-transport-security" not in r.headers


async def test_hsts_present_in_production(client, monkeypatch):
    from data import config

    monkeypatch.setattr(config.settings, "environment", "production")
    r = await client.get("/")
    assert (
        r.headers["strict-transport-security"]
        == "max-age=31536000; includeSubDomains; preload"
    )


# --------------------------------------------------------------------------- #
# SelectiveGZipMiddleware — /convert output shouldn't be gzipped twice
# --------------------------------------------------------------------------- #


def _gzip_test_app() -> FastAPI:
    app = FastAPI()
    big = "x" * 2000  # well over the 500-byte minimum_size

    @app.get("/plain/big")
    def plain_big():
        return {"data": big}

    @app.get("/api/v1/convert/big")
    def convert_big():
        return {"data": big}

    app.add_middleware(
        middleware.SelectiveGZipMiddleware,
        exclude_prefixes=("/api/v1/convert",),
        minimum_size=500,
    )
    return app


async def test_gzip_applies_to_ordinary_large_responses():
    async with AsyncClient(
        transport=ASGITransport(app=_gzip_test_app()), base_url="http://test"
    ) as c:
        r = await c.get("/plain/big", headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip"
    assert r.json() == {"data": "x" * 2000}


async def test_gzip_skips_excluded_convert_prefix():
    async with AsyncClient(
        transport=ASGITransport(app=_gzip_test_app()), base_url="http://test"
    ) as c:
        r = await c.get("/api/v1/convert/big", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in r.headers
    assert r.json() == {"data": "x" * 2000}
