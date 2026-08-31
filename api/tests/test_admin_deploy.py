"""Integration — the Phase 7 deploy round-trip (admin_deploy.py).

httpx is mocked via the ``_make_client`` seam — these tests NEVER call the real
GitHub API. Focus: run-id resolution (204 has no run id — R2), the
never-501-for-a-real-failure contract (§5.3a), the ``run_id`` reply key app.js
polls on, admin-only guards, and that the PAT never leaks into a response.
"""

import base64
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from data import node_registry
from data.config import settings
from data.node_registry import Node, set_active_node
from data.routers import admin_deploy
from nacl import encoding as nacl_encoding
from nacl import public as nacl_public

PAT = "test-pat-secret-value"


def _make_node(node_id: str, connection_string: str) -> Node:
    return Node(
        node_id=node_id,
        display_name=f"Node {node_id}",
        connection_string=connection_string,
        neon_project_id=f"proj-{node_id}",
        status="ready",
        created_at="2026-01-01T00:00:00+00:00",
    )


def _activate_fake_node(monkeypatch, node_id: str, connection_string: str) -> None:
    """Make admin_deploy.py's OWN active-node resolution see a fake node,
    without touching the real registry/Redis (register_node/set_active_node)
    — that would also flip which engine the REST of the app resolves to,
    including admin_client's own auth check, which would then try to
    actually connect to this fake, unreachable hostname and break login
    itself. Same monkeypatch-the-imported-name seam test_db.py uses for
    db.get_node."""
    node = _make_node(node_id, connection_string)

    async def _fake_get_active_node():
        return node_id

    async def _fake_get_node(nid):
        return node if nid == node_id else None

    monkeypatch.setattr(admin_deploy, "get_active_node", _fake_get_active_node)
    monkeypatch.setattr(admin_deploy, "get_node", _fake_get_node)


class FakeResp:
    def __init__(self, status_code, json_data=None):
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}

    def json(self):
        return self._json


class FakeClient:
    """Async-context httpx stand-in. Subclasses override post/get."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None):  # noqa: A002
        return FakeResp(204)

    async def get(self, url, headers=None):
        return FakeResp(200, {"workflow_runs": []})


def _use(monkeypatch, client):
    monkeypatch.setattr(admin_deploy, "_make_client", lambda: client)


@pytest.fixture(autouse=True)
def _configured_and_fast(monkeypatch):
    # Pin the deploy config so tests are deterministic regardless of ambient env.
    # (github_workflow used to read the bare GITHUB_WORKFLOW, which GitHub Actions
    # RESERVES — so in this repo's own CI it resolved to "CI". Phase 9 §5 moved it
    # to FILECAST_GITHUB_WORKFLOW; pinning all four here stays correct either way.)
    monkeypatch.setattr(settings, "github_pat", PAT)
    monkeypatch.setattr(settings, "github_owner", "zahid6454")
    monkeypatch.setattr(settings, "github_repo", "FileCast")
    monkeypatch.setattr(settings, "github_workflow", "deploy.yml")
    # No real sleeps between run-id polls (keeps tests instant).
    monkeypatch.setattr(admin_deploy, "_RUN_RESOLVE_DELAY", 0)
    monkeypatch.setattr(admin_deploy, "_RUN_RESOLVE_ATTEMPTS", 3)
    # Same reasoning as test_db.py's _reset_active_node_cache: the in-process
    # active-node cache isn't reset by conftest.py's global fixture, so a
    # value left warm by an unrelated earlier test could make get_active_node()
    # return stale data here instead of genuinely hitting the (just-flushed)
    # test Redis — every test in this file except the ones that explicitly
    # register+activate a node must see NO active node.
    monkeypatch.setattr(node_registry, "_cached_active_node_id", None)
    monkeypatch.setattr(node_registry, "_cached_active_node_at", 0.0)


# --------------------------------------------------------------------------- #
# dispatch + run-id resolution (R2)
# --------------------------------------------------------------------------- #


class ResolvingClient(FakeClient):
    """POST→204; the runs list carries the posted deploy_id in a run's name."""

    def __init__(self, run_id):
        self.run_id = run_id
        self.deploy_id = None
        self.get_calls = 0
        self.post_url = None
        self.post_headers = None

    async def post(self, url, headers=None, json=None):  # noqa: A002
        self.post_url = url
        self.post_headers = headers or {}
        self.deploy_id = json["inputs"]["deploy_id"]
        assert json["ref"] == "master"  # not "main" (§8)
        return FakeResp(204)

    async def get(self, url, headers=None):
        self.get_calls += 1
        return FakeResp(
            200,
            {
                "workflow_runs": [
                    {"id": self.run_id, "name": f"Deploy {self.deploy_id}"}
                ]
            },
        )


