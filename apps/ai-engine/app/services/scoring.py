"""
Pure scoring logic, with no database and no I/O.
the evaluation harness scores a fixture corpus by calling score_gigs()
directly, exercising exactly the code that serves live requests rather than a
reimplementation of it that could drift.
"""

from dataclasses import dataclass

from sklearn.feature_extraction.text import TfidfVectorizer

from app.services.embeddings import (
    compute_semantic_similarities,
    compute_tfidf_similarities,
)
from app.services import tfidf_model


@dataclass(frozen=True)
class Weights:
    """
    How much each signal contributes. The four sum to 1, so a score stays on a
    0-1 scale and the displayed percentage means something.

    semantic and tfidf are *measured*: chosen by grid search on the training
    split and confirmed on validation (eval/tune_weights.py, eval/ablation.py).
    Semantic carries the work -- removing it costs 0.24 NDCG@10 -- while TF-IDF
    adds a little on top of it.

    location and reputation are a *product prior*, not a measurement. Both
    genuinely vary across candidate gigs and so can reorder them, but neither
    correlates with the relevance grades (-0.003 and -0.007), because those
    grades are derived from occupational similarity and know nothing about
    towns or employers. Their weight therefore cannot be chosen from this
    ground truth: a search drives both to zero only because any weight on an
    unjudgeable signal dilutes the ones the labels do reward.

    They are kept small and non-zero deliberately. Zero would overfit to a
    known blind spot in the labels and discard information a worker plainly
    cares about; the 0.15 reputation weight this previously carried put a fifth
    of the score on signals nothing could validate, and measurably cost 0.035
    NDCG@10. Raising them is a decision for labels that vary with location and
    employer -- see eval/WORKFLOW.md.
    """


    semantic: float = 0.72
    tfidf: float = 0.22
    location: float = 0.03
    reputation: float = 0.03

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
        semantic=read("MATCH_WEIGHT_SEMANTIC", 0.72),
        tfidf=read("MATCH_WEIGHT_TFIDF", 0.22),
        location=read("MATCH_WEIGHT_LOCATION", 0.03),
        reputation=read("MATCH_WEIGHT_REPUTATION", 0.03),
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
    employer_reputation: float

    def breakdown(self) -> dict:
        return {
            "semantic": round(self.semantic, 4),
            "tfidf": round(self.tfidf, 4),
            "location": self.location_match,
            "employer_reputation": round(self.employer_reputation, 2),
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


# An employer with no reviews yet must not be ranked as though they had been
# badly reviewed. `users.reputation_score` is 0.00 both for "nobody has
# reviewed them" and for "every review was one star", so an unreviewed
# employer defaults to the middle of the scale instead of the bottom.
NEUTRAL_REPUTATION = 3.0
REPUTATION_SCALE = 5.0


def employer_reputation(gig: dict) -> float:
    """
    The reputation of the employer who posted this gig, on the 0-5 scale.

    Deliberately a property of the *gig*, not of the worker being matched. A
    worker's own reputation is identical for every candidate, so it shifted all
    of their scores by the same amount and could not reorder them -- it cost a
    weight and bought nothing. The employer's reputation varies from gig to
    gig, which is what lets it change a ranking, and it is also the thing a
    worker choosing between gigs would actually care about.

    Unknown is distinct from bad. Both are mapped to the neutral prior, because
    a rating of 0 is not even reachable on a 1-5 review scale and so almost
    always means "no reviews".
    """
    raw = gig.get("employer_reputation")
    if raw is None:
        return NEUTRAL_REPUTATION

    reviews = gig.get("employer_review_count")
    if reviews is not None and int(reviews) <= 0:
        return NEUTRAL_REPUTATION

    value = float(raw)
    if value <= 0.0:
        return NEUTRAL_REPUTATION

    return min(value, REPUTATION_SCALE)


def composite_score(
    semantic: float,
    tfidf: float,
    location_match: bool,
    reputation: float,
    weights: Weights = DEFAULT_WEIGHTS,
) -> float:
    """
    Combines the four signals into one 0-1 score.

    `reputation` is the *employer's*, on the platform's 0-5 review scale, and
    is normalised here, so every term entering the sum is already 0-1 and the
    weights alone decide influence. Use `employer_reputation(gig)` to obtain
    it, which resolves the unreviewed case.
    """
    loc = 1.0 if location_match else 0.0
    rep = min(max(reputation, 0.0) / REPUTATION_SCALE, 1.0)

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
    vectorizer: TfidfVectorizer | None = None,
) -> list[ScoredGig]:
    """
    Scores every gig against one worker profile, ranked best first.

    `semantic_scores` lets the caller supply similarities it already has — the
    live path derives them from vectors cached in Postgres, so the model never
    runs during an ordinary request. Left out, they are computed here, which is
    what the evaluation harness does so it measures the scoring itself rather
    than the cache.

    `vectorizer` supplies a TF-IDF model fitted on training documents. Passing
    one is the correct path: it keeps document frequencies fixed, so scores are
    reproducible across runs and no validation or test document influences the
    weighting. Omitting it falls back to fitting over the candidates at scoring
    time, which is how the system behaved before the artefact existed and which
    remains the behaviour when no artefact has been built.
    """
    if not gigs:
        return []

    worker_profile = profile_text(worker)
    worker_location = _text(worker.get("location"))

    texts = [gig_text(gig) for gig in gigs]

    if semantic_scores is None:
        semantic_scores = compute_semantic_similarities(worker_profile, texts)
    elif len(semantic_scores) != len(gigs):
        raise ValueError(
            f"semantic_scores has {len(semantic_scores)} entries for {len(gigs)} gigs"
        )

    if vectorizer is not None:
        tfidf_scores = tfidf_model.similarities(vectorizer, worker_profile, texts)
    else:
        tfidf_scores = compute_tfidf_similarities(worker_profile, texts)

    scored = []
    for gig, sem, tfidf in zip(gigs, semantic_scores, tfidf_scores):
        # Computed once per gig rather than inline twice, so the score and the
        # breakdown can never disagree about the same gig.
        location_match = is_location_match(worker_location, gig)
        reputation = employer_reputation(gig)

        scored.append(
            ScoredGig(
                gig_id=gig["id"],
                title=gig.get("title") or "",
                score=round(
                    composite_score(sem, tfidf, location_match, reputation, weights), 4
                ),
                semantic=sem,
                tfidf=tfidf,
                location_match=location_match,
                employer_reputation=reputation,
            )
        )

    scored.sort(key=lambda g: g.score, reverse=True)
    return scored
