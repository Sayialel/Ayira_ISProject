"""
Pure scoring logic, with no database and no I/O.

Keeping this separate from matcher.py is what makes the engine measurable:
the evaluation harness scores a fixture corpus by calling score_gigs()
directly, exercising exactly the code that serves live requests rather than a
reimplementation of it that could drift.
"""

from dataclasses import dataclass

from app.services.embeddings import (
    compute_semantic_similarities,
    compute_tfidf_similarities,
)


@dataclass(frozen=True)
class Weights:
    """
    The composite formula's coefficients.

    These began as asserted constants (0.45 / 0.25 / 0.15 / 0.15). The defaults
    below are instead the outcome of a grid search over 1,771 combinations
    against eval/corpus, reported in eval/results and summarised in
    eval/README.md. Leave-one-profile-out cross-validation puts the
    generalised gain at about +0.019 NDCG@10.

    Two measured findings shaped them:

    * Semantic similarity carries most of the signal. Raising it from 0.45
      while trimming TF-IDF is what produced the improvement — TF-IDF alone
      reaches 0.828 NDCG@10 against semantic's 0.947, because it cannot match
      a gig that describes the same work in different words.

    * Reputation cannot affect ranking at all. It is one number per worker, so
      it adds the same amount to every gig that worker is scored against and
      leaves the ordering untouched — NDCG@10 is identical whether its weight
      is 0.00 or 0.90. It is kept only because it shifts the percentage the
      interface displays; see eval/README.md, which argues that is a misfeature.
    """

    semantic: float = 0.60
    tfidf: float = 0.20
    location: float = 0.05
    reputation: float = 0.15

    def total(self) -> float:
        return self.semantic + self.tfidf + self.location + self.reputation


def _weights_from_env() -> Weights:
    """
    Allows the weights to be overridden without a deploy, so a tuning run's
    output can be tried in a live environment before it is committed.
    """
    import os

    def read(name: str, fallback: float) -> float:
        raw = os.environ.get(name)
        if raw is None:
            return fallback
        try:
            return float(raw)
        except ValueError:
            return fallback

    return Weights(
        semantic=read("MATCH_WEIGHT_SEMANTIC", 0.60),
        tfidf=read("MATCH_WEIGHT_TFIDF", 0.20),
        location=read("MATCH_WEIGHT_LOCATION", 0.05),
        reputation=read("MATCH_WEIGHT_REPUTATION", 0.15),
    )


DEFAULT_WEIGHTS = _weights_from_env()

# The weights the project originally shipped, kept so the evaluation can report
# the change rather than quietly presenting the tuned figures as the baseline.
SHIPPED_WEIGHTS = Weights(semantic=0.45, tfidf=0.25, location=0.15, reputation=0.15)


@dataclass(frozen=True)
class ScoredGig:
    gig_id: str
    title: str
    score: float
    semantic: float
    tfidf: float
    location_match: bool
    reputation: float

    def breakdown(self) -> dict:
        return {
            "semantic": round(self.semantic, 4),
            "tfidf": round(self.tfidf, 4),
            "location": self.location_match,
            "reputation": self.reputation,
        }


def _text(value) -> str:
    """Nullable columns come back as None, which must not reach the model."""
    return (value or "").strip()


def _join(values) -> str:
    return " ".join(v for v in (values or []) if v)


def profile_text(worker: dict) -> str:
    """The worker side of the comparison: their skills and how they describe themselves."""
    return " ".join(
        part
        for part in (_join(worker.get("skills")), _text(worker.get("bio")))
        if part
    ).strip()


def gig_text(gig: dict) -> str:
    """The gig side: what the work is called, what it needs, and what it involves."""
    return " ".join(
        part
        for part in (
            _text(gig.get("title")),
            _join(gig.get("required_skills")),
            _text(gig.get("description")),
        )
        if part
    ).strip()


def is_location_match(worker_location: str, gig: dict) -> bool:
    """A remote gig can be done from anywhere, so it always counts as a match."""
    if gig.get("is_remote"):
        return True

    gig_location = _text(gig.get("location"))
    if not worker_location or not gig_location:
        return False
    return worker_location.casefold() == gig_location.casefold()


def composite_score(
    semantic: float,
    tfidf: float,
    location_match: bool,
    reputation: float,
    weights: Weights = DEFAULT_WEIGHTS,
) -> float:
    """
    Combines the four signals into one 0-1 score.

    Reputation arrives on the platform's 0-5 review scale and is normalised
    here, so every term entering the sum is already 0-1 and the weights alone
    decide influence.
    """
    loc = 1.0 if location_match else 0.0
    rep = min(max(reputation, 0.0) / 5.0, 1.0)

    return (
        weights.semantic * semantic
        + weights.tfidf * tfidf
        + weights.location * loc
        + weights.reputation * rep
    )


def score_gigs(
    worker: dict,
    gigs: list[dict],
    weights: Weights = DEFAULT_WEIGHTS,
    semantic_scores: list[float] | None = None,
) -> list[ScoredGig]:
    """
    Scores every gig against one worker profile, ranked best first.

    `semantic_scores` lets the caller supply similarities it already has — the
    live path derives them from vectors cached in Postgres, so the model never
    runs during an ordinary request. Left out, they are computed here, which is
    what the evaluation harness does so it measures the scoring itself rather
    than the cache.
    """
    if not gigs:
        return []

    worker_profile = profile_text(worker)
    worker_location = _text(worker.get("location"))
    reputation = float(worker.get("reputation_score") or 0)

    texts = [gig_text(gig) for gig in gigs]

    if semantic_scores is None:
        semantic_scores = compute_semantic_similarities(worker_profile, texts)
    elif len(semantic_scores) != len(gigs):
        raise ValueError(
            f"semantic_scores has {len(semantic_scores)} entries for {len(gigs)} gigs"
        )

    tfidf_scores = compute_tfidf_similarities(worker_profile, texts)

    scored = [
        ScoredGig(
            gig_id=gig["id"],
            title=gig.get("title") or "",
            score=round(
                composite_score(sem, tfidf, is_location_match(worker_location, gig), reputation, weights),
                4,
            ),
            semantic=sem,
            tfidf=tfidf,
            location_match=is_location_match(worker_location, gig),
            reputation=reputation,
        )
        for gig, sem, tfidf in zip(gigs, semantic_scores, tfidf_scores)
    ]

    scored.sort(key=lambda g: g.score, reverse=True)
    return scored
