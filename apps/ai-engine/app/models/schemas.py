from pydantic import BaseModel

class MatchRequest(BaseModel):
    worker_id: str
    limit: int = 10

class GigScore(BaseModel):
    gig_id: str
    title: str
    score: float
    breakdown: dict

class MatchResponse(BaseModel):
    worker_id: str
    matches: list[GigScore]
