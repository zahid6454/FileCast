"""Thin client for Neon's console API (NEON_FAILOVER_PLAN.md §7.3/§7.8).

Phase D added one call: confirming, during node provisioning, that the
account-level API key can actually see a freshly-registered project (§7.8
step 4) — this catches a mistyped ``neon_project_id`` before it silently
breaks §7.3's usage polling. Phase E adds the second: ``get_project_usage()``,
which parses the same endpoint's response body for the actual usage/quota
fields the usage-poll loop needs (§7.3).

``GET /projects/{project_id}`` is a control-plane call — it never connects to
the project's own Postgres endpoint, so it costs no CU-hours to check
(confirmed against Neon's API reference, §7.3). This means every node in the
pool can be polled on the same cadence, including reserves — there's no
compute-cost tradeoff to checking a node that isn't currently serving
traffic.
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


async def _fetch_project(project_id: str) -> httpx.Response:
    """Shared GET against the project-detail endpoint — the one
    control-plane call both ``verify_project_visible`` and
    ``get_project_usage`` need (§7.3/§7.8). Raises ``NeonApiError`` only for
    "can't even ask the question" failures (unconfigured key, network/
    timeout) — callers decide what a given status code means for their own
    purpose."""
    if not settings.neon_api_key:
        raise NeonApiError("Neon API key is not configured (NEON_API_KEY unset).")

    url = f"{NEON_API_BASE}/projects/{project_id}"
    headers = {
        "Authorization": f"Bearer {settings.neon_api_key}",
        "Accept": "application/json",
    }
    try:
        async with _make_client() as client:
            return await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise NeonApiError(f"Could not reach Neon's API: {exc}") from exc


async def verify_project_visible(project_id: str) -> None:
    """Raise ``NeonApiError`` unless the configured API key can see
    ``project_id`` — one GET against the project-detail endpoint. Used by
    node provisioning (§7.8 step 4) to catch a mistyped project id before
    the node is marked ``ready``. Never raises for anything other than
    "the key can't confirm this project exists"; no response body parsing
    is attempted."""
    resp = await _fetch_project(project_id)

    if resp.status_code != 200:
        raise NeonApiError(
            f"Neon API returned {resp.status_code} for project {project_id!r} "
            "— the API key may not be able to see this project, or the "
            "project id is wrong."
        )


async def get_project_usage(project_id: str) -> float:
    """Fetch a project's current-billing-period compute-usage ratio (§7.3):
    ``compute_time_seconds`` (consumed so far) / ``settings.quota.compute_time_seconds``
    (the ceiling), both from the same project-detail response
    ``verify_project_visible`` already uses — a control-plane call that
    never connects to the project's own Postgres endpoint or wakes its
    compute (module docstring), so every node in the pool can be polled on
    the same cadence.

    Raises ``NeonApiError`` on anything that makes the ratio unavailable —
    a non-200 status, a non-JSON body, or a response missing either field
    (which would otherwise be a division by zero, or silently reflects a
    Neon API shape change). The usage-poll loop (§7.3, Phase E) treats a
    single failed call as non-fatal by design: keep the last cached value,
    retry next cycle — never let this masquerade as a database-down event.
    """
    resp = await _fetch_project(project_id)

    if resp.status_code != 200:
        raise NeonApiError(
            f"Neon API returned {resp.status_code} for project {project_id!r} "
            "while checking usage."
        )

    try:
        body = resp.json()
    except ValueError as exc:
        raise NeonApiError(
            f"Neon API returned a non-JSON response for project {project_id!r}."
        ) from exc

    project = body.get("project", body) if isinstance(body, dict) else None
    used = project.get("compute_time_seconds") if isinstance(project, dict) else None
    # The quota ceiling lives at project.settings.quota, NOT project.quota —
    # confirmed against Neon's actual API reference (their ProjectQuota
    # schema sits under ProjectSettings). Reading it one level too shallow
    # meant quota_obj was always None against the real API, so every single
    # poll raised here and usage never populated in production even though
    # `used` above was being read correctly all along.
    project_settings = project.get("settings") if isinstance(project, dict) else None
    quota_obj = (
        project_settings.get("quota") if isinstance(project_settings, dict) else None
    )
    quota = (
        quota_obj.get("compute_time_seconds") if isinstance(quota_obj, dict) else None
    )

    if (
        not isinstance(used, int | float)
        or not isinstance(quota, int | float)
        or quota <= 0
    ):
        raise NeonApiError(
            f"Unexpected Neon API response shape for project {project_id!r} — "
            "missing or invalid compute_time_seconds/settings.quota.compute_time_seconds."
        )
    return used / quota
