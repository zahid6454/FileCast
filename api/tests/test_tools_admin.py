"""Integration — tools overlay: admin authz, catalog fields, update, reorder."""

from data.models import Tool
from sqlalchemy import select


async def test_tools_authz(client, user_client, admin_client, seeded_tools):
    assert (await client.get("/api/v1/tools")).status_code == 401
    assert (await user_client.get("/api/v1/tools")).status_code == 403
    assert (await admin_client.get("/api/v1/tools")).status_code == 200


async def test_tools_returns_display_metadata(admin_client, seeded_tools):
    tools = (await admin_client.get("/api/v1/tools")).json()["tools"]
    first = tools[0]
    for field in (
        "category",
        "name",
        "input_format",
        "output_format",
        "sort_order",
        "homepage_order",
    ):
        assert field in first
    assert first["id"] == "jpg-to-png"  # sort_order 1


async def test_update_tool_overlay(admin_client, seeded_tools, db):
    r = await admin_client.put(
        "/api/v1/tools/jpg-to-png", json={"enabled": False, "display_name": "Custom"}
    )
    assert r.status_code == 200
    row = (await db.execute(select(Tool).where(Tool.id == "jpg-to-png"))).scalar_one()
    assert row.enabled is False and row.display_name == "Custom"


async def test_update_unknown_tool_404(admin_client, seeded_tools):
    assert (
        await admin_client.put("/api/v1/tools/nope", json={"enabled": False})
    ).status_code == 404


async def test_reorder_assigns_index(admin_client, seeded_tools, db):
    r = await admin_client.put(
        "/api/v1/tools/reorder", json={"order": ["docx-to-pdf", "jpg-to-png"]}
    )
    assert r.status_code == 200
    rows = {t.id: t.sort_order for t in (await db.execute(select(Tool))).scalars()}
    assert rows["docx-to-pdf"] == 1 and rows["jpg-to-png"] == 2
