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
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException
from log import get_logger

from data.config import settings
from data.security import require_admin

logger = get_logger("admin-deploy")

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
# Slack on the "created at or after our dispatch" filter, to absorb clock skew
# between this host and GitHub's. Small: the cost of being too generous is the
# original bug (binding to a run that isn't ours), and the cost of being too
# strict is only a missing terminal toast.
_RUN_CLOCK_SKEW_GRACE = 30.0


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


def _created_at(run: dict) -> datetime | None:
    """GitHub's ``created_at`` as an aware datetime, or ``None`` if it is absent
    or unparseable. Never raises — a malformed field must not fail a deploy that
    already succeeded."""
    raw = run.get("created_at")
    if not isinstance(raw, str):
        return None
    try:
        # GitHub emits "...Z"; fromisoformat only learned Z in 3.11.
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    # An offset-NAIVE timestamp parses fine and then raises TypeError on the
    # first comparison against an aware `floor`. That exception would escape
    # _resolve_run_id — which runs AFTER a successful 204 — and turn a deploy
    # that already started into a 500. Unusable, same as unparseable.
    return parsed if parsed.tzinfo is not None else None


def _runs_from(resp) -> list[dict]:
    """The ``workflow_runs`` array of a runs-list response, as run objects only.

    Paranoid about shape because of WHERE the caller runs — after a successful
    204 dispatch, where ANY escaping exception turns a deploy that already
    started into a reported failure. That is the one thing this module must
    never do, so an unexpected body degrades to "no candidates" instead.

    Every layer can be wrong independently, and each raised a different
    exception before this existed: a body that isn't an object (``.get`` on a
    list/str → AttributeError), a ``workflow_runs`` that isn't a list (iterating
    a str yields characters → AttributeError; an int isn't iterable →
    TypeError), and entries that aren't run objects (``.get`` on an int →
    AttributeError). None of them are actionable — we cannot resolve a run id
    from them — but none are worth a 500 either.
    """
    # Every rejection below is logged. Degrading silently is what makes this
    # undiagnosable in production: the only symptom of a broken runs query is
    # "the admin stopped getting a terminal toast", with nothing to separate
    # rate-limiting from a revoked PAT scope from a GitHub schema change.
    if resp.status_code != 200:
        logger.warning(
            "runs query returned %s; cannot resolve a run id",
            resp.status_code,
            extra={"data": {"event": "deploy_runs_http", "status": resp.status_code}},
        )
        return []
    try:
        body = resp.json()
    except ValueError:  # JSONDecodeError is a subclass
        logger.warning(
            "runs query returned an unparseable body",
            extra={"data": {"event": "deploy_runs_bad_json"}},
        )
        return []
    if not isinstance(body, dict):
        logger.warning(
            "runs body is %s, expected an object",
            type(body).__name__,
            extra={
                "data": {"event": "deploy_runs_bad_shape", "got": type(body).__name__}
            },
        )
        return []
    runs = body.get("workflow_runs")
    if not isinstance(runs, list):
        logger.warning(
            "workflow_runs is %s, expected a list",
            type(runs).__name__,
            extra={
                "data": {"event": "deploy_runs_bad_shape", "got": type(runs).__name__}
            },
        )
        return []
    objects = [r for r in runs if isinstance(r, dict)]
    if len(objects) != len(runs):
        logger.warning(
            "dropped %s non-object entries from workflow_runs",
            len(runs) - len(objects),
            extra={"data": {"event": "deploy_runs_bad_entries"}},
        )
    return objects


