"""FileCast data layer — shared DB package.

Imported by the running FastAPI app (async engine) AND by repo-root scripts
(`seed.py` now, `build.py` in Phase 2) and Alembic (sync engine). The Docker
build context is ``api/``, so this package must live under ``api/`` to be in
the image; root scripts insert ``api/`` on ``sys.path`` to import it.
"""
