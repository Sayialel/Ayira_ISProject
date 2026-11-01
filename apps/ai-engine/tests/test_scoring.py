"""
Scoring behaviour, edge cases, and the feature defects this project has
already shipped once.
"""

import pytest

from app.services.scoring import (
    DEFAULT_WEIGHTS,
    DIFFERENT_COUNTY,
    NEUTRAL_REPUTATION,
    REPUTATION_SCALE,
    SHIPPED_WEIGHTS,
    Weights,
    composite_score,
    employer_reputation,
    gig_text,
    is_location_match,
    location_affinity,
    profile_sufficiency,
    profile_text,
    score_gigs,
    SAME_COUNTY,
    SAME_METRO,
    SAME_TOWN,
    UNKNOWN_LOCATION,
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
    assert composite_score(0.0, 0.0, 0.0, 0.0) == pytest.approx(0.0)
    assert composite_score(1.0, 1.0, 1.0, REPUTATION_SCALE) == pytest.approx(1.0)


def test_composite_clamps_out_of_range_inputs():
    assert composite_score(1.0, 1.0, 5.0, 99.0) == pytest.approx(1.0)
    assert composite_score(0.0, 0.0, -3.0, -3.0) == pytest.approx(0.0)


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
#
# The engine previously compared town names for exact equality, so Thika and
# Nairobi (about 40 km apart) scored identically to Mombasa and Nairobi (about
# 490 km), and a missing location was indistinguishable from the wrong side of
# the country.


def test_same_town_scores_full_marks():
    assert location_affinity("Nairobi", {"location": "Nairobi"}) == SAME_TOWN


def test_same_county_scores_above_a_different_county():
    """Thika and Ruiru are both in Kiambu; Mombasa is not."""
    near = location_affinity("Thika", {"location": "Ruiru"})
    far = location_affinity("Thika", {"location": "Mombasa"})

    assert near == SAME_COUNTY
    assert far == DIFFERENT_COUNTY
    assert near > far


def test_commuter_belt_is_not_treated_as_a_distant_town():
    """
    The case that motivated the change: Thika to Nairobi is a daily commute,
    Mombasa to Nairobi is a flight.

    County tiering alone does not cover this -- Thika is in Kiambu and Nairobi
    is its own county -- which is why the metropolitan grouping exists.
    """
    commute = location_affinity("Thika", {"location": "Nairobi"})
    distant = location_affinity("Mombasa", {"location": "Nairobi"})

    assert commute == SAME_METRO
    assert distant == DIFFERENT_COUNTY
    assert commute > distant


def test_tiers_are_strictly_ordered():
    """
    The ordering is the whole design, so it is asserted rather than assumed.

    Unknown must sit below every confirmed-reachable tier and above a
    confirmed mismatch.
    """
    assert SAME_TOWN > SAME_COUNTY > SAME_METRO > UNKNOWN_LOCATION > DIFFERENT_COUNTY


def test_unknown_location_is_neutral_not_a_mismatch():
    """
    Either side may simply not be filled in. Scoring that 0 punished such gigs
    as though they were on the wrong side of the country.
    """
    assert location_affinity("", {"location": "Nairobi"}) == UNKNOWN_LOCATION
    assert location_affinity("Nairobi", {"location": None}) == UNKNOWN_LOCATION
    assert location_affinity("Nairobi", {}) == UNKNOWN_LOCATION
    assert UNKNOWN_LOCATION > DIFFERENT_COUNTY


def test_unrecognised_town_is_unknown_not_a_mismatch():
    assert location_affinity("Nairobi", {"location": "Atlantis"}) == UNKNOWN_LOCATION


def test_address_with_a_county_suffix_resolves():
    assert location_affinity("Ruiru, Kiambu", {"location": "Thika"}) == SAME_COUNTY


def test_affinity_is_always_in_unit_range():
    cases = ["Nairobi", "", None, "Atlantis", "Thika"]
    for worker in cases:
        for gig in cases:
            value = location_affinity(worker, {"location": gig})
            assert 0.0 <= value <= 1.0


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
        assert breakdown["location"] == pytest.approx(
            round(scored.location_affinity, 2)
        )
        assert breakdown["employer_reputation"] == pytest.approx(
            round(scored.employer_reputation, 2)
        )


def test_zero_weights_produce_zero_scores(worker, gigs):
    flat = Weights(semantic=0.0, tfidf=0.0, location=0.0, reputation=0.0)
    for scored in score_gigs(worker, gigs, flat):
        assert scored.score == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Profile sufficiency
# ---------------------------------------------------------------------------
#
# The engine used to return a ranking for any profile, including an empty one.
# These tests pin the three levels and, more importantly, the arithmetic the
# 'insufficient' level rests on: with no text, both similarity functions return
# exactly 0.0 for every candidate, so the composite carries no skill signal at
# all.


class TestProfileSufficiency:
    def test_empty_profile_is_insufficient(self):
        assert profile_sufficiency({}).level == "insufficient"

    def test_whitespace_only_is_insufficient(self):
        worker = {"skills": [], "bio": "   \n  "}
        assert profile_sufficiency(worker).level == "insufficient"

    def test_skills_of_only_whitespace_do_not_count(self):
        worker = {"skills": ["", "  "], "bio": ""}
        assert profile_sufficiency(worker).level == "insufficient"

    def test_three_named_skills_are_enough_without_a_bio(self):
        # Short text, but a real query. The length floor exists to catch a
        # one-word bio, not to demand prose from someone who listed their work.
        worker = {"skills": ["python", "react", "sql"], "bio": ""}
        assert profile_sufficiency(worker).level == "ok"

    def test_one_skill_alone_is_weak(self):
        worker = {"skills": ["welding"], "bio": ""}
        assert profile_sufficiency(worker).level == "weak"

    def test_a_substantial_bio_alone_is_enough(self):
        worker = {
            "skills": [],
            "bio": "I fix solar panels across Nakuru and have done so for six years.",
        }
        assert profile_sufficiency(worker).level == "ok"

    def test_a_one_word_bio_is_weak(self):
        assert profile_sufficiency({"skills": [], "bio": "plumber"}).level == "weak"

    def test_reason_is_empty_only_when_ok(self):
        ok = profile_sufficiency({"skills": ["a", "b", "c"]})
        weak = profile_sufficiency({"skills": ["a"]})
        none = profile_sufficiency({})
        assert ok.reason == ""
        assert weak.reason and none.reason

    def test_counts_are_reported(self):
        s = profile_sufficiency({"skills": ["a", "b"], "bio": "something"})
        assert s.skills == 2
        assert s.has_bio is True

    def test_can_rank_on_skills_is_false_only_when_insufficient(self):
        assert profile_sufficiency({}).can_rank_on_skills is False
        assert profile_sufficiency({"skills": ["a"]}).can_rank_on_skills is True

    def test_as_dict_round_trips_the_fields(self):
        s = profile_sufficiency({"skills": ["a"], "bio": ""})
        assert s.as_dict() == {
            "level": s.level,
            "reason": s.reason,
            "skills": s.skills,
            "has_bio": s.has_bio,
        }

    def test_it_reads_the_same_text_the_scorer_reads(self):
        # The guard must not drift from profile_text: if it judged the raw
        # columns instead, the two could disagree about what is empty.
        worker = {"skills": ["carpentry"], "bio": "Furniture maker in Thika."}
        assert profile_text(worker)
        assert profile_sufficiency(worker).level == "ok"

    def test_an_empty_profile_scores_zero_on_both_text_signals(self):
        """The arithmetic the 'insufficient' level rests on."""
        gigs = [
            {"id": "g1", "title": "Plumber needed", "description": "Fix a sink", "location": "Nairobi"},
            {"id": "g2", "title": "Welder needed", "description": "Gate repair", "location": "Nairobi"},
        ]
        empty = {"id": "w1", "skills": [], "bio": "", "location": "Nairobi"}

        ranked = score_gigs(empty, gigs)

        assert all(g.semantic == 0.0 for g in ranked)
        assert all(g.tfidf == 0.0 for g in ranked)
        # So every remaining point comes from location and reputation, which
        # together carry 0.06 of the weight.
        assert all(g.score <= 0.06 + 1e-9 for g in ranked)
