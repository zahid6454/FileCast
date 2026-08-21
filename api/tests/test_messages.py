"""Integration — contact-page messages (public submit + admin inbox)."""

from datetime import UTC, datetime

from data.db import sync_session
from data.models import Message

# --------------------------------------------------------------------------- #
# POST /api/v1/messages — public submission
# --------------------------------------------------------------------------- #


async def test_anonymous_submit_stores_row_with_no_user_id(client):
    r = await client.post(
        "/api/v1/messages",
        json={"title": "Bug report", "body": "The PDF merge tool errored."},
        headers={"User-Agent": "TestAgent/1.0"},
    )
    assert r.status_code == 200
    with sync_session() as s:
        rows = s.query(Message).all()
    assert len(rows) == 1
    assert rows[0].title == "Bug report"
    assert rows[0].body == "The PDF merge tool errored."
    assert rows[0].user_id is None
    assert rows[0].email is None
    assert rows[0].status == "new"
    assert rows[0].user_agent == "TestAgent/1.0"


async def test_signed_in_submit_attaches_user_id(user_client):
    me = (await user_client.get("/api/v1/auth/me")).json()["user"]
    r = await user_client.post(
        "/api/v1/messages", json={"title": "Question", "body": "How do I..."}
    )
    assert r.status_code == 200
    with sync_session() as s:
        row = s.query(Message).one()
    assert row.user_id == me["id"]


async def test_honeypot_silently_drops_submission(client):
    r = await client.post(
        "/api/v1/messages",
        json={
            "title": "spam",
            "body": "spam body",
            "website": "http://spammer.example",
        },
    )
    assert r.status_code == 200  # never reveal the trap to the caller
    with sync_session() as s:
        rows = s.query(Message).all()
    assert rows == []


async def test_rejects_empty_or_whitespace_only_title_or_body(client):
    for title, body in [("", "x"), ("x", ""), ("   ", "x"), ("x", "\n\t")]:
        r = await client.post("/api/v1/messages", json={"title": title, "body": body})
        assert r.status_code == 400, (title, body)


async def test_title_and_body_truncated_at_server_ceiling(client):
    r = await client.post(
        "/api/v1/messages", json={"title": "t" * 500, "body": "b" * 6000}
    )
    assert r.status_code == 200
    with sync_session() as s:
        row = s.query(Message).one()
    assert len(row.title) == 200
    assert len(row.body) == 5000


async def test_valid_email_is_stored(client):
    r = await client.post(
        "/api/v1/messages",
        json={"title": "t", "body": "b", "email": "person@example.com"},
    )
    assert r.status_code == 200
    with sync_session() as s:
        row = s.query(Message).one()
    assert row.email == "person@example.com"


async def test_malformed_email_rejected(client):
    r = await client.post(
        "/api/v1/messages", json={"title": "t", "body": "b", "email": "not-an-email"}
    )
    assert r.status_code == 400


async def test_blank_email_stored_as_null(client):
    r = await client.post(
        "/api/v1/messages", json={"title": "t", "body": "b", "email": "  "}
    )
    assert r.status_code == 200
    with sync_session() as s:
        row = s.query(Message).one()
    assert row.email is None


async def test_oversized_email_rejected_not_silently_truncated(client):
    # An email long enough to still match the shape regex but past the
    # RFC 5321 ceiling must be rejected outright — truncating it would just
    # store a corrupted, unusable address instead.
    huge_email = ("a" * 320) + "@example.com"
    r = await client.post(
        "/api/v1/messages", json={"title": "t", "body": "b", "email": huge_email}
    )
    assert r.status_code == 400


# --------------------------------------------------------------------------- #
# GET/PUT /api/v1/admin/messages — admin inbox
# --------------------------------------------------------------------------- #


async def test_list_requires_admin(client, user_client):
    assert (await client.get("/api/v1/admin/messages")).status_code == 401
    assert (await user_client.get("/api/v1/admin/messages")).status_code == 403


async def test_admin_lists_newest_first(client, admin_client):
    await client.post("/api/v1/messages", json={"title": "first", "body": "b"})
    await client.post("/api/v1/messages", json={"title": "second", "body": "b"})
    data = (await admin_client.get("/api/v1/admin/messages")).json()
    titles = [m["title"] for m in data["messages"]]
    assert titles == ["second", "first"]


async def test_admin_list_breaks_created_at_ties_by_id(admin_client):
    # Two rows landing on the identical timestamp (a real possibility —
    # created_at's precision is finite) must still sort deterministically
    # newest-id-first, not depend on the DB's arbitrary tie order.
    same_instant = datetime.now(UTC)
    with sync_session() as s:
        s.add_all(
            [
                Message(title="a", body="b", created_at=same_instant),
                Message(title="b", body="b", created_at=same_instant),
            ]
        )
        s.commit()
    data = (await admin_client.get("/api/v1/admin/messages")).json()
    titles = [m["title"] for m in data["messages"]]
    assert titles == ["b", "a"]  # higher id (inserted second) sorts first


async def test_admin_list_respects_limit_bounds(client, admin_client):
    for i in range(3):
        await client.post("/api/v1/messages", json={"title": str(i), "body": "b"})
    data = (await admin_client.get("/api/v1/admin/messages?limit=2")).json()
    assert len(data["messages"]) == 2
    # Out-of-range values are clamped, not rejected.
    data = (await admin_client.get("/api/v1/admin/messages?limit=0")).json()
    assert len(data["messages"]) == 1
    data = (await admin_client.get("/api/v1/admin/messages?limit=99999")).json()
    assert len(data["messages"]) == 3


async def test_admin_filters_by_status(client, admin_client):
    await client.post("/api/v1/messages", json={"title": "t", "body": "b"})
    data = (await admin_client.get("/api/v1/admin/messages?status=archived")).json()
    assert data["messages"] == []
    data = (await admin_client.get("/api/v1/admin/messages?status=new")).json()
    assert len(data["messages"]) == 1


async def test_admin_invalid_status_filter_rejected(admin_client):
    r = await admin_client.get("/api/v1/admin/messages?status=bogus")
    assert r.status_code == 400


async def test_admin_updates_status(client, admin_client):
    await client.post("/api/v1/messages", json={"title": "t", "body": "b"})
    msg_id = (await admin_client.get("/api/v1/admin/messages")).json()["messages"][0][
        "id"
    ]
    r = await admin_client.put(
        f"/api/v1/admin/messages/{msg_id}", json={"status": "read"}
    )
    assert r.status_code == 200
    assert r.json()["status"] == "read"
    with sync_session() as s:
        row = s.query(Message).filter_by(id=msg_id).one()
    assert row.status == "read"


async def test_admin_update_invalid_status_rejected(client, admin_client):
    await client.post("/api/v1/messages", json={"title": "t", "body": "b"})
    msg_id = (await admin_client.get("/api/v1/admin/messages")).json()["messages"][0][
        "id"
    ]
    r = await admin_client.put(
        f"/api/v1/admin/messages/{msg_id}", json={"status": "bogus"}
    )
    assert r.status_code == 400


async def test_admin_update_missing_message_404s(admin_client):
    r = await admin_client.put("/api/v1/admin/messages/999999", json={"status": "read"})
    assert r.status_code == 404


async def test_update_requires_admin(client, user_client):
    r = await client.put("/api/v1/admin/messages/1", json={"status": "read"})
    assert r.status_code == 401
    r = await user_client.put("/api/v1/admin/messages/1", json={"status": "read"})
    assert r.status_code == 403
