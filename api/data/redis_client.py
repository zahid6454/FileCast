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

redis_client: redis.Redis = redis.from_url(settings.redis_url, decode_responses=True)
