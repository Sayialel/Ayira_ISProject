"""
Ranking metrics, against hand-computed values.

The tuner optimises a vectorised NDCG while the reports use these functions.
If the two ever disagreed, the system would be tuned for one metric and judged
by another, so `test_fast_ndcg_agrees` below checks them against each other on
the real corpus.
"""

import math

import pytest

from eval import metrics

# g-1 and g-2 are relevant (grade >= 2), g-3 is marginal, g-4 is irrelevant.
GRADES = {"g-1": 3, "g-2": 2, "g-3": 1, "g-4": 0}


def test_precision_counts_only_grade_two_and_above():
    """
    Grade 1 means "plausible but a stretch". Counting it would flatter every
    ranking, so the threshold is what makes precision honest.
    """
    assert metrics.precision_at_k(["g-1", "g-2", "g-3"], GRADES, 3) == pytest.approx(2 / 3)


def test_precision_threshold_is_configurable():
    assert metrics.precision_at_k(
        ["g-1", "g-2", "g-3"], GRADES, 3, threshold=1
    ) == pytest.approx(1.0)


def test_precision_ignores_unjudged_ids():
    assert metrics.precision_at_k(["unknown", "g-1"], GRADES, 2) == pytest.approx(0.5)


def test_precision_divides_by_the_results_returned_not_k():
    """A ranking shorter than k must not be penalised for the missing slots."""
    assert metrics.precision_at_k(["g-1"], GRADES, 5) == pytest.approx(1.0)


def test_precision_of_an_empty_ranking_is_zero():
    assert metrics.precision_at_k([], GRADES, 5) == 0.0
    assert metrics.precision_at_k(["g-1"], GRADES, 0) == 0.0


def test_recall_is_over_all_relevant_items():
    # Two items are relevant; one is retrieved in the top 1.
    assert metrics.recall_at_k(["g-1", "g-4"], GRADES, 1) == pytest.approx(0.5)
    assert metrics.recall_at_k(["g-1", "g-2"], GRADES, 2) == pytest.approx(1.0)


def test_recall_without_relevant_items_is_zero():
    assert metrics.recall_at_k(["g-3"], {"g-3": 1}, 10) == 0.0


def test_reciprocal_rank_finds_the_first_relevant_position():
    assert metrics.reciprocal_rank(["g-1"], GRADES) == pytest.approx(1.0)
    assert metrics.reciprocal_rank(["g-4", "g-1"], GRADES) == pytest.approx(0.5)
    assert metrics.reciprocal_rank(["g-4", "g-3", "g-2"], GRADES) == pytest.approx(1 / 3)


def test_reciprocal_rank_is_zero_when_nothing_relevant_appears():
    assert metrics.reciprocal_rank(["g-3", "g-4"], GRADES) == 0.0


def test_dcg_uses_exponential_gain():
    """
    2^grade - 1 is why NDCG is the headline: it rewards ranking an ideal match
    above a merely adequate one, which precision cannot see.
    """
    expected = (2**3 - 1) / math.log2(2) + (2**2 - 1) / math.log2(3)
    assert metrics.dcg_at_k(["g-1", "g-2"], GRADES, 2) == pytest.approx(expected)


def test_ndcg_of_the_ideal_ordering_is_one():
    assert metrics.ndcg_at_k(["g-1", "g-2", "g-3", "g-4"], GRADES, 4) == pytest.approx(1.0)


def test_ndcg_penalises_a_reversed_ordering():
    ideal = metrics.ndcg_at_k(["g-1", "g-2", "g-3"], GRADES, 3)
    reversed_ = metrics.ndcg_at_k(["g-3", "g-2", "g-1"], GRADES, 3)
    assert reversed_ < ideal
    assert 0.0 <= reversed_ <= 1.0


def test_ndcg_without_any_graded_items_is_zero():
    assert metrics.ndcg_at_k(["g-1"], {}, 10) == 0.0


def test_mean_of_nothing_is_zero():
    assert metrics.mean([]) == 0.0


def test_fast_ndcg_agrees_with_the_reference(features, corpus):
    """
    The tuner's vectorised NDCG must equal this implementation exactly, not
    approximately -- including the tie-breaking, which both resolve by the
    original candidate order.
    """
    from app.services.scoring import DEFAULT_WEIGHTS
    from eval.tune_weights import agreement_with_metrics

    assert agreement_with_metrics(features, corpus, DEFAULT_WEIGHTS) < 1e-9
