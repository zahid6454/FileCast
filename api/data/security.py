"""Sessions, dev-login, cookies, and auth dependencies (§8).

The swappable seam is ``create_session(db, user, response)``: it inserts a
``Session`` row and sets both cookies. Dev-login (now) and Google OAuth (Phase 5)
call the *same* function — Phase 5 changes only *how the user is authenticated*,
nothing downstream.

Session PK is ``sha256(raw_token)``; the cookie carries the raw
``secrets.token_urlsafe(32)`` (§6 Session note).
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from data.config import settings
from data.db import async_session_factory, get_session
from data.models import Session, User

# Seeded dev users (§11) — the two dev-login identities.
DEV_USERS = {
    "admin": {"email": "admin@dev.local", "name": "Dev Admin", "role": "admin"},
    "user": {"email": "user@dev.local", "name": "Dev User", "role": "user"},
}


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cookie_max_age() -> int:
    return settings.session_ttl_days * 86400


def set_session_cookies(response: Response, raw_token: str) -> None:
    max_age = _cookie_max_age()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=raw_token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        domain=settings.cookie_domain,
        path="/",
    )
    # D10 companion cookie — non-httpOnly so anon visitors skip the /me call.
    response.set_cookie(
        key=settings.logged_in_cookie_name,
        value="1",
        max_age=max_age,
        httponly=False,
        samesite="lax",
        secure=settings.cookie_secure,
        domain=settings.cookie_domain,
        path="/",
    )


def clear_session_cookies(response: Response) -> None:
    for name in (settings.session_cookie_name, settings.logged_in_cookie_name):
        response.delete_cookie(
            key=name,
            domain=settings.cookie_domain,
            path="/",
        )


async def create_session(
    db: AsyncSession,
    user: User,
    response: Response,
    request: Request | None = None,
) -> str:
    """Insert a session row, set both cookies, return the raw token."""
    raw_token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    session = Session(
        id=hash_token(raw_token),
        user_id=user.id,
        created_at=now,
        expires_at=now + timedelta(days=settings.session_ttl_days),
        last_used_at=now,
        user_agent=(request.headers.get("user-agent") if request else None),
        ip=(request.client.host if request and request.client else None),
    )
    db.add(session)
    user.last_login_at = now
    await db.flush()
    set_session_cookies(response, raw_token)
    return raw_token


async def destroy_session(
    db: AsyncSession, request: Request, response: Response
) -> None:
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        await db.execute(delete(Session).where(Session.id == hash_token(token)))
    clear_session_cookies(response)


# --- Dependencies ---


async def current_user(
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> User | None:
    """Optional auth: return the ``User`` for a valid unexpired session, else
    ``None``. Loads the user row live so ``role`` reflects demotions (D6)."""
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        return None
    now = datetime.now(UTC)
    row = (
        await db.execute(
            select(User)
            .join(Session, Session.user_id == User.id)
            .where(Session.id == hash_token(token), Session.expires_at > now)
        )
    ).scalar_one_or_none()
    return row


async def current_user_for_convert(request: Request) -> User | None:
    """Non-raising optional auth for the ``/convert`` path (spec §6.3 / C-P5-B).

    ``converter.py`` is deliberately DB-decoupled: an anonymous request (no
    session cookie) must **never** touch the DB, and a DB/session hiccup for a
    signed-in request must **not** 500 the conversion. So this opens its own
    session only when a cookie is present and swallows any error → treat as
    anonymous. It does **not** use ``Depends(get_session)`` — a failing session
    dependency would raise before the route runs, defeating the guarantee.
    """
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        return None
    try:
        async with async_session_factory() as db:
            now = datetime.now(UTC)
            return (
                await db.execute(
                    select(User)
                    .join(Session, Session.user_id == User.id)
                    .where(Session.id == hash_token(token), Session.expires_at > now)
                )
            ).scalar_one_or_none()
    except Exception:
        return None


async def require_user(
    user: User | None = Depends(current_user),
) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


async def require_admin(
    user: User = Depends(require_user),
) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def upsert_google_user(
    db: AsyncSession,
    email: str,
    name: str | None,
    avatar_url: str | None,
) -> User:
    """Find/create the ``User`` for a Google identity (Phase 5 §5.2).

    Matched by email. First sign-in creates a ``role='user'`` row; a returning
    user has ``name``/``avatar_url`` refreshed. ``role`` is **never** changed here
    (D9 — no self-service admin); ``last_login_at`` is set by ``create_session``.
    """
    user = (
        await db.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()
    if user is None:
        user = User(email=email, name=name, avatar_url=avatar_url, role="user")
        db.add(user)
        await db.flush()
    else:
        if name:
            user.name = name
        if avatar_url:
            user.avatar_url = avatar_url
    return user


async def get_or_create_dev_user(db: AsyncSession, role: str) -> User:
    """Find/create the seeded dev user for ``role`` (dev-login only)."""
    spec = DEV_USERS.get(role)
    if spec is None:
        raise HTTPException(status_code=400, detail="Invalid role")
    user = (
        await db.execute(select(User).where(User.email == spec["email"]))
    ).scalar_one_or_none()
    if user is None:
        user = User(email=spec["email"], name=spec["name"], role=spec["role"])
        db.add(user)
        await db.flush()
    return user
