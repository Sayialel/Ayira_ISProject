from fastapi import APIRouter, HTTPException
from app.models.schemas import MatchRequest, MatchResponse
from app.services.matcher import match_worker_to_gigs

router = APIRouter()

@router.post("/match", response_model=MatchResponse)
async def match_gigs(req: MatchRequest):
    try:
        matches = await match_worker_to_gigs(req.worker_id, req.limit)
        return MatchResponse(worker_id=req.worker_id, matches=matches)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
