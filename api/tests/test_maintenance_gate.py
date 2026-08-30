"""Contract test — NEON_FAILOVER_PLAN.md §7.6: every route that writes must
require ``require_not_maintenance``, verified by walking the actual FastAPI
route table rather than only re-testing a couple of routes' live behavior
(that live-503 coverage exists separately — test_converter.py's job-download
case and test_auth.py's OAuth-callback case, per §12).

A per-route behavioral test alone wouldn't catch a brand NEW write route
being added later without the gate; this is what actually would. Two
directions, both load-bearing:

- ``test_every_planned_write_route_requires_not_maintenance`` — nothing in
  §7.6's inventory is missing the gate.
- ``test_no_extra_gated_route_is_untracked`` — keeps EXPECTED_GATED_ROUTES an
  honest, complete inventory (not just a lower bound) so a future route that
  gains the gate has to be deliberately added here too, not silently land.
"""

from converter import router as converter_router
from data.node_registry import require_not_maintenance
from data.routers import all_routers
from fastapi.routing import APIRoute

# Every (method, path) NEON_FAILOVER_PLAN.md §7.6 names as a route that
# writes. Deliberately excludes: every read route, and every admin_nodes.py
# route (Phase D) — those mutate Redis-backed pool state, never the
# Postgres node this gate protects, and a second switch/provision request
# while one is in flight is already excluded by the pool-operation lock
# (§7.1), so the gate there would be "redundant-but-harmless" per §7.6, not
# a new requirement.
EXPECTED_GATED_ROUTES = {
    # converter.py — all 10 job-enqueue routes, plus the one GET-that-writes.
    ("POST", "/api/v1/convert/docx-to-pdf"),
    ("POST", "/api/v1/convert/xlsx-to-pdf"),
    ("POST", "/api/v1/convert/pptx-to-pdf"),
    ("POST", "/api/v1/convert/html-to-pdf"),
    ("POST", "/api/v1/convert/pdf-compress"),
    ("POST", "/api/v1/convert/pdf-to-docx"),
    ("POST", "/api/v1/convert/pdf-to-xlsx"),
    ("POST", "/api/v1/convert/pdf-to-pptx"),
    ("POST", "/api/v1/convert/epub-to-pdf"),
    ("POST", "/api/v1/convert/png-to-svg"),
    ("GET", "/api/v1/convert/jobs/{job_id}/download"),
    # ratings.py
    ("POST", "/api/v1/ratings"),
    ("POST", "/api/v1/ratings/feedback"),
    # favorites.py
    ("POST", "/api/v1/favorites"),
    ("DELETE", "/api/v1/favorites/{tool_id}"),
    # messages.py
    ("POST", "/api/v1/messages"),
    ("PUT", "/api/v1/admin/messages/{message_id}"),
    # preferences.py
    ("PUT", "/api/v1/preferences"),
    # users.py
    ("DELETE", "/api/v1/users/me"),
    # tools.py
    ("PUT", "/api/v1/tools/reorder"),
    ("PUT", "/api/v1/tools/{tool_id}"),
    # staff.py
    ("POST", "/api/v1/admin/staff"),
    ("DELETE", "/api/v1/admin/staff/{email}"),
    # announcements.py
    ("POST", "/api/v1/announcements"),
    ("PUT", "/api/v1/announcements/{announcement_id}"),
    ("DELETE", "/api/v1/announcements/{announcement_id}"),
    # site_settings.py
    ("PUT", "/api/v1/admin/site-settings"),
    # conversions.py
    ("POST", "/api/v1/conversions"),
    # errors.py
    ("POST", "/api/v1/errors"),
    # auth.py — including the OAuth callback, a GET that writes.
    ("POST", "/api/v1/auth/dev-login"),
    ("POST", "/api/v1/auth/logout"),
    ("GET", "/api/v1/auth/google/callback"),
}


def _requires_maintenance_gate(route: APIRoute) -> bool:
    return any(
        dep.call is require_not_maintenance for dep in route.dependant.dependencies
    )


def _gated_routes() -> set[tuple[str, str]]:
    # Walks each APIRouter's OWN .routes directly (converter_router +
    # everything data/routers/__init__.py aggregates into all_routers) —
    # deliberately not main.app.routes: FastAPI (0.141+) wraps
    # app.include_router()'s result in an internal, lazily-resolved
    # _IncludedRouter placeholder rather than eagerly flattening into
    # APIRoute objects there. Each router's own .routes list is unaffected
    # by that and still holds real APIRoute objects with a fully resolved
    # .dependant — this sidesteps FastAPI's private route-resolution
    # internals entirely rather than depending on them.
    routers = [converter_router, *all_routers]
    return {
        (method, route.path)
        for router in routers
        for route in router.routes
        if isinstance(route, APIRoute) and _requires_maintenance_gate(route)
        # Starlette auto-adds HEAD to every GET route — not a semantically
        # distinct route worth tracking separately here.
        for method in route.methods - {"HEAD"}
    }


def test_every_planned_write_route_requires_not_maintenance():
    missing = EXPECTED_GATED_ROUTES - _gated_routes()
    assert not missing, f"routes missing the maintenance gate: {sorted(missing)}"


def test_no_extra_gated_route_is_untracked():
    extra = _gated_routes() - EXPECTED_GATED_ROUTES
    assert not extra, (
        f"routes carrying the gate but not listed in EXPECTED_GATED_ROUTES: "
        f"{sorted(extra)}"
    )


def test_exactly_thirty_two_routes_are_gated():
    # A concrete tripwire alongside the two set-comparisons above — the
    # inventory in NEON_FAILOVER_PLAN.md §7.6 is a fixed, counted list.
    assert len(EXPECTED_GATED_ROUTES) == 32
    assert len(_gated_routes()) == 32
