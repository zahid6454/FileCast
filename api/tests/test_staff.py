"""Staff access & RBAC (Phase 5.5) — unit (apply_staff_role) + integration."""

from urllib.parse import parse_qs, urlparse

from data.models import StaffGrant, User
from data.security import apply_staff_role
from sqlalchemy import func, select

# --- Unit: apply_staff_role ------------------------------------------------


async def _mk_user(db, email, role="user"):
    u = User(email=email, role=role)
    db.add(u)
    await db.flush()
    return u


async def test_apply_config_owner_forces_admin(db, monkeypatch):
    from data import config

    monkeypatch.setattr(config.settings, "initial_admin_emails", "owner@example.com")
    u = await _mk_user(db, "owner@example.com")
    await apply_staff_role(db, u)
    assert u.role == "admin"


async def test_apply_config_owner_case_insensitive(db, monkeypatch):
    from data import config

    monkeypatch.setattr(config.settings, "initial_admin_emails", "Owner@Example.com")
    u = await _mk_user(db, "OWNER@example.COM")
    await apply_staff_role(db, u)
    assert u.role == "admin"


async def test_apply_pending_grant_consumed_and_stamped(db):
    db.add(StaffGrant(email="invitee@example.com", role="admin"))
    u = await _mk_user(db, "invitee@example.com")
    await db.flush()
    await apply_staff_role(db, u)
    assert u.role == "admin"
    grant = (
        await db.execute(
            select(StaffGrant).where(StaffGrant.email == "invitee@example.com")
        )
    ).scalar_one()
    assert grant.consumed_at is not None


async def test_apply_pending_grant_case_insensitive(db):
    db.add(StaffGrant(email="mixed@example.com", role="admin"))
    u = await _mk_user(db, "Mixed@Example.com")
    await db.flush()
    await apply_staff_role(db, u)
    assert u.role == "admin"


async def test_apply_no_match_stays_user(db):
    u = await _mk_user(db, "nobody@example.com")
    await apply_staff_role(db, u)
    assert u.role == "user"


async def test_apply_second_login_does_not_reconsume(db):
    db.add(StaffGrant(email="once@example.com", role="admin"))
    u = await _mk_user(db, "once@example.com")
    await db.flush()
    await apply_staff_role(db, u)
    grant = (
        await db.execute(
            select(StaffGrant).where(StaffGrant.email == "once@example.com")
        )
    ).scalar_one()
    first_stamp = grant.consumed_at
    assert first_stamp is not None
    # Demote out-of-band, then a second login must NOT re-consume/re-promote.
    u.role = "user"
    await apply_staff_role(db, u)
    assert u.role == "user"  # consumed grant no longer applies


async def test_apply_never_demotes(db, monkeypatch):
    from data import config

    monkeypatch.setattr(config.settings, "initial_admin_emails", "")
    u = await _mk_user(db, "keepadmin@example.com", role="admin")
    await apply_staff_role(db, u)
    assert u.role == "admin"


# --- Integration: /api/v1/admin/staff --------------------------------------


async def test_list_staff_shape(admin_client, monkeypatch):
    from data import config

    monkeypatch.setattr(config.settings, "initial_admin_emails", "owner@example.com")
    r = await admin_client.get("/api/v1/admin/staff")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"admins", "pending", "owners"}
    assert body["owners"] == ["owner@example.com"]
    assert any(a["email"] == "admin@dev.local" for a in body["admins"])


async def test_grant_promotes_existing_user(admin_client, user_client):
    # user_client created user@dev.local (role user).
    r = await admin_client.post("/api/v1/admin/staff", json={"email": "user@dev.local"})
    assert r.status_code == 200 and r.json()["status"] == "promoted"
    # user@dev.local is now an admin and can hit an admin route.
    assert (await user_client.get("/api/v1/users")).status_code == 200


async def test_grant_new_email_is_pending_and_idempotent(admin_client):
    for _ in range(2):
        r = await admin_client.post(
            "/api/v1/admin/staff", json={"email": "New@Invite.com"}
        )
        assert r.status_code == 200 and r.json()["status"] == "pending"
    body = (await admin_client.get("/api/v1/admin/staff")).json()
    pend = [p for p in body["pending"] if p["email"] == "new@invite.com"]
    assert len(pend) == 1  # normalized + not duplicated
    assert pend[0]["granted_by_email"] == "admin@dev.local"


async def test_grant_mixedcase_promotes_not_pending(admin_client, db):
    # A legacy mixed-case user row; grant with lowercase must find & promote it.
    db.add(User(email="Casey@Example.com", role="user"))
    await db.commit()
    r = await admin_client.post(
        "/api/v1/admin/staff", json={"email": "casey@example.com"}
    )
    assert r.status_code == 200 and r.json()["status"] == "promoted"
    body = (await admin_client.get("/api/v1/admin/staff")).json()
    assert not any(p["email"] == "casey@example.com" for p in body["pending"])
    row = (
        await db.execute(
            select(User).where(func.lower(User.email) == "casey@example.com")
        )
    ).scalar_one()
    assert row.role == "admin"


