"""Tests for data/routers/admin_nodes.py (NEON_FAILOVER_PLAN.md §7.13, §12).

Router-level: request validation, auth gating, duplicate-project rejection,
active-node-retire rejection, and the wake-queue dispatch contract (a real
push onto the real test Redis list, popped back and parsed here — the
actual switch/provision *execution* is data/node_ops.py's own concern,
covered by test_node_ops.py). Also the required §12 contract test: neither
the node-list nor the status endpoint's response shape ever carries a raw
connection string.
"""

import json

import pytest
from converter import JOB_WAKE_QUEUE_KEY
from data import node_registry as nr
from data.config import settings
from data.node_registry import (
    Node,
    SwitchHistoryEntry,
    append_switch_history,
    get_node,
    get_switch_status,
    register_node,
    set_active_node,
)
from data.redis_client import redis_client


@pytest.fixture(autouse=True)
def _reset_in_process_cache(monkeypatch):
    """Same reasoning as test_node_registry.py's own fixture — the active-
    node fallback cache lives outside Redis (§7.1) and must not leak
    between tests in this file."""
    monkeypatch.setattr(nr, "_cached_active_node_id", None)
    monkeypatch.setattr(nr, "_cached_active_node_at", 0.0)


def _make_node(
    node_id: str, *, neon_project_id: str | None = None, status="ready"
) -> Node:
    return Node(
        node_id=node_id,
        display_name=f"Node {node_id}",
        connection_string=f"postgresql+psycopg://user:pw@ep-{node_id}.neon.tech/filecast",
        neon_project_id=neon_project_id or f"proj-{node_id}",
        status=status,
        created_at="2026-01-01T00:00:00+00:00",
    )


def _make_active_node(node_id: str, **kw) -> Node:
    """A node used as the ACTIVE node needs a REAL, working connection
    string. ``Depends(get_session)``'s own auth lookup runs on every
    authenticated request in this file (``current_user()``) and resolves
    through the same dynamic per-node engine accessor (§7.2) the route
    under test uses — a placeholder Neon-style host here would break every
    later request in the test (a 500 from ``current_user()`` failing to
    connect), not just the one route being exercised."""
    node = _make_node(node_id, **kw)
    return node.model_copy(update={"connection_string": settings.database_url})


async def _pop_wake_task() -> tuple[str, dict]:
    """Pop the oldest pushed wake-queue entry (RPOP mirrors what a real
    BRPOP consumer eventually sees against an LPUSH producer) and parse it
    as a switch/provision task — fails the test loudly if nothing was
    pushed or it isn't a recognized task."""
    from data.node_ops import parse_wake_task

    raw = await redis_client.rpop(JOB_WAKE_QUEUE_KEY)
    assert raw is not None, "expected a task to have been pushed to the wake queue"
    task = parse_wake_task(raw)
    assert task is not None, f"pushed value was not a recognized task: {raw!r}"
    return task


# --------------------------------------------------------------------------- #
# Auth gating — every route requires admin
# --------------------------------------------------------------------------- #


async def test_every_route_requires_admin(client, user_client):
    await register_node(_make_active_node("n1"))
    await set_active_node("n1")

    # Each body (where the route takes one) is a VALID payload for that
    # route — this isolates the auth check from any 422/validation
    # ambiguity about which error FastAPI would surface first.
    calls = [
        ("post", "/api/v1/admin/nodes/n1/switch", None),
        (
            "post",
            "/api/v1/admin/nodes",
            {
                "display_name": "X",
                "connection_string": "postgresql://h/db",
                "neon_project_id": "p",
            },
        ),
        ("get", "/api/v1/admin/nodes/some-run-id/status", None),
        ("get", "/api/v1/admin/nodes", None),
        ("get", "/api/v1/admin/nodes/history", None),
        ("get", "/api/v1/admin/nodes/settings", None),
        ("put", "/api/v1/admin/nodes/settings", {}),
        ("patch", "/api/v1/admin/nodes/n1", {"display_name": "X"}),
        ("post", "/api/v1/admin/nodes/n1/retire", None),
        ("post", "/api/v1/admin/nodes/n1/retry", None),
    ]
    for method, path, body in calls:
        kwargs = {} if body is None else {"json": body}
        anon = await getattr(client, method)(path, **kwargs)
        assert anon.status_code == 401, f"{method} {path} anon"
        user = await getattr(user_client, method)(path, **kwargs)
        assert user.status_code == 403, f"{method} {path} user"


