"""Integration — favorites, preferences, announcements, stats, errors."""

from data.models import Error
from sqlalchemy import select

# --- favorites ---


async def test_favorites_add_idempotent_list_delete(admin_client):
    assert (
        await admin_client.post("/api/v1/favorites", json={"tool_id": "jpg-to-png"})
    ).status_code == 200
    await admin_client.post("/api/v1/favorites", json={"tool_id": "jpg-to-png"})  # dup
    assert (await admin_client.get("/api/v1/favorites")).json()["favorites"] == [
        "jpg-to-png"
    ]
    await admin_client.delete("/api/v1/favorites/jpg-to-png")
    assert (await admin_client.get("/api/v1/favorites")).json()["favorites"] == []


async def test_favorites_requires_auth(client):
    assert (await client.get("/api/v1/favorites")).status_code == 401


# --- preferences ---


async def test_preferences_put_merges(admin_client):
    await admin_client.put("/api/v1/preferences", json={"theme": "dark"})
    r = await admin_client.put("/api/v1/preferences", json={"jpeg_quality": 80})
    assert r.json()["preferences"] == {"theme": "dark", "jpeg_quality": 80}


# --- announcements ---


async def test_announcements_only_one_active(admin_client, client):
    await admin_client.post(
        "/api/v1/announcements", json={"message": "First", "active": True}
    )
    await admin_client.post(
        "/api/v1/announcements", json={"message": "Second", "active": True}
    )
    active = (await client.get("/api/v1/announcements/active")).json()["announcement"]
    assert active["message"] == "Second"
    lst = (await admin_client.get("/api/v1/announcements")).json()["announcements"]
    assert sum(a["active"] for a in lst) == 1


async def test_announcements_active_route_not_shadowed(client):
    # literal /active must resolve even with no announcements (not parsed as {id})
    r = await client.get("/api/v1/announcements/active")
    assert r.status_code == 200 and r.json()["announcement"] is None


async def test_announcements_crud_admin_only(client):
    assert (
        await client.post("/api/v1/announcements", json={"message": "x"})
    ).status_code == 401


# --- stats ---


async def test_stats_admin_only(client):
    for path in (
        "/api/v1/stats/dashboard",
        "/api/v1/stats/conversions",
        "/api/v1/stats/errors",
    ):
        assert (await client.get(path)).status_code == 401


async def test_stats_dashboard_aggregates(admin_client):
    await admin_client.post(
        "/api/v1/conversions",
        json={
            "tool_id": "jpg-to-png",
            "input_format": "JPG",
            "output_format": "PNG",
            "status": "success",
        },
    )
    d = (await admin_client.get("/api/v1/stats/dashboard")).json()
    assert d["total_conversions"] == 1
    assert d["total_users"] >= 1
    assert isinstance(d["top_tools"], list)


# --- errors ---


async def test_errors_public_and_truncated(client, db):
    long_msg = "x" * 5000
    r = await client.post(
        "/api/v1/errors", json={"tool_id": "t", "error_message": long_msg}
    )
    assert r.status_code == 200
    row = (await db.execute(select(Error))).scalar_one()
    assert len(row.error_message) == 2000
