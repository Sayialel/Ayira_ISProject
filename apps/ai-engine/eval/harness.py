"""
Shared plumbing for the evaluation: loading the corpus, fitting preprocessing
on the training split, running a ranking strategy over a split, and reporting
the averaged metrics.

The split discipline lives here rather than in each script, so no experiment
can quietly evaluate on the wrong rows:

    corpus = load_corpus()                   # fits TF-IDF on train only
    dev    = corpus.for_split("validation")  # development decisions
    final  = corpus.for_split("test")        # reported once
"""

import csv
import json
import random
from dataclasses import dataclass, field
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer

from app.services import tfidf_model
from app.services.embeddings import compute_semantic_similarities
from app.services.scoring import (
    DEFAULT_WEIGHTS,
    Weights,
    gig_text,
    profile_text,
    score_gigs,
)
from eval import metrics, splits

CORPUS_DIR = Path(__file__).resolve().parent / "corpus"
RESULTS_DIR = Path(__file__).resolve().parent / "results"


@dataclass
class Corpus:
    profiles: list[dict]
    gigs: list[dict]
    # worker_id -> {gig_id: grade}
    grades: dict[str, dict[str, int]]
    assignment: splits.SplitAssignment
    vectorizer: TfidfVectorizer | None = None
    split: str = "all"

    @property
    def dataset_version(self) -> str:
        return self.assignment.dataset_version

    def for_split(self, split: str) -> "Corpus":
        """
        The same corpus restricted to one split's profiles.

        The gig collection is not restricted: it is the thing being searched,
        and a held-out worker searches the whole catalogue in production. What
        is held out is the query and its judgements.
        """
        wanted = set(self.assignment.ids(split))
        return Corpus(
            profiles=[p for p in self.profiles if p["id"] in wanted],
            gigs=self.gigs,
            grades=self.grades,
            assignment=self.assignment,
            vectorizer=self.vectorizer,
            split=split,
        )

    def describe(self) -> str:
        judged = sum(len(self.grades.get(p["id"], {})) for p in self.profiles)
        return (
            f"{self.split}: {len(self.profiles)} profiles x {len(self.gigs)} gigs, "
            f"{judged} graded pairs"
        )


def load_corpus(fit_preprocessing: bool = True) -> Corpus:
    profiles = json.loads((CORPUS_DIR / "profiles.json").read_text(encoding="utf-8"))
    gigs = json.loads((CORPUS_DIR / "gigs.json").read_text(encoding="utf-8"))

    grades: dict[str, dict[str, int]] = {p["id"]: {} for p in profiles}

    text = (CORPUS_DIR / "relevance.csv").read_text(encoding="utf-8-sig")
    # Comment lines carry the grading scheme; skip them before parsing.
    rows = [line for line in text.splitlines() if line.strip() and not line.startswith("#")]

    for row in csv.DictReader(rows):
        grades.setdefault(row["worker_id"], {})[row["gig_id"]] = int(row["grade"])

    _validate(profiles, gigs, grades)

    assignment = splits.load()
    _validate_splits(profiles, assignment)

    vectorizer = (
        fit_training_vectorizer(profiles, gigs, grades, assignment)
        if fit_preprocessing
        else None
    )

    return Corpus(
        profiles=profiles,
        gigs=gigs,
        grades=grades,
        assignment=assignment,
        vectorizer=vectorizer,
    )


def fit_training_vectorizer(
    profiles: list[dict],
    gigs: list[dict],
    grades: dict[str, dict[str, int]],
    assignment: splits.SplitAssignment,
) -> TfidfVectorizer:
    """
    Fits the TF-IDF vocabulary and document frequencies on training data only.

    Both sides of the comparison contribute, because a vocabulary fitted on
    gigs alone would treat the words workers use to describe themselves as out
    of vocabulary. Both are drawn strictly from the training split.
    """
    scoped_gigs = splits.fit_scope(gigs, assignment, grades)
    train_ids = set(assignment.train)

    documents = [gig_text(g) for g in scoped_gigs]
    documents += [profile_text(p) for p in profiles if p["id"] in train_ids]

    return tfidf_model.fit(documents)


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


def _validate_splits(profiles: list[dict], assignment: splits.SplitAssignment) -> None:
    """
    The splits file and the corpus must describe the same profiles.

    Regenerating the corpus without regenerating the splits would otherwise
    evaluate on a stale assignment, which is the kind of error that produces a
    plausible-looking number for the wrong reason.
    """
    corpus_ids = {p["id"] for p in profiles}
    assigned = set(assignment.train) | set(assignment.validation) | set(assignment.test)

    missing = corpus_ids - assigned
    extra = assigned - corpus_ids
    if missing or extra:
        raise SystemExit(
            "splits.json does not match the corpus "
            f"({len(missing)} unassigned profiles, {len(extra)} assigned but absent).\n"
            "Rebuild both: python -m eval.corpus_sources.build_corpus"
        )


# ---------------------------------------------------------------------------
# Ranking strategies. Each takes a profile and the gig list, and returns gig
# ids best-first.
# ---------------------------------------------------------------------------


def rank_random(profile: dict, gigs: list[dict], seed: int = 0) -> list[str]:
    """The floor. Any strategy that cannot beat this is doing nothing."""
    ids = [g["id"] for g in gigs]
    random.Random(f"{profile['id']}-{seed}").shuffle(ids)
    return ids


def rank_tfidf_only(profile: dict, gigs: list[dict], vectorizer: TfidfVectorizer) -> list[str]:
    """Keyword overlap alone — the classic pre-neural baseline."""
    scores = tfidf_model.similarities(
        vectorizer, profile_text(profile), [gig_text(g) for g in gigs]
    )
    return [g["id"] for g, _ in sorted(zip(gigs, scores), key=lambda p: p[1], reverse=True)]


