"""
Chooses the composite weights, under the split discipline.

    python -m eval.tune_weights

The four coefficients shipped as asserted constants. This replaces the
assertion with a measurement, and keeps each split to its own job:

    train       the grid is searched here — this is the only thing "fitted"
    validation  decides whether the searched weights are adopted at all
    test        reports what the decision is worth, read once at the end

Searching and reporting on the same profiles would measure how well the grid
memorised the corpus. Selecting on validation and reporting on test is what
makes the published gain an estimate of behaviour on a worker the system has
never seen.

One weight is deliberately not searched
---------------------------------------
A signal that does not vary across the gigs being ranked cannot change their
order, so ranking data carries no information about its weight. The grid would
still return a number for it — whatever was left over once the others were
set — and that number would read like a tuned result. `rank_invariant_signals`
detects those signals and holds them fixed instead. See the note there.
"""

import argparse
from dataclasses import dataclass

import numpy as np

from app.services import tfidf_model
from app.services.embeddings import compute_semantic_similarities
from app.services.scoring import (
    DEFAULT_WEIGHTS,
    SHIPPED_WEIGHTS,
    Weights,
    gig_text,
    is_location_match,
    profile_text,
)
from eval import experiment, metrics, plots, splits
from eval.harness import Corpus, load_corpus

GRID_STEP = 0.05
K = 10

SIGNAL_NAMES = ("semantic", "tfidf", "location", "reputation")

# 1 / log2(rank + 1) for ranks 1..K, which is the NDCG discount.
DISCOUNTS = 1.0 / np.log2(np.arange(2, K + 2))


@dataclass
class FeatureMatrix:
    """
    The four signals for a set of profiles against every gig, as arrays.

    Scoring a weight combination is then one matrix product, which is what
    makes an exhaustive search affordable: the embedding model runs once per
    profile rather than once per combination.
    """

    profile_ids: list[str]
    gig_ids: list[str]
    signals: np.ndarray  # (profiles, gigs, 4)
    grades: np.ndarray  # (profiles, gigs)

    def __len__(self) -> int:
        return len(self.profile_ids)

    def subset(self, wanted: list[str]) -> "FeatureMatrix":
        keep = [i for i, pid in enumerate(self.profile_ids) if pid in set(wanted)]
        return FeatureMatrix(
            profile_ids=[self.profile_ids[i] for i in keep],
            gig_ids=self.gig_ids,
            signals=self.signals[keep],
            grades=self.grades[keep],
        )

    def scores(self, weights: Weights) -> np.ndarray:
        vector = np.array([getattr(weights, name) for name in SIGNAL_NAMES])
        return self.signals @ vector

    def ndcg(self, weights: Weights) -> float:
        """
        Mean NDCG@10, computed the same way as eval.metrics.

        Ties are broken by the original gig order, matching the stable sort the
        Python implementation uses, so the two agree exactly rather than
        approximately. `agreement_with_metrics` below checks that.
        """
        scores = self.scores(weights)
        order = np.argsort(-scores, axis=1, kind="stable")[:, :K]

        gains = 2.0 ** np.take_along_axis(self.grades, order, axis=1) - 1
        dcg = (gains * DISCOUNTS).sum(axis=1)

        ideal = -np.sort(-self.grades, axis=1)[:, :K]
        idcg = ((2.0**ideal - 1) * DISCOUNTS).sum(axis=1)

        per_profile = np.where(idcg > 0, dcg / np.where(idcg > 0, idcg, 1), 0.0)
        return float(per_profile.mean()) if len(per_profile) else 0.0

    def ranked_ids(self, weights: Weights) -> dict[str, list[str]]:
        scores = self.scores(weights)
        order = np.argsort(-scores, axis=1, kind="stable")[:, :K]
        return {
            pid: [self.gig_ids[j] for j in order[i]]
            for i, pid in enumerate(self.profile_ids)
        }


