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


def _configure_google(monkeypatch):
    from data import config

    monkeypatch.setattr(config.settings, "google_client_id", "test-id")
    monkeypatch.setattr(config.settings, "google_client_secret", "test-secret")


def _unconfigure_google(monkeypatch):
    # Explicitly clear creds so the test is hermetic even when a real api/.env
    # (with live Google creds) is present on the host.
    from data import config

    monkeypatch.setattr(config.settings, "google_client_id", "")
    monkeypatch.setattr(config.settings, "google_client_secret", "")


async def test_google_start_503_when_unconfigured(client, monkeypatch):
    # Unset client id/secret ⇒ Google routes 503; dev-login stays the local path.
    _unconfigure_google(monkeypatch)
    r = await client.get("/api/v1/auth/google")
    assert r.status_code == 503


async def test_google_callback_503_when_unconfigured(client, monkeypatch):
    _unconfigure_google(monkeypatch)
    r = await client.get("/api/v1/auth/google/callback?code=x&state=y")
    assert r.status_code == 503


async def test_google_start_redirects_and_sets_state_cookie(client, monkeypatch):
    from urllib.parse import parse_qs, urlparse

    _configure_google(monkeypatch)
    r = await client.get("/api/v1/auth/google")
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://accounts.google.com/")
    joined = " ".join(r.headers.get_list("set-cookie")).lower()
    assert "fc_oauth_state=" in joined and "httponly" in joined

    # The cookie MUST equal the state embedded in the redirect URL — otherwise
    # the callback compare always fails ("Invalid OAuth state"). Regression guard
    # for the Authlib create_authorization_url self-generated-state gotcha.
    url_state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    assert r.cookies.get("fc_oauth_state") == url_state


async def test_google_callback_rejects_bad_state(client, monkeypatch):
    # CSRF guard: ?state without a matching fc_oauth_state cookie → 400,
    # before any token exchange (so no network).
    _configure_google(monkeypatch)
    r = await client.get("/api/v1/auth/google/callback?code=x&state=mismatch")
    assert r.status_code == 400


# --- Google callback happy path + email_verified guard (mocked OAuth client) ---


class _FakeResp:
    def __init__(self, data):
        self._data = data

    def json(self):
        return self._data


class _FakeOAuthClient:
    """Stands in for AsyncOAuth2Client so the callback runs with no network."""

    def __init__(self, userinfo):
        self._userinfo = userinfo

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def fetch_token(self, *a, **k):
        return {"access_token": "tok"}

    async def get(self, *a, **k):
        return _FakeResp(self._userinfo)


def _mock_oauth(monkeypatch, userinfo):
    from data.routers import auth

    monkeypatch.setattr(
        auth, "_oauth_client", lambda state=None: _FakeOAuthClient(userinfo)
    )


async def _callback_with(client, monkeypatch, userinfo):
    from urllib.parse import parse_qs, urlparse

    _configure_google(monkeypatch)
    # A real /auth/google runs offline (create_authorization_url builds a URL, no
    # network) and sets the state cookie in the jar with the correct domain.
    start = await client.get("/api/v1/auth/google")
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    # Only the callback's token/userinfo exchange needs mocking.
    _mock_oauth(monkeypatch, userinfo)
    return await client.get(f"/api/v1/auth/google/callback?code=abc&state={state}")


async def test_google_callback_success_creates_user_and_session(
    client, monkeypatch, db
):
    from data.models import User
    from sqlalchemy import select

    r = await _callback_with(
        client,
        monkeypatch,
        {
            "email": "newbie@example.com",
            "email_verified": True,
            "name": "Newbie",
            "picture": "http://x/y.png",
        },
    )
    assert r.status_code == 302
    joined = " ".join(r.headers.get_list("set-cookie")).lower()
    assert "fc_session=" in joined and "fc_logged_in=1" in joined

    row = (
        await db.execute(select(User).where(User.email == "newbie@example.com"))
    ).scalar_one_or_none()
    assert row is not None and row.role == "user"


async def test_google_callback_rejects_unverified_email(client, monkeypatch, db):
    from data.models import User
    from sqlalchemy import select

    r = await _callback_with(
        client,
        monkeypatch,
        {"email": "spoof@example.com", "email_verified": False, "name": "Spoof"},
    )
    assert r.status_code == 302 and "signin=failed" in r.headers["location"]
    # No account is created for an unverified identity.
    row = (
        await db.execute(select(User).where(User.email == "spoof@example.com"))
    ).scalar_one_or_none()
    assert row is None


async def test_upsert_google_user_creates_then_refreshes_without_touching_role(db):
    from data.security import upsert_google_user

    u1 = await upsert_google_user(db, "g@example.com", "G One", "http://a/1.png")
    await db.commit()
    assert u1.role == "user" and u1.name == "G One"

    # An operator promotes them out-of-band.
    u1.role = "admin"
    await db.commit()

    # A returning sign-in refreshes name/avatar but NEVER changes role (D9).
    u2 = await upsert_google_user(db, "g@example.com", "G Two", "http://a/2.png")
    await db.commit()
    assert u2.id == u1.id and u2.name == "G Two" and u2.avatar_url == "http://a/2.png"
    assert u2.role == "admin"


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