# --------------------------------------------------------------------------- #
# Provisioning
# --------------------------------------------------------------------------- #


async def test_provision_node_success(admin_client):
    r = await admin_client.post(
        "/api/v1/admin/nodes",
        json={
            "display_name": "Node Two",
            "connection_string": "postgres://user:pw@ep-two.neon.tech/filecast",
            "neon_project_id": "proj-two",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "queued"
    node_id = body["node_id"]

    node = await get_node(node_id)
    assert node.status == "provisioning"
    # The driver-suffix normalization hint (§7.12) — a bare Neon-style
    # connection string must be stored ready for create_async_engine (§7.2).
    assert node.connection_string.startswith("postgresql+psycopg://")

    task_type, kwargs = await _pop_wake_task()
    from data.node_ops import TASK_TYPE_PROVISION

    assert task_type == TASK_TYPE_PROVISION
    assert kwargs["node_id"] == node_id
    status = await get_switch_status(kwargs["run_id"])
    assert status.status == "pending"


async def test_provision_node_rejects_duplicate_neon_project_id(admin_client):
    await register_node(_make_node("existing", neon_project_id="proj-dup"))

    r = await admin_client.post(
        "/api/v1/admin/nodes",
        json={
            "display_name": "Node Dup",
            "connection_string": "postgresql://user:pw@ep-dup.neon.tech/filecast",
            "neon_project_id": "proj-dup",
        },
    )
    assert r.status_code == 409, r.text
    assert "existing" in r.text


@pytest.mark.parametrize(
    "body",
    [
        {
            "display_name": "",
            "connection_string": "postgresql://h/db",
            "neon_project_id": "p",
        },
        {"display_name": "N", "connection_string": "", "neon_project_id": "p"},
        {
            "display_name": "N",
            "connection_string": "postgresql://h/db",
            "neon_project_id": "",
        },
    ],
)
async def test_provision_node_rejects_empty_fields(admin_client, body):
    r = await admin_client.post("/api/v1/admin/nodes", json=body)
    assert r.status_code == 422, r.text


async def test_provision_node_dispatch_failure_rolls_back_to_error(
    admin_client, monkeypatch
):
    async def boom(*args, **kwargs):
        raise ConnectionError("redis down")

    monkeypatch.setattr(redis_client, "lpush", boom)

    r = await admin_client.post(
        "/api/v1/admin/nodes",
        json={
            "display_name": "Node Boom",
            "connection_string": "postgresql://user:pw@ep-boom.neon.tech/filecast",
            "neon_project_id": "proj-boom",
        },
    )
    assert r.status_code == 502, r.text
    node_id = None
    for candidate in await nr.list_nodes():
        if candidate.display_name == "Node Boom":
            node_id = candidate.node_id
    assert node_id is not None
    node = await get_node(node_id)
    assert node.status == "error"


async def test_retry_provisioning_success(admin_client):
    await register_node(_make_node("errored", status="error"))

    r = await admin_client.post("/api/v1/admin/nodes/errored/retry")
    assert r.status_code == 200, r.text
    node = await get_node("errored")
    assert node.status == "provisioning"
    task_type, kwargs = await _pop_wake_task()
    from data.node_ops import TASK_TYPE_PROVISION

    assert task_type == TASK_TYPE_PROVISION
    assert kwargs["node_id"] == "errored"


async def test_retry_provisioning_rejects_non_error_node(admin_client):
    await register_node(_make_node("healthy", status="ready"))

    r = await admin_client.post("/api/v1/admin/nodes/healthy/retry")
    assert r.status_code == 400, r.text


async def test_retry_provisioning_404_for_unknown_node(admin_client):
    r = await admin_client.post("/api/v1/admin/nodes/does-not-exist/retry")
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# Switch
# --------------------------------------------------------------------------- #


async def test_trigger_switch_success(admin_client):
    await register_node(_make_active_node("active-node"))
    await register_node(_make_node("reserve-node"))
    await set_active_node("active-node")

    r = await admin_client.post("/api/v1/admin/nodes/reserve-node/switch")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "queued"

    task_type, kwargs = await _pop_wake_task()
    from data.node_ops import TASK_TYPE_SWITCH

    assert task_type == TASK_TYPE_SWITCH
    assert kwargs["target_node_id"] == "reserve-node"
    assert kwargs["trigger"] == "manual"
    status = await get_switch_status(body["run_id"])
    assert status.status == "pending"
    assert status.source_node_id == "active-node"


async def test_trigger_switch_404_for_unknown_node(admin_client):
    r = await admin_client.post("/api/v1/admin/nodes/does-not-exist/switch")
    assert r.status_code == 404


async def test_trigger_switch_rejects_non_ready_target(admin_client):
    await register_node(_make_active_node("active-node"))
    await register_node(_make_node("provisioning-node", status="provisioning"))
    await set_active_node("active-node")

    r = await admin_client.post("/api/v1/admin/nodes/provisioning-node/switch")
    assert r.status_code == 400, r.text


async def test_trigger_switch_rejects_already_active_target(admin_client):
    await register_node(_make_active_node("active-node"))
    await set_active_node("active-node")

    r = await admin_client.post("/api/v1/admin/nodes/active-node/switch")
    assert r.status_code == 400, r.text


async def test_trigger_switch_dispatch_failure_marks_run_as_error(
    admin_client, monkeypatch
):
    await register_node(_make_active_node("active-node"))
    await register_node(_make_node("reserve-node"))
    await set_active_node("active-node")

    async def boom(*args, **kwargs):
        raise ConnectionError("redis down")

    monkeypatch.setattr(redis_client, "lpush", boom)

    r = await admin_client.post("/api/v1/admin/nodes/reserve-node/switch")
    assert r.status_code == 502, r.text


# --------------------------------------------------------------------------- #
# Status polling
# --------------------------------------------------------------------------- #


async def test_get_run_status_404_for_unknown_run_id(admin_client):
    r = await admin_client.get("/api/v1/admin/nodes/unknown-run/status")
    assert r.status_code == 404


async def test_get_run_status_returns_known_status(admin_client):
    await register_node(_make_active_node("active-node"))
    await register_node(_make_node("reserve-node"))
    await set_active_node("active-node")

    trigger = await admin_client.post("/api/v1/admin/nodes/reserve-node/switch")
    run_id = trigger.json()["run_id"]

    r = await admin_client.get(f"/api/v1/admin/nodes/{run_id}/status")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending"


# --------------------------------------------------------------------------- #
# Listing — never exposes a raw connection string (§7.1/§12)
# --------------------------------------------------------------------------- #


async def test_list_nodes_never_exposes_connection_string(admin_client):
    await register_node(_make_active_node("active-node"))
    await register_node(_make_node("reserve-node"))
    await set_active_node("active-node")

    r = await admin_client.get("/api/v1/admin/nodes")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "connection_string" not in json.dumps(body)
    assert settings.database_url not in json.dumps(body)
    assert "ep-reserve-node.neon.tech" not in json.dumps(body)

    by_id = {n["node_id"]: n for n in body["nodes"]}
    assert by_id["active-node"]["is_active"] is True
    assert by_id["reserve-node"]["is_active"] is False
    assert by_id["active-node"]["usage"] is None
    assert by_id["active-node"]["last_activity"] is None


async def test_status_endpoint_never_exposes_connection_string(admin_client):
    await register_node(_make_active_node("active-node"))
    await register_node(_make_node("reserve-node"))
    await set_active_node("active-node")

    trigger = await admin_client.post("/api/v1/admin/nodes/reserve-node/switch")
    run_id = trigger.json()["run_id"]

    r = await admin_client.get(f"/api/v1/admin/nodes/{run_id}/status")
    assert "connection_string" not in json.dumps(r.json())
    assert settings.database_url not in json.dumps(r.json())
    assert "ep-reserve-node.neon.tech" not in json.dumps(r.json())


# --------------------------------------------------------------------------- #
# History — §7.12's admin panel History tab (no route existed before this
# phase; see the docstring on the route itself for why).
# --------------------------------------------------------------------------- #


async def test_list_history_returns_newest_first(admin_client):
    await append_switch_history(
        SwitchHistoryEntry(
            trigger="manual",
            source_node_id="a",
            target_node_id="b",
            outcome="success",
            detail=None,
            at="2026-01-01T00:00:00+00:00",
        )
    )
    await append_switch_history(
        SwitchHistoryEntry(
            trigger="reactive",
            source_node_id="b",
            target_node_id="c",
            outcome="success",
            detail="bounded staleness note",
            at="2026-01-02T00:00:00+00:00",
        )
    )

    r = await admin_client.get("/api/v1/admin/nodes/history")
    assert r.status_code == 200, r.text
    entries = r.json()["history"]
    assert len(entries) == 2
    assert entries[0]["trigger"] == "reactive"
    assert entries[0]["target_node_id"] == "c"
    assert entries[1]["trigger"] == "manual"


async def test_list_history_never_exposes_connection_string(admin_client):
    await register_node(_make_active_node("active-node"))
    await register_node(_make_node("reserve-node"))
    await set_active_node("active-node")
    await append_switch_history(
        SwitchHistoryEntry(
            trigger="manual",
            source_node_id="active-node",
            target_node_id="reserve-node",
            outcome="success",
            detail=None,
            at="2026-01-01T00:00:00+00:00",
        )
    )

    r = await admin_client.get("/api/v1/admin/nodes/history")
    assert r.status_code == 200, r.text
    assert "connection_string" not in json.dumps(r.json())
    assert settings.database_url not in json.dumps(r.json())


async def test_list_history_empty_when_no_switches_yet(admin_client):
    r = await admin_client.get("/api/v1/admin/nodes/history")
    assert r.status_code == 200, r.text
    assert r.json()["history"] == []


# --------------------------------------------------------------------------- #
# Settings
# --------------------------------------------------------------------------- #


async def test_get_settings_returns_defaults(admin_client):
    r = await admin_client.get("/api/v1/admin/nodes/settings")
    assert r.status_code == 200, r.text
    assert r.json()["warmup_threshold_pct"] == 70
    assert r.json()["cutover_threshold_pct"] == 80


async def test_put_settings_updates_one_field(admin_client):
    r = await admin_client.put(
        "/api/v1/admin/nodes/settings", json={"warmup_threshold_pct": 65}
    )
    assert r.status_code == 200, r.text
    assert r.json()["warmup_threshold_pct"] == 65
    # Untouched fields keep their existing values.
    assert r.json()["cutover_threshold_pct"] == 80

    again = await admin_client.get("/api/v1/admin/nodes/settings")
    assert again.json()["warmup_threshold_pct"] == 65


async def test_put_settings_rejects_wrong_type(admin_client):
    r = await admin_client.put(
        "/api/v1/admin/nodes/settings", json={"warmup_threshold_pct": "not-a-number"}
    )
    assert r.status_code == 422, r.text


# --------------------------------------------------------------------------- #
# Rename
# --------------------------------------------------------------------------- #


async def test_rename_node_success(admin_client):
    await register_node(_make_node("n1"))

    r = await admin_client.patch(
        "/api/v1/admin/nodes/n1", json={"display_name": "Renamed Node"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["node"]["display_name"] == "Renamed Node"
    node = await get_node("n1")
    assert node.display_name == "Renamed Node"


async def test_rename_node_404_for_unknown_node(admin_client):
    r = await admin_client.patch(
        "/api/v1/admin/nodes/does-not-exist", json={"display_name": "X"}
    )
    assert r.status_code == 404


async def test_rename_node_rejects_empty_display_name(admin_client):
    await register_node(_make_node("n1"))
    r = await admin_client.patch("/api/v1/admin/nodes/n1", json={"display_name": "  "})
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# Retire — the currently-active node must be impossible to retire (§7.8/§12)
# --------------------------------------------------------------------------- #


async def test_retire_active_node_is_rejected(admin_client):
    await register_node(_make_active_node("active-node"))
    await set_active_node("active-node")

    r = await admin_client.post("/api/v1/admin/nodes/active-node/retire")
    assert r.status_code == 400, r.text
    node = await get_node("active-node")
    assert node.status == "ready"  # untouched


async def test_retire_reserve_node_succeeds(admin_client):
    await register_node(_make_active_node("active-node"))
    await register_node(_make_node("reserve-node"))
    await set_active_node("active-node")

    r = await admin_client.post("/api/v1/admin/nodes/reserve-node/retire")
    assert r.status_code == 200, r.text
    node = await get_node("reserve-node")
    assert node.status == "retired"


async def test_retire_node_404_for_unknown_node(admin_client):
    r = await admin_client.post("/api/v1/admin/nodes/does-not-exist/retire")
    assert r.status_code == 404
