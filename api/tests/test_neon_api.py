"""Tests for data/neon_api.py (NEON_FAILOVER_PLAN.md §7.3/§7.8, Phase D).

httpx is mocked via the ``_make_client`` seam, same pattern
``test_admin_deploy.py`` uses for the GitHub API — these tests never call
the real Neon API.
"""

import httpx
import pytest
from data import neon_api
from data.config import settings


class FakeResp:
    def __init__(self, status_code, body=None):
        self.status_code = status_code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


class FakeClient:
    def __init__(self, status_code=200, body=None):
        self.status_code = status_code
        self.body = body
        self.requested_url = None
        self.requested_headers = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, headers=None):
        self.requested_url = url
        self.requested_headers = headers or {}
        return FakeResp(self.status_code, self.body)


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    monkeypatch.setattr(settings, "neon_api_key", "test-neon-key")


async def test_verify_project_visible_succeeds_on_200(monkeypatch):
    client = FakeClient(status_code=200)
    monkeypatch.setattr(neon_api, "_make_client", lambda: client)

    await neon_api.verify_project_visible("proj-123")

    assert client.requested_url == f"{neon_api.NEON_API_BASE}/projects/proj-123"
    assert client.requested_headers["Authorization"] == "Bearer test-neon-key"


async def test_verify_project_visible_raises_on_404_wrong_project_id(monkeypatch):
    monkeypatch.setattr(neon_api, "_make_client", lambda: FakeClient(status_code=404))

    with pytest.raises(neon_api.NeonApiError, match="404"):
        await neon_api.verify_project_visible("wrong-id")


async def test_verify_project_visible_raises_on_non_200_non_404(monkeypatch):
    monkeypatch.setattr(neon_api, "_make_client", lambda: FakeClient(status_code=500))

    with pytest.raises(neon_api.NeonApiError, match="500"):
        await neon_api.verify_project_visible("proj-123")


async def test_verify_project_visible_raises_when_key_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "neon_api_key", "")

    with pytest.raises(neon_api.NeonApiError, match="not configured"):
        await neon_api.verify_project_visible("proj-123")


async def test_verify_project_visible_raises_on_network_error(monkeypatch):
    class BoomClient(FakeClient):
        async def get(self, url, headers=None):
            raise httpx.ConnectError("boom")

    monkeypatch.setattr(neon_api, "_make_client", lambda: BoomClient())

    with pytest.raises(neon_api.NeonApiError, match="Could not reach Neon"):
        await neon_api.verify_project_visible("proj-123")


# --------------------------------------------------------------------------- #
# get_project_usage (NEON_FAILOVER_PLAN.md §7.3, Phase E)
# --------------------------------------------------------------------------- #


def _usage_body(used: float) -> dict:
    # Matches Neon's actual GET /projects/{id} shape: compute_time_seconds
    # (consumed) sits directly on the project. The quota ceiling is NOT read
    # from this response at all — confirmed live in production (2026-09-01)
    # that Neon only populates project.settings.quota when a project has an
    # explicit custom quota override configured, which neither of FileCast's
    # real projects has ever had. quota_seconds is a caller-supplied
    # argument instead (job_worker.py, sourced from the
    # monthly_quota_compute_hours admin setting) — see neon_api.py's
    # get_project_usage() docstring.
    return {"project": {"compute_time_seconds": used}}


async def test_get_project_usage_computes_ratio_from_project_body(monkeypatch):
    client = FakeClient(status_code=200, body=_usage_body(50))
    monkeypatch.setattr(neon_api, "_make_client", lambda: client)

    ratio = await neon_api.get_project_usage("proj-123", quota_seconds=100)

    assert ratio == 0.5
    assert client.requested_url == f"{neon_api.NEON_API_BASE}/projects/proj-123"


async def test_get_project_usage_accepts_a_flat_unwrapped_body(monkeypatch):
    # Some Neon API responses may not nest under "project" — _fetch_project's
    # shared parsing falls back to the body itself in that case.
    body = {"compute_time_seconds": 25}
    monkeypatch.setattr(neon_api, "_make_client", lambda: FakeClient(200, body))

    assert await neon_api.get_project_usage("proj-123", quota_seconds=100) == 0.25


async def test_get_project_usage_raises_on_404(monkeypatch):
    monkeypatch.setattr(neon_api, "_make_client", lambda: FakeClient(status_code=404))

    with pytest.raises(neon_api.NeonApiError, match="404"):
        await neon_api.get_project_usage("wrong-id", quota_seconds=100)


async def test_get_project_usage_raises_when_key_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "neon_api_key", "")

    with pytest.raises(neon_api.NeonApiError, match="not configured"):
        await neon_api.get_project_usage("proj-123", quota_seconds=100)


async def test_get_project_usage_raises_on_missing_compute_time(monkeypatch):
    monkeypatch.setattr(
        neon_api, "_make_client", lambda: FakeClient(200, {"project": {}})
    )

    with pytest.raises(neon_api.NeonApiError, match="Unexpected"):
        await neon_api.get_project_usage("proj-123", quota_seconds=100)


async def test_get_project_usage_raises_on_non_positive_quota(monkeypatch):
    # A misconfigured monthly_quota_compute_hours setting (0, or negative)
    # must be rejected rather than raising ZeroDivisionError — the quota no
    # longer comes from Neon's response (see _usage_body's comment), so this
    # is now purely a caller/config-side validation, never a Neon API shape
    # issue.
    monkeypatch.setattr(
        neon_api, "_make_client", lambda: FakeClient(200, _usage_body(50))
    )

    with pytest.raises(neon_api.NeonApiError, match="quota_seconds"):
        await neon_api.get_project_usage("proj-123", quota_seconds=0)


async def test_get_project_usage_raises_on_non_json_body(monkeypatch):
    class NonJsonResp(FakeResp):
        def json(self):
            raise ValueError("not json")

    class NonJsonClient(FakeClient):
        async def get(self, url, headers=None):
            return NonJsonResp(200)

    monkeypatch.setattr(neon_api, "_make_client", lambda: NonJsonClient())

    with pytest.raises(neon_api.NeonApiError, match="non-JSON"):
        await neon_api.get_project_usage("proj-123", quota_seconds=100)