def extract_features(corpus: Corpus) -> FeatureMatrix:
    """
    Computes the four signals once, for every profile in the corpus.

    The TF-IDF column comes from the vectoriser fitted on the training split,
    so the search never sees document frequencies learned from validation or
    test gigs.
    """
    if corpus.vectorizer is None:
        raise SystemExit("The corpus was loaded without preprocessing; cannot tune.")

    gig_ids = [g["id"] for g in corpus.gigs]
    texts = [gig_text(g) for g in corpus.gigs]

    profile_ids: list[str] = []
    rows: list[np.ndarray] = []
    grade_rows: list[np.ndarray] = []

    for profile in corpus.profiles:
        text = profile_text(profile)
        location = (profile.get("location") or "").strip()
        reputation = min(max(float(profile.get("reputation_score") or 0), 0.0) / 5.0, 1.0)

        semantic = compute_semantic_similarities(text, texts)
        tfidf = tfidf_model.similarities(corpus.vectorizer, text, texts)

        rows.append(
            np.column_stack(
                [
                    np.asarray(semantic, dtype=float),
                    np.asarray(tfidf, dtype=float),
                    np.array(
                        [1.0 if is_location_match(location, g) else 0.0 for g in corpus.gigs]
                    ),
                    np.full(len(gig_ids), reputation),
                ]
            )
        )

        judged = corpus.grades.get(profile["id"], {})
        grade_rows.append(np.array([judged.get(gid, 0) for gid in gig_ids], dtype=float))
        profile_ids.append(profile["id"])

    return FeatureMatrix(
        profile_ids=profile_ids,
        gig_ids=gig_ids,
        signals=np.stack(rows),
        grades=np.stack(grade_rows),
    )


def rank_invariant_signals(features: FeatureMatrix, tolerance: float = 1e-12) -> list[str]:
    """
    Signals that cannot change a ranking, because they do not vary across the
    candidates being ranked.

    Reputation is the live example. `score_gigs()` reads the *worker's* own
    reputation once and adds the same term to every gig, so it shifts a
    profile's scores up or down as a block and reorders nothing. Its weight is
    therefore unidentifiable from ranking data: the grid would hand back
    whatever was left over after the others were set, and that leftover would
    read like a tuned finding. Holding it fixed is the difference between a
    result and a coincidence.

    Detected rather than hardcoded, so this keeps working if a signal later
    becomes gig-dependent. An *employer's* reputation would be, which is the
    obvious way to make this term earn its place.
    """
    within_profile_spread = features.signals.std(axis=1).max(axis=0)
    return [
        name
        for name, spread in zip(SIGNAL_NAMES, within_profile_spread)
        if spread < tolerance
    ]


def label_uninformative_signals(
    features: FeatureMatrix, threshold: float = 0.05
) -> dict[str, float]:
    """
    Signals the relevance labels say nothing about, with their correlations.

    Location is the live example. Grades in this corpus are derived from
    distance in the KeSCO occupational hierarchy, and `build_corpus` assigns
    each gig a town independently at random, so a gig in the worker's town is
    no more likely to be graded relevant than one anywhere else. Measured
    across the corpus the correlation is about -0.003, and the mean grade is
    the same either way.

    That makes the location weight untunable here, and the consequence is a
    trap rather than merely a gap: against labels that cannot reward it, any
    weight on location only dilutes the signals that can be rewarded, so a
    grid search will confidently drive it to zero. It would then look as though
    the experiment had shown location to be useless to workers, when all it
    showed is that this ground truth never encoded it.

    Holding such signals fixed keeps the search honest. Measuring whether
    location actually helps needs labels that vary with it — a grading rule
    that accounts for travel, or a human annotation pass that does.
    """
    grades = features.grades.ravel()
    uninformative: dict[str, float] = {}

    for index, name in enumerate(SIGNAL_NAMES):
        column = features.signals[:, :, index].ravel()
        if column.std() < 1e-12:
            continue  # constant overall; rank_invariant_signals reports it
        correlation = float(np.corrcoef(column, grades)[0, 1])
        if abs(correlation) < threshold:
            uninformative[name] = correlation

    return uninformative


def candidate_weights(
    step: float = GRID_STEP, fixed: dict[str, float] | None = None
) -> list[Weights]:
    """
    Every combination on a 0.05 grid whose weights sum to 1.

    Signals named in `fixed` are held at the given value and the grid covers
    the rest. Constraining the total to 1 keeps scores comparable to the
    current system and keeps the displayed percentage meaningful.
    """
    fixed = dict(fixed or {})
    active = [name for name in SIGNAL_NAMES if name not in fixed]
    if not active:
        raise SystemExit("Every signal is fixed; there is nothing to search.")

    budget = 1.0 - sum(fixed.values())
    if budget <= 0:
        raise SystemExit("The fixed weights leave no budget for the searched signals.")

    steps = int(round(budget / step))
    out: list[Weights] = []

    def walk(index: int, remaining: int, counts: list[int]) -> None:
        if index == len(active) - 1:
            values = dict(fixed)
            for name, count in zip(active, counts + [remaining]):
                values[name] = round(count * step, 4)
            out.append(Weights(**values))
            return
        for take in range(remaining + 1):
            walk(index + 1, remaining - take, counts + [take])

    walk(0, steps, [])
    return out


