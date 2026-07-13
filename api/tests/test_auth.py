"""Integration — sessions, dev-login gating, /me, logout, admin authz."""


async def test_dev_login_sets_two_cookies_and_returns_user(client):
    r = await client.post("/api/v1/auth/dev-login", json={"role": "admin"})
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "admin"
    # both fc_session (httpOnly) and fc_logged_in companion are set
    cookies = r.headers.get_list("set-cookie")
    joined = " ".join(cookies).lower()
    assert "fc_session=" in joined and "httponly" in joined
    assert "fc_logged_in=" in joined


async def test_me_requires_session(client):
    assert (await client.get("/api/v1/auth/me")).status_code == 401


async def test_me_returns_user_with_favorites(admin_client):
    r = await admin_client.get("/api/v1/auth/me")
    assert r.status_code == 200
    body = r.json()["user"]
    assert body["email"] == "admin@dev.local"
    assert body["favorites"] == []


async def test_logout_clears_cookies(admin_client):
    r = await admin_client.post("/api/v1/auth/logout")
    assert r.status_code == 200
    # session no longer valid
    assert (await admin_client.get("/api/v1/auth/me")).status_code == 401


async def test_dev_login_rejects_bad_role(client):
    r = await client.post("/api/v1/auth/dev-login", json={"role": "root"})
    assert r.status_code == 400


async def test_dev_login_404_outside_development(client, monkeypatch):
    # gate: dev-login must 404 when not development
    from data import config

    monkeypatch.setattr(config.settings, "environment", "production")
    r = await client.post("/api/v1/auth/dev-login", json={"role": "admin"})
    assert r.status_code == 404


async def test_admin_role_read_live_demotion_immediate(admin_client, db):
    # admin can hit an admin route
    assert (await admin_client.get("/api/v1/tools")).status_code == 200
    # demote the user in the DB → next request is 403 (D6: role read live)
    from data.models import User
    from sqlalchemy import update

    await db.execute(
        update(User).where(User.email == "admin@dev.local").values(role="user")
    )
    await db.commit()
    assert (await admin_client.get("/api/v1/tools")).status_code == 403
