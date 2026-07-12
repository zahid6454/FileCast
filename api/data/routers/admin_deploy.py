"""Admin rebuild/deploy — Phase 1 STUB.

Returns 501 until wired to real CI in Phase 7; the Phase 4 admin panel degrades
gracefully. The deploy PAT is held server-side there (never in the browser —
D7/P18).
"""

from fastapi import APIRouter, Depends, HTTPException

from data.security import require_admin

router = APIRouter(prefix="/api/v1/admin", tags=["admin-deploy"])


@router.post("/deploy")
async def trigger_deploy(_admin=Depends(require_admin)):
    raise HTTPException(status_code=501, detail="Deploy is configured in Phase 7")


@router.get("/deploy/{run_id}")
async def deploy_status(run_id: str, _admin=Depends(require_admin)):
    raise HTTPException(status_code=501, detail="Deploy is configured in Phase 7")
