"""
Evaluates the matching engine against the fixture corpus.

    python -m eval.run_eval

Reports the live composite alongside three baselines, so the question is not
"does it produce a number?" but "does it beat keyword matching, does it beat
the embedding model alone, and by how much?"
"""

import json
from datetime import datetime, timezone

from app.services.scoring import DEFAULT_WEIGHTS, SHIPPED_WEIGHTS
from eval.harness import (
    RESULTS_DIR,
    evaluate,
    load_corpus,
    print_table,
    rank_composite,
    rank_random,
    rank_semantic_only,
    rank_tfidf_only,
)


def main() -> None:
    corpus = load_corpus()
    judged = sum(len(v) for v in corpus.grades.values())

    print(f"\nCorpus: {len(corpus.profiles)} profiles x {len(corpus.gigs)} gigs")
    print(f"        {judged} graded pairs, the remaining {len(corpus.profiles) * len(corpus.gigs) - judged} treated as irrelevant\n")

    results = [
        evaluate("random", rank_random, corpus),
        evaluate("tfidf only", rank_tfidf_only, corpus),
        evaluate("semantic only", rank_semantic_only, corpus),
        evaluate(
            "composite (shipped)",
            lambda p, g: rank_composite(p, g, SHIPPED_WEIGHTS),
            corpus,
        ),
        evaluate(
            "composite (tuned)",
            lambda p, g: rank_composite(p, g, DEFAULT_WEIGHTS),
            corpus,
        ),
    ]

    print_table(results)

    RESULTS_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = RESULTS_DIR / f"baseline-{stamp}.json"
    path.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "corpus": {
                    "profiles": len(corpus.profiles),
                    "gigs": len(corpus.gigs),
                    "graded_pairs": judged,
                },
                "results": [r.__dict__ for r in results],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nWritten to {path.relative_to(path.parents[2])}\n")


if __name__ == "__main__":
    main()
