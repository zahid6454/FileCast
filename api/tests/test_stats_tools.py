"""Integration — GET /api/v1/stats/tools: all-time per-tool conversion
aggregate, bulk (every tool, not just the dashboard's top 10)."""

from datetime import date, timedelta

from data.db import sync_session
from data.models import Conversion


def _seed(
    tool_id: str, day: date, count: int, failures: int = 0, visitors: int = 0
) -> None:
    with sync_session() as s:
        s.add(
            Conversion(
                tool_id=tool_id,
                date=day,
                count=count,
                failures=failures,
                unique_visitors=visitors,
            )
        )
        s.commit()


async def test_admin_only(client, user_client, admin_client):
    assert (await client.get("/api/v1/stats/tools")).status_code == 401
    assert (await user_client.get("/api/v1/stats/tools")).status_code == 403
    assert (await admin_client.get("/api/v1/stats/tools")).status_code == 200


async def test_empty_when_no_conversions(admin_client):
    assert (await admin_client.get("/api/v1/stats/tools")).json() == []


async def test_sums_across_days_for_one_tool(admin_client):
    today = date.today()
    _seed("jpg-to-png", today, count=5, failures=1, visitors=3)
    _seed("jpg-to-png", today - timedelta(days=1), count=2, failures=0, visitors=1)
    body = (await admin_client.get("/api/v1/stats/tools")).json()
    assert body == [
        {"tool_id": "jpg-to-png", "count": 7, "failures": 1, "unique_visitors": 4}
    ]


async def test_covers_every_tool_not_just_top_10(admin_client):
    # The existing /stats/dashboard top_tools list caps at 10 — this endpoint
    # exists precisely so a tool outside that cap still reports a real count.
    today = date.today()
    for i in range(12):
        _seed(f"tool-{i}", today, count=1)
    body = (await admin_client.get("/api/v1/stats/tools")).json()
    assert len(body) == 12


async def test_shape_matches_bulk_ratings_convention(admin_client):
    # A bare list of dicts, same style as the sibling bulk GET /ratings — the
    # admin tools-tab slide-out indexes both by tool_id the same way.
    _seed("jpg-to-png", date.today(), count=1)
    body = (await admin_client.get("/api/v1/stats/tools")).json()
    assert isinstance(body, list)
    assert set(body[0].keys()) == {"tool_id", "count", "failures", "unique_visitors"}
