"""
Evaluates the matching engine against the fixture corpus.

    python -m eval.run_eval                  # validation — the development figure
    python -m eval.run_eval --split test     # the final reported figure, once
    python -m eval.run_eval --split train    # diagnostic only

Reports the live composite alongside three baselines, so the question is not
"does it produce a number?" but "does it beat keyword matching, does it beat
the embedding model alone, and by how much?"

Which split to use
------------------
Validation is the default because that is where development decisions belong.
The test split answers a different question — how the system does on workers
nothing was chosen on — and it is only meaningful while it stays unused. Every
run records which split it read, so a test figure quoted in the write-up can be
traced to the one run that produced it.
"""

import argparse

from app.services import tfidf_model
from app.services.scoring import DEFAULT_WEIGHTS, SHIPPED_WEIGHTS
from eval import experiment, plots, splits
from eval.harness import (
    evaluate,
    format_table,
    load_corpus,
    print_table,
    rank_composite,
    rank_random,
    rank_semantic_only,
    rank_tfidf_only,
)

RANDOM_SEED = 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--split",
        default="validation",
        choices=["train", "validation", "test"],
        help="which split to evaluate on (default: validation)",
    )
    parser.add_argument(
        "--note", default="", help="free text recorded in the run manifest"
    )
    args = parser.parse_args()

    full = load_corpus()
    corpus = full.for_split(args.split)

    if not corpus.profiles:
        raise SystemExit(f"The {args.split} split contains no profiles.")

    run = experiment.Run(
        name=f"baselines-{args.split}",
        params={
            "split": args.split,
            "weights_shipped": SHIPPED_WEIGHTS.__dict__,
            "weights_tuned": DEFAULT_WEIGHTS.__dict__,
            "tfidf_fitted_on": "train",
            "tfidf_vocabulary_size": len(corpus.vectorizer.vocabulary_),
            "metrics_at_k": {"precision": [5, 10], "recall": [10], "ndcg": [10]},
        },
        seeds={"random_baseline": RANDOM_SEED, "split": splits.SPLIT_SEED},
        dataset_version=corpus.dataset_version,
        notes=args.note,
    )

    if args.split == "test":
        run.log(
            "NOTE: this reads the test split. It is the final figure, not a "
            "development one — do not tune against it."
        )

    run.log(corpus.describe())
    run.log(
        f"splits: {len(full.assignment.train)} train / "
        f"{len(full.assignment.validation)} validation / "
        f"{len(full.assignment.test)} test  (by profile)"
    )
    run.log(f"dataset version {corpus.dataset_version}")

    vectorizer = corpus.vectorizer

    results = [
        evaluate("random", lambda p, g: rank_random(p, g, RANDOM_SEED), corpus),
        evaluate("tfidf only", lambda p, g: rank_tfidf_only(p, g, vectorizer), corpus),
        evaluate("semantic only", rank_semantic_only, corpus),
        evaluate(
            "composite (shipped)",
            lambda p, g: rank_composite(p, g, SHIPPED_WEIGHTS, vectorizer),
            corpus,
        ),
        evaluate(
            "composite (tuned)",
            lambda p, g: rank_composite(p, g, DEFAULT_WEIGHTS, vectorizer),
            corpus,
        ),
    ]

    print()
    print_table(results)

    # -- evidence ---------------------------------------------------------
    #
    # Everything needed to defend or reproduce the table above: the metrics,
    # the rankings they were computed from, the preprocessing artefact that
    # produced the TF-IDF column, and the split assignment.

    run.write_text("metrics.txt", format_table(results))
    run.write_json(
        "predictions.json",
        {r.name: r.predictions for r in results},
    )
    run.write_json("splits.json", full.assignment.as_dict())
    tfidf_model.save(vectorizer, run.artefact_path("tfidf_vectorizer.joblib"))

    plots.baseline_comparison(
        results,
        run.artefact_path("baselines.png"),
        title=f"Ranking quality on the {args.split} split ({len(corpus.profiles)} profiles)",
    )

    composite = next(r for r in results if r.name == "composite (tuned)")
    semantic = next(r for r in results if r.name == "semantic only")
    tfidf = next(r for r in results if r.name == "tfidf only")

    directory = run.finish(
        {
            "split": args.split,
            "corpus": {
                "profiles": len(corpus.profiles),
                "gigs": len(corpus.gigs),
                "graded_pairs": sum(
                    len(corpus.grades.get(p["id"], {})) for p in corpus.profiles
                ),
            },
            "results": [r.as_metrics() for r in results],
            "headline": {
                "ndcg_at_10": composite.ndcg_at_10,
                "gain_over_semantic_only": composite.ndcg_at_10 - semantic.ndcg_at_10,
                "gain_over_tfidf_only": composite.ndcg_at_10 - tfidf.ndcg_at_10,
            },
        }
    )

    print(f"\nRun saved to {directory}\n")


if __name__ == "__main__":
    main()