def rank_semantic_only(profile: dict, gigs: list[dict]) -> list[str]:
    """The embedding model on its own, with no other signal."""
    scores = compute_semantic_similarities(profile_text(profile), [gig_text(g) for g in gigs])
    return [g["id"] for g, _ in sorted(zip(gigs, scores), key=lambda p: p[1], reverse=True)]


def rank_composite(
    profile: dict,
    gigs: list[dict],
    weights: Weights = DEFAULT_WEIGHTS,
    vectorizer: TfidfVectorizer | None = None,
) -> list[str]:
    """The live system: the full weighted composite."""
    return [s.gig_id for s in score_gigs(profile, gigs, weights, vectorizer=vectorizer)]


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
    ndcg_at_5: float
    ndcg_at_10: float
    # Per-profile NDCG@10, kept so a confidence interval can be computed. With
    # 9 validation profiles the mean alone invites more confidence than the
    # data supports.
    per_profile_ndcg: list[float] = field(default_factory=list, repr=False)
    # Kept out of the metrics table; written separately as the run's predictions.
    predictions: dict[str, list[str]] = field(default_factory=dict, repr=False)

    def as_row(self) -> list[str]:
        return [
            self.name,
            f"{self.precision_at_5:.3f}",
            f"{self.precision_at_10:.3f}",
            f"{self.recall_at_10:.3f}",
            f"{self.mrr:.3f}",
            f"{self.ndcg_at_5:.3f}",
            f"{self.ndcg_at_10:.3f}",
            self.interval(),
        ]

    def as_metrics(self) -> dict:
        return {
            "name": self.name,
            "precision_at_5": self.precision_at_5,
            "precision_at_10": self.precision_at_10,
            "recall_at_10": self.recall_at_10,
            "mrr": self.mrr,
            "ndcg_at_5": self.ndcg_at_5,
            "ndcg_at_10": self.ndcg_at_10,
            "ndcg_at_10_ci95": self.confidence_interval(),
        }

    def confidence_interval(self, resamples: int = 2000, seed: int = 11) -> list[float]:
        """
        A 95% bootstrap interval for mean NDCG@10 across profiles.

        Resampling profiles, because profiles are the independent unit -- the
        same reason the splits are by profile. With 9 of them the interval is
        wide, which is the point: it shows directly that differences of a few
        thousandths are not resolvable here.
        """
        values = self.per_profile_ndcg
        if len(values) < 2:
            return []

        rng = random.Random(seed)
        n = len(values)
        means = sorted(
            sum(values[rng.randrange(n)] for _ in range(n)) / n
            for _ in range(resamples)
        )
        lower = means[int(0.025 * resamples)]
        upper = means[int(0.975 * resamples) - 1]
        return [round(lower, 4), round(upper, 4)]

    def interval(self) -> str:
        bounds = self.confidence_interval()
        return f"[{bounds[0]:.3f}, {bounds[1]:.3f}]" if bounds else ""


def evaluate(name: str, rank_fn, corpus: Corpus, keep: int = 10) -> Result:
    """Runs one strategy across every profile in the corpus and averages the metrics."""
    p5, p10, r10, rr, ndcg5, ndcg = [], [], [], [], [], []
    predictions: dict[str, list[str]] = {}

    for profile in corpus.profiles:
        ranked = rank_fn(profile, corpus.gigs)
        grades = corpus.grades.get(profile["id"], {})

        p5.append(metrics.precision_at_k(ranked, grades, 5))
        p10.append(metrics.precision_at_k(ranked, grades, 10))
        r10.append(metrics.recall_at_k(ranked, grades, 10))
        rr.append(metrics.reciprocal_rank(ranked, grades))
        ndcg5.append(metrics.ndcg_at_k(ranked, grades, 5))
        ndcg.append(metrics.ndcg_at_k(ranked, grades, 10))

        # The top of each ranking, so a reviewer can see what the numbers mean.
        predictions[profile["id"]] = ranked[:keep]

    return Result(
        name=name,
        precision_at_5=metrics.mean(p5),
        precision_at_10=metrics.mean(p10),
        recall_at_10=metrics.mean(r10),
        mrr=metrics.mean(rr),
        ndcg_at_5=metrics.mean(ndcg5),
        ndcg_at_10=metrics.mean(ndcg),
        per_profile_ndcg=ndcg,
        predictions=predictions,
    )


HEADERS = [
    "strategy", "P@5", "P@10", "R@10", "MRR", "NDCG@5", "NDCG@10",
    "NDCG@10 95% CI",
]

# Stated with every table, because a precision figure means nothing without it.
THRESHOLD_NOTE = (
    "P@k and R@k count a gig as relevant at grade >= 2 (ideal or good); "
    "grade 1 is marginal and deliberately does not count. "
    "NDCG uses every grade, weighted 2^grade - 1."
)


def format_table(results: list[Result]) -> str:
    rows = [HEADERS] + [r.as_row() for r in results]
    widths = [max(len(row[i]) for row in rows) for i in range(len(HEADERS))]

    out = []
    for index, row in enumerate(rows):
        cells = [row[0].ljust(widths[0])]
        cells += [row[i].rjust(widths[i]) for i in range(1, len(row))]
        out.append("  ".join(cells))
        if index == 0:
            out.append("  ".join("-" * w for w in widths))
    return "\n".join(out) + "\n"


def print_table(results: list[Result]) -> None:
    print(format_table(results), end="")
