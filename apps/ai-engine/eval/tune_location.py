"""
Does measured distance beat the four-tier location affinity, and if so, does
the location weight deserve to move?

    python -m eval.tune_location

THE QUESTION. The tiers -- same town 1.0, same county 0.6, same metro 0.45,
unknown 0.3, different county 0.0 -- were an improvement on exact string
equality, but they are a four-valued approximation of a continuous quantity
and they cannot separate pairs inside one bucket. Every "different county"
pair scored 0.0, so Nakuru to Nairobi (160 km, an awkward but real trip)
scored identically to Mombasa to Nairobi (440 km, an overnight journey).

Coordinates for 34 towns are now available, so the quantity can be measured.
The weight was separately tuned DOWN from 0.15 to 0.03, which is evidence
that the tiered signal was not earning its place. The honest question is
whether a sharper signal earns more, and the only way to answer it is to
measure, not to turn the weight up by hand.

THE PROTOCOL, which is the same one tune_weights.py uses and for the same
reason. The half-life and the weights are both searched on TRAIN, the pair is
selected on VALIDATION, and the winner is reported once on TEST. Searching
and reporting on the same split would report the search's own fit.

Features are extracted once and only the location column is recomputed per
half-life: the semantic column costs an embedding pass per profile and does
not depend on the thing being swept.
"""

from __future__ import annotations

import argparse

import numpy as np

from app.services.scoring import (
    DEFAULT_WEIGHTS,
    REPUTATION_SCALE,
    Weights,
    distance_affinity,
    employer_reputation,
)
from app.services import kenya_geography
from eval import experiment, splits
from eval.harness import Corpus, load_corpus
from eval.tune_location_support import LOCATION_COLUMN
from eval.tune_weights import K, FeatureMatrix, candidate_weights, extract_features

#: Kilometres per halving. Spans "only your own town counts" (10) to "distance
#: barely matters" (200), so the sweep can find no gain if there is none.
HALFLIVES = [10.0, 20.0, 30.0, 50.0, 75.0, 100.0, 150.0, 200.0]


def tiered_column(corpus: Corpus) -> np.ndarray:
    """The four-tier affinity, as the baseline to beat."""
    return LOCATION_COLUMN(corpus, halflife=None)


def distance_column(corpus: Corpus, halflife: float) -> np.ndarray:
    return LOCATION_COLUMN(corpus, halflife=halflife)


def with_location(features: FeatureMatrix, column: np.ndarray) -> FeatureMatrix:
    """The same features with the location signal replaced."""
    signals = features.signals.copy()
    signals[:, :, 2] = column
    return FeatureMatrix(
        profile_ids=features.profile_ids,
        gig_ids=features.gig_ids,
        signals=signals,
        grades=features.grades,
    )


