"""Site Settings routes — Phase 7.

A **singleton** row (``id == 1``) overlaying ``site-config.yaml``'s display copy
and the AdSense / GA4 / Sentry integration toggles. ``build.py`` reads it and
bakes the result into every page, so the ``PUT`` body validation here is the
**injection guard**: these values land in HTML attributes, text nodes and
``<meta>`` tags. A bad id must be rejected with **422 before** any rebuild, never
baked. Structural fields (``base_url``, categories) are deliberately not editable
here — they stay YAML-only.
"""

import re
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import SiteSetting
from data.security import require_admin

router = APIRouter(prefix="/api/v1/admin/site-settings", tags=["site-settings"])

SINGLETON_ID = 1

_PUBLISHER_RE = re.compile(r"^ca-pub-\d{16}$")
_MEASUREMENT_RE = re.compile(r"^G-[A-Z0-9]{4,}$")
_SLOT_RE = re.compile(r"^\d+$")

# Length caps — these render into <title>, the hero and <meta name=description>.
NAME_MAX = 80
TAGLINE_MAX = 160
DESCRIPTION_MAX = 300


def _blank_to_none(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v or None


class SiteSettingsBody(BaseModel):
    site_name: str
    site_tagline: str
    site_description: str
    adsense_enabled: bool = False
    adsense_publisher_id: str | None = None
    adsense_slot_leaderboard: str | None = None
    adsense_slot_in_content: str | None = None
    ga4_enabled: bool = False
    ga4_measurement_id: str | None = None
    sentry_enabled: bool = False
    sentry_dsn: str | None = None

    @field_validator("site_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("site_name must not be empty")
        if len(v) > NAME_MAX:
            raise ValueError(f"site_name must be ≤ {NAME_MAX} characters")
        return v

    @field_validator("site_tagline")
    @classmethod
    def _tagline(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("site_tagline must not be empty")
        if len(v) > TAGLINE_MAX:
            raise ValueError(f"site_tagline must be ≤ {TAGLINE_MAX} characters")
        return v

    @field_validator("site_description")
    @classmethod
    def _description(cls, v: str) -> str:
        v = v.strip()
        if len(v) > DESCRIPTION_MAX:
            raise ValueError(f"site_description must be ≤ {DESCRIPTION_MAX} characters")
        return v

    @field_validator(
        "adsense_publisher_id",
        "adsense_slot_leaderboard",
        "adsense_slot_in_content",
        "ga4_measurement_id",
        "sentry_dsn",
        mode="before",
    )
    @classmethod
    def _normalize_blank(cls, v: str | None) -> str | None:
        return _blank_to_none(v)

    @field_validator("adsense_publisher_id")
    @classmethod
    def _publisher(cls, v: str | None) -> str | None:
        if v is not None and not _PUBLISHER_RE.match(v):
            raise ValueError("adsense_publisher_id must match ca-pub-<16 digits>")
        return v

    @field_validator("adsense_slot_leaderboard", "adsense_slot_in_content")
    @classmethod
    def _slot(cls, v: str | None) -> str | None:
        if v is not None and not _SLOT_RE.match(v):
            raise ValueError("ad slot id must be numeric")
        return v

    @field_validator("ga4_measurement_id")
    @classmethod
    def _measurement(cls, v: str | None) -> str | None:
        if v is not None and not _MEASUREMENT_RE.match(v):
            raise ValueError("ga4_measurement_id must match G-XXXXXXXX")
        return v

    @field_validator("sentry_dsn")
    @classmethod
    def _dsn(cls, v: str | None) -> str | None:
        if v is not None:
            parts = urlsplit(v)
            host = parts.hostname or ""
            if parts.scheme != "https" or not (
                host == "sentry.io" or host.endswith(".sentry.io")
            ):
                raise ValueError("sentry_dsn must be an https://…sentry.io URL")
        return v

    @model_validator(mode="after")
    def _enabled_requires_id(self) -> "SiteSettingsBody":
        if self.adsense_enabled and not self.adsense_publisher_id:
            raise ValueError("adsense_publisher_id is required when AdSense is enabled")
        if self.ga4_enabled and not self.ga4_measurement_id:
            raise ValueError("ga4_measurement_id is required when GA4 is enabled")
        if self.sentry_enabled and not self.sentry_dsn:
            raise ValueError("sentry_dsn is required when Sentry is enabled")
        return self


def _dict(s: SiteSetting) -> dict:
    return {
        "site_name": s.site_name,
        "site_tagline": s.site_tagline,
        "site_description": s.site_description,
        "adsense_enabled": s.adsense_enabled,
        "adsense_publisher_id": s.adsense_publisher_id,
        "adsense_slot_leaderboard": s.adsense_slot_leaderboard,
        "adsense_slot_in_content": s.adsense_slot_in_content,
        "ga4_enabled": s.ga4_enabled,
        "ga4_measurement_id": s.ga4_measurement_id,
        "sentry_enabled": s.sentry_enabled,
        "sentry_dsn": s.sentry_dsn,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


async def _get_singleton(db: AsyncSession) -> SiteSetting | None:
    return (
        await db.execute(select(SiteSetting).where(SiteSetting.id == SINGLETON_ID))
    ).scalar_one_or_none()


@router.get("")
async def get_site_settings(
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    row = await _get_singleton(db)
    return {"site_settings": _dict(row) if row else None}


@router.put("")
async def update_site_settings(
    body: SiteSettingsBody,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    values = body.model_dump()
    # Race-safe singleton upsert: a plain read-then-insert lets two concurrent
    # first-time PUTs both see no row and collide on the id=1 PK (IntegrityError
    # → 500). ON CONFLICT DO UPDATE folds the insert and update into one atomic
    # statement so the second writer updates instead of erroring. ``updated_at``
    # is bumped explicitly on the update path (the model's ``onupdate`` is
    # ORM-flush-level and does not fire for a Core upsert).
    stmt = (
        pg_insert(SiteSetting)
        .values(id=SINGLETON_ID, **values)
        .on_conflict_do_update(
            index_elements=["id"],
            set_={**values, "updated_at": func.now()},
        )
    )
    await db.execute(stmt)
    await db.commit()
    row = await _get_singleton(db)
    return {"site_settings": _dict(row)}
