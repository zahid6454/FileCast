"""Thin client for Neon's console API (NEON_FAILOVER_PLAN.md §7.3/§7.8).

Phase D added one call: confirming, during node provisioning, that the
account-level API key can actually see a freshly-registered project (§7.8
step 4) — this catches a mistyped ``neon_project_id`` before it silently
breaks §7.3's usage polling. Phase E adds the second: ``get_project_usage()``,
which parses the same endpoint's response body for the ``compute_time_seconds``
field the usage-poll loop needs (§7.3) — the quota ceiling is a caller-supplied
argument, not read from this response (see that function's own docstring for
why).

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


async def get_project_usage(project_id: str, quota_seconds: float) -> float:
    """Fetch a project's current-billing-period compute-usage ratio (§7.3):
    ``compute_time_seconds`` (consumed so far, from the same project-detail
    response ``verify_project_visible`` already uses — a control-plane call
    that never connects to the project's own Postgres endpoint or wakes its
    compute, module docstring) / ``quota_seconds`` — the monthly ceiling,
    which the CALLER supplies rather than this function reading it off
    Neon's response.

    An earlier revision read the ceiling from Neon's own
    ``project.quota``/``project.settings.quota`` — both real, documented
    fields (Neon's ``ProjectQuota`` schema lives under ``ProjectSettings``).
    Confirmed live in production (2026-09-01) that Neon only actually
    populates ``settings.quota`` when a project has an explicit custom quota
    override configured — neither of FileCast's Neon projects has ever had
    one, so the field is simply absent on every real poll regardless of
    which path reads it; every poll raised here no matter the fix. The
    caller (job_worker.py) now derives ``quota_seconds`` from FileCast's own
    admin-configurable ``monthly_quota_compute_hours`` setting instead —
    the only reliable source for this number.

    Raises ``NeonApiError`` on anything that makes the ratio unavailable —
    a non-200 status, a non-JSON body, a response missing
    ``compute_time_seconds``, or a non-positive ``quota_seconds`` (which
    would otherwise be a division by zero). The usage-poll loop (§7.3,
    Phase E) treats a single failed call as non-fatal by design: keep the
    last cached value, retry next cycle — never let this masquerade as a
    database-down event.
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

    if not isinstance(used, int | float):
        raise NeonApiError(
            f"Unexpected Neon API response shape for project {project_id!r} — "
            "missing or invalid compute_time_seconds."
        )
    if not isinstance(quota_seconds, int | float) or quota_seconds <= 0:
        raise NeonApiError(
            f"Invalid quota_seconds ({quota_seconds!r}) for project {project_id!r} "
            "— check the monthly_quota_compute_hours setting."
        )
    return used / quota_seconds
