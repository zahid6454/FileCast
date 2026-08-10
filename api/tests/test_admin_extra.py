"""Integration — coverage for endpoints not exercised elsewhere:
users admin list/detail, announcements update/delete, and preferences auth gate."""


# --- users (admin) ---


async def test_users_list_and_detail(admin_client):
    me = (await admin_client.get("/api/v1/auth/me")).json()["user"]

    listing = (await admin_client.get("/api/v1/users")).json()["users"]
    assert any(u["email"] == "admin@dev.local" for u in listing)

    detail = (await admin_client.get(f"/api/v1/users/{me['id']}")).json()
    assert detail["user"]["id"] == me["id"]
    assert "history" in detail


async def test_user_history_paginated(admin_client):
    me = (await admin_client.get("/api/v1/auth/me")).json()["user"]
    for _ in range(3):
        await admin_client.post(
            "/api/v1/conversions",
            json={
                "tool_id": "jpg-to-png",
                "input_format": "JPG",
                "output_format": "PNG",
                "status": "success",
            },
        )
    p1 = (
        await admin_client.get(f"/api/v1/users/{me['id']}/history?limit=2&offset=0")
    ).json()
    assert len(p1["history"]) == 2 and p1["has_more"] is True
    p2 = (
        await admin_client.get(f"/api/v1/users/{me['id']}/history?limit=2&offset=2")
    ).json()
    assert len(p2["history"]) == 1 and p2["has_more"] is False


async def test_users_admin_only(user_client):
    assert (await user_client.get("/api/v1/users")).status_code == 403
    assert (await user_client.get("/api/v1/users/whatever/history")).status_code == 403


async def test_user_detail_unknown_404(admin_client):
    assert (await admin_client.get("/api/v1/users/nope")).status_code == 404


# --- announcements update / delete ---


async def test_announcement_update_and_delete(admin_client, client):
    created = (
        await admin_client.post(
            "/api/v1/announcements", json={"message": "Original", "active": False}
        )
    ).json()["announcement"]
    aid = created["id"]

    upd = (
        await admin_client.put(
            f"/api/v1/announcements/{aid}",
            json={"message": "Edited", "active": True},
        )
    ).json()["announcement"]
    assert upd["message"] == "Edited" and upd["active"] is True

    # now it's the active one
    assert (await client.get("/api/v1/announcements/active")).json()["announcement"][
        "message"
    ] == "Edited"

    assert (
        await admin_client.delete(f"/api/v1/announcements/{aid}")
    ).status_code == 200
    assert (await admin_client.get("/api/v1/announcements")).json()[
        "announcements"
    ] == []


async def test_announcement_update_unknown_404(admin_client):
    assert (
        await admin_client.put("/api/v1/announcements/999", json={"message": "x"})
    ).status_code == 404


# --- announcements validation (O4 audit item #6) ---


async def test_announcement_create_rejects_empty_message(admin_client):
    r = await admin_client.post("/api/v1/announcements", json={"message": "   "})
    assert r.status_code == 422


async def test_announcement_create_rejects_overlong_message(admin_client):
    r = await admin_client.post("/api/v1/announcements", json={"message": "x" * 501})
    assert r.status_code == 422


async def test_announcement_create_rejects_unknown_type(admin_client):
    r = await admin_client.post(
        "/api/v1/announcements", json={"message": "Hi", "type": "danger"}
    )
    assert r.status_code == 422


async def test_announcement_create_rejects_overlong_link(admin_client):
    r = await admin_client.post(
        "/api/v1/announcements",
        json={"message": "Hi", "link": "https://example.com/" + "x" * 2048},
    )
    assert r.status_code == 422


async def test_announcement_update_rejects_invalid_fields(admin_client):
    created = (
        await admin_client.post("/api/v1/announcements", json={"message": "Original"})
    ).json()["announcement"]
    aid = created["id"]

    assert (
        await admin_client.put(f"/api/v1/announcements/{aid}", json={"message": ""})
    ).status_code == 422
    assert (
        await admin_client.put(f"/api/v1/announcements/{aid}", json={"type": "danger"})
    ).status_code == 422


# admin-deploy is covered in test_admin_deploy.py (Phase 7 real round-trip).


# --- preferences auth gate ---


async def test_preferences_requires_auth(client):
    assert (
        await client.put("/api/v1/preferences", json={"theme": "dark"})
    ).status_code == 401


async def test_history_requires_auth(client):
    assert (await client.get("/api/v1/user/history")).status_code == 401
