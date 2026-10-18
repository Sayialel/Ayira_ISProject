"""
Does the two-stage retrieval cost any quality?

    python -m eval.retrieval_eval

The engine replaced "score every open gig" with "let Postgres return the
nearest N by vector, then re-rank those with the full composite". That is
faster by construction, but it can only rank what the shortlist contains: a
gig the composite would have placed highly can be missed if semantic
similarity alone did not put it in the top N.

This measures that loss directly, by simulating the shortlist at several sizes
and comparing against scoring the whole catalogue.

Choosing the shortlist size is a development decision, so it is made on the
validation split.
"""

import argparse

import numpy as np

from app.services import tfidf_model
from app.services.scoring import DEFAULT_WEIGHTS, Weights
from eval import experiment, metrics, plots, splits
from eval.harness import load_corpus
from eval.tune_weights import FeatureMatrix, extract_features

POOL_SIZES = [3, 5, 10, 15, 20, 30, None]


def rank_with_pool(
    features: FeatureMatrix, index: int, weights: Weights, pool: int | None
) -> list[str]:
    """
    Ranks as the live engine does.

    `pool` is the shortlist size: the top N by semantic similarity are kept,
    then re-ranked by the full composite. None means no shortlist at all, which
    is the exhaustive behaviour the engine had before.
    """
    semantic = features.signals[index, :, 0]
    composite = features.scores(weights)[index]

    shortlist = np.argsort(-semantic, kind="stable")
    if pool is not None:
        shortlist = shortlist[:pool]

    reranked = shortlist[np.argsort(-composite[shortlist], kind="stable")]
    return [features.gig_ids[j] for j in reranked]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--split",
        default="validation",
        choices=["train", "validation", "test"],
        help="which split to measure on (default: validation)",
    )
    parser.add_argument("--note", default="", help="free text recorded in the manifest")
    args = parser.parse_args()

    full = load_corpus()
    corpus = full.for_split(args.split)

    run = experiment.Run(
        name=f"retrieval-{args.split}",
        params={
            "split": args.split,
            "pool_sizes": [p if p is not None else "exhaustive" for p in POOL_SIZES],
            "weights": DEFAULT_WEIGHTS.__dict__,
            "metric": "ndcg_at_10",
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
    total_gigs = len(corpus.gigs)
    rows = []

    for pool in POOL_SIZES:
        ndcg, p5, r10 = [], [], []
        for index, profile_id in enumerate(features.profile_ids):
            grades = corpus.grades.get(profile_id, {})
            ranked = rank_with_pool(features, index, DEFAULT_WEIGHTS, pool)
            ndcg.append(metrics.ndcg_at_k(ranked, grades, 10))
            p5.append(metrics.precision_at_k(ranked, grades, 5))
            r10.append(metrics.recall_at_k(ranked, grades, 10))
        rows.append(
            {
                "pool": "exhaustive" if pool is None else str(pool),
                "ndcg_at_10": metrics.mean(ndcg),
                "precision_at_5": metrics.mean(p5),
                "recall_at_10": metrics.mean(r10),
            }
        )

    baseline = rows[-1]["ndcg_at_10"]

    print(f"\n{'shortlist':<12}{'NDCG@10':>10}{'P@5':>8}{'R@10':>8}{'vs exhaustive':>16}")
    print("-" * 54)
    for row in rows:
        delta = row["ndcg_at_10"] - baseline
        marker = "" if abs(delta) < 1e-9 else f"{delta:+.4f}"
        print(
            f"{row['pool']:<12}{row['ndcg_at_10']:>10.4f}{row['precision_at_5']:>8.3f}"
            f"{row['recall_at_10']:>8.3f}{marker:>16}"
        )

    print(
        "\nA shortlist at least as large as the catalogue is exact by definition,"
        f"\nso anything >= {total_gigs} here matches exhaustive scoring. The rows below"
        "\nthat show what a shortlist actually costs once the catalogue outgrows it."
    )

    # The smallest shortlist that gives up nothing measurable: the number the
    # engine should use, and the reason to prefer it over a larger one.
    lossless = next(
        (
            row["pool"]
            for row in rows
            if row["pool"] != "exhaustive" and baseline - row["ndcg_at_10"] < 1e-9
        ),
        None,
    )
    if lossless:
        run.log(f"smallest lossless shortlist on this corpus: {lossless}")

    plots.shortlist_curve(rows, run.artefact_path("shortlist_curve.png"), total_gigs)
    run.write_json("splits.json", full.assignment.as_dict())
    tfidf_model.save(full.vectorizer, run.artefact_path("tfidf_vectorizer.joblib"))

    directory = run.finish(
        {
            "split": args.split,
            "corpus_gigs": total_gigs,
            "profiles": len(features),
            "exhaustive_ndcg_at_10": baseline,
            "smallest_lossless_shortlist": lossless,
            "rows": rows,
        }
    )

    print(f"\nRun saved to {directory}\n")


if __name__ == "__main__":
    main()
