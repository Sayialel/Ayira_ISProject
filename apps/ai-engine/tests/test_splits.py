"""
Split discipline.

Every defect these guard against produces a plausible-looking number rather
than an error, which is why they are tested rather than trusted.
"""

import json

import pytest

from eval import splits
from eval.harness import CORPUS_DIR


@pytest.fixture(scope="module")
def assignment():
    return splits.load()


def test_splits_are_disjoint(assignment):
    """
    A profile in two splits means tuning on data you then report on.

    This is the single most consequential thing in the evaluation, because
    nothing downstream would fail -- the metrics would simply be optimistic.
    """
    train, validation, test = (
        set(assignment.train),
        set(assignment.validation),
        set(assignment.test),
    )
    assert not train & validation
    assert not train & test
    assert not validation & test


def test_splits_cover_every_profile(assignment):
    profiles = json.loads((CORPUS_DIR / "profiles.json").read_text(encoding="utf-8"))
    assigned = set(assignment.train) | set(assignment.validation) | set(assignment.test)
    assert assigned == {p["id"] for p in profiles}


def test_no_split_is_empty(assignment):
    for name in ("train", "validation", "test"):
        assert assignment.ids(name), f"{name} split is empty"


def test_assignment_is_deterministic(assignment):
    """
    Rebuilding from the same profiles must reproduce the same assignment.

    The split is derived from a hash rather than a shuffle precisely so this
    holds on any machine and in any Python version.
    """
    profiles = json.loads((CORPUS_DIR / "profiles.json").read_text(encoding="utf-8"))
    rebuilt = splits.build(profiles, assignment.dataset_version)

    assert rebuilt.train == assignment.train
    assert rebuilt.validation == assignment.validation
    assert rebuilt.test == assignment.test


def test_every_category_appears_in_every_split(assignment):
    """Stratification: a split missing a category measures something different."""
    profiles = json.loads((CORPUS_DIR / "profiles.json").read_text(encoding="utf-8"))
    category = {p["id"]: p.get("category", "Unknown") for p in profiles}
    everything = set(category.values())

    for name in ("train", "validation", "test"):
        present = {category[pid] for pid in assignment.ids(name)}
        assert present == everything, f"{name} is missing {everything - present}"


def test_adding_a_profile_causes_only_boundary_churn():
    """
    Growing the corpus must not reshuffle the splits.

    Ordering is hash-based, so it is stable -- but the cut points move with the
    count, so a profile on a boundary can change split. That is accepted and
    documented; what must not happen is wholesale reassignment, which would
    make every previously reported figure refer to a different split without
    anything looking wrong.

    One profile added to one category can move at most one profile across each
    of the two boundaries.
    """
    profiles = [{"id": f"w-{i}", "category": "Business"} for i in range(12)]
    before = splits.build(profiles, "v1")
    after = splits.build(profiles + [{"id": "w-new", "category": "Business"}], "v1")

    moved = [p["id"] for p in profiles if before.of(p["id"]) != after.of(p["id"])]
    assert len(moved) <= 2, f"{len(moved)} profiles moved: {moved}"


def test_churn_stays_bounded_as_the_corpus_grows():
    """
    Growth must not reshuffle wholesale.

    Asserting the hash ordering directly would only restate the
    implementation, so this asserts the consequence that matters: adding
    several profiles still moves only a few of the existing ones, so a corpus
    that grows stays broadly comparable rather than being silently
    re-partitioned.
    """
    profiles = [{"id": f"w-{i}", "category": "Business"} for i in range(30)]
    before = splits.build(profiles, "v1")

    added = [{"id": f"w-extra-{i}", "category": "Business"} for i in range(5)]
    after = splits.build(profiles + added, "v1")

    moved = [p["id"] for p in profiles if before.of(p["id"]) != after.of(p["id"])]
    # Five additions shift each of the two cut points by at most three places.
    assert len(moved) <= 6, f"{len(moved)} of 30 profiles moved: {moved}"


def test_of_returns_none_for_unknown_profile(assignment):
    assert assignment.of("w-does-not-exist") is None


def test_dataset_version_changes_with_content(tmp_path):
    """A content hash that ignored content would make runs falsely comparable."""
    a = tmp_path / "a.json"
    a.write_text("one", encoding="utf-8")
    first = splits.dataset_version(a)

    a.write_text("two", encoding="utf-8")
    assert splits.dataset_version(a) != first


def test_dataset_version_is_order_independent(tmp_path):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    a.write_text("one", encoding="utf-8")
    b.write_text("two", encoding="utf-8")

    assert splits.dataset_version(a, b) == splits.dataset_version(b, a)


def test_fit_scope_excludes_non_training_gigs():
    """
    Preprocessing may only see training data.

    `fit_scope` is what enforces that for the gig collection, which is shared
    across splits.
    """
    gigs = [{"id": f"g-{i}", "kesco_code": "1111"} for i in range(20)]
    assignment = splits.SplitAssignment(
        train=["w-train"], validation=["w-val"], test=["w-test"], dataset_version="v1"
    )
    grades = {
        "w-train": {f"g-{i}": 3 for i in range(15)},
        "w-test": {"g-19": 3},
    }

    scoped = {g["id"] for g in splits.fit_scope(gigs, assignment, grades)}

    assert scoped == {f"g-{i}" for i in range(15)}
    assert "g-19" not in scoped, "a test-only gig reached the fitting scope"


def test_fit_scope_includes_authored_probes():
    """Hand-authored gigs carry no KeSCO code and belong to no split."""
    gigs = [{"id": f"g-{i}", "kesco_code": "1111"} for i in range(12)]
    gigs.append({"id": "g-authored", "kesco_code": None})
    assignment = splits.SplitAssignment(
        train=["w-train"], validation=[], test=[], dataset_version="v1"
    )
    grades = {"w-train": {f"g-{i}": 2 for i in range(12)}}

    scoped = {g["id"] for g in splits.fit_scope(gigs, assignment, grades)}
    assert "g-authored" in scoped


def test_fit_scope_refuses_a_scope_too_small_to_fit():
    gigs = [{"id": "g-1", "kesco_code": "1111"}]
    assignment = splits.SplitAssignment(
        train=["w-train"], validation=[], test=[], dataset_version="v1"
    )
    with pytest.raises(SystemExit):
        splits.fit_scope(gigs, assignment, {"w-train": {"g-1": 3}})