async def test_grant_owner_email_is_noop(admin_client, monkeypatch):
    from data import config

    monkeypatch.setattr(config.settings, "initial_admin_emails", "owner@example.com")
    r = await admin_client.post(
        "/api/v1/admin/staff", json={"email": "Owner@Example.com"}
    )
    assert r.status_code == 200 and r.json()["status"] == "owner"
    body = (await admin_client.get("/api/v1/admin/staff")).json()
    assert not any(p["email"] == "owner@example.com" for p in body["pending"])


async def test_grant_malformed_email_400(admin_client):
    r = await admin_client.post("/api/v1/admin/staff", json={"email": "not-an-email"})
    assert r.status_code == 400


async def test_revoke_demotes_existing_admin(admin_client, user_client, db):
    await admin_client.post("/api/v1/admin/staff", json={"email": "user@dev.local"})
    assert (await user_client.get("/api/v1/users")).status_code == 200  # is admin now
    r = await admin_client.delete("/api/v1/admin/staff/user@dev.local")
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    # D6: next request loses admin.
    assert (await user_client.get("/api/v1/users")).status_code == 403


async def test_revoke_self_409(admin_client):
    r = await admin_client.delete("/api/v1/admin/staff/admin@dev.local")
    assert r.status_code == 409


async def test_revoke_owner_403(admin_client, monkeypatch):
    from data import config

    monkeypatch.setattr(config.settings, "initial_admin_emails", "owner@example.com")
    r = await admin_client.delete("/api/v1/admin/staff/owner@example.com")
    assert r.status_code == 403


async def test_revoke_deletes_pending_grant(admin_client, db):
    await admin_client.post("/api/v1/admin/staff", json={"email": "pend@example.com"})
    r = await admin_client.delete("/api/v1/admin/staff/pend@example.com")
    assert r.status_code == 200
    count = (
        await db.execute(
            select(func.count())
            .select_from(StaffGrant)
            .where(StaffGrant.email == "pend@example.com")
        )
    ).scalar_one()
    assert count == 0


async def test_user_client_forbidden_on_all_staff_endpoints(user_client):
    assert (await user_client.get("/api/v1/admin/staff")).status_code == 403
    assert (
        await user_client.post("/api/v1/admin/staff", json={"email": "x@y.com"})
    ).status_code == 403
    assert (await user_client.delete("/api/v1/admin/staff/x@y.com")).status_code == 403


async def test_gdpr_delete_clears_grants(admin_client, db):
    # A grant keyed to the admin's own email should be wiped on account deletion.
    db.add(StaffGrant(email="admin@dev.local", role="admin"))
    await db.commit()
    r = await admin_client.delete("/api/v1/users/me")
    assert r.status_code == 200
    count = (
        await db.execute(select(func.count()).select_from(StaffGrant))
    ).scalar_one()
    assert count == 0


# --- OAuth callback wiring (owner + pending grant consumed on login) --------


class _FakeResp:
    def __init__(self, data):
        self._data = data

    def json(self):
        return self._data


class _FakeOAuthClient:
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


async def _callback_with(client, monkeypatch, userinfo):
    from data import config
    from data.routers import auth

    monkeypatch.setattr(config.settings, "google_client_id", "test-id")
    monkeypatch.setattr(config.settings, "google_client_secret", "test-secret")
    start = await client.get("/api/v1/auth/google")
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    monkeypatch.setattr(
        auth, "_oauth_client", lambda state=None: _FakeOAuthClient(userinfo)
    )
    return await client.get(f"/api/v1/auth/google/callback?code=abc&state={state}")


async def test_callback_owner_becomes_admin(client, monkeypatch, db):
    from data import config

    monkeypatch.setattr(config.settings, "initial_admin_emails", "owner@example.com")
    r = await _callback_with(
        client,
        monkeypatch,
        {"email": "owner@example.com", "email_verified": True, "name": "Owner"},
    )
    assert r.status_code == 302
    row = (
        await db.execute(select(User).where(User.email == "owner@example.com"))
    ).scalar_one()
    assert row.role == "admin"


async def test_callback_consumes_pending_grant(client, monkeypatch, db):
    db.add(StaffGrant(email="invited@example.com", role="admin"))
    await db.commit()
    r = await _callback_with(
        client,
        monkeypatch,
        {"email": "Invited@Example.com", "email_verified": True, "name": "Inv"},
    )
    assert r.status_code == 302
    row = (
        await db.execute(
            select(User).where(func.lower(User.email) == "invited@example.com")
        )
    ).scalar_one()
    assert row.role == "admin"
    grant = (
        await db.execute(
            select(StaffGrant).where(StaffGrant.email == "invited@example.com")
        )
    ).scalar_one()
    assert grant.consumed_at is not None
