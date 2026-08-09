"""Email/password auth (P4 §37) — register, login, verify-email."""

from data.models import User
from sqlalchemy import select


async def test_register_creates_account_and_signs_in(client):
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": "New.User@Example.com", "password": "correcthorse1", "name": "New User"},
    )
    assert r.status_code == 200, r.text
    body = r.json()["user"]
    # Stored/returned lowercased, same normalization as the Google path.
    assert body["email"] == "new.user@example.com"
    assert body["email_verified"] is False
    assert body["has_password"] is True

    # Session cookie was actually set — register signs the user in immediately.
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "new.user@example.com"


async def test_register_rejects_weak_password(client):
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": "weak@example.com", "password": "short1"},
    )
    assert r.status_code == 400

    r2 = await client.post(
        "/api/v1/auth/register",
        json={"email": "weak@example.com", "password": "alllettersnodigits"},
    )
    assert r2.status_code == 400


async def test_register_rejects_invalid_email(client):
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": "not-an-email", "password": "correcthorse1"},
    )
    assert r.status_code == 400


async def test_register_duplicate_email_409(client):
    body = {"email": "dupe@example.com", "password": "correcthorse1"}
    r1 = await client.post("/api/v1/auth/register", json=body)
    assert r1.status_code == 200

    r2 = await client.post("/api/v1/auth/register", json=body)
    assert r2.status_code == 409


async def test_register_existing_google_account_gets_a_distinct_message(client, db):
    # Simulate a Google-only account (no password_hash) — same shape
    # upsert_google_user produces.
    db.add(User(id="g1", email="googleuser@example.com", role="user", email_verified=True))
    await db.commit()

    r = await client.post(
        "/api/v1/auth/register",
        json={"email": "GoogleUser@example.com", "password": "correcthorse1"},
    )
    assert r.status_code == 409
    assert "Google" in r.json()["detail"]


async def test_login_success(client):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "login@example.com", "password": "correcthorse1"},
    )
    await client.post("/api/v1/auth/logout")

    r = await client.post(
        "/api/v1/auth/login", json={"email": "Login@Example.com", "password": "correcthorse1"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == "login@example.com"


async def test_login_wrong_password_401(client):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "wrongpw@example.com", "password": "correcthorse1"},
    )
    await client.post("/api/v1/auth/logout")

    r = await client.post(
        "/api/v1/auth/login", json={"email": "wrongpw@example.com", "password": "nope12345"}
    )
    assert r.status_code == 401


async def test_login_nonexistent_email_401_generic(client):
    r = await client.post(
        "/api/v1/auth/login", json={"email": "ghost@example.com", "password": "whatever1"}
    )
    assert r.status_code == 401
    # Must not leak whether the email exists — same message either way.
    assert r.json()["detail"] == "Invalid email or password."


async def test_login_against_google_only_account_401(client, db):
    db.add(User(id="g2", email="googleonly@example.com", role="user", email_verified=True))
    await db.commit()

    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "googleonly@example.com", "password": "whatever1"},
    )
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid email or password."


async def test_verify_email_flow(client, db):
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": "verifyme@example.com", "password": "correcthorse1"},
    )
    assert r.status_code == 200

    user = (
        await db.execute(select(User).where(User.email == "verifyme@example.com"))
    ).scalar_one()
    assert user.email_verified is False
    assert user.email_verify_token_hash is not None

    # The raw token only ever exists in the logged link, never the response —
    # recover it the same way an operator reading the log would: re-derive it
    # is impossible (only the hash is stored), so drive this test via a token
    # minted the same way the endpoint does, through the DB row's hash isn't
    # reversible. Instead, exercise the failure path (wrong token) plus the
    # success path via a freshly minted token using the same helper the route
    # uses, asserting hash_token(raw) matches what's stored.
    from data.routers.auth import _new_email_verify_token

    raw_token = _new_email_verify_token(user)
    await db.commit()

    ok = await client.get(f"/api/v1/auth/verify-email?token={raw_token}", follow_redirects=False)
    assert ok.status_code == 302
    assert "email_verified=1" in ok.headers["location"]

    await db.refresh(user)
    assert user.email_verified is True
    assert user.email_verify_token_hash is None


async def test_verify_email_bad_token_redirects_failed(client):
    r = await client.get("/api/v1/auth/verify-email?token=not-a-real-token", follow_redirects=False)
    assert r.status_code == 302
    assert "email_verified=failed" in r.headers["location"]


async def test_login_and_register_are_rate_limited():
    from middleware import PATH_LIMITS

    prefixes = dict(PATH_LIMITS)
    assert "/api/v1/auth/login" in prefixes
    assert "/api/v1/auth/register" in prefixes