async def test_dispatch_resolves_and_returns_run_id(admin_client, monkeypatch):
    client = ResolvingClient(run_id=4242)
    _use(monkeypatch, client)
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 200, r.text
    body = r.json()
    # app.js polls on res.run_id (snake_case) — its presence is load-bearing.
    assert body["run_id"] == 4242
    assert body["deploy_id"] == client.deploy_id
    assert body["status"] == "queued"
    # Dispatched to the workflow's dispatches endpoint with a Bearer PAT (a typo
    # in the path/header would 404/401 in prod → 502, never a real deploy).
    assert client.post_url.endswith("/actions/workflows/deploy.yml/dispatches")
    assert client.post_headers.get("Authorization") == f"Bearer {PAT}"


async def test_trigger_deploy_logs_actor(admin_client, monkeypatch, caplog):
    # OWASP A09 — a successful deploy dispatch must leave an audit trail.
    _use(monkeypatch, ResolvingClient(run_id=4242))
    with caplog.at_level("INFO", logger="filecast.admin-deploy"):
        await admin_client.post("/api/v1/admin/deploy")
    record = next(
        r
        for r in caplog.records
        if getattr(r, "data", {}).get("event") == "admin_deploy_trigger"
    )
    assert record.data["actor"] == "admin@dev.local"
    assert record.data["run_id"] == 4242


def _iso(offset_seconds: float) -> str:
    """GitHub-shaped ``created_at``, offset from now."""
    return (
        (datetime.now(UTC) + timedelta(seconds=offset_seconds))
        .isoformat()
        .replace("+00:00", "Z")
    )


class FallbackClient(FakeClient):
    """The runs list never contains the deploy_id → resolution falls back to the
    newest ELIGIBLE run after exhausting attempts (and must not hang)."""

    def __init__(self, runs):
        self.runs = runs
        self.get_calls = 0

    async def post(self, url, headers=None, json=None):  # noqa: A002
        return FakeResp(204)

    async def get(self, url, headers=None):
        self.get_calls += 1
        return FakeResp(200, {"workflow_runs": self.runs})


async def test_run_id_resolution_falls_back_and_never_hangs(admin_client, monkeypatch):
    # A run created after our dispatch, with a name we can't match, is still
    # plausibly ours — that is what the fallback is for.
    client = FallbackClient([{"id": 777, "name": "unrelated", "created_at": _iso(1)}])
    _use(monkeypatch, client)
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 200
    assert r.json()["run_id"] == 777  # newest eligible, as a fallback
    assert client.get_calls == 3  # polled every attempt, then returned — no hang


async def test_fallback_ignores_runs_older_than_this_dispatch(
    admin_client, monkeypatch
):
    # The bug this closes: with two Saves queued in the build window, our run may
    # not have surfaced yet, and the old code took the newest run unconditionally
    # — so the panel polled an UNRELATED run and reported ITS conclusion. A run
    # that predates our dispatch cannot be ours; returning None only costs the
    # terminal toast, whereas a wrong run reports a wrong outcome.
    client = FallbackClient(
        [{"id": 777, "name": "someone else", "created_at": _iso(-600)}]
    )
    _use(monkeypatch, client)
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 200
    assert r.json()["run_id"] is None


