"""
Scoring behaviour, edge cases, and the feature defects this project has
already shipped once.
"""

import pytest

from app.services.scoring import (
    DEFAULT_WEIGHTS,
    NEUTRAL_REPUTATION,
    REPUTATION_SCALE,
    SHIPPED_WEIGHTS,
    Weights,
    composite_score,
    employer_reputation,
    gig_text,
    is_location_match,
    profile_text,
    score_gigs,
)


# --- weights -------------------------------------------------------------


def test_weights_sum_to_one():
    """
    A score is presented as a percentage, which only means something if the
    weights total 1.
    """
    assert DEFAULT_WEIGHTS.total() == pytest.approx(1.0)
    assert SHIPPED_WEIGHTS.total() == pytest.approx(1.0)


def test_score_stays_in_unit_range(worker, gigs):
    for scored in score_gigs(worker, gigs):
        assert 0.0 <= scored.score <= 1.0


def test_composite_is_bounded_at_the_extremes():
    assert composite_score(0.0, 0.0, False, 0.0) == pytest.approx(0.0)
    assert composite_score(1.0, 1.0, True, REPUTATION_SCALE) == pytest.approx(1.0)


# --- employer reputation -------------------------------------------------
#
# The engine previously weighted the *worker's* reputation, which is identical
# for every candidate gig and therefore cannot reorder them. These guard the
# redesign.


def test_reputation_comes_from_the_gig_not_the_worker():
    """The worker's own reputation must not influence their ranking."""
    gigs = [
        {"id": "a", "title": "x", "employer_reputation": 5.0, "employer_review_count": 9},
        {"id": "b", "title": "x", "employer_reputation": 3.5, "employer_review_count": 9},
    ]
    low = score_gigs({"skills": ["x"], "reputation_score": 0.0}, gigs)
    high = score_gigs({"skills": ["x"], "reputation_score": 5.0}, gigs)

    assert [s.gig_id for s in low] == [s.gig_id for s in high]
    assert [s.score for s in low] == [s.score for s in high]


def test_reputation_can_reorder_candidates():
    """
    The whole point of the redesign: a better-reviewed employer must be able to
    win when everything else is equal.
    """
    gigs = [
        {"id": "poor", "title": "Data entry", "description": "Enter records.",
         "employer_reputation": 3.3, "employer_review_count": 11},
        {"id": "great", "title": "Data entry", "description": "Enter records.",
         "employer_reputation": 5.0, "employer_review_count": 11},
    ]
    ranked = score_gigs({"skills": ["Data entry"], "bio": "Enter records."}, gigs)
    assert ranked[0].gig_id == "great"


def test_unreviewed_employer_is_neutral_not_zero():
    """
    reputation_score is 0.00 both for "no reviews" and "all one star", and a
    1-5 scale cannot produce 0. Treating an unreviewed employer as terrible
    would push every new employer to the bottom of every ranking.
    """
    assert employer_reputation(
        {"employer_reputation": 0.0, "employer_review_count": 0}
    ) == NEUTRAL_REPUTATION
    assert employer_reputation({"employer_reputation": None}) == NEUTRAL_REPUTATION
    assert employer_reputation({}) == NEUTRAL_REPUTATION
    # Explicit 0 with no count recorded: still far more likely to mean unrated.
    assert employer_reputation({"employer_reputation": 0.0}) == NEUTRAL_REPUTATION


def test_reviewed_employer_keeps_its_score():
    assert employer_reputation(
        {"employer_reputation": 4.25, "employer_review_count": 7}
    ) == pytest.approx(4.25)


def test_reputation_is_clamped_to_the_scale():
    assert employer_reputation(
        {"employer_reputation": 99.0, "employer_review_count": 3}
    ) == REPUTATION_SCALE


def test_unreviewed_employer_beats_a_badly_reviewed_one():
    gigs = [
        {"id": "bad", "title": "Data entry", "employer_reputation": 1.2,
         "employer_review_count": 15},
        {"id": "new", "title": "Data entry", "employer_reputation": 0.0,
         "employer_review_count": 0},
    ]
    ranked = score_gigs({"skills": ["Data entry"]}, gigs)
    assert ranked[0].gig_id == "new"


# --- location ------------------------------------------------------------


def test_remote_gig_matches_any_location():
    assert is_location_match("Kisumu", {"is_remote": True})
    assert is_location_match("", {"is_remote": True})


def test_remote_gig_is_not_penalised_for_having_no_town():
    assert is_location_match("Nairobi", {"is_remote": True, "location": None})


def test_location_match_is_case_insensitive():
    assert is_location_match("Nairobi", {"location": "nairobi"})


def test_unknown_location_does_not_match():
    assert not is_location_match("", {"location": "Nairobi"})
    assert not is_location_match("Nairobi", {"location": None})


def test_different_towns_do_not_match():
    assert not is_location_match("Mombasa", {"location": "Nairobi"})


# --- text building -------------------------------------------------------


def test_text_builders_tolerate_missing_and_null_fields():
    """Nullable columns arrive as None and must never reach the model."""
    assert profile_text({}) == ""
    assert profile_text({"skills": None, "bio": None}) == ""
    assert gig_text({}) == ""
    assert gig_text({"title": None, "required_skills": None, "description": None}) == ""


def test_text_builders_drop_empty_list_entries():
    assert profile_text({"skills": ["Python", "", None], "bio": ""}) == "Python"


# --- robustness ----------------------------------------------------------


def test_empty_candidate_list_returns_empty():
    assert score_gigs({"skills": ["Python"]}, []) == []


def test_all_null_worker_does_not_crash(gigs):
    scored = score_gigs(
        {"skills": None, "bio": None, "location": None, "reputation_score": None}, gigs
    )
    assert len(scored) == len(gigs)


def test_scoring_is_deterministic(worker, gigs):
    first = score_gigs(worker, gigs)
    second = score_gigs(worker, gigs)
    assert [s.gig_id for s in first] == [s.gig_id for s in second]
    assert [s.score for s in first] == [s.score for s in second]


def test_results_are_sorted_by_score(worker, gigs):
    scores = [s.score for s in score_gigs(worker, gigs)]
    assert scores == sorted(scores, reverse=True)


def test_mismatched_semantic_scores_are_rejected(worker, gigs):
    """
    Silently zipping a short list would drop candidates without any error,
    which is worse than failing.
    """
    with pytest.raises(ValueError):
        score_gigs(worker, gigs, semantic_scores=[0.5])


def test_breakdown_matches_the_scored_fields(worker, gigs):
    for scored in score_gigs(worker, gigs):
        breakdown = scored.breakdown()
        assert breakdown["location"] == scored.location_match
        assert breakdown["employer_reputation"] == pytest.approx(
            round(scored.employer_reputation, 2)
        )


def test_zero_weights_produce_zero_scores(worker, gigs):
    flat = Weights(semantic=0.0, tfidf=0.0, location=0.0, reputation=0.0)
    for scored in score_gigs(worker, gigs, flat):
        assert scored.score == pytest.approx(0.0)
