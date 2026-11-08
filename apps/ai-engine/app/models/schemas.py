from pydantic import BaseModel

class MatchRequest(BaseModel):
    worker_id: str
    limit: int = 10

class GigScore(BaseModel):
    gig_id: str
    title: str
    #: The raw weighted composite. Kept because the breakdown is shown against
    #: it and because every evaluation figure is computed from it.
    score: float
    #: P(this gig is relevant to this worker), from the calibration artefact.
    #: None when no artefact is promoted, so a caller can tell "uncalibrated"
    #: from "calibrated and low". See services/calibration.py.
    confidence: float | None = None
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