async def test_fallback_ignores_runs_with_unusable_created_at(
    admin_client, monkeypatch
):
    # Absent or unparseable timestamps are not eligible either — unverifiable is
    # not the same as recent — and must not raise.
    client = FallbackClient(
        [
            {"id": 1, "name": "no timestamp"},
            {"id": 2, "name": "bad timestamp", "created_at": "not-a-date"},
            {"id": 3, "name": "null timestamp", "created_at": None},
            # Parses fine but has NO offset. Comparing it against the aware
            # floor raises TypeError, which would escape _resolve_run_id — a
            # function that runs AFTER a successful 204 — and turn a deploy that
            # already started into a 500. Must be treated as unusable, not
            # allowed to raise.
            {"id": 4, "name": "naive timestamp", "created_at": "2099-01-01T00:00:00"},
            {"id": 5, "name": "numeric timestamp", "created_at": 1234567890},
        ]
    )
    _use(monkeypatch, client)
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 200
    assert r.json()["run_id"] is None


class ArbitraryBodyClient(FakeClient):
    """POST→204; the runs GET returns 200 with an arbitrary JSON body."""

    def __init__(self, body):
        self.body = body

    async def post(self, url, headers=None, json=None):  # noqa: A002
        return FakeResp(204)

    async def get(self, url, headers=None):
        return FakeResp(200, self.body)


@pytest.mark.parametrize(
    "body",
    [
        [1, 2],  # body is an array, not an object → .get AttributeError
        "nope",  # body is a string → .get AttributeError
        {"workflow_runs": "oops"},  # iterating a str yields chars → AttributeError
        {"workflow_runs": [1, 2]},  # entries aren't run objects → AttributeError
        {"workflow_runs": 5},  # not iterable → TypeError
        {"workflow_runs": None},
        {"workflow_runs": [{"id": 9, "name": 123}]},  # int + str → TypeError
    ],
    ids=[
        "body-is-array",
        "body-is-string",
        "runs-is-string",
        "runs-holds-ints",
        "runs-is-number",
        "runs-is-null",
        "run-name-is-number",
    ],
)
async def test_malformed_runs_body_never_fails_a_succeeded_dispatch(
    admin_client, monkeypatch, body
):
    # Every one of these raised before _runs_from() existed — AttributeError or
    # TypeError, depending on which layer was wrong — and NONE of them were
    # caught: the inner except covered httpx.HTTPError/ValueError, the outer
    # only httpx.HTTPError. So a body GitHub should never send would escape
    # _resolve_run_id, which runs AFTER a successful 204, and turn a deploy that
    # already started into a 500. Unresolvable is fine; raising is not.
    _use(monkeypatch, ArbitraryBodyClient(body))
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 200, r.text  # NOT 500
    assert r.json()["run_id"] is None


async def test_junk_entries_do_not_hide_a_real_run(admin_client, monkeypatch):
    # Skipping malformed entries must not mean skipping the list. A real run
    # sitting behind junk is still matched on its deploy_id — otherwise the
    # hardening would have quietly cost the panel its polling.
    class MixedClient(FakeClient):
        def __init__(self):
            self.deploy_id = None

        async def post(self, url, headers=None, json=None):  # noqa: A002
            self.deploy_id = json["inputs"]["deploy_id"]
            return FakeResp(204)

        async def get(self, url, headers=None):
            return FakeResp(
                200,
                {
                    "workflow_runs": [
                        1,
                        "junk",
                        None,
                        {
                            "id": 7,
                            "name": f"Deploy {self.deploy_id}",
                            "created_at": _iso(1),
                        },
                    ]
                },
            )

    _use(monkeypatch, MixedClient())
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.json()["run_id"] == 7


