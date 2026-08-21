"""SQLAlchemy 2.0 models — 9 domain tables (ledger §4) + a ``sessions`` table
for DB-backed auth. Proper Postgres types throughout (``timestamptz``,
``Boolean``, identity PKs, ``JSONB``).
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from data.db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


class Tool(Base):
    """Operational overlay on a YAML tool + seed-managed display metadata.

    ``category``/``name``/``input_format``/``output_format`` are a display cache
    mirrored from YAML on every ``seed.py`` run (§6 Tool note, admin-panel C1);
    YAML stays authoritative for page content. ``display_name`` /
    ``maintenance_message`` / ``custom_max_file_size`` are admin-owned overlay.
    """

    __tablename__ = "tools"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    maintenance_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    custom_max_file_size: Mapped[str | None] = mapped_column(String, nullable=True)
    # seed-managed display metadata (mirrored from YAML)
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    input_format: Mapped[str | None] = mapped_column(String, nullable=True)
    output_format: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, onupdate=func.now()
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    role: Mapped[str] = mapped_column(String, nullable=False, default="user")
    max_file_size: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class StaffGrant(Base):
    """Pending-invite + audit record for admin access (Phase 5.5).

    NOT a second source of truth — ``users.role`` remains the sole live authority
    (D6). A row exists to (a) hold an admin grant for an email that hasn't signed
    in yet (consumed on first Google login by ``apply_staff_role``) and (b) keep an
    audit trail of who granted what. ``email`` is stored **lowercased**; the unique
    constraint gives one row per email and a free index.
    """

    __tablename__ = "staff_grants"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    role: Mapped[str] = mapped_column(String, nullable=False, default="admin")
    granted_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    consumed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Session(Base):
    """DB-backed session. PK is ``sha256(raw_token)`` — a DB dump can't be
    replayed as live sessions (§6 Session note). The cookie carries the raw
    ``secrets.token_urlsafe(32)``."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True)  # sha256 hex
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    user_agent: Mapped[str | None] = mapped_column(String, nullable=True)
    ip: Mapped[str | None] = mapped_column(String, nullable=True)

    __table_args__ = (
        Index("ix_sessions_user_id", "user_id"),
        Index("ix_sessions_expires_at", "expires_at"),
    )


# The favorites list is user-writable, unbounded, and joined into EVERY /me
# response, so without a ceiling one account can inflate the payload on every
# page load site-wide. `tool_id` is not validated against the catalogue, so the
# list is not naturally bounded by the ~34 real tools either. Lives here rather
# than in the router because it is enforced on BOTH sides: the write path
# refuses to grow past it, and the serializer refuses to return more than it
# (which is what bounds an account that grew large before the cap existed).
MAX_FAVORITES = 100


class UserFavorite(Base):
    __tablename__ = "user_favorites"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    tool_id: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class UserConversion(Base):
    """Per-user conversion history. Purged after ``retention_days`` (§12)."""

    __tablename__ = "user_conversions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    tool_id: Mapped[str] = mapped_column(String, nullable=False)
    input_format: Mapped[str | None] = mapped_column(String, nullable=True)
    output_format: Mapped[str | None] = mapped_column(String, nullable=True)
    file_size_kb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("ix_user_conversions_user_id", "user_id"),)


class UserPreference(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    preferences: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class Rating(Base):
    """Anonymous yes/no vote with server-side dedup.

    ``vote`` is a **String** storing the literal ``'yes'``/``'no'`` — NOT a
    boolean (hard Phase 6 contract, §6/R9). Retained (never purged); anonymous.
    """

    __tablename__ = "ratings"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tool_id: Mapped[str] = mapped_column(String, nullable=False)
    vote: Mapped[str] = mapped_column(String, nullable=False)  # 'yes' | 'no'
    fingerprint: Mapped[str] = mapped_column(String, nullable=False)
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("tool_id", "fingerprint", name="uq_ratings_tool_fingerprint"),
        Index("ix_ratings_tool_id", "tool_id"),
    )


