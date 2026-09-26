import logging
import time
from functools import lru_cache

from supabase import Client, create_client

from app.config import settings
from app.models.schemas import GigScore
from app.services.embedding_store import (
    refresh_gig_embeddings,
    to_pgvector,
    worker_embedding,
)
from app.services.scoring import gig_text, profile_text, score_gigs

logger = logging.getLogger(__name__)

# Columns the scorer reads, plus the cached vector and the hash that says
# whether it is still current.
WORKER_COLUMNS = "id, skills, bio, location, reputation_score, embedding, embedding_hash"

# How many nearest candidates to pull back before re-ranking with the full
# composite. Large enough that the shortlist is not the thing limiting quality,
# small enough that re-ranking stays bounded however big the catalogue grows.
CANDIDATE_POOL = 200

# Cap on how many stale gigs are re-embedded in a single request, so one bulk
# import cannot turn one unlucky user's search into a long wait.
EMBED_BATCH = 100

# How often to ask the database whether any gig needs embedding. Newly posted
# gigs become matchable within this window.
BACKFILL_CHECK_INTERVAL = 30.0

_last_backfill_check = 0.0


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    """One client for the process; creating it per request is wasted setup."""
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def _similarity_from_distance(distance) -> float:
    """
    pgvector's <=> is cosine *distance*, so similarity is 1 - distance.

    A gig with no embedding yet comes back with distance NULL. Scoring it 0
    ranks it last on the semantic term rather than dropping it, so a catalogue
    mid-backfill degrades instead of disappearing.
    """
    if distance is None:
        return 0.0
    return max(0.0, min(1.0, 1.0 - float(distance)))


def _backfill_embeddings(sb) -> int:
    """
    Brings stored gig embeddings up to date.

    Runs before retrieval because a gig with no vector cannot be found by
    vector search. In steady state this does nothing — it only has work after
    gigs are posted or edited.

    The check itself is a round trip, so it is rate-limited: asking on every
    request spent real time confirming there was nothing to do. A gig posted
    during the interval is simply picked up by the next check.
    """
    global _last_backfill_check

    now = time.monotonic()
    if now - _last_backfill_check < BACKFILL_CHECK_INTERVAL:
        return 0
    _last_backfill_check = now

    try:
        pending = sb.rpc("gigs_needing_embedding", {"p_limit": EMBED_BATCH}).execute()
    except Exception:
        logger.exception("Could not list gigs needing embedding")
        return 0

    if not pending.data:
        return 0

    return refresh_gig_embeddings(sb, pending.data, gig_text)


async def match_worker_to_gigs(worker_id: str, limit: int = 10) -> list[GigScore]:
    """
    Ranks open gigs for one worker.

    The model does not run here in the normal case: the worker's vector and
    every gig's vector are already in Postgres, which does the nearest-neighbour
    search. Only the shortlist that comes back is scored in full.
    """
    sb = get_supabase()

    worker = (
        sb.table("users")
        .select(WORKER_COLUMNS)
        .eq("id", worker_id)
        .limit(1)
        .execute()
    )
    if not worker.data:
        return []

    profile = worker.data[0]

    rebuilt = _backfill_embeddings(sb)
    if rebuilt:
        logger.info("Rebuilt %d gig embedding(s) before matching", rebuilt)

    vector = worker_embedding(sb, profile, profile_text)

    candidates = sb.rpc(
        "nearest_open_gigs",
        {
            "p_worker_id": worker_id,
            "p_embedding": to_pgvector(vector),
            "p_limit": CANDIDATE_POOL,
        },
    ).execute()

    if not candidates.data:
        return []

    gigs = candidates.data
    semantic = [_similarity_from_distance(g.get("distance")) for g in gigs]

    ranked = score_gigs(profile, gigs, semantic_scores=semantic)

    return [
        GigScore(
            gig_id=g.gig_id,
            title=g.title,
            score=g.score,
            breakdown=g.breakdown(),
        )
        for g in ranked[:limit]
    ]
