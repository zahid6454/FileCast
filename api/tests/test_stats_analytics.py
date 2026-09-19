"""Integration — the filter-bar-driven admin dashboard endpoints added by
ADMIN-DASHBOARD-ANALYTICS-PLAN.md §7: GET /stats/conversions's new
tool_id/group_by params, GET /stats/top-tools, GET /stats/signups, and
GET /stats/errors/summary."""

from datetime import UTC, date, datetime, timedelta

from data.db import sync_session
from data.models import Conversion, Error, User


def _seed_conversion(
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


# --- GET /stats/conversions: tool_id + group_by ------------------------------


async def test_conversions_series_filters_by_tool_id(admin_client):
    today = date.today()
    _seed_conversion("jpg-to-png", today, count=5)
    _seed_conversion("docx-to-pdf", today, count=9)
    body = (
        await admin_client.get("/api/v1/stats/conversions?tool_id=jpg-to-png")
    ).json()
    assert body["series"] == [{"date": today.isoformat(), "count": 5, "failures": 0}]


async def test_conversions_series_empty_when_tool_id_matches_nothing(admin_client):
    _seed_conversion("jpg-to-png", date.today(), count=5)
    body = (
        await admin_client.get("/api/v1/stats/conversions?tool_id=no-such-tool")
    ).json()
    assert body["series"] == []


async def test_conversions_series_group_by_month_buckets_across_days(admin_client):
    today = date.today()
    other_day_in_month = (
        today.replace(day=1) if today.day != 1 else today.replace(day=2)
    )
    _seed_conversion("jpg-to-png", today, count=3)
    _seed_conversion("jpg-to-png", other_day_in_month, count=4)
    body = (
        await admin_client.get("/api/v1/stats/conversions?days=365&group_by=month")
    ).json()
    month_key = today.strftime("%Y-%m")
    assert body["series"] == [{"date": month_key, "count": 7, "failures": 0}]


# --- GET /stats/top-tools -----------------------------------------------------


async def test_top_tools_admin_only(client, user_client, admin_client):
    assert (await client.get("/api/v1/stats/top-tools")).status_code == 401
    assert (await user_client.get("/api/v1/stats/top-tools")).status_code == 403
    assert (await admin_client.get("/api/v1/stats/top-tools")).status_code == 200


async def test_top_tools_empty_when_no_conversions(admin_client):
    body = (await admin_client.get("/api/v1/stats/top-tools")).json()
    assert body["top_tools"] == []


async def test_top_tools_ranks_within_the_window_only(admin_client):
    today = date.today()
    old_day = today - timedelta(days=40)
    _seed_conversion("jpg-to-png", today, count=5, visitors=2)
    _seed_conversion(
        "docx-to-pdf", old_day, count=100, visitors=50
    )  # outside 30d window
    body = (await admin_client.get("/api/v1/stats/top-tools?days=30")).json()
    assert body["top_tools"] == [{"tool_id": "jpg-to-png", "count": 5, "visitors": 2}]


# --- GET /stats/signups --------------------------------------------------------


async def test_signups_admin_only(client, user_client, admin_client):
    assert (await client.get("/api/v1/stats/signups")).status_code == 401
    assert (await user_client.get("/api/v1/stats/signups")).status_code == 403
    assert (await admin_client.get("/api/v1/stats/signups")).status_code == 200


async def test_signups_groups_by_day_and_excludes_outside_range(admin_client, db):
    today = datetime.now(UTC)
    old = today - timedelta(days=40)
    db.add_all(
        [
            User(id="u-today-1", email="a@x.com", created_at=today),
            User(id="u-today-2", email="b@x.com", created_at=today),
            User(id="u-old", email="c@x.com", created_at=old),
        ]
    )
    await db.commit()
    body = (await admin_client.get("/api/v1/stats/signups?days=30")).json()
    todays_row = next(r for r in body if r["date"] == today.date().isoformat())
    assert todays_row["count"] >= 2
    assert all(r["date"] != old.date().isoformat() for r in body)


# --- GET /stats/errors/summary -------------------------------------------------


async def test_errors_summary_admin_only(client, user_client, admin_client):
    assert (await client.get("/api/v1/stats/errors/summary")).status_code == 401
    assert (await user_client.get("/api/v1/stats/errors/summary")).status_code == 403
    assert (await admin_client.get("/api/v1/stats/errors/summary")).status_code == 200


async def test_errors_summary_empty_when_no_errors(admin_client):
    body = (await admin_client.get("/api/v1/stats/errors/summary")).json()
    assert body == {"by_type": [], "by_tool": [], "retention_days": 30}


async def test_errors_summary_splits_by_type_and_tool(admin_client, db):
    db.add_all(
        [
            Error(tool_id="jpg-to-png", error_type="validation_error"),
            Error(tool_id="jpg-to-png", error_type="conversion_error"),
            Error(tool_id="docx-to-pdf", error_type="conversion_error"),
        ]
    )
    await db.commit()
    body = (await admin_client.get("/api/v1/stats/errors/summary")).json()
    by_type = {r["error_type"]: r["count"] for r in body["by_type"]}
    assert by_type == {"validation_error": 1, "conversion_error": 2}
    by_tool = {r["tool_id"]: r["count"] for r in body["by_tool"]}
    assert by_tool == {"jpg-to-png": 2, "docx-to-pdf": 1}


async def test_errors_summary_filters_by_tool_id(admin_client, db):
    db.add_all(
        [
            Error(tool_id="jpg-to-png", error_type="validation_error"),
            Error(tool_id="docx-to-pdf", error_type="conversion_error"),
        ]
    )
    await db.commit()
    body = (
        await admin_client.get("/api/v1/stats/errors/summary?tool_id=jpg-to-png")
    ).json()
    assert body["by_type"] == [{"error_type": "validation_error", "count": 1}]
    assert body["by_tool"] == [{"tool_id": "jpg-to-png", "count": 1}]
