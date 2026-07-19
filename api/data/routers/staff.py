"""Staff access & RBAC — grant/revoke admin (Phase 5.5 §5).

All routes are ``require_admin`` under ``/api/v1/admin``. ``users.role`` stays the
single live authority (D6); ``staff_grants`` is only a pending-invite + audit table.
Email is the shared identity key and is normalized to lowercase everywhere; ``users``
lookups are case-insensitive so a mixed-case stored row is never missed.
"""

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from data.config import settings
from data.db import get_session
from data.models import StaffGrant, User
from data.routers._serialize import user_dict
from data.security import require_admin

router = APIRouter(prefix="/api/v1/admin", tags=["staff"])

# Deliberately permissive: a single ``@`` with non-space local/domain parts and a
# dotted domain. Real deliverability is Google's problem (only granted emails that
# actually sign in with Google ever become admin) — this just rejects obvious junk.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class StaffGrantBody(BaseModel):
    email: str


def _normalize_email(raw: str) -> str:
    email = (raw or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Malformed email")
    return email


async def _admin_users(db: AsyncSession) -> list[User]:
    return list(
        (
            await db.execute(
                select(User)
                .where(User.role == "admin")
                .order_by(User.created_at.desc())
            )
        )
        .scalars()
        .all()
    )


@router.get("/staff")
async def list_staff(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """Current admins, unconsumed invites, and config-owner emails (§5)."""
    admins = await _admin_users(db)

    # Pending (unconsumed) grants, with the granter's email resolved for display.
    granter = User.__table__.alias("granter")
    rows = (
        await db.execute(
            select(
                StaffGrant.email,
                StaffGrant.granted_at,
                granter.c.email,
            )
            .select_from(
                StaffGrant.__table__.outerjoin(
                    granter, StaffGrant.granted_by == granter.c.id
                )
            )
            .where(StaffGrant.consumed_at.is_(None))
            .order_by(StaffGrant.granted_at.desc())
        )
    ).all()
    # An email that became a config owner AFTER being invited keeps an unconsumed
    # grant forever (the owner branch of apply_staff_role short-circuits before
    # consuming it). Owners are always admin, so a "pending invite" for one is
    # meaningless noise — hide it; they show in `owners` instead.
    owner_set = settings.initial_admin_email_set
    pending = [
        {
            "email": email,
            "granted_at": granted_at.isoformat() if granted_at else None,
            "granted_by_email": granted_by_email,
        }
        for email, granted_at, granted_by_email in rows
        if email not in owner_set
    ]

    return {
        "admins": [user_dict(u) for u in admins],
        "pending": pending,
        "owners": sorted(settings.initial_admin_email_set),
    }


@router.post("/staff")
async def grant_staff(
    body: StaffGrantBody,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """Grant admin to ``email`` — immediate if the user exists, else a pending
    invite consumed on their first Google login. Idempotent; owner emails no-op."""
    email = _normalize_email(body.email)

    # Config owners are already force-admin on every login; creating a grant would
    # leave a permanently-pending row (the owner branch of apply_staff_role
    # short-circuits before consuming a grant). No-op (§2, edge 8).
    if email in settings.initial_admin_email_set:
        return {"status": "owner", "email": email}

    user = (
        await db.execute(select(User).where(func.lower(User.email) == email))
    ).scalar_one_or_none()
    if user is not None:
        user.role = "admin"
        await db.commit()
        return {"status": "promoted", "email": email}

    # Upsert a pending grant (idempotent on the unique email). Refresh the granter
    # so the audit trail reflects the most recent inviter.
    await db.execute(
        pg_insert(StaffGrant)
        .values(email=email, role="admin", granted_by=admin.id)
        .on_conflict_do_update(
            index_elements=[StaffGrant.email],
            set_={"granted_by": admin.id},
            where=StaffGrant.consumed_at.is_(None),
        )
    )
    await db.commit()
    return {"status": "pending", "email": email}


@router.delete("/staff/{email}")
async def revoke_staff(
    email: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """Revoke admin: demote any existing user + delete the grant row. Guards:
    403 for config owners, 409 for self, 409 for the last admin (§2)."""
    email = _normalize_email(email)

    if email in settings.initial_admin_email_set:
        raise HTTPException(status_code=403, detail="Config owners cannot be revoked")
    if email == admin.email.lower():
        raise HTTPException(status_code=409, detail="You cannot revoke your own admin")

    user = (
        await db.execute(select(User).where(func.lower(User.email) == email))
    ).scalar_one_or_none()

    # Defensive last-admin guard. Unreachable past the self-guard above (any
    # non-self admin target implies the caller is a second admin), but cheap.
    if user is not None and user.role == "admin":
        admin_count = (
            await db.execute(select(func.count()).where(User.role == "admin"))
        ).scalar_one()
        if admin_count <= 1:
            raise HTTPException(status_code=409, detail="Cannot remove the last admin")

    if user is not None:
        user.role = "user"
    # Unique email → at most one row; delete unconditionally so a stale consumed
    # row can't confuse a later re-invite (§2).
    await db.execute(delete(StaffGrant).where(StaffGrant.email == email))
    await db.commit()
    return {"status": "revoked", "email": email}