class RatingFeedback(Base):
    """Free-text "what went wrong?" follow-up on a "No" vote (P2 §18 —
    technical audit report §11.5). Anonymous; retained (never purged), same
    posture as Rating.

    Deliberately a SEPARATE table from Rating, not a nullable column on it.
    Rating's ``UNIQUE(tool_id, fingerprint)`` dedups to exactly one row per
    tool per fingerprint (a vote you can *change* — a second "no" from the
    same fingerprint upserts over the first). That is correct for a vote and
    wrong for free text: a second "no" days later with a different complaint
    would silently overwrite the first comment instead of adding to it. This
    table is append-only instead, the same shape as ``Error`` — every
    submission is its own row, keyed by nothing but its own id, with no
    fingerprint/dedup at all (submitting feedback isn't rate-limited to one
    opinion the way a vote is).
    """

    __tablename__ = "rating_feedback"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tool_id: Mapped[str] = mapped_column(String, nullable=False)
    feedback_text: Mapped[str] = mapped_column(Text, nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("ix_rating_feedback_tool_id", "tool_id"),)


class Conversion(Base):
    """Anonymous per-tool-per-day aggregate counter. Never purged (D5)."""

    __tablename__ = "conversions"

    tool_id: Mapped[str] = mapped_column(String, primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (
        Index("ix_conversions_date", "date"),
        Index("ix_conversions_tool_id", "tool_id"),
    )


class Announcement(Base):
    __tablename__ = "announcements"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    link: Mapped[str | None] = mapped_column(String, nullable=True)
    type: Mapped[str] = mapped_column(String, nullable=False, default="info")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    starts_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ends_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SiteSetting(Base):
    """Singleton (``id`` is always ``1``) display + integration overlay on
    ``site-config.yaml`` (Phase 7).

    Overlays only the **display** copy (``site.name``/``tagline``/``description``)
    and the AdSense / GA4 / Sentry integration toggles. Structural fields
    (``site.base_url``, ``api.base_url``, every ``categories[].*``) stay
    YAML-only and are deliberately NOT columns here — editing them from a textbox
    would orphan tools and 404 live URLs. ``build.py`` reads this row and merges
    it over the YAML, all-or-nothing (P10). Integrations default OFF.
    """

    __tablename__ = "site_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    # display copy (overlays the site: block)
    site_name: Mapped[str] = mapped_column(String, nullable=False)
    site_tagline: Mapped[str] = mapped_column(String, nullable=False)
    site_description: Mapped[str] = mapped_column(Text, nullable=False)
    # integrations — all default OFF
    adsense_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    adsense_publisher_id: Mapped[str | None] = mapped_column(String, nullable=True)
    adsense_slot_leaderboard: Mapped[str | None] = mapped_column(String, nullable=True)
    adsense_slot_in_content: Mapped[str | None] = mapped_column(String, nullable=True)
    ga4_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ga4_measurement_id: Mapped[str | None] = mapped_column(String, nullable=True)
    sentry_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sentry_dsn: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class Error(Base):
    """Append-only client error log. Purged after ``retention_days`` (§12)."""

    __tablename__ = "errors"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tool_id: Mapped[str | None] = mapped_column(String, nullable=True)
    error_type: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    browser: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_errors_created_at", "created_at"),
        Index("ix_errors_tool_id", "tool_id"),
    )


class Message(Base):
    """Contact-page submission. Anonymous or attributed to a signed-in user.

    Retained, never purged — unlike ``Error``/``UserConversion``, these are
    unread support requests, not diagnostic noise. Deliberately excluded from
    ``tasks.purge_expired()``; do not add it there without an explicit product
    decision to discard un-actioned contact messages.

    ``email`` is optional free text, not tied to ``user_id`` — an anonymous
    sender can leave one so support can reply; a signed-in sender's account
    email is reachable via ``user_id`` instead, so leaving it blank there is
    fine too.
    """

    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    user_agent: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="new")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_messages_created_at", "created_at"),
        Index("ix_messages_status", "status"),
    )
