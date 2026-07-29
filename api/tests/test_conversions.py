"""Integration — dual-write (D2/D3/P5): aggregate always, history awaited &
truthful, and a history failure never fails the counter."""

from data.models import Conversion, UserConversion
from sqlalchemy import func, select


def _payload(**kw):
    base = dict(
        tool_id="jpg-to-png", input_format="JPG", output_format="PNG", status="success"
    )
    base.update(kw)
    return base


async def _agg(db, tool_id):
    return (
        await db.execute(
            select(func.coalesce(func.sum(Conversion.count), 0)).where(
                Conversion.tool_id == tool_id
            )
        )
    ).scalar_one()


async def test_anon_conversion_counts_but_no_history(client, db):
    r = await client.post("/api/v1/conversions", json=_payload())
    assert r.status_code == 200
    assert r.json()["saved_to_history"] is False
    assert await _agg(db, "jpg-to-png") == 1


async def test_session_conversion_saves_history_truthfully(admin_client, db):
    r = await admin_client.post("/api/v1/conversions", json=_payload())
    assert r.json()["saved_to_history"] is True
    hist = (await admin_client.get("/api/v1/user/history")).json()["history"]
    assert len(hist) == 1 and hist[0]["tool_id"] == "jpg-to-png"


async def test_history_pagination_has_more(admin_client, db):
    for _ in range(3):
        await admin_client.post("/api/v1/conversions", json=_payload())
    p1 = (await admin_client.get("/api/v1/user/history?limit=2&offset=0")).json()
    assert len(p1["history"]) == 2 and p1["has_more"] is True
    p2 = (await admin_client.get("/api/v1/user/history?limit=2&offset=2")).json()
    assert len(p2["history"]) == 1 and p2["has_more"] is False


async def test_aggregate_increments_on_conflict(client, db):
    for _ in range(3):
        await client.post("/api/v1/conversions", json=_payload())
    await client.post("/api/v1/conversions", json=_payload(status="error"))
    row = (
        await db.execute(select(Conversion).where(Conversion.tool_id == "jpg-to-png"))
    ).scalar_one()
    assert row.count == 3 and row.failures == 1


async def test_history_failure_never_fails_counter(admin_client, db):
    # duration_ms overflows int4 → the history insert fails; the SAVEPOINT must
    # roll back only the history row, the counter must still commit (D3/P5).
    r = await admin_client.post(
        "/api/v1/conversions",
        json=_payload(tool_id="sp-test", duration_ms=99_999_999_999),
    )
    assert r.status_code == 200
    assert r.json()["saved_to_history"] is False
    assert await _agg(db, "sp-test") == 1  # counter survived
    n = (
        await db.execute(
            select(func.count(UserConversion.id)).where(
                UserConversion.tool_id == "sp-test"
            )
        )
    ).scalar_one()
    assert n == 0  # history rolled back


async def test_favorites_cap_rejects_beyond_limit(admin_client, monkeypatch):
    from data.routers import favorites as fav

    monkeypatch.setattr(fav, "MAX_FAVORITES", 3)
    for i in range(3):
        r = await admin_client.post("/api/v1/favorites", json={"tool_id": f"t{i}"})
        assert r.status_code == 200
    over = await admin_client.post("/api/v1/favorites", json={"tool_id": "t3"})
    assert over.status_code == 409
    # Re-favoriting something already saved must stay a no-op, not hit the cap.
    again = await admin_client.post("/api/v1/favorites", json={"tool_id": "t1"})
    assert again.status_code == 200


async def test_favorites_capped_on_read_not_only_on_write(admin_client, monkeypatch):
    """A list that grew large BEFORE the write cap must not keep inflating /me."""
    from data.routers import _serialize

    for i in range(5):
        r = await admin_client.post("/api/v1/favorites", json={"tool_id": f"r{i}"})
        assert r.status_code == 200

    # The write path allowed all five; the serializer still bounds the payload.
    monkeypatch.setattr(_serialize, "MAX_FAVORITES", 3)
    me = (await admin_client.get("/api/v1/auth/me")).json()
    assert len(me["user"]["favorites"]) == 3
