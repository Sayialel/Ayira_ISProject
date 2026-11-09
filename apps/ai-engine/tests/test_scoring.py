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
from app.services.matcher import _sufficiency_without_vector
from app.services import calibration, embedding_store, kenya_geography
from app.services.scoring import distance_affinity
import math


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


# ---------------------------------------------------------------------------
# Sufficiency when a worker has no cached vector
#
# Serving never loads the model, so a worker whose vector has not yet been
# computed is ranked on keywords and location alone. What they are *told*
# about that has to depend on why the vector is missing.
# ---------------------------------------------------------------------------


class TestSufficiencyWithoutVector:
    def test_a_real_profile_is_told_it_is_being_prepared(self):
        before = profile_sufficiency({"skills": ["welding", "fabrication", "fitting"]})
        assert before.level == "ok"

        after = _sufficiency_without_vector(before)
        assert after.level == "degraded"
        assert "check back" in after.reason.lower()

    def test_a_weak_profile_is_also_downgraded(self):
        # Weak still has text, so a vector will eventually exist for it.
        before = profile_sufficiency({"skills": ["welding"]})
        assert before.level == "weak"
        assert _sufficiency_without_vector(before).level == "degraded"

    def test_an_empty_profile_keeps_its_own_advice(self):
        # The regression this guards: an empty profile has nothing to embed, so
        # "check back shortly" is false -- waiting will never produce a vector.
        # It must keep being told to add skills or a bio.
        before = profile_sufficiency({})
        assert before.level == "insufficient"

        after = _sufficiency_without_vector(before)
        assert after.level == "insufficient"
        assert after is before
        assert "check back" not in after.reason.lower()
        assert "add your skills" in after.reason.lower()

    def test_the_counts_survive_the_downgrade(self):
        before = profile_sufficiency({"skills": ["a", "b", "c"], "bio": "a bio"})
        after = _sufficiency_without_vector(before)
        assert (after.skills, after.has_bio) == (before.skills, before.has_bio)


# ---------------------------------------------------------------------------
# Calibration
#
# The reason the composite could not be shown as a percentage: it is capped
# near 0.7 by construction, so a good match read "59%". The calibrated figure
# answers "what fraction of pairs scoring like this were judged relevant",
# which is a claim that can be checked -- and the one property it must never
# break is the ordering, because every reported metric is rank-based.
# ---------------------------------------------------------------------------


class TestCalibration:
    def test_is_strictly_monotonic(self):
        # The load-bearing property. If calibration could reorder a result
        # list, NDCG@10 0.780 would no longer describe what is served.
        cal = calibration.Calibration(a=10.2466, b=-3.6719)
        scores = [i / 100 for i in range(0, 101)]
        out = [cal.apply(s) for s in scores]
        assert all(b > a for a, b in zip(out, out[1:]))

    def test_maps_into_a_probability(self):
        cal = calibration.Calibration(a=10.2466, b=-3.6719)
        for s in (-5.0, 0.0, 0.5, 1.0, 50.0):
            assert 0.0 <= cal.apply(s) <= 1.0

    def test_does_not_overflow_on_an_absurd_score(self):
        # Clamped before exp. Without the clamp this raises OverflowError and
        # takes the whole match request with it.
        cal = calibration.Calibration(a=1e6, b=0.0)
        assert cal.apply(1e6) == pytest.approx(1.0)
        assert cal.apply(-1e6) == pytest.approx(0.0)

    def test_lifts_a_good_match_into_the_eighties(self):
        # The fitted values, and the behaviour the change exists for: the
        # live example that read 0.59 should now read about 90%.
        cal = calibration.Calibration(a=10.2465815408678, b=-3.6718790861739383)
        assert cal.apply(0.5916) > 0.85
        # And a genuinely weak match must stay weak.
        assert cal.apply(0.06) < 0.10

    def test_confidence_is_none_without_an_artefact(self, tmp_path, monkeypatch):
        # Absent artefact is a supported state, not an error: the engine then
        # serves the raw score, which is what it did before calibration.
        monkeypatch.setattr(calibration, "ARTIFACT_PATH", tmp_path / "missing.json")
        calibration.reset_cache()
        assert calibration.confidence(0.5) is None
        calibration.reset_cache()

    def test_a_corrupt_artefact_does_not_break_matching(self, tmp_path, monkeypatch):
        bad = tmp_path / "calibration.json"
        bad.write_text("{not json", encoding="utf-8")
        monkeypatch.setattr(calibration, "ARTIFACT_PATH", bad)
        calibration.reset_cache()
        assert calibration.confidence(0.5) is None
        calibration.reset_cache()

    def test_reads_a_promoted_artefact(self, tmp_path, monkeypatch):
        good = tmp_path / "calibration.json"
        good.write_text('{"a": 10.0, "b": -3.0, "dataset_version": "x"}', encoding="utf-8")
        monkeypatch.setattr(calibration, "ARTIFACT_PATH", good)
        calibration.reset_cache()
        got = calibration.confidence(0.5)
        assert got is not None and got == pytest.approx(1 / (1 + math.exp(-2.0)))
        calibration.reset_cache()


