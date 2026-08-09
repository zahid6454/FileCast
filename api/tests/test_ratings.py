"""Integration — rating dedup + pinned Phase 6 response shapes."""

from data.db import sync_session
from data.models import Rating, RatingFeedback


def _seed_votes(tool_id: str, yes: int, no: int) -> None:
    """Insert distinct-fingerprint votes, bypassing the per-client dedup.

    The API gives one vote per (tool, fingerprint, day), so multi-vote aggregate
    behaviour can only be exercised by writing rows directly.
    """
    with sync_session() as s:
        for i in range(yes):
            s.add(Rating(tool_id=tool_id, vote="yes", fingerprint=f"{tool_id}-y{i}"))
        for i in range(no):
            s.add(Rating(tool_id=tool_id, vote="no", fingerprint=f"{tool_id}-n{i}"))
        s.commit()


async def test_vote_and_read_shape(client):
    await client.post("/api/v1/ratings", json={"tool_id": "jpg-to-png", "vote": "yes"})
    r = await client.get("/api/v1/ratings/jpg-to-png")
    assert r.json() == {"tool_id": "jpg-to-png", "yes": 1, "no": 0}


async def test_dedup_same_fingerprint(client):
    # same client/IP/day/tool → second vote updates, does not add (total stays 1)
    await client.post("/api/v1/ratings", json={"tool_id": "jpg-to-png", "vote": "yes"})
    await client.post("/api/v1/ratings", json={"tool_id": "jpg-to-png", "vote": "yes"})
    body = (await client.get("/api/v1/ratings/jpg-to-png")).json()
    assert body["yes"] + body["no"] == 1


async def test_change_vote_updates_bucket(client):
    await client.post("/api/v1/ratings", json={"tool_id": "jpg-to-png", "vote": "yes"})
    await client.post("/api/v1/ratings", json={"tool_id": "jpg-to-png", "vote": "no"})
    assert (await client.get("/api/v1/ratings/jpg-to-png")).json() == {
        "tool_id": "jpg-to-png",
        "yes": 0,
        "no": 1,
    }


async def test_invalid_vote_rejected(client):
    r = await client.post("/api/v1/ratings", json={"tool_id": "x", "vote": "maybe"})
    assert r.status_code == 400


async def test_bulk_ratings_admin_only_and_shape(client, admin_client):
    assert (await client.get("/api/v1/ratings")).status_code == 401
    await client.post("/api/v1/ratings", json={"tool_id": "jpg-to-png", "vote": "yes"})
    bulk = (await admin_client.get("/api/v1/ratings")).json()
    assert bulk == [{"tool_id": "jpg-to-png", "yes": 1, "no": 0}]


async def test_vote_is_a_string_column_not_a_boolean(client):
    """R9 — the hard cross-phase contract, guarded at the storage layer.

    Both the API bucketing and ``build.fetch_rating_aggregates()`` group by
    ``vote`` and filter ``vote in ("yes", "no")``. A boolean column would make
    that filter drop every row and bake all-zero scores with no error, so assert
    the literal strings actually land in the DB.
    """
    await client.post("/api/v1/ratings", json={"tool_id": "jpg-to-png", "vote": "yes"})
    with sync_session() as s:
        stored = s.query(Rating).filter_by(tool_id="jpg-to-png").all()
    assert [r.vote for r in stored] == ["yes"]
    assert all(isinstance(r.vote, str) for r in stored)


async def test_aggregates_bucket_many_distinct_voters(client):
    # Multi-voter counts survive the GROUP BY intact (the R9 failure mode would
    # silently return zeroes here).
    _seed_votes("png-to-jpg", yes=44, no=8)
    assert (await client.get("/api/v1/ratings/png-to-jpg")).json() == {
        "tool_id": "png-to-jpg",
        "yes": 44,
        "no": 8,
    }


async def test_bulk_aggregates_span_multiple_tools(admin_client):
    _seed_votes("png-to-jpg", yes=3, no=1)
    _seed_votes("jpg-to-png", yes=2, no=0)
    bulk = {r["tool_id"]: r for r in (await admin_client.get("/api/v1/ratings")).json()}
    assert bulk["png-to-jpg"] == {"tool_id": "png-to-jpg", "yes": 3, "no": 1}
    assert bulk["jpg-to-png"] == {"tool_id": "jpg-to-png", "yes": 2, "no": 0}


async def test_unrated_tool_reports_zeroes(client):
    assert (await client.get("/api/v1/ratings/never-rated")).json() == {
        "tool_id": "never-rated",
        "yes": 0,
        "no": 0,
    }


# --------------------------------------------------------------------------- #
# POST /api/v1/ratings/feedback — free-text "No" follow-up (P2 §18)
# --------------------------------------------------------------------------- #


async def test_feedback_stores_text_tool_and_user_agent(client):
    r = await client.post(
        "/api/v1/ratings/feedback",
        json={"tool_id": "jpg-to-png", "feedback_text": "the output was blank"},
        headers={"User-Agent": "TestAgent/1.0"},
    )
    assert r.status_code == 200
    with sync_session() as s:
        rows = s.query(RatingFeedback).filter_by(tool_id="jpg-to-png").all()
    assert len(rows) == 1
    assert rows[0].feedback_text == "the output was blank"
    assert rows[0].user_agent == "TestAgent/1.0"


async def test_feedback_is_anonymous_no_fingerprint_or_user_field():
    # The model itself carries no fingerprint/user_id column — the anonymity
    # guarantee is structural, not just "the router doesn't ask for one".
    assert not hasattr(RatingFeedback, "fingerprint")
    assert not hasattr(RatingFeedback, "user_id")


async def test_feedback_does_not_dedup_multiple_submissions_same_tool(client):
    # Unlike a vote, feedback has no UNIQUE constraint to collapse into — two
    # different complaints about the same tool are two different rows.
    await client.post(
        "/api/v1/ratings/feedback",
        json={"tool_id": "jpg-to-png", "feedback_text": "first complaint"},
    )
    await client.post(
        "/api/v1/ratings/feedback",
        json={"tool_id": "jpg-to-png", "feedback_text": "second, different complaint"},
    )
    with sync_session() as s:
        rows = s.query(RatingFeedback).filter_by(tool_id="jpg-to-png").all()
    assert sorted(r.feedback_text for r in rows) == [
        "first complaint",
        "second, different complaint",
    ]


async def test_feedback_rejects_empty_or_whitespace_only_text(client):
    for text in ("", "   ", "\n\t"):
        r = await client.post(
            "/api/v1/ratings/feedback",
            json={"tool_id": "jpg-to-png", "feedback_text": text},
        )
        assert r.status_code == 400, text


async def test_feedback_text_truncated_at_server_ceiling(client):
    long_text = "x" * 5000
    await client.post(
        "/api/v1/ratings/feedback",
        json={"tool_id": "jpg-to-png", "feedback_text": long_text},
    )
    with sync_session() as s:
        row = s.query(RatingFeedback).filter_by(tool_id="jpg-to-png").one()
    assert len(row.feedback_text) == 2000


async def test_feedback_missing_user_agent_header_stores_null(client):
    r = await client.post(
        "/api/v1/ratings/feedback",
        json={"tool_id": "jpg-to-png", "feedback_text": "no UA sent"},
        headers={"User-Agent": ""},
    )
    assert r.status_code == 200
    with sync_session() as s:
        row = s.query(RatingFeedback).filter_by(tool_id="jpg-to-png").one()
    assert row.user_agent is None
