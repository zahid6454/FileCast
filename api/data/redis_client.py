"""Shared async Redis client (Phase 3 Part B —
STRESS_TEST_PHASE3_PLAN.md).

Module-level, created eagerly at import — same pattern ``data/db.py`` uses
for ``async_engine``, not lifespan-constructed-and-injected:
``RateLimitMiddleware`` is instantiated at ``app.add_middleware()`` time,
which runs before lifespan ever starts, so DI from lifespan doesn't wire up
cleanly here. Backs two independent uses that happen to share one small
Redis instance: the cross-process rate limiter (``middleware.py``) and the
conversion job worker's wake-up signal (``converter.py`` pushes,
``data/job_worker.py`` ``BRPOP``s). No persistence needed for either —
counters are inherently ephemeral, and a dropped wake-up push degrades to
slower pickup via the worker's own periodic sweep, never a lost job.
"""

import redis.asyncio as redis

from data.config import settings

# Both timeouts default to unbounded in redis-py, so a down/unreachable Redis
# left every caller waiting on the OS's own TCP timeout (measured 3.3-7s
# depending on how many sequential Redis calls a request made) before the
# fail-open path could even start (Phase 3 stress test, Finding 4). A short
# explicit bound makes "Redis is down" fail fast into that already-correct
# fail-open behavior instead of eating multiple seconds of latency first.
redis_client: redis.Redis = redis.from_url(
    settings.redis_url,
    decode_responses=True,
    socket_connect_timeout=1,
    socket_timeout=1,
)
