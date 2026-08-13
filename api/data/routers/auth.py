"""Auth routes — dev-login (stub), /me, logout, Google OAuth (§8, §5).

Google OAuth (``/auth/google`` + ``/callback``) reuses the same
``create_session()`` seam as dev-login; ``dev-login``/``/me``/``/logout`` are
unchanged. When the Google client is unconfigured the OAuth routes return 503,
so a plain local checkout (dev-login only) still works (spec §1, D-locked).
"""

import secrets

from authlib.integrations.httpx_client import AsyncOAuth2Client
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from data.config import settings
from data.db import get_session
from data.models import UserFavorite, UserPreference
from data.routers._serialize import user_dict
from data.security import (
    apply_staff_role,
    create_session,
    destroy_session,
    get_or_create_dev_user,
    require_user,
    upsert_google_user,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# Google's stable OAuth 2.0 / OpenID Connect endpoints (per the discovery doc
# https://accounts.google.com/.well-known/openid-configuration). Identity is read
# from the userinfo endpoint with the access token — no id_token nonce — so no
# Starlette SessionMiddleware is needed (spec §5.2).
GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo"
GOOGLE_SCOPE = "openid email profile"
OAUTH_NEXT_COOKIE_NAME = "fc_oauth_next"


def _safe_next(raw: str | None) -> str:
    """Accept only a same-origin path (starts with a single ``/``); else root.
    Blocks ``//host`` and absolute URLs so ``next`` can't become an open redirect."""
    if raw and raw.startswith("/") and not raw.startswith("//"):
        return raw
    return "/"


def _email_verified(userinfo: dict) -> bool:
    """Google returns ``email_verified`` (bool, occasionally the string 'true').
    Never trust an unverified email — it could be one the account doesn't own."""
    v = userinfo.get("email_verified")
    return v is True or (isinstance(v, str) and v.lower() == "true")


def _oauth_client(state: str | None = None) -> AsyncOAuth2Client:
    return AsyncOAuth2Client(
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        redirect_uri=settings.google_redirect_uri,
        scope=GOOGLE_SCOPE,
        state=state,
    )


def _set_oauth_cookie(response: Response, name: str, value: str) -> None:
    response.set_cookie(
        key=name,
        value=value,
        max_age=settings.oauth_state_ttl_seconds,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        domain=settings.cookie_domain,
        path="/",
    )


def _clear_oauth_cookies(response: Response) -> None:
    for name in (settings.oauth_state_cookie_name, OAUTH_NEXT_COOKIE_NAME):
        response.delete_cookie(key=name, domain=settings.cookie_domain, path="/")


class DevLoginBody(BaseModel):
    role: str = "user"


async def _favorites_for(db: AsyncSession, user_id: str) -> list[str]:
    rows = (
        (
            await db.execute(
                select(UserFavorite.tool_id).where(UserFavorite.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def _favorites_and_preferences_for(
    db: AsyncSession, user_id: str
) -> tuple[list[str], dict]:
    """Favorites + preferences in one round trip via two independent scalar
    subqueries — an ``AsyncSession`` can't run two ``execute()`` calls
    concurrently, so this is the safe way to avoid paying two sequential queries
    on every ``/me`` call."""
    favorites_subq = (
        select(func.array_agg(UserFavorite.tool_id))
        .where(UserFavorite.user_id == user_id)
        .scalar_subquery()
    )
    preferences_subq = (
        select(UserPreference.preferences)
        .where(UserPreference.user_id == user_id)
        .scalar_subquery()
    )
    favorites, preferences = (
        await db.execute(select(favorites_subq, preferences_subq))
    ).one()
    return (favorites or []), (preferences or {})


@router.post("/dev-login")
async def dev_login(
    body: DevLoginBody,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
):
    # Gated: 404 unless running in development (§8).
    if settings.environment != "development":
        raise HTTPException(status_code=404, detail="Not found")
    if body.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="role must be 'admin' or 'user'")

    user = await get_or_create_dev_user(db, body.role)
    await create_session(db, user, response, request)
    await db.commit()
    favorites = await _favorites_for(db, user.id)
    return {"user": user_dict(user, favorites)}


@router.get("/me")
async def me(
    response: Response,
    user=Depends(require_user),
    db: AsyncSession = Depends(get_session),
):
    favorites, preferences = await _favorites_and_preferences_for(db, user.id)
    # Fetched on every page (nav's account menu) plus every /account/ load, with
    # nothing else to invalidate it on — a short private cache absorbs repeat
    # navigations within a few seconds without meaningfully hiding a fresh write.
    # `Vary: Cookie` is required alongside `private`: browser HTTP caches key on
    # URL, not on the Cookie header, so without it a cached response could be
    # replayed to a different session hitting this same URL.
    response.headers["Cache-Control"] = "private, max-age=5"
    response.headers["Vary"] = "Cookie"
    return {"user": user_dict(user, favorites, preferences)}


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
):
    await destroy_session(db, request, response)
    await db.commit()
    return {"ok": True}


# --- Google OAuth (Authorization-Code flow, server-side token exchange) ---


@router.get("/google")
async def google_start(request: Request, next: str = "/"):
    """Begin sign-in: set a CSRF ``state`` cookie and 302 to Google's consent."""
    if not settings.google_oauth_configured:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")

    # Use the state Authlib actually embeds in the URL (the 2nd return value) —
    # it generates its own and ignores a state passed to the constructor, so the
    # cookie MUST store this exact value or the callback compare always fails.
    async with _oauth_client() as client:
        auth_url, state = client.create_authorization_url(
            GOOGLE_AUTH_ENDPOINT, prompt="select_account"
        )

    response = RedirectResponse(auth_url, status_code=302)
    _set_oauth_cookie(response, settings.oauth_state_cookie_name, state)
    _set_oauth_cookie(response, OAUTH_NEXT_COOKIE_NAME, _safe_next(next))
    return response


@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_session),
):
    """Finish sign-in: verify ``state``, exchange ``code`` server↔Google, upsert the
    user, and create the same session as dev-login. Consent-denied / token failures
    land back on the site with ``?signin=failed`` (a benign, surfaceable hint)."""
    if not settings.google_oauth_configured:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")

    cookie_state = request.cookies.get(settings.oauth_state_cookie_name)
    next_path = _safe_next(request.cookies.get(OAUTH_NEXT_COOKIE_NAME))

    # CSRF guard: the ?state must equal our httpOnly cookie. Absent/mismatch → 400.
    if not state or not cookie_state or not secrets.compare_digest(state, cookie_state):
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    if error or not code:
        failed = RedirectResponse(
            settings.site_origin + "/?signin=failed", status_code=302
        )
        _clear_oauth_cookies(failed)
        return failed

    try:
        async with _oauth_client(state=state) as client:
            await client.fetch_token(
                GOOGLE_TOKEN_ENDPOINT,
                code=code,
                grant_type="authorization_code",
            )
            userinfo = (await client.get(GOOGLE_USERINFO_ENDPOINT)).json()
    except Exception:
        # Any token/userinfo failure degrades to a benign failed-signin redirect.
        failed = RedirectResponse(
            settings.site_origin + "/?signin=failed", status_code=302
        )
        _clear_oauth_cookies(failed)
        return failed

    email = userinfo.get("email")
    # Require a verified email (Google best practice): an unverified address could
    # be one the signer doesn't actually control → account takeover / squatting.
    if not email or not _email_verified(userinfo):
        failed = RedirectResponse(
            settings.site_origin + "/?signin=failed", status_code=302
        )
        _clear_oauth_cookies(failed)
        return failed

    user = await upsert_google_user(
        db, email, userinfo.get("name"), userinfo.get("picture")
    )
    # Phase 5.5: resolve admin access (config owner / pending grant) before the
    # session is created — never demotes (§2).
    await apply_staff_role(db, user)
    response = RedirectResponse(settings.site_origin + next_path, status_code=302)
    await create_session(db, user, response, request)
    await db.commit()
    _clear_oauth_cookies(response)
    return response