async def test_non_200_runs_response_yields_no_candidates(admin_client, monkeypatch):
    # A 404/500 body is not a runs list, and must not be read as one.
    class NotOkClient(FakeClient):
        async def post(self, url, headers=None, json=None):  # noqa: A002
            return FakeResp(204)

        async def get(self, url, headers=None):
            return FakeResp(500, {"workflow_runs": [{"id": 1, "created_at": _iso(1)}]})

    _use(monkeypatch, NotOkClient())
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 200
    assert r.json()["run_id"] is None


async def test_deploy_id_match_wins_over_the_timestamp_filter(
    admin_client, monkeypatch
):
    # An exact deploy_id match identifies OUR run, so it is returned even when
    # its timestamp would have excluded it (clock skew, a slow GitHub clock).
    class MatchingButOldClient(FakeClient):
        def __init__(self):
            self.deploy_id = None

        async def post(self, url, headers=None, json=None):  # noqa: A002
            self.deploy_id = json["inputs"]["deploy_id"]
            return FakeResp(204)

        async def get(self, url, headers=None):
            return FakeResp(
                200,
                {
                    "workflow_runs": [
                        {
                            "id": 909,
                            "name": f"Deploy {self.deploy_id}",
                            "created_at": _iso(-3600),
                        }
                    ]
                },
            )

    _use(monkeypatch, MatchingButOldClient())
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.json()["run_id"] == 909


class EmptyRunsClient(FakeClient):
    async def post(self, url, headers=None, json=None):  # noqa: A002
        return FakeResp(204)

    async def get(self, url, headers=None):
        return FakeResp(200, {"workflow_runs": []})


async def test_run_id_none_when_no_runs_yet(admin_client, monkeypatch):
    # No runs resolvable → run_id None, but the dispatch still SUCCEEDED (2xx).
    _use(monkeypatch, EmptyRunsClient())
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 200
    assert r.json()["run_id"] is None


class DispatchOkResolveErrorsClient(FakeClient):
    """POST→204 (dispatch SUCCEEDS); every resolution GET raises a network error."""

    async def post(self, url, headers=None, json=None):  # noqa: A002
        return FakeResp(204)

    async def get(self, url, headers=None):
        raise httpx.ConnectError("blip during resolution")


async def test_resolution_error_does_not_mask_successful_dispatch(
    admin_client, monkeypatch
):
    # A transient error DURING run-id resolution must not turn a successful 204
    # dispatch into a 502 — the deploy is running; we just couldn't resolve its id.
    _use(monkeypatch, DispatchOkResolveErrorsClient())
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 200  # NOT 502
    assert r.json()["run_id"] is None


class BadJsonResp:
    status_code = 200

    def json(self):
        raise ValueError("malformed body")  # json.JSONDecodeError is a ValueError


class DispatchOkBadJsonClient(FakeClient):
    """POST→204; the runs GET returns 200 with an unparseable body."""

    async def post(self, url, headers=None, json=None):  # noqa: A002
        return FakeResp(204)

    async def get(self, url, headers=None):
        return BadJsonResp()


async def test_resolution_malformed_body_does_not_mask_dispatch(
    admin_client, monkeypatch
):
    # A malformed 200 body during resolution (ValueError) is swallowed too, so a
    # successful dispatch is never reported as a 500.
    _use(monkeypatch, DispatchOkBadJsonClient())
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 200
    assert r.json()["run_id"] is None


# --------------------------------------------------------------------------- #
# never 501 for a real failure (§5.3a)
# --------------------------------------------------------------------------- #


class DispatchFailClient(FakeClient):
    async def post(self, url, headers=None, json=None):  # noqa: A002
        return FakeResp(401, {"message": "Bad credentials"})


async def test_dispatch_failure_is_real_error_not_501(admin_client, monkeypatch):
    _use(monkeypatch, DispatchFailClient())
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 502
    assert r.status_code != 501  # 501 would render the calm "pending" banner


class RaisingClient(FakeClient):
    async def post(self, url, headers=None, json=None):  # noqa: A002
        raise httpx.ConnectError("cannot reach github")


