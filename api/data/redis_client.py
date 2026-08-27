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

# socket_connect_timeout defaults to unbounded in redis-py, so a down/
# unreachable Redis left every caller waiting on the OS's own TCP connect
# timeout (measured 3.3-7s depending on how many sequential Redis calls a
# request made) before the fail-open path could even start (Phase 3 stress
# test, Finding 4). A short explicit bound makes "Redis is down" fail fast
# into that already-correct fail-open behavior instead of eating multiple
# seconds of latency first.
#
# Deliberately NOT pairing this with a blanket socket_timeout (the read/write
# timeout on an already-established connection): data/job_worker.py's own
# BRPOP legitimately blocks on this same shared client for up to
# BRPOP_TIMEOUT_SECONDS=5s waiting for a job — a client-side socket_timeout
# shorter than that would fire on every single idle poll, even with Redis
# perfectly healthy (confirmed live: a 1s socket_timeout here made the
# worker's loop log "Redis BRPOP failed" continuously). Every OTHER Redis
# call in the app — middleware.py's rate limiter, converter.py's job-enqueue
# LPUSH and /health's cached-signal reads — gets its own short
# asyncio.wait_for() bound instead, right at the call site (see
# REDIS_CALL_TIMEOUT_SECONDS below), so BRPOP's long, intentional block is
# left alone.
redis_client: redis.Redis = redis.from_url(
    settings.redis_url,
    decode_responses=True,
    socket_connect_timeout=1,
)

# Shared bound for the app's short, non-blocking Redis calls — an
# already-connected-but-wedged Redis would otherwise hang on the read past
# the connect-phase bound alone. NOT used anywhere near
# data/job_worker.py's BRPOP, which blocks on purpose.
REDIS_CALL_TIMEOUT_SECONDS = 1
