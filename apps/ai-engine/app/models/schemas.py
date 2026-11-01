from pydantic import BaseModel

class MatchRequest(BaseModel):
    worker_id: str
    limit: int = 10

class GigScore(BaseModel):
    gig_id: str
    title: str
    score: float
    breakdown: dict

class ProfileSufficiency(BaseModel):
    """How much of the ranking the worker's own profile could drive."""

    level: str          # 'ok' | 'weak' | 'insufficient'
    reason: str
    skills: int
    has_bio: bool


class MatchResponse(BaseModel):
    worker_id: str
    matches: list[GigScore]
    # Optional so an older gateway reading this response still parses it.
    sufficiency: ProfileSufficiency | None = None