async def test_dispatch_network_error_is_502(admin_client, monkeypatch):
    _use(monkeypatch, RaisingClient())
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 502


async def test_missing_pat_is_500_not_501(admin_client, monkeypatch):
    monkeypatch.setattr(settings, "github_pat", "")  # misconfigured
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 500
    assert r.status_code != 501


# --------------------------------------------------------------------------- #
# active-node secret sync (PR #153 — NEON_FAILOVER_PLAN.md Phase D gap)
# --------------------------------------------------------------------------- #


class SecretSyncClient(FakeClient):
    """A real X25519 keypair stands in for the repo's Actions public key, so
    a PUT's ``encrypted_value`` can be decrypted back to plaintext in the
    test — verifying the actual sealed-box round trip, not just that some
    string got sent somewhere."""

    def __init__(self, run_id):
        self.run_id = run_id
        self.deploy_id = None
        self.private_key = nacl_public.PrivateKey.generate()
        self.put_calls: list[tuple[str, dict]] = []

    async def get(self, url, headers=None):
        if url.endswith("/actions/secrets/public-key"):
            key_b64 = self.private_key.public_key.encode(nacl_encoding.Base64Encoder)
            return FakeResp(200, {"key_id": "test-key-id", "key": key_b64.decode()})
        return FakeResp(
            200,
            {
                "workflow_runs": [
                    {"id": self.run_id, "name": f"Deploy {self.deploy_id}"}
                ]
            },
        )

    async def post(self, url, headers=None, json=None):  # noqa: A002
        self.deploy_id = json["inputs"]["deploy_id"]
        return FakeResp(204)

    async def put(self, url, headers=None, json=None):  # noqa: A002
        self.put_calls.append((url, json))
        return FakeResp(204)

    def decrypt_put(self, index: int = -1) -> str:
        _, payload = self.put_calls[index]
        sealed = base64.b64decode(payload["encrypted_value"])
        return nacl_public.SealedBox(self.private_key).decrypt(sealed).decode()


CONN_STR = "postgresql+psycopg://user:pw@ep-active.neon.tech/filecast"


async def test_deploy_rotates_database_url_to_the_active_node(
    admin_client, monkeypatch
):
    _activate_fake_node(monkeypatch, "node-a", CONN_STR)

    client = SecretSyncClient(run_id=1)
    _use(monkeypatch, client)
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 200, r.text

    assert len(client.put_calls) == 1
    url, payload = client.put_calls[0]
    assert url.endswith("/actions/secrets/DATABASE_URL")
    assert payload["key_id"] == "test-key-id"
    assert client.decrypt_put() == CONN_STR


async def test_deploy_skips_secret_sync_when_no_active_node(admin_client, monkeypatch):
    # Pre-Bootstrap (nothing registered): DATABASE_URL already holds the
    # one-and-only static value, so no PUT should happen at all.
    client = SecretSyncClient(run_id=1)
    _use(monkeypatch, client)
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 200, r.text
    assert client.put_calls == []


async def test_deploy_fails_loud_when_public_key_fetch_fails(admin_client, monkeypatch):
    # A PAT missing the "Secrets: read/write" permission (or any other GitHub
    # error here) must NOT let the dispatch proceed with a stale secret —
    # that would silently reproduce the exact bug this mechanism closes.
    _activate_fake_node(monkeypatch, "node-b", CONN_STR)

    class BadKeyClient(FakeClient):
        dispatched = False

        async def get(self, url, headers=None):
            if url.endswith("/actions/secrets/public-key"):
                return FakeResp(403, {"message": "Forbidden"})
            return FakeResp(200, {"workflow_runs": []})

        async def post(self, url, headers=None, json=None):  # noqa: A002
            type(self).dispatched = True
            return FakeResp(204)

    _use(monkeypatch, BadKeyClient())
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 502
    assert "sync the active database target" in r.text
    assert BadKeyClient.dispatched is False  # never reached the dispatch POST


