import logging

from fastapi import APIRouter, Depends, HTTPException

from app.models.schemas import MatchRequest, MatchResponse
from app.security import require_api_key
from app.services.matcher import match_worker_to_gigs

logger = logging.getLogger(__name__)

# Every route on this router requires the shared secret. Health stays public so
# platform health checks keep working.
router = APIRouter(dependencies=[Depends(require_api_key)])


@router.post("/match", response_model=MatchResponse)
async def match_gigs(req: MatchRequest):
    try:
        matches = await match_worker_to_gigs(req.worker_id, req.limit)
        return MatchResponse(worker_id=req.worker_id, matches=matches)
    except Exception as exc:
        # Log the detail for operators; return a generic message, since the
        # exception text can carry database and configuration internals.
        logger.exception("Matching failed for worker %s", req.worker_id)
        raise HTTPException(
            status_code=500,
            detail="Matching failed. Please try again.",
        ) from exc
