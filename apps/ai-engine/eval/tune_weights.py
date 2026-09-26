"""
Searches for better composite weights.

    python -m eval.tune_weights

The four coefficients shipped as asserted constants. This replaces the
assertion with a measurement, and reports an honest estimate of whether the
result generalises rather than only fitting the corpus it was tuned on.
"""

import json
from dataclasses import dataclass
from datetime import datetime, timezone

from app.services.embeddings import (
    compute_semantic_similarities,
    compute_tfidf_similarities,
)
from app.services.scoring import DEFAULT_WEIGHTS, Weights, gig_text, is_location_match, profile_text
from eval import metrics
from eval.harness import Corpus, RESULTS_DIR, load_corpus


@dataclass
class Features:
    """
    The four signals for one profile against every gig, computed once.

    Scoring a weight combination is then just a dot product, which is what
    makes an exhaustive search affordable — the model runs 12 times in total
    rather than once per combination.
    """

    profile_id: str
    gig_ids: list[str]
    semantic: list[float]
    tfidf: list[float]
    location: list[float]
    reputation: float


def extract_features(corpus: Corpus) -> list[Features]:
    gig_ids = [g["id"] for g in corpus.gigs]
    texts = [gig_text(g) for g in corpus.gigs]

    features = []
    for profile in corpus.profiles:
        text = profile_text(profile)
        location = (profile.get("location") or "").strip()
        features.append(
            Features(
                profile_id=profile["id"],
                gig_ids=gig_ids,
                semantic=compute_semantic_similarities(text, texts),
                tfidf=compute_tfidf_similarities(text, texts),
                location=[1.0 if is_location_match(location, g) else 0.0 for g in corpus.gigs],
                reputation=min(max(float(profile.get("reputation_score") or 0), 0.0) / 5.0, 1.0),
            )
        )
    return features


def rank(features: Features, weights: Weights) -> list[str]:
    scored = [
        (
            gig_id,
            weights.semantic * sem
            + weights.tfidf * tf
            + weights.location * loc
            + weights.reputation * features.reputation,
        )
        for gig_id, sem, tf, loc in zip(
            features.gig_ids, features.semantic, features.tfidf, features.location
        )
    ]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return [gig_id for gig_id, _ in scored]


def ndcg_over(features: list[Features], corpus: Corpus, weights: Weights) -> float:
    return metrics.mean(
        [
            metrics.ndcg_at_k(rank(f, weights), corpus.grades.get(f.profile_id, {}), 10)
            for f in features
        ]
    )


def candidate_weights(step: float = 0.05) -> list[Weights]:
    """
    Every combination on a 0.05 grid that sums to 1.

    Constraining the sum keeps scores comparable to the current system and
    keeps the displayed percentage meaningful.
    """
    steps = int(round(1 / step))
    out = []
    for a in range(steps + 1):
        for b in range(steps + 1 - a):
            for c in range(steps + 1 - a - b):
                d = steps - a - b - c
                out.append(
                    Weights(
                        semantic=round(a * step, 4),
                        tfidf=round(b * step, 4),
                        location=round(c * step, 4),
                        reputation=round(d * step, 4),
                    )
                )
    return out


def cross_validated_ndcg(features: list[Features], corpus: Corpus, grid: list[Weights]) -> float:
    """
    Leave-one-profile-out estimate of how the tuning generalises.

    Choosing weights on the same data you then report on measures how well the
    search memorised the corpus, not how well the system will rank for a worker
    it has never seen. Here each profile is scored using weights chosen without
    it, which is the honest number to publish.
    """
    scores = []
    for held_out in features:
        rest = [f for f in features if f.profile_id != held_out.profile_id]
        best = max(grid, key=lambda w: ndcg_over(rest, corpus, w))
        scores.append(
            metrics.ndcg_at_k(rank(held_out, best), corpus.grades.get(held_out.profile_id, {}), 10)
        )
    return metrics.mean(scores)


def main() -> None:
    corpus = load_corpus()
    print(f"\nCorpus: {len(corpus.profiles)} profiles x {len(corpus.gigs)} gigs")
    print("Extracting features (the model runs once per profile)...")
    features = extract_features(corpus)

    grid = candidate_weights()
    print(f"Searching {len(grid)} weight combinations on a 0.05 grid...\n")

    scored = sorted(((ndcg_over(features, corpus, w), w) for w in grid), key=lambda p: -p[0])
    best_score, best = scored[0]
    current = ndcg_over(features, corpus, DEFAULT_WEIGHTS)

    def show(label: str, w: Weights, score: float) -> None:
        print(
            f"  {label:<22} semantic {w.semantic:.2f}  tfidf {w.tfidf:.2f}  "
            f"location {w.location:.2f}  reputation {w.reputation:.2f}   NDCG@10 {score:.4f}"
        )

    show("current (shipped)", DEFAULT_WEIGHTS, current)
    show("best on this corpus", best, best_score)
    print(f"\n  absolute gain: {best_score - current:+.4f}")

    print("\n  next best combinations:")
    for score, w in scored[1:6]:
        show("", w, score)

    print("\nLeave-one-profile-out cross-validation (the honest estimate)...")
    cv = cross_validated_ndcg(features, corpus, grid)
    cv_current = metrics.mean(
        [
            metrics.ndcg_at_k(rank(f, DEFAULT_WEIGHTS), corpus.grades.get(f.profile_id, {}), 10)
            for f in features
        ]
    )
    print(f"  tuned weights, unseen profiles : {cv:.4f}")
    print(f"  current weights                : {cv_current:.4f}")
    print(f"  generalised gain               : {cv - cv_current:+.4f}")

    RESULTS_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = RESULTS_DIR / f"weights-{stamp}.json"
    path.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "grid_step": 0.05,
                "combinations_tried": len(grid),
                "current": {"weights": DEFAULT_WEIGHTS.__dict__, "ndcg_at_10": current},
                "best_on_corpus": {"weights": best.__dict__, "ndcg_at_10": best_score},
                "cross_validated": {"tuned": cv, "current": cv_current},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nWritten to {path.relative_to(path.parents[2])}\n")


if __name__ == "__main__":
    main()