async def _resolve_run_id(
    client: httpx.AsyncClient, deploy_id: str, dispatched_at: datetime
):
    """Poll the workflow's ``workflow_dispatch`` runs for the one whose run-name
    carries ``deploy_id``; fall back to the newest run *started by this dispatch*.
    Returns the id or ``None`` (the dispatch already succeeded — a ``None`` just
    means the panel can't poll, never that nothing deployed). Bounded attempts ⇒
    never hangs (R2)."""
    runs_url = (
        f"{_repo_base()}/actions/workflows/{settings.github_workflow}/runs"
        "?event=workflow_dispatch&per_page=30"
    )
    # Best-effort: this runs AFTER a successful 204 dispatch, so a transient error
    # here (network blip / rate-limit / non-200) must NOT turn a successful deploy
    # into a reported failure — swallow it as a failed attempt and degrade to the
    # newest eligible run or None.
    #
    # "Eligible" is the fix: the fallback used to take the newest run in the list
    # unconditionally, so if this deploy's run hadn't surfaced yet (two Saves
    # queued in the build window) the panel could poll an UNRELATED run and
    # report ITS conclusion — a red "Publish failed" for a deploy that was fine,
    # or worse a green "Published" for one that wasn't. Only runs created at or
    # after the dispatch can be ours, so older ones are excluded. A run with no
    # usable created_at is not eligible either: unverifiable is not the same as
    # recent, and returning None only costs the terminal toast.
    floor = dispatched_at - timedelta(seconds=_RUN_CLOCK_SKEW_GRACE)
    newest = None
    for attempt in range(_RUN_RESOLVE_ATTEMPTS):
        # Both the GET and the body are best-effort: a network error here is
        # swallowed as a failed attempt and never bubbled up to fail an
        # already-succeeded dispatch. Body shape is _runs_from's job.
        try:
            runs = _runs_from(await client.get(runs_url, headers=_gh_headers()))
        except httpx.HTTPError as exc:
            logger.warning(
                "runs query failed (%s); retrying if attempts remain",
                exc.__class__.__name__,
                extra={"data": {"event": "deploy_runs_network", "attempt": attempt}},
            )
            runs = []
        for run in runs:
            created = _created_at(run)
            if newest is None and created is not None and created >= floor:
                newest = run.get("id")
            # f-string rather than concatenation: these are attacker-irrelevant
            # but type-unstable, and a non-string `name` used to raise TypeError
            # on `int + str`. Formatting coerces whatever arrives.
            name = f"{run.get('name') or ''} {run.get('display_title') or ''}"
            if deploy_id in name:
                # An exact deploy_id match is authoritative — it identifies OUR
                # run regardless of what its timestamp says.
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
    # Stamped BEFORE the POST: any run created after this instant may be ours,
    # anything older certainly is not. See _resolve_run_id.
    dispatched_at = datetime.now(UTC)
    try:
        async with _make_client() as client:
            resp = await client.post(dispatch_url, headers=_gh_headers(), json=payload)
            # workflow_dispatch → 204 No Content on success.
            if resp.status_code != 204:
                raise HTTPException(
                    status_code=502,
                    detail=f"GitHub dispatch failed ({resp.status_code}).",
                )
            run_id = await _resolve_run_id(client, deploy_id, dispatched_at)
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
    # Same bug class _runs_from() exists for, one endpoint down: a bare .json()
    # on an unparseable 200 raises ValueError → an opaque 500, and a body that
    # parses to a non-object then raises AttributeError on .get. Lower stakes
    # than the dispatch path — app.js's .catch absorbs it and now retries — but
    # a 502 naming the cause beats a 500 naming nothing.
    try:
        data = resp.json()
    except ValueError as exc:
        logger.warning(
            "deploy status returned an unparseable body",
            extra={"data": {"event": "deploy_status_bad_json", "run_id": run_id}},
        )
        raise HTTPException(
            status_code=502, detail="GitHub returned an unreadable status body."
        ) from exc
    if not isinstance(data, dict):
        logger.warning(
            "deploy status body is %s, expected an object",
            type(data).__name__,
            extra={"data": {"event": "deploy_status_bad_shape", "run_id": run_id}},
        )
        raise HTTPException(
            status_code=502, detail="GitHub returned an unexpected status body."
        )
    # Return GitHub's RAW status — app.js matches 'completed'/'success' (§5.3a).
    return {
        "status": data.get("status"),
        "conclusion": data.get("conclusion"),
        "html_url": data.get("html_url"),
    }
