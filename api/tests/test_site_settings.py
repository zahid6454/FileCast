"""Integration — Site Settings singleton: admin authz, upsert, and the 422
validation rules that are the injection guard (values bake into HTML)."""

from data.models import SiteSetting
from sqlalchemy import select

VALID = {
    "site_name": "FileCast",
    "site_tagline": "Free File Conversion",
    "site_description": "Convert files privately in your browser.",
    "adsense_enabled": False,
    "ga4_enabled": False,
    "sentry_enabled": False,
}


async def test_site_settings_authz(client, user_client, admin_client):
    url = "/api/v1/admin/site-settings"
    assert (await client.get(url)).status_code == 401
    assert (await user_client.get(url)).status_code == 403
    assert (await admin_client.get(url)).status_code == 200
    # PUT is admin-only too.
    assert (await client.put(url, json=VALID)).status_code == 401
    assert (await user_client.put(url, json=VALID)).status_code == 403


async def test_get_returns_null_when_unseeded(admin_client):
    r = await admin_client.get("/api/v1/admin/site-settings")
    assert r.status_code == 200
    assert r.json()["site_settings"] is None


async def test_put_creates_singleton(admin_client, db):
    r = await admin_client.put("/api/v1/admin/site-settings", json=VALID)
    assert r.status_code == 200, r.text
    assert r.json()["site_settings"]["site_name"] == "FileCast"
    rows = (await db.execute(select(SiteSetting))).scalars().all()
    assert len(rows) == 1 and rows[0].id == 1


async def test_put_upserts_same_row(admin_client, db):
    await admin_client.put("/api/v1/admin/site-settings", json=VALID)
    body = {**VALID, "site_name": "Renamed"}
    r = await admin_client.put("/api/v1/admin/site-settings", json=body)
    assert r.status_code == 200
    rows = (await db.execute(select(SiteSetting))).scalars().all()
    assert len(rows) == 1  # upsert, not a second row
    assert rows[0].site_name == "Renamed"


async def test_get_after_put_returns_saved_values(admin_client):
    body = {**VALID, "site_tagline": "Persisted Tagline"}
    await admin_client.put("/api/v1/admin/site-settings", json=body)
    r = await admin_client.get("/api/v1/admin/site-settings")
    assert r.status_code == 200
    out = r.json()["site_settings"]
    assert out is not None
    assert out["site_tagline"] == "Persisted Tagline"
    assert out["updated_at"] is not None  # server-stamped


async def test_put_full_integration_roundtrip(admin_client):
    body = {
        **VALID,
        "adsense_enabled": True,
        "adsense_publisher_id": "ca-pub-1234567890123456",
        "adsense_slot_leaderboard": "1122334455",
        "adsense_slot_in_content": "6677889900",
        "ga4_enabled": True,
        "ga4_measurement_id": "G-ABCD1234",
        "sentry_enabled": True,
        "sentry_dsn": "https://abc123@o1.ingest.sentry.io/42",
    }
    r = await admin_client.put("/api/v1/admin/site-settings", json=body)
    assert r.status_code == 200, r.text
    out = r.json()["site_settings"]
    assert out["adsense_publisher_id"] == "ca-pub-1234567890123456"
    assert out["ga4_measurement_id"] == "G-ABCD1234"


# --- 422 validation rules (each rejects BEFORE any rebuild) ------------------- #


async def _put(admin_client, **overrides):
    return await admin_client.put(
        "/api/v1/admin/site-settings", json={**VALID, **overrides}
    )


async def test_reject_empty_site_name(admin_client):
    assert (await _put(admin_client, site_name="")).status_code == 422
    assert (await _put(admin_client, site_name="   ")).status_code == 422


async def test_reject_empty_site_tagline(admin_client):
    assert (await _put(admin_client, site_tagline="")).status_code == 422


async def test_reject_oversize_copy(admin_client):
    assert (await _put(admin_client, site_name="x" * 81)).status_code == 422
    assert (await _put(admin_client, site_tagline="x" * 161)).status_code == 422
    assert (await _put(admin_client, site_description="x" * 301)).status_code == 422


async def test_reject_bad_publisher_id(admin_client):
    assert (
        await _put(admin_client, adsense_publisher_id="pub-1234")
    ).status_code == 422
    assert (
        await _put(admin_client, adsense_publisher_id="ca-pub-123")
    ).status_code == 422  # too few digits


async def test_reject_bad_measurement_id(admin_client):
    assert (await _put(admin_client, ga4_measurement_id="UA-123")).status_code == 422


async def test_reject_non_numeric_slot(admin_client):
    assert (await _put(admin_client, adsense_slot_leaderboard="abc")).status_code == 422


async def test_reject_non_sentry_dsn(admin_client):
    assert (
        await _put(admin_client, sentry_dsn="https://evil.example.com/1")
    ).status_code == 422
    assert (
        await _put(admin_client, sentry_dsn="http://o1.ingest.sentry.io/1")
    ).status_code == 422  # not https


async def test_reject_enabled_with_empty_id(admin_client):
    # enabled + empty required id must 422 — else a rebuild bakes a broken tag.
    assert (await _put(admin_client, adsense_enabled=True)).status_code == 422
    assert (await _put(admin_client, ga4_enabled=True)).status_code == 422
    assert (await _put(admin_client, sentry_enabled=True)).status_code == 422
