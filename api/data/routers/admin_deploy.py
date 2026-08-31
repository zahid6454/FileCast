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
import base64
import secrets
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException
from log import get_logger
from nacl import encoding as nacl_encoding
from nacl import public as nacl_public

from data.config import settings
from data.node_registry import NoActiveNodeError, get_active_node, get_node
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
    client: httpx.AsyncClient,
    deploy_id: str,
    dispatched_at: datetime,
    workflow: str | None = None,
):
    """Poll ``workflow``'s (default: the deploy workflow) ``workflow_dispatch``
    runs for the one whose run-name carries ``deploy_id``; fall back to the
    newest run *started by this dispatch*. Returns the id or ``None`` (the
    dispatch already succeeded — a ``None`` just means the panel can't poll,
    never that nothing deployed/seeded). Bounded attempts ⇒ never hangs (R2).

    Shared by both the deploy and seed-tools flows (Admin-Tool-Sync-Plan.md
    D6) — only the workflow file differs, so it's a parameter rather than a
    second ~50-line copy of this function."""
    runs_url = (
        f"{_repo_base()}/actions/workflows/{workflow or settings.github_workflow}/runs"
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


# --------------------------------------------------------------------------- #
# Active-node secret sync (NEON_FAILOVER_PLAN.md Phase D gap, PR #153) — keep
# DATABASE_URL/DATABASE_URL_WRITE pointed at whichever Neon node is actually
# active, right before dispatching a workflow that reads one of them.
# --------------------------------------------------------------------------- #
#
# deploy.yml (build.py) and seed-tools.yml (seed.py) both run on GitHub-hosted
# runners with no path to production's Redis (deliberately not exposed
# publicly — docker-compose.prod.yml), so neither script's own
# data.db.sync_session() can resolve the active node the way every real
# request does; it silently falls back to whatever these two GitHub secrets
# hold. Those were set once, before Phase D existed, and never move on their
# own: the Phase D rehearsal switched production to a new node and these two
# secrets kept pointing at the old, now-idle one, so "Publish"/"Sync Tools"
# kept reading from and writing to it no matter how many times an admin
# re-ran them. Resolving the SAME active node get_active_node() resolves
# everywhere else and rotating both secrets to it right before every
# dispatch — rather than a one-time manual fix — is what keeps this correct
# across every future switch, not just the current one.
#
# Requires the fine-grained PAT (DEVELOPMENT.md) to also carry this repo's
# "Secrets: Read and write" permission, in addition to the "Actions: read/
# write" it already has for dispatching workflows — without it, every
# dispatch fails loud (502) once a node has ever been registered, rather than
# silently reproducing the staleness bug this exists to close.


async def _fetch_repo_public_key(client: httpx.AsyncClient) -> tuple[str, str]:
    """GET the repo's Actions public key. GitHub's Secrets API requires every
    secret value to be libsodium sealed-box-encrypted against it before the
    PUT below — the same scheme GitHub's own API docs use PyNaCl for."""
    resp = await client.get(
        f"{_repo_base()}/actions/secrets/public-key", headers=_gh_headers()
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"could not fetch the repo's Actions public key ({resp.status_code})"
        )
    try:
        body = resp.json()
        return body["key_id"], body["key"]
    except (ValueError, KeyError, TypeError) as exc:
        raise RuntimeError("repo public key response was malformed") from exc


def _seal_for_github(public_key_b64: str, plaintext: str) -> str:
    """Encrypt ``plaintext`` for a GitHub secrets PUT — base64 libsodium
    sealed box, exactly the scheme GitHub's API requires."""
    public_key = nacl_public.PublicKey(
        public_key_b64.encode("utf-8"), nacl_encoding.Base64Encoder()
    )
    sealed = nacl_public.SealedBox(public_key).encrypt(plaintext.encode("utf-8"))
    return base64.b64encode(sealed).decode("utf-8")


async def _update_github_secret(
    client: httpx.AsyncClient, name: str, value: str
) -> None:
    key_id, public_key_b64 = await _fetch_repo_public_key(client)
    resp = await client.put(
        f"{_repo_base()}/actions/secrets/{name}",
        headers=_gh_headers(),
        json={
            "encrypted_value": _seal_for_github(public_key_b64, value),
            "key_id": key_id,
        },
    )
    # GitHub returns 201 on first creation, 204 on every update thereafter.
    if resp.status_code not in (201, 204):
        raise RuntimeError(f"could not update the {name} secret ({resp.status_code})")


async def _resolve_active_connection_string() -> str | None:
    """The active node's connection string, or ``None`` when there is no
    dynamic node registered yet (pre-Bootstrap) — in that case
    DATABASE_URL/DATABASE_URL_WRITE already hold the one-and-only static
    value and don't need rotating."""
    try:
        node_id = await get_active_node()
    except NoActiveNodeError:
        return None
    try:
        node = await get_node(node_id)
    except Exception as exc:  # noqa: BLE001 — a Redis hiccup here must become
        # a clear, actionable RuntimeError (caught by the callers below), not
        # escape uncaught — silently proceeding with a stale secret would
        # reproduce the exact bug this whole mechanism exists to close.
        raise RuntimeError(
            f"registry lookup for active node_id={node_id!r} failed: {exc}"
        ) from exc
    if node is None:
        raise RuntimeError(f"active node_id={node_id!r} has no registry record")
    return node.connection_string


async def _sync_active_db_secret(client: httpx.AsyncClient, secret_name: str) -> None:
    connection_string = await _resolve_active_connection_string()
    if connection_string is None:
        return
    await _update_github_secret(client, secret_name, connection_string)


@router.post("/deploy")
async def trigger_deploy(admin=Depends(require_admin)):
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
            # DATABASE_URL is deploy.yml's read-only build overlay source
            # (build.py) — must be fresh before dispatch, not just at some
            # earlier switch time an admin may not have re-triggered a deploy
            # since.
            await _sync_active_db_secret(client, "DATABASE_URL")
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
    except RuntimeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not sync the active database target before deploying: {exc}",
        ) from exc
    logger.info(
        "Deploy triggered by %s",
        admin.email,
        extra={
            "data": {
                "event": "admin_deploy_trigger",
                "actor": admin.email,
                "deploy_id": deploy_id,
                "run_id": run_id,
            }
        },
    )
    # run_id may be str|int|None depending on GitHub; app.js only needs it present
    # and truthy to poll. Return it as-is.
    return {"deploy_id": deploy_id, "run_id": run_id, "status": "queued"}


