"""Aggregates every data router. ``main.py`` iterates ``all_routers`` and
``app.include_router()``s each (they carry their own ``/api/v1`` prefix)."""

from data.routers import (
    admin_deploy,
    announcements,
    auth,
    conversions,
    errors,
    favorites,
    history,
    messages,
    preferences,
    ratings,
    site_settings,
    staff,
    stats,
    tools,
    users,
)

all_routers = [
    auth.router,
    tools.router,
    conversions.router,
    ratings.router,
    errors.router,
    announcements.router,
    stats.router,
    users.router,
    favorites.router,
    preferences.router,
    history.router,
    messages.router,
    admin_deploy.router,
    site_settings.router,
    staff.router,
]
