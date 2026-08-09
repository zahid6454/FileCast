"""Auth routes — dev-login (stub), /me, logout, Google OAuth (§8, §5), and
email/password auth (P4 §37).

Google OAuth (``/auth/google`` + ``/callback``) reuses the same
``create_session()`` seam as dev-login; ``dev-login``/``/me``/``/logout`` are
unchanged. When the Google client is unconfigured the OAuth routes return 503,
so a plain local checkout (dev-login only) still works (spec §1, D-locked).

Email/password (``/register``/``/login``/``/verify-email``) is a genuinely
independent second path, not a fallback bolted onto Google — there is no
account-linking UI, and the two never interact beyond sharing the ``users``
table's unique email constraint. ``/register`` creates the account, hashes the
password (``data/passwords.py`` — real Python ``bcrypt``, not a Node port),
and signs the user in immediately, same as Google does.

**Email verification is intentionally not a login gate.** The report's #37
asked for it, and the token/expiry plumbing exists (``/verify-email``, the
``email_verify_token_hash`` columns) — but nothing in this stack can actually
deliver the email: no SMTP/SendGrid/SES credentials exist anywhere in
``api/`` or the go-live plan. Blocking login on a verification step with no
way to complete it would just lock every password account out forever, which
is worse than not gating at all. The verification link is logged server-side
(``logger.info``, not returned in the API response — never hand a
still-anonymous caller a token that flips someone else's account) so an
operator can act on it by hand until a real mailer is wired in; that's the one
piece of #37 left for a follow-up session, not silently dropped.
"""

import re
import secrets
from datetime import UTC, datetime, timedelta

from authlib.integrations.httpx_client import AsyncOAuth2Client
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from log import get_logger
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from data.config import settings
from data.db import get_session
from data.models import User, UserFavorite, UserPreference
from data.passwords import (
    WeakPasswordError,
    hash_password,
    validate_password_strength,
    verify_password,
)
from data.routers._serialize import user_dict
from data.security import (
    apply_staff_role,
    create_session,
    destroy_session,
    get_or_create_dev_user,
    hash_token,
    require_user,
    upsert_google_user,
)

logger = get_logger("auth")

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

EMAIL_VERIFY_TTL_HOURS = 24
# Deliberately simple (not a full RFC 5322 parser) — this only needs to catch
# obvious garbage before it reaches the DB; the account is only ever reachable
# by whoever controls that inbox once real email delivery exists.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

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


async def _preferences_for(db: AsyncSession, user_id: str) -> dict:
    prefs = (
        await db.execute(
            select(UserPreference.preferences).where(UserPreference.user_id == user_id)
        )
    ).scalar_one_or_none()
    return prefs or {}


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
    user=Depends(require_user),
    db: AsyncSession = Depends(get_session),
):
    favorites = await _favorites_for(db, user.id)
    preferences = await _preferences_for(db, user.id)
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


# --- Email/password auth (P4 §37) ---


class RegisterBody(BaseModel):
    email: str
    password: str
    name: str | None = None


class LoginBody(BaseModel):
    email: str
    password: str


def _new_email_verify_token(user: User) -> str:
    """Generate + attach a verification token, same hash-the-token-at-rest
    shape as sessions (``security.hash_token``) — a DB read alone can't be
    replayed as a live verification link."""
    raw_token = secrets.token_urlsafe(32)
    user.email_verify_token_hash = hash_token(raw_token)
    user.email_verify_expires_at = datetime.now(UTC) + timedelta(
        hours=EMAIL_VERIFY_TTL_HOURS
    )
    return raw_token


@router.post("/register")
async def register(
    body: RegisterBody,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
):
    email = body.email.strip().lower()
    if not email or not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")

    try:
        validate_password_strength(body.password)
    except WeakPasswordError as e:
        raise HTTPException(status_code=400, detail=e.message) from e

    existing = (
        await db.execute(select(User).where(func.lower(User.email) == email))
    ).scalar_one_or_none()
    if existing is not None:
        if existing.password_hash is None:
            raise HTTPException(
                status_code=409,
                detail="This email is already registered via Google sign-in. "
                "Use 'Sign in with Google' instead.",
            )
        raise HTTPException(
            status_code=409, detail="An account with this email already exists."
        )

    user = User(
        email=email,
        name=(body.name or "").strip() or None,
        role="user",
        password_hash=hash_password(body.password),
        email_verified=False,
    )
    db.add(user)
    await db.flush()

    verify_token = _new_email_verify_token(user)
    verify_url = (
        f"{settings.site_origin.rstrip('/')}/api/v1/auth/verify-email"
        f"?token={verify_token}"
    )
    # Stand-in for real email delivery — see the module docstring. Logged, not
    # returned in the response: this endpoint is reachable while still
    # anonymous, and the token proves control of the account.
    logger.info(
        "Email verification link (no mailer configured — logging instead)",
        extra={
            "data": {
                "event": "email_verify_link",
                "user_id": user.id,
                "verify_url": verify_url,
            }
        },
    )

    await create_session(db, user, response, request)
    await db.commit()
    favorites = await _favorites_for(db, user.id)
    return {"user": user_dict(user, favorites)}


@router.post("/login")
async def login(
    body: LoginBody,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
):
    email = body.email.strip().lower()
    user = (
        await db.execute(select(User).where(func.lower(User.email) == email))
    ).scalar_one_or_none()

    # verify_password() always runs bcrypt.checkpw, even for a nonexistent
    # user or a Google-only account with no password_hash — constant-effort
    # so failure timing can't be used to enumerate which emails have accounts.
    password_hash = user.password_hash if user else None
    if not verify_password(body.password, password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    await create_session(db, user, response, request)
    await db.commit()
    favorites = await _favorites_for(db, user.id)
    return {"user": user_dict(user, favorites)}


@router.get("/verify-email")
async def verify_email(token: str, db: AsyncSession = Depends(get_session)):
    """Clicked from the (currently just logged, see module docstring)
    verification link. Redirects rather than returning JSON, same shape as the
    Google callback's benign-failure redirects, since a browser navigates here
    directly."""
    token_hash = hash_token(token)
    now = datetime.now(UTC)
    user = (
        await db.execute(
            select(User).where(
                User.email_verify_token_hash == token_hash,
                User.email_verify_expires_at > now,
            )
        )
    ).scalar_one_or_none()

    if user is None:
        return RedirectResponse(
            settings.site_origin + "/?email_verified=failed", status_code=302
        )

    user.email_verified = True
    user.email_verify_token_hash = None
    user.email_verify_expires_at = None
    await db.commit()
    return RedirectResponse(
        settings.site_origin + "/?email_verified=1", status_code=302
    )


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