async def _fetch_run_status(
    run_id: str, *, unreachable_error: str, log_prefix: str
) -> dict:
    """GET a run's status/conclusion/html_url from GitHub. Shared by
    ``deploy_status`` and ``seed_status`` (Admin-Tool-Sync-Plan.md D6) — same
    reasoning as ``_resolve_run_id``'s ``workflow`` parameter: two copies of
    this error handling is two places for a future fix to land in only one.

    Same bug class _runs_from() exists for, one endpoint down: a bare
    .json() on an unparseable 200 raises ValueError → an opaque 500, and a
    body that parses to a non-object then raises AttributeError on .get.
    Lower stakes than the dispatch path — the frontend's .catch absorbs it
    and retries — but a 502 naming the cause beats a 500 naming nothing.
    ``log_prefix`` keeps the two callers' log events distinguishable
    (``deploy_status_bad_json`` vs. ``seed_status_bad_json``, etc.)."""
    url = f"{_repo_base()}/actions/runs/{run_id}"
    try:
        async with _make_client() as client:
            resp = await client.get(url, headers=_gh_headers())
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=unreachable_error) from exc
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502, detail=f"GitHub status failed ({resp.status_code})."
        )
    try:
        data = resp.json()
    except ValueError as exc:
        logger.warning(
            "%s status returned an unparseable body",
            log_prefix,
            extra={
                "data": {"event": f"{log_prefix}_status_bad_json", "run_id": run_id}
            },
        )
        raise HTTPException(
            status_code=502, detail="GitHub returned an unreadable status body."
        ) from exc
    if not isinstance(data, dict):
        logger.warning(
            "%s status body is %s, expected an object",
            log_prefix,
            type(data).__name__,
            extra={
                "data": {"event": f"{log_prefix}_status_bad_shape", "run_id": run_id}
            },
        )
        raise HTTPException(
            status_code=502, detail="GitHub returned an unexpected status body."
        )
    # Return GitHub's RAW status — the frontend matches 'completed'/'success'
    # (§5.3a), for both the deploy banner and the Sync Tools button.
    return {
        "status": data.get("status"),
        "conclusion": data.get("conclusion"),
        "html_url": data.get("html_url"),
    }


@router.get("/deploy/{run_id}")
async def deploy_status(run_id: str, _admin=Depends(require_admin)):
    _require_configured()
    return await _fetch_run_status(
        run_id,
        unreachable_error="Could not reach GitHub for deploy status.",
        log_prefix="deploy",
    )


# --------------------------------------------------------------------------- #
# Sync Tools (Admin-Tool-Sync-Plan.md) — a close sibling of the deploy flow
# above (D6): dispatch seed-tools.yml, resolve its run id, poll to a terminal
# state. seed.py runs unmodified in that workflow, writing straight to
# Postgres — this API is never in that write path.
# --------------------------------------------------------------------------- #


@router.post("/seed-tools")
async def trigger_seed(admin=Depends(require_admin)):
    _require_configured()
    seed_id = secrets.token_hex(8)
    dispatch_url = (
        f"{_repo_base()}/actions/workflows/{settings.github_seed_workflow}/dispatches"
    )
    payload = {"ref": DISPATCH_REF, "inputs": {"seed_id": seed_id}}
    # Stamped BEFORE the POST, same reasoning as trigger_deploy: any run
    # created after this instant may be ours, anything older certainly is not.
    dispatched_at = datetime.now(UTC)
    try:
        async with _make_client() as client:
            # DATABASE_URL_WRITE is seed-tools.yml's write-capable target
            # (seed.py) — same freshness requirement as trigger_deploy's
            # DATABASE_URL sync above.
            await _sync_active_db_secret(client, "DATABASE_URL_WRITE")
            resp = await client.post(dispatch_url, headers=_gh_headers(), json=payload)
            # workflow_dispatch → 204 No Content on success.
            if resp.status_code != 204:
                raise HTTPException(
                    status_code=502,
                    detail=f"GitHub dispatch failed ({resp.status_code}).",
                )
            run_id = await _resolve_run_id(
                client, seed_id, dispatched_at, workflow=settings.github_seed_workflow
            )
    except httpx.HTTPError as exc:
        # Network/timeout to GitHub — a real, transient failure (NOT 501).
        raise HTTPException(
            status_code=502, detail="Could not reach GitHub to start the sync."
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not sync the active database target before seeding: {exc}",
        ) from exc
    logger.info(
        "Tool sync triggered by %s",
        admin.email,
        extra={
            "data": {
                "event": "admin_seed_trigger",
                "actor": admin.email,
                "seed_id": seed_id,
                "run_id": run_id,
            }
        },
    )
    return {"seed_id": seed_id, "run_id": run_id, "status": "queued"}


@router.get("/seed-tools/{run_id}")
async def seed_status(run_id: str, _admin=Depends(require_admin)):
    _require_configured()
    return await _fetch_run_status(
        run_id,
        unreachable_error="Could not reach GitHub for sync status.",
        log_prefix="seed",
    )
