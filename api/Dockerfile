FROM python:3.12-slim

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

# Drop root before serving. Nothing at runtime writes under /app — the only
# two filesystem writes anywhere in this app (converter.py's temp PDFs,
# data/tasks.py's purge heartbeat) already go through Python's tempfile
# module, which defaults to /tmp (world-writable, sticky bit) — so a non-root
# user needs no chown here, only read+execute on files root already left
# world-readable by the default umask.
RUN useradd --create-home --shell /usr/sbin/nologin --uid 1000 appuser
USER appuser

EXPOSE 8090

# Migrate then serve — in the api service COMMAND (not a shared ENTRYPOINT) so
# only this service applies migrations and nothing races it (§7/§16-R5).
CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8090 --workers 4"]