# ---------------------------------------------------------------------------
# Distance-based location affinity
#
# The tiers it replaces could not separate pairs inside one bucket: every
# "different county" pair scored 0.0, so Nakuru to Nairobi (160 km) scored
# the same as Mombasa to Nairobi (440 km).
# ---------------------------------------------------------------------------


class TestDistanceAffinity:
    def test_same_place_is_full_marks(self):
        assert distance_affinity(0.0) == pytest.approx(1.0)

    def test_halves_at_the_halflife(self):
        assert distance_affinity(50.0, halflife_km=50.0) == pytest.approx(0.5)
        assert distance_affinity(100.0, halflife_km=50.0) == pytest.approx(0.25)

    def test_decreases_monotonically(self):
        values = [distance_affinity(km) for km in range(0, 500, 10)]
        assert all(b < a for a, b in zip(values, values[1:]))

    def test_stays_in_range(self):
        for km in (0.0, 1.0, 50.0, 500.0, 5000.0):
            assert 0.0 < distance_affinity(km) <= 1.0

    def test_a_negative_distance_cannot_exceed_full_marks(self):
        # Defensive: a distance is never negative, but clamping beats
        # returning an affinity above 1.0 and corrupting the composite.
        assert distance_affinity(-10.0) == pytest.approx(1.0)

    def test_separates_what_the_tiers_cannot(self):
        # What distance would buy, if the corpus could show it: these two are
        # both DIFFERENT_COUNTY = 0.0 under the tiers, so the ordering between
        # a 160 km trip and a 440 km one is lost.
        nakuru = distance_affinity(kenya_geography.distance_km("Nairobi", "Nakuru"))
        mombasa = distance_affinity(kenya_geography.distance_km("Nairobi", "Mombasa"))
        assert nakuru > mombasa
        assert mombasa < 0.05

    def test_thika_would_land_near_the_tier_it_deserves(self):
        # Nairobi to Thika is 39.7 km and a commute people genuinely make.
        # The tiers give it SAME_METRO (0.45); measured it is ~0.58, closer to
        # the SAME_COUNTY 0.6 the pair arguably warrants.
        assert 0.5 < distance_affinity(kenya_geography.distance_km("Nairobi", "Thika")) < 0.65

    def test_the_scoring_path_still_uses_the_evaluated_tiers(self):
        # Pins the revert. eval/tune_location.py found distance did not earn
        # the change (-0.0002 on validation, 0.005 required), so serving must
        # stay on the configuration the reported NDCG describes. If someone
        # wires distance in without re-running that sweep, this fails.
        assert location_affinity("Nairobi", {"location": "Thika", "is_remote": False}) == (
            SAME_METRO
        )
        assert location_affinity("Nairobi", {"location": "Mombasa", "is_remote": False}) == (
            DIFFERENT_COUNTY
        )

    def test_remote_still_scores_full_marks(self):
        assert location_affinity(None, {"location": None, "is_remote": True}) == SAME_TOWN

    def test_an_unknown_town_falls_back_rather_than_guessing(self):
        # Lodwar has no coordinates and no county entry, so this must be the
        # unknown tier -- not 0.0, which would read as a confirmed mismatch.
        assert location_affinity("Lodwar", {"location": "Nairobi", "is_remote": False}) == (
            UNKNOWN_LOCATION
        )

    def test_missing_location_is_unknown_not_a_mismatch(self):
        assert location_affinity("", {"location": "Nairobi", "is_remote": False}) == (
            UNKNOWN_LOCATION
        )


