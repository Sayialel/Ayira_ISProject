"""
Offline / live parity.

The evaluation and the serving path must rank identically for identical
inputs. They do not share a code path by accident -- they share `score_gigs`
deliberately -- but three things differ between them and each has already
caused, or could cause, a divergence:

  * the live path takes semantic similarity from pgvector's cosine *distance*,
    while the harness computes similarity directly from the model;
  * the live path loads a persisted TF-IDF artefact, while an unconfigured
    deployment silently refits per request;
  * the live path reads employer reputation from a SQL join, while the harness
    reads it from the corpus.

These run without Supabase. A test that needs a live database is a test that
does not run, and this is exactly the property that must be checked on every
change.
"""

import numpy as np
import pytest

from app.services import tfidf_model
from app.services.matcher import _similarity_from_distance
from app.services.scoring import DEFAULT_WEIGHTS, score_gigs


# --- the distance -> similarity conversion -------------------------------


def test_distance_converts_to_similarity():
    assert _similarity_from_distance(0.0) == pytest.approx(1.0)
    assert _similarity_from_distance(1.0) == pytest.approx(0.0)
    assert _similarity_from_distance(0.25) == pytest.approx(0.75)


def test_missing_embedding_scores_zero_rather_than_dropping():
    """A catalogue mid-backfill must degrade, not disappear."""
    assert _similarity_from_distance(None) == 0.0


def test_similarity_is_clamped():
    # pgvector can return slightly outside [0, 2] through float error, and a
    # negative similarity would make the weighted sum leave its range.
    assert _similarity_from_distance(1.4) == 0.0
    assert _similarity_from_distance(-0.2) == 1.0


# --- the full ranking ----------------------------------------------------


def test_live_and_offline_rank_identically(corpus):
    """
    The live path's inputs, reconstructed exactly, must reproduce the harness.

    Semantic similarity is round-tripped through cosine distance the way
    Postgres would store and return it, which is where a silent divergence
    would appear.
    """
    from app.services.embeddings import compute_semantic_similarities
    from app.services.scoring import gig_text, profile_text

    profile = corpus.profiles[0]
    gigs = corpus.gigs
    texts = [gig_text(g) for g in gigs]

    offline_similarity = compute_semantic_similarities(profile_text(profile), texts)

    # What Postgres would hand back: distance = 1 - similarity.
    live_similarity = [
        _similarity_from_distance(1.0 - s) for s in offline_similarity
    ]

    offline = score_gigs(
        profile, gigs, DEFAULT_WEIGHTS,
        semantic_scores=offline_similarity, vectorizer=corpus.vectorizer,
    )
    live = score_gigs(
        profile, gigs, DEFAULT_WEIGHTS,
        semantic_scores=live_similarity, vectorizer=corpus.vectorizer,
    )

    assert [s.gig_id for s in offline] == [s.gig_id for s in live]
    for a, b in zip(offline, live):
        assert a.score == pytest.approx(b.score, abs=1e-6)


def test_deployed_artefact_matches_the_training_fit(corpus):
    """
    The artefact the service loads must be the one the evaluation fitted.

    If promotion ever copies the wrong file, or an artefact goes stale against
    a regenerated corpus, offline figures stop describing the live system --
    and nothing else would report it.
    """
    serving = tfidf_model.load_serving()
    if serving is None:
        pytest.skip("no artefact promoted; run python -m eval.promote <run-id>")

    assert serving.vocabulary_ == corpus.vectorizer.vocabulary_

    profile = corpus.profiles[0]
    ranked_with_serving = score_gigs(
        profile, corpus.gigs, DEFAULT_WEIGHTS, vectorizer=serving
    )
    ranked_with_fitted = score_gigs(
        profile, corpus.gigs, DEFAULT_WEIGHTS, vectorizer=corpus.vectorizer
    )
    assert [s.gig_id for s in ranked_with_serving] == [
        s.gig_id for s in ranked_with_fitted
    ]


def test_missing_artefact_falls_back_without_crashing(corpus, tmp_path, monkeypatch):
    """
    The fallback must work and must be visible.

    An unconfigured deployment should degrade to per-request fitting rather
    than failing to serve, but the warning is what stops that state from
    going unnoticed.
    """
    monkeypatch.setattr(tfidf_model, "SERVING_PATH", tmp_path / "absent.joblib")
    tfidf_model.reset_serving_cache()

    assert tfidf_model.load_serving() is None
    ranked = score_gigs(corpus.profiles[0], corpus.gigs[:5], vectorizer=None)
    assert len(ranked) == 5

    tfidf_model.reset_serving_cache()


# --- the employer reputation join ----------------------------------------


def test_sql_shaped_rows_score_the_same_as_corpus_rows():
    """
    The live rows come from nearest_open_gigs, which returns NUMERIC and
    BIGINT. Those arrive as strings through some drivers, so the scorer must
    not depend on them already being floats.
    """
    corpus_row = {
        "id": "g-1", "title": "Data entry", "description": "Enter records.",
        "employer_reputation": 4.4, "employer_review_count": 6,
    }
    sql_row = {
        "id": "g-1", "title": "Data entry", "description": "Enter records.",
        "employer_reputation": "4.4", "employer_review_count": "6",
    }
    worker = {"skills": ["Data entry"], "bio": "Enter records."}

    assert score_gigs(worker, [corpus_row])[0].score == pytest.approx(
        score_gigs(worker, [sql_row])[0].score
    )
