"""Integration — the Sync Tools round-trip (admin_deploy.py's seed-tools
routes, Admin-Tool-Sync-Plan.md).

A close sibling of test_admin_deploy.py: same fake-httpx seam (``_make_client``),
same never-501-for-a-real-failure contract, same ``run_id`` reply key the
frontend polls on. Reuses that file's fakes rather than duplicating them —
pytest's default import mode makes ``tests/`` importable as a flat namespace
(no ``__init__.py``), so a plain module import works.
"""

import httpx
import pytest
from data.config import settings
from test_admin_deploy import BadJsonResp, FakeClient, FakeResp, _iso, _use

SEED_PAT = "test-pat-secret-value"


@pytest.fixture(autouse=True)
def _configured_and_fast(monkeypatch):
    # Autouse fixtures are per-module — test_admin_deploy.py's own doesn't
    # apply here, so this mirrors it for the seed-tools routes.
    monkeypatch.setattr(settings, "github_pat", SEED_PAT)
    monkeypatch.setattr(settings, "github_owner", "zahid6454")
    monkeypatch.setattr(settings, "github_repo", "FileCast")
    monkeypatch.setattr(settings, "github_seed_workflow", "seed-tools.yml")
    monkeypatch.setattr("data.routers.admin_deploy._RUN_RESOLVE_DELAY", 0)
    monkeypatch.setattr("data.routers.admin_deploy._RUN_RESOLVE_ATTEMPTS", 3)


class ResolvingSeedClient(FakeClient):
    """POST→204; the runs list carries the posted seed_id in a run's name."""

    def __init__(self, run_id):
        self.run_id = run_id
        self.seed_id = None
        self.post_url = None
        self.post_headers = None

    async def post(self, url, headers=None, json=None):  # noqa: A002
        self.post_url = url
        self.post_headers = headers or {}
        self.seed_id = json["inputs"]["seed_id"]
        assert json["ref"] == "master"
        return FakeResp(204)

    async def get(self, url, headers=None):
        return FakeResp(
            200,
            {"workflow_runs": [{"id": self.run_id, "name": f"Seed {self.seed_id}"}]},
        )


async def test_dispatch_resolves_and_returns_run_id(admin_client, monkeypatch):
    client = ResolvingSeedClient(run_id=99)
    _use(monkeypatch, client)
    r = await admin_client.post("/api/v1/admin/seed-tools")
    assert r.status_code == 200, r.text
    body = r.json()
    # tools.js polls on res.run_id (snake_case) — its presence is load-bearing.
    assert body["run_id"] == 99
    assert body["seed_id"] == client.seed_id
    assert body["status"] == "queued"
    # Dispatched to the SEED workflow's dispatches endpoint, not deploy.yml's.
    assert client.post_url.endswith(
        f"/actions/workflows/{settings.github_seed_workflow}/dispatches"
    )
    assert client.post_headers.get("Authorization") == f"Bearer {SEED_PAT}"


async def test_run_id_none_when_no_runs_yet(admin_client, monkeypatch):
    class EmptyRunsClient(FakeClient):
        async def post(self, url, headers=None, json=None):  # noqa: A002
            return FakeResp(204)

        async def get(self, url, headers=None):
            return FakeResp(200, {"workflow_runs": []})

    _use(monkeypatch, EmptyRunsClient())
    r = await admin_client.post("/api/v1/admin/seed-tools")
    assert r.status_code == 200
    assert r.json()["run_id"] is None


async def test_fallback_ignores_runs_older_than_this_dispatch(
    admin_client, monkeypatch
):
    # Same eligibility rule as the deploy flow (_resolve_run_id is shared):
    # a run older than our dispatch cannot be ours.
    class FallbackClient(FakeClient):
        async def post(self, url, headers=None, json=None):  # noqa: A002
            return FakeResp(204)

        async def get(self, url, headers=None):
            return FakeResp(
                200,
                {
                    "workflow_runs": [
                        {"id": 1, "name": "someone else", "created_at": _iso(-600)}
                    ]
                },
            )

    _use(monkeypatch, FallbackClient())
    r = await admin_client.post("/api/v1/admin/seed-tools")
    assert r.status_code == 200
    assert r.json()["run_id"] is None


