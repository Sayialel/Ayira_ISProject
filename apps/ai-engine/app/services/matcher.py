import logging
import time
from dataclasses import replace
from functools import lru_cache

from supabase import Client, create_client

from app.config import settings
from app.models.schemas import GigScore
from app.services.embedding_store import (
    refresh_gig_embeddings,
    to_pgvector,
    worker_embedding,
)
from app.services import calibration, tfidf_model
from app.services.scoring import (
    ProfileSufficiency,
    gig_text,
    profile_sufficiency,
    profile_text,
    score_gigs,
)

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

# all-MiniLM-L6-v2's output width, and the width of the vector columns in
# migration 014. Used to build the zero probe when a worker has no vector yet.
EMBEDDING_DIMENSIONS = 384

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


def _gigs_awaiting_embedding(sb) -> int:
    """
    Reports how many gigs still have no usable vector. Does NOT compute them.

    It used to compute them, and that was a latent copy of the bug that broke
    worker matching. Embedding loads the encoder -- about 316 MB on top of a
    130 MB process, against a 512 MB limit -- and doing it here put that cost
    inside a match request. One employer posting a gig made the next worker's
    match slow, and a batch of new gigs could take the request down with it.

    A gig with no vector is simply not retrievable by vector search yet. That
    is a visible, bounded gap -- it misses from the candidate pool until
    something embeds it -- and it is much better than the alternative of
    charging an unrelated worker's request for the work. POST /ai/embed-worker
    and eval/backfill_worker_embeddings.py are where embedding belongs.

    The count is still taken, rate-limited, because it is worth logging: a
    number that stays non-zero means nothing is embedding gigs and the
    catalogue is quietly shrinking from the matcher's point of view.
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

    return len(pending.data)


def _sufficiency_without_vector(sufficiency: ProfileSufficiency) -> ProfileSufficiency:
    """
    Downgrades a profile's sufficiency when its vector has not been computed.

    Only a profile that *has* something to embed is "being prepared". An empty
    one is missing a vector because there is no text to turn one from, and no
    amount of waiting changes that -- telling such a worker to check back
    shortly sends them away from the one action that would help. The
    'insufficient' reason already asks for skills or a bio, so it is left to
    speak for itself.
    """
    if not sufficiency.can_rank_on_skills:
        return sufficiency

    return replace(
        sufficiency,
        level="degraded",
        reason=(
            "Your profile is still being prepared, so these are ranked on "
            "keywords and location for now. Check back shortly for better "
            "matches."
        ),
    )


async def match_worker_to_gigs(
    worker_id: str, limit: int = 10
) -> tuple[list[GigScore], ProfileSufficiency | None]:
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
        return [], None

    profile = worker.data[0]

    # Judged before anything is scored, because it describes the input
    # rather than the result, and the caller needs it even when the
    # candidate list comes back empty.
    sufficiency = profile_sufficiency(profile)

    awaiting = _gigs_awaiting_embedding(sb)
    if awaiting:
        logger.warning(
            "%d gig(s) have no embedding and are not retrievable by vector search. "
            "Run POST /ai/embed-gigs or eval/backfill_worker_embeddings.py.",
            awaiting,
        )

    # allow_compute=False: serving never loads the model. See
    # embedding_store.worker_embedding -- the instance cannot hold it, and a
    # request that tried was killed by the host.
    vector = worker_embedding(sb, profile, profile_text, allow_compute=False)

    # Retrieval needs *a* vector to order by. With none, a zero vector makes
    # every distance equal, so the shortlist is simply the open gigs this
    # worker may see, still correctly filtered by status, deadline, ownership
    # and prior applications -- and the ranking below falls to the remaining
    # signals rather than to nothing.
    probe = vector if vector is not None else [0.0] * EMBEDDING_DIMENSIONS

    candidates = sb.rpc(
        "nearest_open_gigs",
        {
            "p_worker_id": worker_id,
            "p_embedding": to_pgvector(probe),
            "p_limit": CANDIDATE_POOL,
        },
    ).execute()

    if not candidates.data:
        return [], sufficiency

    gigs = candidates.data

    if vector is None:
        # Distances against a zero vector carry no meaning, so they are not
        # dressed up as similarity. Zero is the honest value, and it is what
        # the two text signals already return for an empty query.
        semantic = [0.0] * len(gigs)

        sufficiency = _sufficiency_without_vector(sufficiency)
    else:
        semantic = [_similarity_from_distance(g.get("distance")) for g in gigs]

    # The TF-IDF artefact fitted on the training split. If none has been
    # promoted this is None and score_gigs falls back to fitting over the
    # candidates, which still works but makes the score depend on which gigs
    # are open -- see tfidf_model.load_serving().
    ranked = score_gigs(
        profile,
        gigs,
        semantic_scores=semantic,
        vectorizer=tfidf_model.load_serving(),
    )

    scored = [
        GigScore(
            gig_id=g.gig_id,
            title=g.title,
            score=g.score,
            confidence=calibration.confidence(g.score),
            breakdown=g.breakdown(),
        )
        for g in ranked[:limit]
    ]
    return scored, sufficiency
