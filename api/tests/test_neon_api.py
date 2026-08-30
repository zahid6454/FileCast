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
    def __init__(self, status_code):
        self.status_code = status_code


class FakeClient:
    def __init__(self, status_code=200):
        self.status_code = status_code
        self.requested_url = None
        self.requested_headers = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, headers=None):
        self.requested_url = url
        self.requested_headers = headers or {}
        return FakeResp(self.status_code)


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
