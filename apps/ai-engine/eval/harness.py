"""
Shared plumbing for the evaluation: loading the corpus, running a ranking
strategy over every profile, and reporting the averaged metrics.
"""

import csv
import json
import random
from dataclasses import dataclass
from pathlib import Path

from app.services.embeddings import (
    compute_semantic_similarities,
    compute_tfidf_similarities,
)
from app.services.scoring import (
    DEFAULT_WEIGHTS,
    Weights,
    gig_text,
    is_location_match,
    profile_text,
    score_gigs,
)
from eval import metrics

CORPUS_DIR = Path(__file__).resolve().parent / "corpus"
RESULTS_DIR = Path(__file__).resolve().parent / "results"


@dataclass
class Corpus:
    profiles: list[dict]
    gigs: list[dict]
    # worker_id -> {gig_id: grade}
    grades: dict[str, dict[str, int]]


def load_corpus() -> Corpus:
    profiles = json.loads((CORPUS_DIR / "profiles.json").read_text(encoding="utf-8"))
    gigs = json.loads((CORPUS_DIR / "gigs.json").read_text(encoding="utf-8"))

    grades: dict[str, dict[str, int]] = {p["id"]: {} for p in profiles}

    text = (CORPUS_DIR / "relevance.csv").read_text(encoding="utf-8-sig")
    # Comment lines carry the grading scheme; skip them before parsing.
    rows = [line for line in text.splitlines() if line.strip() and not line.startswith("#")]

    for row in csv.DictReader(rows):
        grades.setdefault(row["worker_id"], {})[row["gig_id"]] = int(row["grade"])

    _validate(profiles, gigs, grades)
    return Corpus(profiles=profiles, gigs=gigs, grades=grades)


def _validate(profiles: list[dict], gigs: list[dict], grades: dict[str, dict[str, int]]) -> None:
    """A typo in an id would silently grade a pair as irrelevant, so fail loudly."""
    profile_ids = {p["id"] for p in profiles}
    gig_ids = {g["id"] for g in gigs}

    for worker_id, judged in grades.items():
        if worker_id not in profile_ids:
            raise ValueError(f"relevance.csv references unknown worker '{worker_id}'")
        for gig_id in judged:
            if gig_id not in gig_ids:
                raise ValueError(f"relevance.csv references unknown gig '{gig_id}'")


# ---------------------------------------------------------------------------
# Ranking strategies. Each takes a profile and the gig list, and returns gig
# ids best-first.
# ---------------------------------------------------------------------------


def rank_random(profile: dict, gigs: list[dict], seed: int = 0) -> list[str]:
    """The floor. Any strategy that cannot beat this is doing nothing."""
    ids = [g["id"] for g in gigs]
    random.Random(f"{profile['id']}-{seed}").shuffle(ids)
    return ids


def rank_tfidf_only(profile: dict, gigs: list[dict]) -> list[str]:
    """Keyword overlap alone — the classic pre-neural baseline."""
    scores = compute_tfidf_similarities(profile_text(profile), [gig_text(g) for g in gigs])
    return [g["id"] for g, _ in sorted(zip(gigs, scores), key=lambda p: p[1], reverse=True)]


def rank_semantic_only(profile: dict, gigs: list[dict]) -> list[str]:
    """The embedding model on its own, with no other signal."""
    scores = compute_semantic_similarities(profile_text(profile), [gig_text(g) for g in gigs])
    return [g["id"] for g, _ in sorted(zip(gigs, scores), key=lambda p: p[1], reverse=True)]


def rank_composite(profile: dict, gigs: list[dict], weights: Weights = DEFAULT_WEIGHTS) -> list[str]:
    """The live system: the full weighted composite."""
    return [s.gig_id for s in score_gigs(profile, gigs, weights)]


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------


@dataclass
class Result:
    name: str
    precision_at_5: float
    precision_at_10: float
    recall_at_10: float
    mrr: float
    ndcg_at_10: float

    def as_row(self) -> list[str]:
        return [
            self.name,
            f"{self.precision_at_5:.3f}",
            f"{self.precision_at_10:.3f}",
            f"{self.recall_at_10:.3f}",
            f"{self.mrr:.3f}",
            f"{self.ndcg_at_10:.3f}",
        ]


def evaluate(name: str, rank_fn, corpus: Corpus) -> Result:
    """Runs one strategy across every profile and averages the metrics."""
    p5, p10, r10, rr, ndcg = [], [], [], [], []

    for profile in corpus.profiles:
        ranked = rank_fn(profile, corpus.gigs)
        grades = corpus.grades.get(profile["id"], {})

        p5.append(metrics.precision_at_k(ranked, grades, 5))
        p10.append(metrics.precision_at_k(ranked, grades, 10))
        r10.append(metrics.recall_at_k(ranked, grades, 10))
        rr.append(metrics.reciprocal_rank(ranked, grades))
        ndcg.append(metrics.ndcg_at_k(ranked, grades, 10))

    return Result(
        name=name,
        precision_at_5=metrics.mean(p5),
        precision_at_10=metrics.mean(p10),
        recall_at_10=metrics.mean(r10),
        mrr=metrics.mean(rr),
        ndcg_at_10=metrics.mean(ndcg),
    )


HEADERS = ["strategy", "P@5", "P@10", "R@10", "MRR", "NDCG@10"]


def print_table(results: list[Result]) -> None:
    rows = [HEADERS] + [r.as_row() for r in results]
    widths = [max(len(row[i]) for row in rows) for i in range(len(HEADERS))]

    def line(row: list[str]) -> str:
        cells = [row[0].ljust(widths[0])]
        cells += [row[i].rjust(widths[i]) for i in range(1, len(row))]
        return "  ".join(cells)

    print(line(rows[0]))
    print("  ".join("-" * w for w in widths))
    for row in rows[1:]:
        print(line(row))