async def test_dispatch_failure_is_real_error_not_501(admin_client, monkeypatch):
    class DispatchFailClient(FakeClient):
        async def post(self, url, headers=None, json=None):  # noqa: A002
            return FakeResp(401, {"message": "Bad credentials"})

    _use(monkeypatch, DispatchFailClient())
    r = await admin_client.post("/api/v1/admin/seed-tools")
    assert r.status_code == 502
    assert r.status_code != 501  # 501 would render a calm "not configured" state


async def test_dispatch_network_error_is_502(admin_client, monkeypatch):
    class RaisingClient(FakeClient):
        async def post(self, url, headers=None, json=None):  # noqa: A002
            raise httpx.ConnectError("cannot reach github")

    _use(monkeypatch, RaisingClient())
    r = await admin_client.post("/api/v1/admin/seed-tools")
    assert r.status_code == 502


async def test_missing_pat_is_500_not_501(admin_client, monkeypatch):
    monkeypatch.setattr(settings, "github_pat", "")  # misconfigured
    r = await admin_client.post("/api/v1/admin/seed-tools")
    assert r.status_code == 500
    assert r.status_code != 501


async def test_status_returns_raw_github_fields(admin_client, monkeypatch):
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

    _use(monkeypatch, StatusClient())
    r = await admin_client.get("/api/v1/admin/seed-tools/123")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "completed"
    assert body["conclusion"] == "success"
    assert body["html_url"] == "https://gh/run/1"


async def test_status_failure_is_502(admin_client, monkeypatch):
    class StatusFailClient(FakeClient):
        async def get(self, url, headers=None):
            return FakeResp(404, {"message": "Not Found"})

    _use(monkeypatch, StatusFailClient())
    r = await admin_client.get("/api/v1/admin/seed-tools/999")
    assert r.status_code == 502


async def test_status_unparseable_body_is_502_not_500(admin_client, monkeypatch):
    class BadJsonStatusClient(FakeClient):
        async def get(self, url, headers=None):
            return BadJsonResp()

    _use(monkeypatch, BadJsonStatusClient())
    r = await admin_client.get("/api/v1/admin/seed-tools/123")
    assert r.status_code == 502
    assert r.status_code != 500


async def test_both_routes_require_admin(client, user_client):
    assert (await client.post("/api/v1/admin/seed-tools")).status_code == 401
    assert (await client.get("/api/v1/admin/seed-tools/1")).status_code == 401
    assert (await user_client.post("/api/v1/admin/seed-tools")).status_code == 403
    assert (await user_client.get("/api/v1/admin/seed-tools/1")).status_code == 403


async def test_pat_never_appears_in_any_response(admin_client, monkeypatch):
    _use(monkeypatch, ResolvingSeedClient(run_id=5))
    ok = await admin_client.post("/api/v1/admin/seed-tools")
    assert SEED_PAT not in ok.text


async def test_seed_and_deploy_dispatch_to_different_workflows(
    admin_client, monkeypatch
):
    # D6/D5: the two flows share _resolve_run_id and the dispatch shape, but
    # must never collide on which workflow file they hit.
    client = ResolvingSeedClient(run_id=1)
    _use(monkeypatch, client)
    await admin_client.post("/api/v1/admin/seed-tools")
    assert "seed-tools.yml" in client.post_url
    assert "deploy.yml" not in client.post_url


def test_seed_workflow_setting_uses_filecast_prefixed_alias(monkeypatch):
    # D5: a bare GITHUB_SEED_WORKFLOW would collide with GitHub Actions'
    # reserved GITHUB_WORKFLOW env var if the backend ever ran inside a
    # runner context — the same bug github_workflow itself once hit.
    monkeypatch.setenv("FILECAST_GITHUB_SEED_WORKFLOW", "custom-seed.yml")
    from data.config import Settings

    assert Settings().github_seed_workflow == "custom-seed.yml"