async def test_deploy_fails_loud_when_secret_put_fails(admin_client, monkeypatch):
    _activate_fake_node(monkeypatch, "node-c", CONN_STR)

    class BadPutClient(SecretSyncClient):
        async def put(self, url, headers=None, json=None):  # noqa: A002
            return FakeResp(500, {"message": "internal error"})

    _use(monkeypatch, BadPutClient(run_id=1))
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 502
    assert "sync the active database target" in r.text


async def test_deploy_fails_loud_when_active_node_record_missing(
    admin_client, monkeypatch
):
    # A dangling active pointer (registry hash entry absent) is a distinct
    # failure from a lookup error — must still fail loud, not dispatch with
    # a stale secret.
    await set_active_node("ghost-node-id")

    client = SecretSyncClient(run_id=1)
    _use(monkeypatch, client)
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 502
    assert client.put_calls == []


# --------------------------------------------------------------------------- #
# status proxy
# --------------------------------------------------------------------------- #


class StatusClient(FakeClient):
    async def get(self, url, headers=None):
        return FakeResp(
            200,
            {
                "status": "completed",
                "conclusion": "success",
                "html_url": "https://gh/run/1",
            },
        )


async def test_status_returns_raw_github_fields(admin_client, monkeypatch):
    _use(monkeypatch, StatusClient())
    r = await admin_client.get("/api/v1/admin/deploy/123")
    assert r.status_code == 200
    body = r.json()
    # app.js matches status === 'completed' | 'success' — return GitHub's raw value.
    assert body["status"] == "completed"
    assert body["conclusion"] == "success"
    assert body["html_url"] == "https://gh/run/1"


class StatusFailClient(FakeClient):
    async def get(self, url, headers=None):
        return FakeResp(404, {"message": "Not Found"})


async def test_status_failure_is_502(admin_client, monkeypatch):
    _use(monkeypatch, StatusFailClient())
    r = await admin_client.get("/api/v1/admin/deploy/999")
    assert r.status_code == 502


async def test_status_unparseable_body_is_502_not_500(admin_client, monkeypatch):
    # A bare resp.json() on a 200 raised ValueError → an opaque 500. Same class
    # as the runs-body hardening; a 502 naming the cause is the right answer.
    class BadJsonStatusClient(FakeClient):
        async def get(self, url, headers=None):
            return BadJsonResp()

    _use(monkeypatch, BadJsonStatusClient())
    r = await admin_client.get("/api/v1/admin/deploy/123")
    assert r.status_code == 502
    assert r.status_code != 500


async def test_status_non_object_body_is_502_not_500(admin_client, monkeypatch):
    # Parses fine, then .get would raise AttributeError.
    class ArrayStatusClient(FakeClient):
        async def get(self, url, headers=None):
            return FakeResp(200, [1, 2, 3])

    _use(monkeypatch, ArrayStatusClient())
    r = await admin_client.get("/api/v1/admin/deploy/123")
    assert r.status_code == 502


# --------------------------------------------------------------------------- #
# authz + secret hygiene
# --------------------------------------------------------------------------- #


async def test_both_routes_require_admin(client, user_client):
    # Anonymous → 401, non-admin → 403, on BOTH routes. Guard runs before any
    # GitHub call, so no client patching is needed.
    assert (await client.post("/api/v1/admin/deploy")).status_code == 401
    assert (await client.get("/api/v1/admin/deploy/1")).status_code == 401
    assert (await user_client.post("/api/v1/admin/deploy")).status_code == 403
    assert (await user_client.get("/api/v1/admin/deploy/1")).status_code == 403


async def test_pat_never_appears_in_any_response(admin_client, monkeypatch):
    # Success path.
    _use(monkeypatch, ResolvingClient(run_id=5))
    ok = await admin_client.post("/api/v1/admin/deploy")
    assert PAT not in ok.text
    # Failure path (error detail must not echo the secret either).
    _use(monkeypatch, DispatchFailClient())
    fail = await admin_client.post("/api/v1/admin/deploy")
    assert PAT not in fail.text
