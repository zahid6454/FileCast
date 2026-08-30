"""Thin client for Neon's console API (NEON_FAILOVER_PLAN.md §7.3/§7.8).

Phase D only needs one call: confirming, during node provisioning, that the
account-level API key can actually see a freshly-registered project (§7.8
step 4) — this catches a mistyped ``neon_project_id`` before it silently
breaks §7.3's usage polling later (a later phase, not implemented here).
That's why this module deliberately does NOT parse the response body for
usage/quota fields yet — inventing that shape now, without a concrete need
to verify it against, would just be a guess baked into shipped code. Phase
E's usage-poll loop extends this module with real field parsing when it
actually needs it.

``GET /projects/{project_id}`` is a control-plane call — it never connects to
the project's own Postgres endpoint, so it costs no CU-hours to check
(confirmed against Neon's API reference, §7.3).
"""

import httpx

from data.config import settings

NEON_API_BASE = "https://console.neon.tech/api/v2"

# Bounds the whole call — this runs synchronously inside node provisioning
# (§7.8), which already has its own overall budget via node_registry's
# pool-op lock TTL; a hung network call here must not eat that whole budget.
NEON_API_TIMEOUT_SECONDS = 10.0


class NeonApiError(RuntimeError):
    """The Neon API call failed outright (network/timeout/unconfigured key)
    or returned a non-2xx status — including 404, which is exactly what a
    mistyped ``neon_project_id`` produces (§7.8)."""


def _make_client() -> httpx.AsyncClient:
    """Seam for tests — same pattern as admin_deploy.py's ``_make_client``:
    tests patch this to inject a fake client and never call the real API."""
    return httpx.AsyncClient(timeout=NEON_API_TIMEOUT_SECONDS)


async def verify_project_visible(project_id: str) -> None:
    """Raise ``NeonApiError`` unless the configured API key can see
    ``project_id`` — one GET against the project-detail endpoint. Used by
    node provisioning (§7.8 step 4) to catch a mistyped project id before
    the node is marked ``ready``. Never raises for anything other than
    "the key can't confirm this project exists"; no response body parsing
    is attempted (see module docstring)."""
    if not settings.neon_api_key:
        raise NeonApiError("Neon API key is not configured (NEON_API_KEY unset).")

    url = f"{NEON_API_BASE}/projects/{project_id}"
    headers = {
        "Authorization": f"Bearer {settings.neon_api_key}",
        "Accept": "application/json",
    }
    try:
        async with _make_client() as client:
            resp = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise NeonApiError(f"Could not reach Neon's API: {exc}") from exc

    if resp.status_code != 200:
        raise NeonApiError(
            f"Neon API returned {resp.status_code} for project {project_id!r} "
            "— the API key may not be able to see this project, or the "
            "project id is wrong."
        )
