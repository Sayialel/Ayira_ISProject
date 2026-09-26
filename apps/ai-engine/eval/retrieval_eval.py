"""
Does the two-stage retrieval cost any quality?

    python -m eval.retrieval_eval

Block 4 replaced "score every open gig" with "let Postgres return the nearest
N by vector, then re-rank those with the full composite". That is faster by
construction, but it can only rank what the shortlist contains: a gig the
composite would have placed highly can be missed if semantic similarity alone
did not put it in the top N.

This measures that loss directly, by simulating the shortlist at several sizes
and comparing against scoring the whole catalogue.
"""

import json
from datetime import datetime, timezone

from app.services.scoring import DEFAULT_WEIGHTS, composite_score, is_location_match
from eval import metrics
from eval.harness import RESULTS_DIR, load_corpus
from eval.tune_weights import extract_features


def rank_with_pool(features, corpus, pool: int | None) -> list[str]:
    """
    Ranks as the live engine does.

    `pool` is the shortlist size: the top N by semantic similarity are kept,
    then re-ranked by the full composite. None means no shortlist at all, which
    is the exhaustive behaviour the engine had before.
    """
    by_index = sorted(range(len(features.gig_ids)), key=lambda i: -features.semantic[i])
    kept = by_index if pool is None else by_index[:pool]

    scored = [
        (
            features.gig_ids[i],
            composite_score(
                features.semantic[i],
                features.tfidf[i],
                bool(features.location[i]),
                features.reputation * 5.0,  # composite_score renormalises
                DEFAULT_WEIGHTS,
            ),
        )
        for i in kept
    ]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return [gig_id for gig_id, _ in scored]


def main() -> None:
    corpus = load_corpus()
    features = extract_features(corpus)
    total_gigs = len(corpus.gigs)

    print(f"\nCorpus: {len(corpus.profiles)} profiles x {total_gigs} gigs\n")

    pools = [3, 5, 10, 15, 20, 30, None]
    rows = []

    for pool in pools:
        ndcg, p5, r10 = [], [], []
        for f in features:
            grades = corpus.grades.get(f.profile_id, {})
            ranked = rank_with_pool(f, corpus, pool)
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

    print(f"{'shortlist':<12}{'NDCG@10':>10}{'P@5':>8}{'R@10':>8}{'vs exhaustive':>16}")
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

    RESULTS_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = RESULTS_DIR / f"retrieval-{stamp}.json"
    path.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "corpus_gigs": total_gigs,
                "rows": rows,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nWritten to {path.relative_to(path.parents[2])}\n")


if __name__ == "__main__":
    main()
