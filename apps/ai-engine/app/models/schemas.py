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

class EmbedRequest(BaseModel):
    worker_id: str
    #: Recompute even when the stored hash already matches. Only for a
    #: deliberate refresh; the default skips work that would change nothing.
    force: bool = False


class EmbedResponse(BaseModel):
    worker_id: str
    embedded: bool
    #: Why, so the caller can tell "already current" from "nothing to embed"
    #: from "done" without guessing from a boolean.
    reason: str


class EmbedGigsRequest(BaseModel):
    #: How many to embed in one call. Bounded because each batch holds the
    #: model, and the point of this endpoint is that the cost is predictable.
    limit: int = 50


class EmbedGigsResponse(BaseModel):
    embedded: int
    remaining: int
