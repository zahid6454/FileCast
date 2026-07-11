# Reliability & SRE Review Guide

Checklist for the production-readiness dimension — "will this page someone at
3am." Load when the change touches network calls, background work, data
stores, migrations, concurrency, caching, or deploy/config.

## Contents
- Dependencies & failure modes
- Timeouts, retries & backpressure
- Idempotency
- Resource management
- Concurrency & data integrity
- Data & schema migrations
- Observability
- Rollout, config & operability

## Dependencies & failure modes
- For each external call (DB, cache, queue, HTTP API, disk): what happens if it
  is **slow, unavailable, or returns an error/garbage**? Is that path handled?
- Does failure of a non-critical dependency degrade gracefully, or take the
  whole request/feature down?
- Errors are caught at the right boundary — not swallowed silently, not caught
  so broadly that real bugs are hidden.

## Timeouts, retries & backpressure
- Every remote call has an explicit **timeout** (no unbounded waits).
- Retries use **bounded attempts + exponential backoff + jitter**; no tight
  retry loops that amplify an outage (retry storm / thundering herd).
- Only **idempotent** operations are retried, or retries are deduplicated.
- Queues/buffers are bounded; overload sheds load rather than exhausting memory.

## Idempotency
- Operations that can be retried or replayed (webhooks, job runs, POST handlers)
  produce the same result and don't double-charge / double-write.
- Idempotency keys or natural dedup where side effects matter.

## Resource management
- Connections, files, sockets, locks, cursors are always released (finally /
  context managers / defer), including on error paths.
- No unbounded growth: caches with eviction/TTL, lists/maps that can't grow
  forever, pagination on queries that can return many rows.
- No N+1 query patterns; batch where the loop hits I/O.

## Concurrency & data integrity
- Shared mutable state is protected; no data races or check-then-act gaps.
- No lost updates — use transactions, optimistic/pessimistic locking, or atomic
  ops where two writers can collide.
- Lock ordering avoids deadlock; critical sections are minimal.
- Partial-failure states are recoverable (no "wrote A, crashed before B" that
  leaves data corrupt).

## Data & schema migrations
- Migration is **backward compatible** with the currently deployed code
  (expand/contract): add columns nullable/defaulted, don't drop/rename in the
  same deploy that stops using them.
- Reversible, or has a documented rollback.
- Safe on large tables (no long exclusive locks / full rewrites without a plan).
- Backfills are batched and resumable.

## Observability
- Enough **structured logging** to debug a production failure — with context
  (ids, operation), at appropriate levels, and **never secrets/PII**.
- Errors are actionable: they say what failed and with what inputs, not just
  "error".
- The metrics that matter exist (rate, errors, duration for the new path;
  saturation for new resources). A way to answer "is this feature healthy?"
- Correlation/trace propagation across service boundaries where relevant.

## Rollout, config & operability
- No hardcoded environment-specific values (hosts, URLs, buckets, secrets) — use
  config/env; config differs cleanly per environment.
- Risky changes are guarded (feature flag / gradual rollout) with a clear,
  fast **rollback** that doesn't require a data migration to reverse.
- Runbook/docs updated if operational behavior, alerts, or dashboards change.
- Backward-compatible CLI/API/flag changes (or a deprecation path), so callers
  don't break on deploy.
