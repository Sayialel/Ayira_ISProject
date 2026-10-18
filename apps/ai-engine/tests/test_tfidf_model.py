"""
The TF-IDF artefact.

Fitting per request was the original defect: it leaked validation and test
documents into the weighting, and made the same worker and gig score
differently as the catalogue changed. These guard the fix.
"""

import joblib
import pytest

from app.services import tfidf_model

DOCS = [
    "python developer data pipelines",
    "data entry clerk spreadsheet records",
    "graphic designer logo branding",
]


def test_fit_learns_a_vocabulary():
    vectorizer = tfidf_model.fit(DOCS)
    assert len(vectorizer.vocabulary_) > 0
    assert "python" in vectorizer.vocabulary_


def test_fit_refuses_an_empty_corpus():
    with pytest.raises(ValueError):
        tfidf_model.fit([])


def test_similarities_rank_the_matching_document_first():
    vectorizer = tfidf_model.fit(DOCS)
    scores = tfidf_model.similarities(vectorizer, "python pipelines", DOCS)
    assert scores.index(max(scores)) == 0


def test_similarities_are_in_unit_range():
    vectorizer = tfidf_model.fit(DOCS)
    for score in tfidf_model.similarities(vectorizer, "data records", DOCS):
        assert 0.0 <= score <= 1.0


def test_scoring_never_refits():
    """
    The artefact exists so nothing is learned at scoring time. If scoring
    refitted, document frequencies would depend on the candidate pool and the
    whole point would be lost.
    """
    vectorizer = tfidf_model.fit(DOCS)
    before = dict(vectorizer.vocabulary_)

    tfidf_model.similarities(vectorizer, "entirely unseen vocabulary here", DOCS)

    assert vectorizer.vocabulary_ == before


def test_out_of_vocabulary_query_scores_zero_rather_than_failing():
    vectorizer = tfidf_model.fit(DOCS)
    scores = tfidf_model.similarities(vectorizer, "zzz unseen", DOCS)
    assert scores == [0.0, 0.0, 0.0]


def test_empty_query_and_empty_documents():
    vectorizer = tfidf_model.fit(DOCS)
    assert tfidf_model.similarities(vectorizer, "", DOCS) == [0.0, 0.0, 0.0]
    assert tfidf_model.similarities(vectorizer, "python", []) == []


def test_save_and_load_round_trip(tmp_path):
    vectorizer = tfidf_model.fit(DOCS)
    path = tfidf_model.save(vectorizer, tmp_path / "v.joblib")

    loaded = tfidf_model.load(path)
    assert loaded is not None
    assert loaded.vocabulary_ == vectorizer.vocabulary_
    assert tfidf_model.similarities(loaded, "python", DOCS) == tfidf_model.similarities(
        vectorizer, "python", DOCS
    )


def test_load_returns_none_for_a_missing_file(tmp_path):
    assert tfidf_model.load(tmp_path / "absent.joblib") is None


def test_load_rejects_a_stale_artefact_version(tmp_path):
    """
    A version bump means the fitting parameters changed. Reusing the old file
    would score with settings nobody chose.
    """
    path = tmp_path / "old.joblib"
    joblib.dump(
        {"version": tfidf_model.ARTEFACT_VERSION + 1, "vectorizer": tfidf_model.fit(DOCS)},
        path,
    )
    assert tfidf_model.load(path) is None


def test_load_survives_a_corrupt_file(tmp_path):
    path = tmp_path / "corrupt.joblib"
    path.write_bytes(b"not a joblib payload")
    assert tfidf_model.load(path) is None


def test_serving_cache_is_reset_between_loads(tmp_path, monkeypatch):
    monkeypatch.setattr(tfidf_model, "SERVING_PATH", tmp_path / "absent.joblib")
    tfidf_model.reset_serving_cache()
    assert tfidf_model.load_serving() is None

    tfidf_model.save(tfidf_model.fit(DOCS), tmp_path / "absent.joblib")
    # Still None: the miss was cached, which is what keeps it off the hot path.
    assert tfidf_model.load_serving() is None

    tfidf_model.reset_serving_cache()
    assert tfidf_model.load_serving() is not None

    tfidf_model.reset_serving_cache()


def test_vocabulary_is_fitted_on_training_data_only(corpus):
    """
    The leakage guard, on the real corpus.

    A term that appears *only* in a validation or test gig must not be in the
    vocabulary, because its presence would mean the weighting had seen
    held-out documents.
    """
    from app.services.scoring import gig_text
    from eval import splits

    scoped = splits.fit_scope(corpus.gigs, corpus.assignment, corpus.grades)
    scoped_ids = {g["id"] for g in scoped}

    analyze = corpus.vectorizer.build_analyzer()
    in_scope_terms = set()
    for gig in scoped:
        in_scope_terms.update(analyze(gig_text(gig)))
    for profile in corpus.profiles:
        if corpus.assignment.of(profile["id"]) == "train":
            from app.services.scoring import profile_text

            in_scope_terms.update(analyze(profile_text(profile)))

    leaked = set(corpus.vectorizer.vocabulary_) - in_scope_terms
    assert not leaked, f"vocabulary contains terms absent from training data: {sorted(leaked)[:10]}"

    # And the scope really did exclude some gigs, or the test proves nothing.
    assert scoped_ids != {g["id"] for g in corpus.gigs}
