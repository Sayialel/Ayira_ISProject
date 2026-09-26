from functools import lru_cache

from supabase import Client, create_client

from app.config import settings
from app.models.schemas import GigScore
from app.services.scoring import score_gigs

# Columns the scorer actually reads. Selecting explicitly keeps the payload
# small and makes the engine's data dependencies obvious.
WORKER_COLUMNS = "id, skills, bio, location, reputation_score"
GIG_COLUMNS = "id, title, description, required_skills, location, is_remote"


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    """One client for the process; creating it per request is wasted setup."""
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


async def match_worker_to_gigs(worker_id: str, limit: int = 10) -> list[GigScore]:
    """
    Fetches the worker and the open gigs, then delegates the ranking.

    All scoring lives in app/services/scoring.py so the evaluation harness can
    exercise the same code path without a database.
    """
    sb = get_supabase()

    # A plain limited select rather than .single(), which raises when the row
    # is missing.
    worker = (
        sb.table("users")
        .select(WORKER_COLUMNS)
        .eq("id", worker_id)
        .limit(1)
        .execute()
    )
    if not worker.data:
        return []

    gigs = (
        sb.table("gigs")
        .select(GIG_COLUMNS)
        .eq("status", "open")
        .execute()
    )
    if not gigs.data:
        return []

    ranked = score_gigs(worker.data[0], gigs.data)

    return [
        GigScore(
            gig_id=g.gig_id,
            title=g.title,
            score=g.score,
            breakdown=g.breakdown(),
        )
        for g in ranked[:limit]
    ]