def agreement_with_metrics(
    features: FeatureMatrix, corpus: Corpus, weights: Weights
) -> float:
    """
    Cross-checks the fast NDCG against the reference implementation.

    The vectorised version exists for speed, and a tuner that optimised a
    subtly different metric from the one reported would be worse than no tuner
    at all. Returns the absolute disagreement.
    """
    ranked = features.ranked_ids(weights)
    reference = metrics.mean(
        [
            metrics.ndcg_at_k(ranked[pid], corpus.grades.get(pid, {}), K)
            for pid in features.profile_ids
        ]
    )
    return abs(reference - features.ndcg(weights))


def show(label: str, w: Weights, score: float) -> None:
    print(
        f"  {label:<26} semantic {w.semantic:.2f}  tfidf {w.tfidf:.2f}  "
        f"location {w.location:.2f}  reputation {w.reputation:.2f}   NDCG@10 {score:.4f}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--adopt-margin",
        type=float,
        default=0.005,
        help="validation gain required before the searched weights are adopted",
    )
    parser.add_argument("--note", default="", help="free text recorded in the manifest")
    args = parser.parse_args()

    full = load_corpus()

    run = experiment.Run(
        name="tune-weights",
        params={
            "grid_step": GRID_STEP,
            "metric": f"ndcg_at_{K}",
            "search_split": "train",
            "selection_split": "validation",
            "reporting_split": "test",
            "adopt_margin": args.adopt_margin,
            "shipped_weights": SHIPPED_WEIGHTS.__dict__,
            "current_weights": DEFAULT_WEIGHTS.__dict__,
            "tfidf_fitted_on": "train",
        },
        seeds={"split": splits.SPLIT_SEED},
        dataset_version=full.dataset_version,
        notes=args.note,
    )

    run.log(f"dataset version {full.dataset_version}")
    run.log("Extracting features (the embedding model runs once per profile)...")
    features = extract_features(full)

    train = features.subset(full.assignment.train)
    validation = features.subset(full.assignment.validation)
    held_out = features.subset(full.assignment.test)
    run.log(
        f"profiles: {len(train)} train / {len(validation)} validation / {len(held_out)} test"
    )

    drift = agreement_with_metrics(train, full, DEFAULT_WEIGHTS)
    run.log(f"fast NDCG agrees with eval.metrics to {drift:.2e}")
    if drift > 1e-9:
        raise SystemExit(
            f"The vectorised NDCG disagrees with eval.metrics by {drift:.2e}. "
            "Tuning against a different metric from the reported one is not safe."
        )

    # -- what can actually be tuned ---------------------------------------

    invariant = rank_invariant_signals(features)
    uninformative = label_uninformative_signals(features)

    # Both kinds are held at their current value. Searching a weight the data
    # cannot speak to does not leave it undetermined; it returns a confident
    # number for the wrong reason.
    held = list(invariant) + [n for n in uninformative if n not in invariant]
    fixed = {name: getattr(DEFAULT_WEIGHTS, name) for name in held}

    for name in invariant:
        run.log(
            f"holding {name}={fixed[name]:.2f}: constant across the candidates "
            "being ranked, so it cannot change their order"
        )
    for name, correlation in uninformative.items():
        if name in invariant:
            continue
        run.log(
            f"holding {name}={fixed[name]:.2f}: correlation with the relevance "
            f"grade is {correlation:+.4f}, so the labels carry no information "
            "about its weight"
        )

    grid = candidate_weights(GRID_STEP, fixed)
    run.params["fixed_weights"] = fixed
    run.params["rank_invariant_signals"] = invariant
    run.params["label_uninformative_signals"] = uninformative
    run.params["searched_signals"] = [n for n in SIGNAL_NAMES if n not in fixed]
    run.params["combinations"] = len(grid)

    # -- search, on train only -------------------------------------------

    run.log(f"Searching {len(grid)} weight combinations on the train split...")
    scored = sorted(((train.ndcg(w), w) for w in grid), key=lambda pair: -pair[0])
    best_train_score, best_train = scored[0]

    print("\nTrain split (where the search happens)")
    show("current weights", DEFAULT_WEIGHTS, train.ndcg(DEFAULT_WEIGHTS))
    show("best found", best_train, best_train_score)

    print("\n  next best combinations on train:")
    for score, w in scored[1:6]:
        show("", w, score)

    # -- select, on validation -------------------------------------------

    validation_current = validation.ndcg(DEFAULT_WEIGHTS)
    validation_best = validation.ndcg(best_train)
    gain = validation_best - validation_current

    print("\nValidation split (where the decision is made)")
    show("current weights", DEFAULT_WEIGHTS, validation_current)
    show("weights found on train", best_train, validation_best)
    print(f"\n  validation gain: {gain:+.4f}  (adopt if > {args.adopt_margin:+.4f})")

    adopt = gain > args.adopt_margin
    chosen = best_train if adopt else DEFAULT_WEIGHTS
    run.log(
        f"decision: {'adopt the searched weights' if adopt else 'keep the current weights'}"
    )

    # -- report, on test --------------------------------------------------

    test_chosen = held_out.ndcg(chosen)
    test_current = held_out.ndcg(DEFAULT_WEIGHTS)

    print("\nTest split (read once, reported as the final figure)")
    show("chosen weights", chosen, test_chosen)
    if adopt:
        show("current weights", DEFAULT_WEIGHTS, test_current)
        print(f"\n  test gain of the change: {test_chosen - test_current:+.4f}")

    # -- evidence ---------------------------------------------------------

    plots.weight_sensitivity(
        scored, run.artefact_path("weight_sensitivity.png"), train.ndcg(DEFAULT_WEIGHTS)
    )

    run.write_json(
        "grid_top50.json",
        [{"weights": w.__dict__, "train_ndcg_at_10": s} for s, w in scored[:50]],
    )
    run.write_json("predictions_test.json", held_out.ranked_ids(chosen))
    run.write_json("splits.json", full.assignment.as_dict())
    tfidf_model.save(full.vectorizer, run.artefact_path("tfidf_vectorizer.joblib"))

    directory = run.finish(
        {
            "rank_invariant_signals": invariant,
            "label_uninformative_signals": uninformative,
            "searched_signals": [n for n in SIGNAL_NAMES if n not in fixed],
            "fixed_weights": fixed,
            "train": {
                "current": {
                    "weights": DEFAULT_WEIGHTS.__dict__,
                    "ndcg_at_10": train.ndcg(DEFAULT_WEIGHTS),
                },
                "best_found": {
                    "weights": best_train.__dict__,
                    "ndcg_at_10": best_train_score,
                },
            },
            "validation": {
                "current_ndcg_at_10": validation_current,
                "best_found_ndcg_at_10": validation_best,
                "gain": gain,
                "adopt_margin": args.adopt_margin,
                "adopted": adopt,
            },
            "test": {
                "chosen_weights": chosen.__dict__,
                "chosen_ndcg_at_10": test_chosen,
                "current_ndcg_at_10": test_current,
                "gain": test_chosen - test_current,
            },
        }
    )

    if adopt:
        print(
            "\nTo ship these, set MATCH_WEIGHT_SEMANTIC / _TFIDF / _LOCATION / "
            "_REPUTATION\nor update DEFAULT_WEIGHTS in app/services/scoring.py."
        )
    else:
        print(
            "\nThe search did not clear the validation margin, so the current "
            "weights stand.\nThat is a result, not a failure - it is evidence the "
            "shipped weights are not\nleaving much on the table."
        )

    if fixed:
        print(
            "\nWeights held fixed rather than searched:"
        )
        for name in invariant:
            print(
                f"  {name:<12} constant across the candidates being ranked, so it "
                "cannot\n               change their order. Ranking data does not "
                "determine its weight."
            )
        for name, correlation in uninformative.items():
            if name in invariant:
                continue
            print(
                f"  {name:<12} correlation with the relevance grade is "
                f"{correlation:+.4f}, so the\n               labels carry no "
                "information about this weight. A search would\n"
                "               drive it to zero only because it dilutes the "
                "signals the\n               labels do reward."
            )
        print(
            "\nThese are limits of the ground truth, not findings about the "
            "signals.\nDeciding what either weight should be needs labels that "
            "vary with them."
        )

    print(f"\nRun saved to {directory}\n")


if __name__ == "__main__":
    main()
