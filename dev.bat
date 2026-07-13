@echo off
REM Start FileCast local development environment (Windows)
REM Usage: dev.bat

echo Starting API server (Docker)...
docker compose -f api/docker-compose.yml up -d

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
