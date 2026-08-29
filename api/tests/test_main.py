"""Tests for main.py's lifespan (NEON_FAILOVER_PLAN.md §7.2) — one of the
seven touch points migrated to the dynamic accessor, and otherwise
completely uncovered: httpx.ASGITransport (conftest.py's test client) never
runs FastAPI's lifespan protocol at all, so these are the only tests in the
suite that actually exercise main.py's lifespan function.
"""

import main


async def test_lifespan_resolves_engine_dynamically_at_startup(monkeypatch):
    call_count = 0
    original = main.get_active_engine

    async def _counting_get_active_engine():
        nonlocal call_count
        call_count += 1
        return await original()

    # Regression guard: a revert to a hardcoded `async_engine.connect()`
    # would make this attribute not exist on `main` at all, failing this
    # monkeypatch.setattr call outright.
    monkeypatch.setattr(main, "get_active_engine", _counting_get_active_engine)

    async with main.lifespan(main.app):
        pass

    assert call_count == 1


async def test_lifespan_disposes_every_cached_engine_on_shutdown(monkeypatch):
    call_count = 0
    original = main.dispose_engines

    async def _counting_dispose_engines():
        nonlocal call_count
        call_count += 1
        await original()

    monkeypatch.setattr(main, "dispose_engines", _counting_dispose_engines)

    async with main.lifespan(main.app):
        assert call_count == 0  # not yet — only on the way out

    assert call_count == 1
