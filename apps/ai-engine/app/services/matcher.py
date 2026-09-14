from functools import lru_cache

from supabase import Client, create_client

from app.config import settings
from app.models.schemas import GigScore
from app.services.embeddings import (
    composite_score,
    compute_semantic_similarities,
    compute_tfidf_similarities,
)


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    """One client for the process; creating it per request is wasted setup."""
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def _text(value) -> str:
    """Nullable columns come back as None, which must not reach the model."""
    return (value or "").strip()


def _join(values) -> str:
    return " ".join(v for v in (values or []) if v)


def _profile_text(worker: dict) -> str:
    return " ".join(
        part
        for part in (
            _join(worker.get("skills")),
            _text(worker.get("bio")),
        )
        if part
    ).strip()


def _gig_text(gig: dict) -> str:
    return " ".join(
        part
        for part in (
            _text(gig.get("title")),
            _join(gig.get("required_skills")),
            _text(gig.get("description")),
        )
        if part
    ).strip()


def _is_location_match(worker_location: str, gig: dict) -> bool:
    """A remote gig can be done from anywhere, so it always counts as a match."""
    if gig.get("is_remote"):
        return True

    gig_location = _text(gig.get("location"))
    if not worker_location or not gig_location:
        return False
    return worker_location.casefold() == gig_location.casefold()


async def match_worker_to_gigs(worker_id: str, limit: int = 10) -> list[GigScore]:
    sb = get_supabase()

    # Fetch worker profile. A plain limited select is used rather than
    # .single(), which raises when the row is missing.
    worker = (
        sb.table("users")
        .select("id, skills, bio, location, reputation_score")
        .eq("id", worker_id)
        .limit(1)
        .execute()
    )
    if not worker.data:
        return []

    profile = worker.data[0]
    worker_text = _profile_text(profile)
    worker_location = _text(profile.get("location"))
    worker_rep = float(profile.get("reputation_score") or 0)

    # Fetch open gigs
    gigs = (
        sb.table("gigs")
        .select("id, title, description, required_skills, location, is_remote")
        .eq("status", "open")
        .execute()
    )
    if not gigs.data:
        return []

    gig_texts = [_gig_text(gig) for gig in gigs.data]

    # Both similarity passes score the whole gig list in one call.
    semantic_scores = compute_semantic_similarities(worker_text, gig_texts)
    tfidf_scores = compute_tfidf_similarities(worker_text, gig_texts)

    scored: list[GigScore] = []
    for gig, sem, tfidf in zip(gigs.data, semantic_scores, tfidf_scores):
        loc_match = _is_location_match(worker_location, gig)
        score = composite_score(sem, tfidf, loc_match, worker_rep)

        scored.append(
            GigScore(
                gig_id=gig["id"],
                title=gig.get("title") or "",
                score=round(score, 4),
                breakdown={
                    "semantic": round(sem, 4),
                    "tfidf": round(tfidf, 4),
                    "location": loc_match,
                    "reputation": worker_rep,
                },
            )
        )

    scored.sort(key=lambda g: g.score, reverse=True)
    return scored[:limit]
