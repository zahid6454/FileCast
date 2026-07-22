"""Integration — the Phase 7 deploy round-trip (admin_deploy.py).

httpx is mocked via the ``_make_client`` seam — these tests NEVER call the real
GitHub API. Focus: run-id resolution (204 has no run id — R2), the
never-501-for-a-real-failure contract (§5.3a), the ``run_id`` reply key app.js
polls on, admin-only guards, and that the PAT never leaks into a response.
"""

import httpx
import pytest
from data.config import settings
from data.routers import admin_deploy

PAT = "test-pat-secret-value"


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
    # A configured PAT + no real sleeps between run-id polls (keeps tests instant).
    monkeypatch.setattr(settings, "github_pat", PAT)
    monkeypatch.setattr(admin_deploy, "_RUN_RESOLVE_DELAY", 0)
    monkeypatch.setattr(admin_deploy, "_RUN_RESOLVE_ATTEMPTS", 3)


# --------------------------------------------------------------------------- #
# dispatch + run-id resolution (R2)
# --------------------------------------------------------------------------- #


class ResolvingClient(FakeClient):
    """POST→204; the runs list carries the posted deploy_id in a run's name."""

    def __init__(self, run_id):
        self.run_id = run_id
        self.deploy_id = None
        self.get_calls = 0

    async def post(self, url, headers=None, json=None):  # noqa: A002
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


class FallbackClient(FakeClient):
    """The runs list never contains the deploy_id → resolution falls back to the
    newest run after exhausting attempts (and must not hang)."""

    def __init__(self):
        self.get_calls = 0

    async def post(self, url, headers=None, json=None):  # noqa: A002
        return FakeResp(204)

    async def get(self, url, headers=None):
        self.get_calls += 1
        return FakeResp(200, {"workflow_runs": [{"id": 777, "name": "unrelated"}]})


async def test_run_id_resolution_falls_back_and_never_hangs(admin_client, monkeypatch):
    client = FallbackClient()
    _use(monkeypatch, client)
    r = await admin_client.post("/api/v1/admin/deploy")
    assert r.status_code == 200
    assert r.json()["run_id"] == 777  # newest, as a fallback
    assert client.get_calls == 3  # polled every attempt, then returned — no hang


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
