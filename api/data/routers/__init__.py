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
    preferences,
    ratings,
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
    admin_deploy.router,
    staff.router,
]
