"""Integration — GDPR export + account deletion (retain anonymous ratings)."""

from data.models import Rating, User, UserConversion
from sqlalchemy import func, select


async def test_export_shape(admin_client):
    await admin_client.post(
        "/api/v1/conversions",
        json={
            "tool_id": "jpg-to-png",
            "input_format": "JPG",
            "output_format": "PNG",
            "status": "success",
        },
    )
    data = (await admin_client.get("/api/v1/users/me/export")).json()
    assert set(data) >= {"user", "preferences", "favorites", "history"}
    assert len(data["history"]) == 1


async def test_delete_account_wipes_user_but_keeps_anon_ratings(admin_client, db):
    # arrange: a history row + a rating attributed to the user
    await admin_client.post(
        "/api/v1/conversions",
        json={
            "tool_id": "jpg-to-png",
            "input_format": "JPG",
            "output_format": "PNG",
            "status": "success",
        },
    )
    await admin_client.post(
        "/api/v1/ratings", json={"tool_id": "jpg-to-png", "vote": "yes"}
    )

    r = await admin_client.delete("/api/v1/users/me")
    assert r.status_code == 200
    # cookies cleared → session invalid
    assert (await admin_client.get("/api/v1/auth/me")).status_code == 401

    users = (await db.execute(select(func.count(User.id)))).scalar_one()
    hist = (await db.execute(select(func.count(UserConversion.id)))).scalar_one()
    ratings = (await db.execute(select(func.count(Rating.id)))).scalar_one()
    ratings_with_user = (
        await db.execute(
            select(func.count(Rating.id)).where(Rating.user_id.isnot(None))
        )
    ).scalar_one()
    assert users == 0 and hist == 0  # user data gone
    assert ratings == 1  # anonymous rating retained
    assert ratings_with_user == 0  # but detached from the user
