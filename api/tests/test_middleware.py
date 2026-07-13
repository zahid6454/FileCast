"""Integration — CORS credentials, per-path rate limiting, docs gating.

The limiter is reset per test (conftest ``_reset_rate_limiter``), so counts are
deterministic against the single in-process app instance.
"""

import main


async def test_cors_credentials_on_normal_request(client):
    r = await client.get(
        "/api/v1/announcements/active", headers={"Origin": "http://localhost:8000"}
    )
    assert r.headers["access-control-allow-origin"] == "http://localhost:8000"
    assert r.headers["access-control-allow-credentials"] == "true"


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


async def test_conversions_higher_budget_than_errors(client):
    # 61 conversion tracking posts must NOT be rate limited (budget is 120)
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


async def test_docs_enabled_in_development():
    # ENVIRONMENT=development in tests → docs surface exposed (404 in prod, gated)
    assert main.app.openapi_url == "/openapi.json"
    assert main.app.docs_url == "/docs"
