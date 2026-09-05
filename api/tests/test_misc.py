"""Integration — favorites, preferences, announcements, stats, errors."""

from datetime import UTC, datetime

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


async def test_preferences_rejects_unknown_keys(admin_client):
    r = await admin_client.put("/api/v1/preferences", json={"evil": "x"})
    assert r.status_code == 400


async def test_preferences_rejects_oversized_payload(admin_client):
    r = await admin_client.put("/api/v1/preferences", json={"display_name": "x" * 5000})
    assert r.status_code == 413


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
    assert d["total_unique_visitors"] == 1
    assert d["top_tools"][0] == {"tool_id": "jpg-to-png", "count": 1, "visitors": 1}


async def test_stats_errors_lists_newest_first_with_total_and_has_more(
    client, admin_client
):
    for i in range(3):
        await client.post(
            "/api/v1/errors", json={"tool_id": "t", "error_message": str(i)}
        )
    data = (await admin_client.get("/api/v1/stats/errors?limit=2&offset=0")).json()
    assert [e["error_message"] for e in data["errors"]] == ["2", "1"]
    assert data["total"] == 3
    assert data["has_more"] is True
    data = (await admin_client.get("/api/v1/stats/errors?limit=2&offset=2")).json()
    assert [e["error_message"] for e in data["errors"]] == ["0"]
    assert data["total"] == 3
    assert data["has_more"] is False


async def test_stats_errors_breaks_created_at_ties_by_id(admin_client, db):
    # Two rows landing on the identical timestamp (created_at's precision is
    # finite) must still sort deterministically newest-id-first, not depend
    # on the DB's arbitrary tie order — mirrors messages.py's own tiebreaker.
    same_instant = datetime.now(UTC)
    db.add_all(
        [
            Error(tool_id="t", error_message="a", created_at=same_instant),
            Error(tool_id="t", error_message="b", created_at=same_instant),
        ]
    )
    await db.commit()
    data = (await admin_client.get("/api/v1/stats/errors")).json()
    assert [e["error_message"] for e in data["errors"]] == ["b", "a"]


async def test_stats_errors_respects_limit_bounds(client, admin_client):
    for i in range(3):
        await client.post(
            "/api/v1/errors", json={"tool_id": "t", "error_message": str(i)}
        )
    data = (await admin_client.get("/api/v1/stats/errors?limit=2")).json()
    assert len(data["errors"]) == 2
    # Out-of-range values are clamped, not rejected.
    data = (await admin_client.get("/api/v1/stats/errors?limit=0")).json()
    assert len(data["errors"]) == 1
    data = (await admin_client.get("/api/v1/stats/errors?limit=99999")).json()
    assert len(data["errors"]) == 3


async def test_stats_errors_offset_past_end_still_reports_total(client, admin_client):
    # When offset lands at or past the last row, the windowed query returns
    # zero rows — total then has to come from the separate COUNT fallback
    # (see recent_errors) rather than the window function, which has nothing
    # to ride along on. That fallback path must still report the real total,
    # not silently report 0 (this is what the admin panel's pager relies on
    # to notice a stale page and step back rather than stranding the admin).
    for i in range(3):
        await client.post(
            "/api/v1/errors", json={"tool_id": "t", "error_message": str(i)}
        )
    data = (await admin_client.get("/api/v1/stats/errors?limit=2&offset=10")).json()
    assert data["errors"] == []
    assert data["total"] == 3
    assert data["has_more"] is False


# --- errors ---


async def test_errors_public_and_truncated(client, db):
    long_msg = "x" * 5000
    r = await client.post(
        "/api/v1/errors", json={"tool_id": "t", "error_message": long_msg}
    )
    assert r.status_code == 200
    row = (await db.execute(select(Error))).scalar_one()
    assert len(row.error_message) == 2000
