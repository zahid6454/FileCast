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
        "featured_slot",
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


async def test_featured_slot_steals_from_same_category_holder(
    admin_client, seeded_tools, db
):
    # png-to-jpg shares jpg-to-png's category (image-conversion) — a slot has
    # exactly one owner within a category, so claiming it must clear the other.
    db.add(
        Tool(
            id="png-to-jpg",
            enabled=True,
            sort_order=3,
            category="image-conversion",
            name="PNG to JPG",
            input_format="PNG",
            output_format="JPG",
        )
    )
    await db.commit()

    assert (
        await admin_client.put("/api/v1/tools/jpg-to-png", json={"featured_slot": 1})
    ).status_code == 200
    assert (
        await admin_client.put("/api/v1/tools/png-to-jpg", json={"featured_slot": 1})
    ).status_code == 200

    rows = {t.id: t.featured_slot for t in (await db.execute(select(Tool))).scalars()}
    assert rows["jpg-to-png"] is None
    assert rows["png-to-jpg"] == 1


async def test_featured_slot_self_heals_if_invariant_already_broken(
    admin_client, seeded_tools, db
):
    # Two tools already sharing a slot (hand-edited DB, a bad migration) must
    # not 500 the next routine edit — clear every other holder, not just one.
    db.add_all(
        [
            Tool(
                id="png-to-jpg",
                enabled=True,
                sort_order=3,
                category="image-conversion",
                name="PNG to JPG",
                input_format="PNG",
                output_format="JPG",
                featured_slot=1,
            ),
            Tool(
                id="heic-to-jpg",
                enabled=True,
                sort_order=4,
                category="image-conversion",
                name="HEIC to JPG",
                input_format="HEIC",
                output_format="JPG",
                featured_slot=1,
            ),
        ]
    )
    await db.commit()

    r = await admin_client.put("/api/v1/tools/jpg-to-png", json={"featured_slot": 1})
    assert r.status_code == 200

    rows = {t.id: t.featured_slot for t in (await db.execute(select(Tool))).scalars()}
    assert rows["jpg-to-png"] == 1
    assert rows["png-to-jpg"] is None
    assert rows["heic-to-jpg"] is None


async def test_featured_slot_independent_across_categories(
    admin_client, seeded_tools, db
):
    # jpg-to-png (image-conversion) and docx-to-pdf (document-conversion) are
    # different categories — slot 1 in one must not touch slot 1 in the other.
    assert (
        await admin_client.put("/api/v1/tools/jpg-to-png", json={"featured_slot": 1})
    ).status_code == 200
    assert (
        await admin_client.put("/api/v1/tools/docx-to-pdf", json={"featured_slot": 1})
    ).status_code == 200

    rows = {t.id: t.featured_slot for t in (await db.execute(select(Tool))).scalars()}
    assert rows["jpg-to-png"] == 1
    assert rows["docx-to-pdf"] == 1


async def test_disabling_tool_clears_featured_slot(admin_client, seeded_tools, db):
    await admin_client.put("/api/v1/tools/jpg-to-png", json={"featured_slot": 2})
    r = await admin_client.put("/api/v1/tools/jpg-to-png", json={"enabled": False})
    assert r.status_code == 200
    row = (await db.execute(select(Tool).where(Tool.id == "jpg-to-png"))).scalar_one()
    assert row.enabled is False and row.featured_slot is None


async def test_disable_wins_over_a_simultaneous_slot_assignment(
    admin_client, seeded_tools, db
):
    r = await admin_client.put(
        "/api/v1/tools/jpg-to-png", json={"enabled": False, "featured_slot": 3}
    )
    assert r.status_code == 200
    row = (await db.execute(select(Tool).where(Tool.id == "jpg-to-png"))).scalar_one()
    assert row.enabled is False and row.featured_slot is None


async def test_clearing_a_featured_slot_does_not_steal(admin_client, seeded_tools, db):
    # Explicitly nulling a slot is not "claiming a slot" — it must not run the
    # steal logic against whatever else happens to already be at slot None.
    await admin_client.put("/api/v1/tools/jpg-to-png", json={"featured_slot": 1})
    r = await admin_client.put("/api/v1/tools/jpg-to-png", json={"featured_slot": None})
    assert r.status_code == 200
    row = (await db.execute(select(Tool).where(Tool.id == "jpg-to-png"))).scalar_one()
    assert row.featured_slot is None
