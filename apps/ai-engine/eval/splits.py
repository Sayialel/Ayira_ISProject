"""
Train / validation / test splits.

The institutional workflow requires three splits with distinct jobs:

    train       fit anything that is fitted — the composite weights, and the
                TF-IDF vocabulary and document frequencies
    validation  every development decision: which weights, which model,
                which shortlist size
    test        touched once, for the final reported figure, and never used
                to choose anything

This module is the single place that decides which rows belong where, so the
rule cannot drift between scripts.

Why the split is by profile
---------------------------
A profile is the query; the gigs are the document collection being searched.
Splitting by *pair* would put some of a worker's judged gigs in train and
others in test, and a weight set fitted on the first would already know that
worker's preferences. Splitting by profile keeps a held-out worker genuinely
unseen.

The gig collection is deliberately shared across all three splits. That is
standard for retrieval evaluation — the corpus is the thing being searched,
not the thing being predicted — but it has one consequence that is handled in
`fit_scope()` below.
"""

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

CORPUS_DIR = Path(__file__).resolve().parent / "corpus"
SPLIT_FILE = CORPUS_DIR / "splits.json"

# Fixed, so the same corpus always produces the same assignment on any machine.
# Changing it invalidates every previously reported figure.
SPLIT_SEED = 20261018

# 60 / 20 / 20. With 47 profiles that is roughly 28 / 9 / 10 — small, and the
# write-up says so rather than implying otherwise.
TRAIN_FRACTION = 0.60
VALIDATION_FRACTION = 0.20

Split = str  # "train" | "validation" | "test"


@dataclass(frozen=True)
class SplitAssignment:
    """Which profiles belong to each split, plus the dataset version they describe."""

    train: list[str]
    validation: list[str]
    test: list[str]
    dataset_version: str

    def of(self, profile_id: str) -> Split | None:
        if profile_id in self.train:
            return "train"
        if profile_id in self.validation:
            return "validation"
        if profile_id in self.test:
            return "test"
        return None

    def ids(self, split: Split) -> list[str]:
        return {"train": self.train, "validation": self.validation, "test": self.test}[split]

    def as_dict(self) -> dict:
        return {
            "dataset_version": self.dataset_version,
            "seed": SPLIT_SEED,
            "counts": {
                "train": len(self.train),
                "validation": len(self.validation),
                "test": len(self.test),
            },
            "train": self.train,
            "validation": self.validation,
            "test": self.test,
        }


def dataset_version(*paths: Path) -> str:
    """
    A content hash of the corpus files.

    Every run records this. Two runs quoting the same version were measured on
    byte-identical data; two quoting different versions are not comparable, and
    the difference is visible rather than assumed.
    """
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


def _stratified(profiles: list[dict]) -> tuple[list[str], list[str], list[str]]:
    """
    Assigns profiles to splits, keeping the category mix of each split close to
    the corpus as a whole.

    A plain random split of 47 items can easily put every Writing profile in
    train, which would make the validation and test figures measure something
    different from each other. Stratifying removes that accident.

    Ordering within a category is by a hash of the profile id rather than a
    shuffle, so the order is stable across machines and Python versions and
    does not depend on the order of the corpus file.

    That bounds the churn from adding a profile but does not eliminate it: the
    *order* is preserved, yet the cut points move with the count, so a profile
    sitting on a boundary can change split. Expect a couple of profiles to move
    when the corpus grows, and treat figures from before and after as measured
    on different splits -- which the dataset version makes visible. True
    per-profile stability would need hash bucketing, which at this corpus size
    would give splits too uneven to keep every category in each one.
    """
    by_category: dict[str, list[str]] = {}
    for profile in profiles:
        category = profile.get("category", "Unknown")
        by_category.setdefault(category, []).append(profile["id"])

    train: list[str] = []
    validation: list[str] = []
    test: list[str] = []

    for category, ids in sorted(by_category.items()):
        # Deterministic order that is unrelated to the order in the file.
        ordered = sorted(
            ids,
            key=lambda pid: hashlib.sha256(f"{SPLIT_SEED}:{pid}".encode("utf-8")).hexdigest(),
        )
        n = len(ordered)
        n_train = max(1, round(n * TRAIN_FRACTION))
        n_validation = max(1, round(n * VALIDATION_FRACTION)) if n >= 3 else 0

        # A category too small to fill all three splits gives its remainder to
        # train, so no split ends up empty for that category.
        if n_train + n_validation >= n:
            n_train = max(1, n - 2) if n >= 3 else n
            n_validation = 1 if n >= 3 else 0

        train.extend(ordered[:n_train])
        validation.extend(ordered[n_train : n_train + n_validation])
        test.extend(ordered[n_train + n_validation :])

    return sorted(train), sorted(validation), sorted(test)


def build(profiles: list[dict], version: str) -> SplitAssignment:
    train, validation, test = _stratified(profiles)
    return SplitAssignment(
        train=train, validation=validation, test=test, dataset_version=version
    )


def write(assignment: SplitAssignment) -> None:
    SPLIT_FILE.write_text(
        json.dumps(assignment.as_dict(), indent=2) + "\n", encoding="utf-8"
    )


def load() -> SplitAssignment:
    if not SPLIT_FILE.exists():
        raise SystemExit(
            "No splits.json — run: python -m eval.corpus_sources.build_corpus"
        )
    raw = json.loads(SPLIT_FILE.read_text(encoding="utf-8"))
    return SplitAssignment(
        train=raw["train"],
        validation=raw["validation"],
        test=raw["test"],
        dataset_version=raw["dataset_version"],
    )


def fit_scope(gigs: list[dict], assignment: SplitAssignment, grades: dict) -> list[dict]:
    """
    The gigs any fitted preprocessing may see.

    The requirement is that preprocessing is fitted on training data only. The
    gig collection is shared across splits, so "training data" here means the
    gigs reachable from a training profile — those judged relevant to one, plus
    the hand-authored gigs, which exist to probe the method rather than to
    belong to any split.

    This matters because TF-IDF learns document frequencies from whatever it is
    fitted on. Fitting it over the whole collection would let the weighting
    reflect the test gigs, which is exactly the leakage the rule prohibits.
    """
    reachable: set[str] = set()
    for profile_id in assignment.train:
        reachable.update(grades.get(profile_id, {}).keys())

    # Gigs with no KeSCO code are the authored probes; they carry no split.
    for gig in gigs:
        if not gig.get("kesco_code"):
            reachable.add(gig["id"])

    scoped = [g for g in gigs if g["id"] in reachable]
    # A corpus too small to scope meaningfully falls back to everything, loudly.
    if len(scoped) < 10:
        raise SystemExit(
            f"Only {len(scoped)} gigs reachable from the training split; "
            "the corpus is too small to fit preprocessing without leakage."
        )
    return scoped