class TestCoordinateParity:
    """
    The engine's coordinates and the web map's must agree.

    They are separate tables in separate languages -- apps/web cannot import
    Python -- so nothing but a test stops them drifting. Two of them showing a
    town in different places would be a silent fault: the map would put a pin
    somewhere the location score disagrees with.
    """

    def _web_table(self) -> dict[str, tuple[float, float]]:
        import re
        from pathlib import Path

        ts = Path(__file__).parent.parent.parent / "web" / "src" / "lib" / "kenyaTowns.ts"
        body = ts.read_text(encoding="utf-8")
        start = body.index("export const TOWN_POINTS")
        block = body[start : body.index("\n};", start)]
        found = {}
        for q1, q2, bare, lat, lon in re.findall(
            r"(?:'([^']+)'|\"([^\"]+)\"|([a-z]+))\s*:\s*\{\s*lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)",
            block,
        ):
            found[q1 or q2 or bare] = (float(lat), float(lon))
        return found

    def test_the_two_tables_hold_the_same_towns(self):
        web = self._web_table()
        assert web, "could not parse the TypeScript table"
        assert set(web) == set(kenya_geography.TOWN_POINT)

    def test_every_town_is_at_the_same_coordinates(self):
        web = self._web_table()
        for town, (lat, lon) in web.items():
            engine_lat, engine_lon = kenya_geography.TOWN_POINT[town]
            assert (lat, lon) == pytest.approx((engine_lat, engine_lon)), town

    def test_every_town_the_matcher_knows_can_be_placed(self):
        # A town in TOWN_COUNTY without coordinates silently falls back to
        # the tiers, which is the behaviour the change was meant to retire.
        missing = set(kenya_geography.TOWN_COUNTY) - set(kenya_geography.TOWN_POINT)
        assert not missing, f"towns without coordinates: {sorted(missing)}"


# ---------------------------------------------------------------------------
# A stale embedding is still an embedding
#
# This is the regression that was reported three times: a worker edits their
# profile, the stored hash no longer matches, and the serving path threw the
# vector away -- dropping them to semantic = 0 against every gig and showing
# "your profile is still being prepared" until somebody ran the backfill by
# hand. Then they edited again.
# ---------------------------------------------------------------------------


class TestStaleEmbedding:
    @staticmethod
    def _worker(stored_hash: str | None, has_vector: bool = True) -> dict:
        vector = "[" + ",".join(["0.1"] * 384) + "]" if has_vector else None
        return {
            "id": "w-1",
            "skills": ["Python", "Django"],
            "bio": "A backend developer.",
            "embedding": vector,
            "embedding_hash": stored_hash,
        }

    def test_a_matching_hash_returns_the_vector(self):
        worker = self._worker(None)
        worker["embedding_hash"] = embedding_store.text_hash(profile_text(worker))
        got = embedding_store.worker_embedding(None, worker, profile_text, allow_compute=False)
        assert got is not None and len(got) == 384

    def test_a_stale_hash_still_returns_the_vector(self):
        # The fix. A profile edited since the vector was computed is a small
        # error; discarding the vector is a total one -- it removes 72% of the
        # scoring weight and makes the nearest-neighbour probe a zero vector.
        got = embedding_store.worker_embedding(
            None, self._worker("a-hash-from-before-the-edit"), profile_text, allow_compute=False
        )
        assert got is not None and len(got) == 384

    def test_no_vector_at_all_still_returns_none(self):
        # The distinction that matters: stale is usable, absent is not, and
        # only the absent case may degrade the ranking.
        got = embedding_store.worker_embedding(
            None, self._worker(None, has_vector=False), profile_text, allow_compute=False
        )
        assert got is None

    def test_a_stale_vector_does_not_degrade_the_ranking(self):
        # Ties the storage behaviour to what the worker is told. With a vector
        # in hand the matcher never reaches _sufficiency_without_vector, so an
        # edited profile must not produce the "still being prepared" message.
        worker = self._worker("stale")
        assert (
            embedding_store.worker_embedding(None, worker, profile_text, allow_compute=False)
            is not None
        )
        # And the message only exists for the no-vector path.
        ok = profile_sufficiency(worker)
        assert ok.level == "ok"
        assert "being prepared" in _sufficiency_without_vector(ok).reason
