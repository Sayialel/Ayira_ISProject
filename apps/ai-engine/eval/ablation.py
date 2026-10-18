"""
What each signal contributes.

    python -m eval.ablation                  # validation
    python -m eval.ablation --split test     # final figures, once

The composite weights four signals. This measures what happens when each is
removed, and what happens when each is used alone, so the contribution of a
signal is a measurement rather than an assumption.

Why this is not the same as tuning
----------------------------------
`eval.tune_weights` asks "what is the best weighting of the signals we have".
This asks the prior question: "is this signal pulling its weight at all". A
signal that costs quality when added is worth removing regardless of how its
weight is tuned, and a signal the labels cannot judge will show up here as
noise rather than as a contribution.

Weights are renormalised to sum to 1 within each subset, so the subsets stay
comparable to each other and to the shipped composite. Dropping a signal
therefore redistributes its weight across the rest in their existing
proportions, rather than shrinking the total score.
"""

import argparse
from itertools import combinations

from app.services import tfidf_model
from app.services.scoring import DEFAULT_WEIGHTS, Weights
from eval import experiment, metrics, plots, splits
from eval.harness import load_corpus
from eval.tune_weights import (
    SIGNAL_NAMES,
    FeatureMatrix,
    extract_features,
    label_uninformative_signals,
    rank_invariant_signals,
)

K = 10


def renormalised(active: tuple[str, ...], base: Weights = DEFAULT_WEIGHTS) -> Weights:
    """
    The base weights restricted to `active`, rescaled to sum to 1.

    Keeping the total at 1 is what makes two subsets comparable: otherwise a
    subset would score lower simply because fewer terms contributed, and the
    comparison would measure the number of signals rather than their quality.
    """
    kept = {name: getattr(base, name) for name in active}
    total = sum(kept.values())
    if total <= 0:
        # A subset whose base weights are all zero still needs to be scored,
        # so share the weight equally rather than dividing by zero.
        kept = {name: 1.0 / len(active) for name in active}
        total = 1.0

    return Weights(**{name: kept.get(name, 0.0) / total for name in SIGNAL_NAMES})


def evaluate_subset(features: FeatureMatrix, corpus, active: tuple[str, ...]) -> dict:
    weights = renormalised(active)
    ranked = features.ranked_ids(weights)

    def mean(fn) -> float:
        return metrics.mean(
            [fn(ranked[pid], corpus.grades.get(pid, {})) for pid in features.profile_ids]
        )

    return {
        "signals": list(active),
        "weights": weights.__dict__,
        "ndcg_at_10": features.ndcg(weights),
        "ndcg_at_5": mean(lambda r, g: metrics.ndcg_at_k(r, g, 5)),
        "precision_at_5": mean(lambda r, g: metrics.precision_at_k(r, g, 5)),
        "recall_at_10": mean(lambda r, g: metrics.recall_at_k(r, g, 10)),
        "mrr": mean(metrics.reciprocal_rank),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--split", default="validation", choices=["train", "validation", "test"]
    )
    parser.add_argument("--note", default="", help="free text recorded in the manifest")
    args = parser.parse_args()

    full = load_corpus()
    corpus = full.for_split(args.split)

    run = experiment.Run(
        name=f"ablation-{args.split}",
        params={
            "split": args.split,
            "base_weights": DEFAULT_WEIGHTS.__dict__,
            "renormalised": True,
            "metric": f"ndcg_at_{K}",
            "tfidf_fitted_on": "train",
        },
        seeds={"split": splits.SPLIT_SEED},
        dataset_version=full.dataset_version,
        notes=args.note,
    )

    run.log(corpus.describe())
    run.log(f"dataset version {full.dataset_version}")
    run.log("Extracting features...")
    features = extract_features(corpus)

    # Recorded alongside the results, because a signal the labels cannot judge
    # will look like a pure cost here, and that reading would be wrong.
    invariant = rank_invariant_signals(extract_features(full))
    uninformative = label_uninformative_signals(extract_features(full))
    run.params["rank_invariant_signals"] = invariant
    run.params["label_uninformative_signals"] = uninformative

    all_signals = tuple(SIGNAL_NAMES)
    rows = []

    # Each signal alone.
    for name in all_signals:
        rows.append((f"{name} alone", evaluate_subset(features, corpus, (name,))))

    # Everything, then everything minus one.
    rows.append(("full", evaluate_subset(features, corpus, all_signals)))
    for name in all_signals:
        rest = tuple(n for n in all_signals if n != name)
        rows.append((f"without {name}", evaluate_subset(features, corpus, rest)))

    # The text pair on its own, which the full composite has to beat to justify
    # the two signals the labels cannot judge.
    rows.append(("text only", evaluate_subset(features, corpus, ("semantic", "tfidf"))))

    full_ndcg = next(r for label, r in rows if label == "full")["ndcg_at_10"]

    print(f"\nAblation on the {args.split} split ({len(features)} profiles)\n")
    header = f"{'subset':<22}{'NDCG@5':>9}{'NDCG@10':>10}{'P@5':>8}{'R@10':>8}{'vs full':>10}"
    print(header)
    print("-" * len(header))
    for label, row in rows:
        delta = row["ndcg_at_10"] - full_ndcg
        marker = "" if abs(delta) < 1e-9 else f"{delta:+.4f}"
        print(
            f"{label:<22}{row['ndcg_at_5']:>9.4f}{row['ndcg_at_10']:>10.4f}"
            f"{row['precision_at_5']:>8.3f}{row['recall_at_10']:>8.3f}{marker:>10}"
        )

    print(
        "\n'without X' better than 'full' means X is costing quality at its "
        "current weight."
    )
    if uninformative:
        print(
            f"\nNote: {', '.join(uninformative)} "
            f"{'are' if len(uninformative) > 1 else 'is'} uncorrelated with the "
            "relevance grades\n(see the manifest), so the cost shown here is "
            "what an unjudgeable signal does to\nthis metric -- not evidence "
            "that the signal is useless to a worker."
        )

    run.write_json("ablation.json", [{"label": label, **row} for label, row in rows])
    run.write_json("splits.json", full.assignment.as_dict())
    tfidf_model.save(full.vectorizer, run.artefact_path("tfidf_vectorizer.joblib"))

    class _Row:
        def __init__(self, label, row):
            self.name = label
            self.precision_at_5 = row["precision_at_5"]
            self.precision_at_10 = row["precision_at_5"]
            self.recall_at_10 = row["recall_at_10"]
            self.mrr = row["mrr"]
            self.ndcg_at_10 = row["ndcg_at_10"]

    highlights = ("semantic alone", "tfidf alone", "text only", "full")
    plots.baseline_comparison(
        [_Row(label, row) for label, row in rows if label in highlights],
        run.artefact_path("ablation.png"),
        title=f"Signal ablation, {args.split} split",
    )

    directory = run.finish(
        {
            "split": args.split,
            "full_ndcg_at_10": full_ndcg,
            "rows": [{"label": label, **row} for label, row in rows],
        }
    )
    print(f"\nRun saved to {directory}\n")


if __name__ == "__main__":
    main()
