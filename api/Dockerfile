# Digest-pinned (python:3.12-slim, 3.12.14-slim-trixie) so a rebuild can't
# silently pull a different, unaudited base image — Dependabot's docker
# ecosystem (.github/dependabot.yml) keeps this digest current.
FROM python:3.12-slim@sha256:2c941e860699f878900b0edc2403613c234d4b32eda3cc9fa7036991a2a63c4a

RUN apt-get update && \
    apt-get install -y --no-install-recommends ghostscript && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The commit this image was built from, surfaced at GET / so a running container
# can be compared against a checkout. Declared AFTER the pip layers so re-stamping
# an otherwise-identical build only rebuilds these two trivial layers.
#
# Defaults to "unknown" rather than failing the build: an image is still perfectly
# runnable unstamped (that is what `docker build .` by hand produces), and the
# drift check reads "unknown" as "cannot verify" instead of "up to date".
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

# Drop root before serving. Nothing else at runtime writes under /app — the
# other filesystem writes in this app (converter.py's temp PDFs,
# data/tasks.py's purge heartbeat, data/job_worker.py's own heartbeat)
# already go through Python's tempfile module, which defaults to /tmp
# (world-writable, sticky bit) — so a non-root user needs no chown for those,
# only read+execute on files root already left world-readable by the default
# umask.
#
# job_results IS under /app though, and it's a fresh named-volume mount
# point (Phase 3 — STRESS_TEST_PHASE3_PLAN.md), which Docker creates
# root-owned by default regardless of where it's mounted — /tmp's sticky-bit
# default is what gives appuser free write access there, and job_results
# doesn't get that for free. Explicit mkdir+chown, same non-root user, so
# both `api` and `worker` (which mount this same volume) can read/write it.
RUN useradd --create-home --shell /usr/sbin/nologin --uid 1000 appuser
RUN mkdir -p /app/job_results && chown appuser:appuser /app/job_results
USER appuser

EXPOSE 8090

# Migrate then serve — in the api service COMMAND (not a shared ENTRYPOINT) so
# only this service applies migrations and nothing races it (§7/§16-R5).
#
# NEON_FAILOVER_PLAN.md §7.10: DATABASE_URL is a static, deploy-time env var
# that never moves when the active node switches (node identity lives in
# Redis, by design). A bare `alembic upgrade head` here would keep migrating
# whichever node was active at Bootstrap, forever — silently missing real
# schema changes on the actual active node, and eventually blocking every
# future deploy outright once that original node is retired or exhausted.
# resolve_active_db_url.py resolves the real active node (falling back to
# this same static DATABASE_URL when the registry can't be read — Redis
# down, or pre-Bootstrap) and the resolved value is exported over it before
# alembic runs.
CMD ["sh", "-c", "export DATABASE_URL=$(python -m scripts.resolve_active_db_url) && alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8090 --workers 4"]
