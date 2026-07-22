"""Admin rebuild/deploy — Phase 7 (the real round-trip).

The admin panel's Save flow POSTs ``/admin/deploy`` and then polls
``/admin/deploy/{run_id}``. This dispatches the ``deploy.yml`` workflow via the
GitHub REST API using a server-side PAT (held ONLY in the backend ``.env`` —
never a GitHub secret, never in a response; D7/P18).

🔴 **Never return 501 for a real failure.** ``static/js/admin/api.js`` special-
cases 501 into a ``{ notImplemented: true }`` sentinel and *never rejects*, so a
501 from (say) a missing PAT would render the reassuring "pending rebuild" banner
while nothing was dispatched. Genuine failures use **500/502** so the panel shows
a real error (§5.3a).

**Run-id resolution (R2).** ``workflow_dispatch`` returns ``204 No Content`` with
no run id. ``deploy.yml`` sets ``run-name`` to include the unique ``deploy_id`` we
send, so we poll the workflow's runs list and match the run carrying it (falling
back to the newest ``workflow_dispatch`` run). The POST reply key MUST be
``run_id`` (snake_case) or ``app.js`` never starts polling (§5.3a).
"""

import asyncio
import secrets

import httpx
from fastapi import APIRouter, Depends, HTTPException

from data.config import settings
from data.security import require_admin

router = APIRouter(prefix="/api/v1/admin", tags=["admin-deploy"])

GITHUB_API = "https://api.github.com"
# This repo's default branch. ``main`` would 422 against a non-existent branch and
# break the whole round-trip; a wrong branch here publishes a preview that looks
# like success (§8).
DISPATCH_REF = "master"
DEPLOY_TIMEOUT = 15.0  # seconds — bounded so a GitHub hang can't wedge a worker

# Run-id resolution polling. Kept as module globals so tests can shrink the delay.
_RUN_RESOLVE_ATTEMPTS = 6
_RUN_RESOLVE_DELAY = 2.0


def _make_client() -> httpx.AsyncClient:
    """The httpx client seam — tests patch this to inject a fake (never call the
    real GitHub API)."""
    return httpx.AsyncClient(timeout=DEPLOY_TIMEOUT)


def _gh_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.github_pat}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _require_configured() -> None:
    # A missing PAT is a genuine misconfiguration → a REAL error, never 501.
    if not settings.github_pat:
        raise HTTPException(
            status_code=500, detail="Deploy is not configured (missing GITHUB_PAT)."
        )


def _repo_base() -> str:
    return f"{GITHUB_API}/repos/{settings.github_owner}/{settings.github_repo}"


async def _resolve_run_id(client: httpx.AsyncClient, deploy_id: str):
    """Poll the workflow's ``workflow_dispatch`` runs for the one whose run-name
    carries ``deploy_id``; fall back to the newest run. Returns the id or ``None``
    (the dispatch already succeeded — a ``None`` just means the panel can't poll,
    never that nothing deployed). Bounded attempts ⇒ never hangs (R2)."""
    runs_url = (
        f"{_repo_base()}/actions/workflows/{settings.github_workflow}/runs"
        "?event=workflow_dispatch&per_page=30"
    )
    # Best-effort: this runs AFTER a successful 204 dispatch, so a transient error
    # here (network blip / rate-limit / non-200) must NOT turn a successful deploy
    # into a reported failure — swallow it as a failed attempt and degrade to the
    # newest run or None.
    newest = None
    for attempt in range(_RUN_RESOLVE_ATTEMPTS):
        try:
            resp = await client.get(runs_url, headers=_gh_headers())
        except httpx.HTTPError:
            resp = None  # transient — dispatch already succeeded; keep trying
        if resp is not None and resp.status_code == 200:
            runs = resp.json().get("workflow_runs", []) or []
            for run in runs:
                if newest is None:
                    newest = run.get("id")
                name = (run.get("name") or "") + " " + (run.get("display_title") or "")
                if deploy_id in name:
                    return run.get("id")
        if attempt < _RUN_RESOLVE_ATTEMPTS - 1:
            await asyncio.sleep(_RUN_RESOLVE_DELAY)
    return newest


@router.post("/deploy")
async def trigger_deploy(_admin=Depends(require_admin)):
    _require_configured()
    deploy_id = secrets.token_hex(8)
    dispatch_url = (
        f"{_repo_base()}/actions/workflows/{settings.github_workflow}/dispatches"
    )
    payload = {"ref": DISPATCH_REF, "inputs": {"deploy_id": deploy_id}}
    try:
        async with _make_client() as client:
            resp = await client.post(dispatch_url, headers=_gh_headers(), json=payload)
            # workflow_dispatch → 204 No Content on success.
            if resp.status_code != 204:
                raise HTTPException(
                    status_code=502,
                    detail=f"GitHub dispatch failed ({resp.status_code}).",
                )
            run_id = await _resolve_run_id(client, deploy_id)
    except httpx.HTTPError as exc:
        # Network/timeout to GitHub — a real, transient failure (NOT 501).
        raise HTTPException(
            status_code=502, detail="Could not reach GitHub to start the deploy."
        ) from exc
    # run_id may be str|int|None depending on GitHub; app.js only needs it present
    # and truthy to poll. Return it as-is.
    return {"deploy_id": deploy_id, "run_id": run_id, "status": "queued"}


@router.get("/deploy/{run_id}")
async def deploy_status(run_id: str, _admin=Depends(require_admin)):
    _require_configured()
    url = f"{_repo_base()}/actions/runs/{run_id}"
    try:
        async with _make_client() as client:
            resp = await client.get(url, headers=_gh_headers())
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail="Could not reach GitHub for deploy status."
        ) from exc
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502, detail=f"GitHub status failed ({resp.status_code})."
        )
    data = resp.json()
    # Return GitHub's RAW status — app.js matches 'completed'/'success' (§5.3a).
    return {
        "status": data.get("status"),
        "conclusion": data.get("conclusion"),
        "html_url": data.get("html_url"),
    }
