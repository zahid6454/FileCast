@echo off
REM Start FileCast local development environment (Windows)
REM Usage: dev.bat

REM Stamp the image with the current commit so GET / reports what it is running.
REM If git is unavailable GIT_SHA stays unset and the Dockerfile default
REM ("unknown") applies — the drift check then says it cannot verify.
for /f "delims=" %%i in ('git rev-parse HEAD 2^>nul') do set GIT_SHA=%%i

echo Starting API server (Docker)...
REM --build is NOT optional. Without it `up -d` reuses whatever image already
REM exists, while build.py --watch below rebuilds the static site from the working
REM tree every time. That asymmetry is silent: the page ships code calling an API
REM field the running container was built too early to return, and the JS quietly
REM takes its fallback branch. Rebuilding is a cache hit when nothing changed.
docker compose -f api/docker-compose.yml up -d --build

echo Waiting for Gotenberg health...
:healthcheck
curl -sf http://localhost:3000/health >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /noq >nul
    goto healthcheck
)
echo API ready at http://localhost:8090

echo Starting static site with watch + live reload...
echo Open http://localhost:8000
echo.

set API_URL=http://localhost:8090
REM Read the tool-state overlay from the Phase 1 Postgres (published on
REM localhost:5432). Unset/unreachable degrades to YAML-only — safe.
set DATABASE_URL=postgresql+psycopg://filecast:filecast_dev@localhost:5432/filecast
python build.py --watch

echo.
echo Stopping API server...
docker compose -f api/docker-compose.yml down