def best_weights(features: FeatureMatrix) -> tuple[Weights, float]:
    best: tuple[Weights, float] | None = None
    for weights in candidate_weights():
        score = features.ndcg(weights)
        if best is None or score > best[1]:
            best = (weights, score)
    assert best is not None
    return best


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--adopt-margin",
        type=float,
        default=0.005,
        help="validation gain required before distance replaces the tiers",
    )
    parser.add_argument("--note", default="")
    args = parser.parse_args()

    full = load_corpus()
    run = experiment.Run(
        name="tune-location",
        params={
            "question": "does measured distance beat tiered location affinity",
            "halflives_km": HALFLIVES,
            "search_split": "train",
            "selection_split": "validation",
            "reporting_split": "test",
            "adopt_margin": args.adopt_margin,
            "current_weights": DEFAULT_WEIGHTS.__dict__,
            "towns_with_coordinates": len(kenya_geography.TOWN_POINT),
            "metric": f"ndcg_at_{K}",
        },
        seeds={"split": splits.SPLIT_SEED},
        dataset_version=full.dataset_version,
        notes=args.note,
    )

    run.log(f"dataset version {full.dataset_version}")
    run.log(f"{len(kenya_geography.TOWN_POINT)} towns have coordinates")
    run.log("Extracting features once (the embedding model runs per profile)...")

    corpora = {name: full.for_split(name) for name in ("train", "validation", "test")}
    features = {name: extract_features(c) for name, c in corpora.items()}
    for name, c in corpora.items():
        run.log(f"  {c.describe()}")

    # --- Baseline: the tiers, with the weights currently deployed ----------
    base_cols = {name: tiered_column(c) for name, c in corpora.items()}
    base_feats = {name: with_location(features[name], base_cols[name]) for name in corpora}

    baseline_val = base_feats["validation"].ndcg(DEFAULT_WEIGHTS)
    baseline_test = base_feats["test"].ndcg(DEFAULT_WEIGHTS)
    run.log("")
    run.log(f"BASELINE  tiers + deployed weights: validation {baseline_val:.4f}  test {baseline_test:.4f}")

    # Also the best weights the tiers can reach, so the comparison is not
    # distance-with-a-search against tiers-without-one.
    tier_w, tier_train = best_weights(base_feats["train"])
    tier_val = base_feats["validation"].ndcg(tier_w)
    run.log(
        f"BASELINE  tiers + searched weights:  train {tier_train:.4f}  "
        f"validation {tier_val:.4f}  {tier_w.__dict__}"
    )

    # --- The sweep ---------------------------------------------------------
    run.log("")
    run.log("halflife   train    validation   weights")
    results = []
    for halflife in HALFLIVES:
        cols = {name: distance_column(c, halflife) for name, c in corpora.items()}
        feats = {name: with_location(features[name], cols[name]) for name in corpora}
        weights, train_score = best_weights(feats["train"])
        val_score = feats["validation"].ndcg(weights)
        results.append((halflife, weights, train_score, val_score, feats))
        run.log(
            f"{halflife:7.0f}   {train_score:.4f}   {val_score:.4f}      "
            f"sem {weights.semantic:.2f} tf {weights.tfidf:.2f} "
            f"loc {weights.location:.2f} rep {weights.reputation:.2f}"
        )

    best = max(results, key=lambda r: r[3])
    halflife, weights, train_score, val_score, feats = best

    run.log("")
    run.log(f"best on validation: halflife {halflife:.0f} km, {weights.__dict__}")
    run.log(f"  validation {val_score:.4f} vs tiers {max(baseline_val, tier_val):.4f}")

    gain = val_score - max(baseline_val, tier_val)
    adopt = gain >= args.adopt_margin

    test_score = feats["test"].ndcg(weights)

    run.log("")
    run.log(f"validation gain {gain:+.4f}, margin required {args.adopt_margin:.4f}")
    run.log(f"VERDICT: {'ADOPT distance' if adopt else 'KEEP the tiers'}")
    run.log("")
    run.log(f"REPORTED ON TEST (once): distance {test_score:.4f}  tiers {baseline_test:.4f}")
    if not adopt:
        run.log(
            "The test figure for distance is recorded for completeness and is NOT a "
            "result to report as an improvement: the decision was made on validation "
            "and it was to keep the tiers."
        )

    run.finish(
        {
            "baseline_validation_deployed_weights": baseline_val,
            "baseline_validation_searched_weights": tier_val,
            "baseline_test": baseline_test,
            "baseline_searched_weights": tier_w.__dict__,
            "sweep": [
                {
                    "halflife_km": h,
                    "train_ndcg": t,
                    "validation_ndcg": v,
                    "weights": w.__dict__,
                }
                for h, w, t, v, _ in results
            ],
            "selected_halflife_km": halflife,
            "selected_weights": weights.__dict__,
            "selected_validation_ndcg": val_score,
            "validation_gain": gain,
            "adopted": adopt,
            "test_ndcg": test_score,
        }
    )
    print(f"\nrun written to {run.directory}")


if __name__ == "__main__":
    main()
