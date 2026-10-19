"""
Promotion safeguards.

Promotion is the one step that changes what the live engine does, so every
gate here is a gate against shipping something that cannot be traced or
reproduced.
"""

import json

import pytest

from app.services import tfidf_model
from eval import experiment, promote

DOCS = ["python developer pipelines", "data entry clerk records", "designer logo"]


@pytest.fixture
def deployment(tmp_path, monkeypatch):
    """Redirects the serving paths into a temporary directory."""
    serving = tmp_path / "artifacts" / "tfidf_vectorizer.joblib"
    serving.parent.mkdir(parents=True)

    monkeypatch.setattr(tfidf_model, "SERVING_PATH", serving)
    monkeypatch.setattr(promote, "RECORD_PATH", serving.parent / "deployed.json")
    monkeypatch.setattr(
        promote, "PREVIOUS_PATH", serving.with_suffix(".joblib.previous")
    )
    monkeypatch.setattr(
        promote, "PREVIOUS_RECORD_PATH", serving.parent / "deployed.json.previous"
    )
    monkeypatch.setattr(experiment, "LOCAL_RUNS", tmp_path / "runs")
    tfidf_model.reset_serving_cache()
    yield serving
    tfidf_model.reset_serving_cache()


def _make_run(name="r", dirty=False, dataset="v1"):
    """A finished run folder holding a real artefact."""
    run = experiment.Run(name=name, dataset_version=dataset)
    run.params["tfidf_fitted_on"] = "train"
    tfidf_model.save(tfidf_model.fit(DOCS), run.artefact_path(promote.ARTEFACT_NAME))
    run.git = {**run.git, "dirty": dirty, "commit": "a" * 40, "short_commit": "aaaaaaa"}
    run.finish({"ndcg_at_10": 0.5})
    return run


def test_promote_deploys_the_artefact_and_records_provenance(deployment):
    run = _make_run()
    promote.promote(run.run_id)

    assert deployment.exists()
    assert tfidf_model.load(deployment) is not None

    record = json.loads(promote.RECORD_PATH.read_text(encoding="utf-8"))
    assert record["run_id"] == run.run_id
    assert record["dataset_version"] == "v1"
    assert record["fitted_on"] == "train"
    assert record["git_commit"] == "a" * 40


def test_promote_refuses_a_run_from_a_dirty_tree(deployment):
    """
    An artefact built from uncommitted code cannot be rebuilt from its commit,
    so what is serving could not be reproduced.
    """
    run = _make_run(dirty=True)
    with pytest.raises(SystemExit, match="modified working tree"):
        promote.promote(run.run_id)

    assert not deployment.exists()


def test_allow_dirty_is_an_explicit_override(deployment):
    run = _make_run(dirty=True)
    promote.promote(run.run_id, allow_dirty=True)
    assert deployment.exists()


def test_promote_refuses_an_unknown_run(deployment):
    with pytest.raises(SystemExit, match="No run folder"):
        promote.promote("20260101T000000Z__nope__abc1234")


def test_promote_refuses_a_run_without_an_artefact(deployment):
    run = experiment.Run(name="no-artefact")
    run.git = {**run.git, "dirty": False}
    run.finish({})

    with pytest.raises(SystemExit, match="no tfidf_vectorizer"):
        promote.promote(run.run_id)


def test_promote_refuses_a_corrupt_artefact(deployment):
    """Verified before overwriting, so a bad file cannot take down scoring."""
    run = experiment.Run(name="corrupt", dataset_version="v1")
    run.artefact_path(promote.ARTEFACT_NAME).write_bytes(b"not joblib")
    run.git = {**run.git, "dirty": False}
    run.finish({})

    with pytest.raises(SystemExit, match="refusing to deploy"):
        promote.promote(run.run_id)


def test_a_failed_promotion_leaves_the_previous_artefact_serving(deployment):
    good = _make_run(name="good")
    promote.promote(good.run_id)
    before = deployment.read_bytes()

    bad = experiment.Run(name="bad", dataset_version="v1")
    bad.artefact_path(promote.ARTEFACT_NAME).write_bytes(b"not joblib")
    bad.git = {**bad.git, "dirty": False}
    bad.finish({})

    with pytest.raises(SystemExit):
        promote.promote(bad.run_id)

    assert deployment.read_bytes() == before


# --- rollback ------------------------------------------------------------


def test_promote_keeps_the_previous_artefact(deployment):
    first = _make_run(name="first")
    promote.promote(first.run_id)

    second = _make_run(name="second")
    promote.promote(second.run_id)

    assert promote.PREVIOUS_PATH.exists()
    record = json.loads(promote.RECORD_PATH.read_text(encoding="utf-8"))
    previous = json.loads(promote.PREVIOUS_RECORD_PATH.read_text(encoding="utf-8"))
    assert record["run_id"] == second.run_id
    assert previous["run_id"] == first.run_id


def test_rollback_restores_the_previous_deployment(deployment, capsys):
    first = _make_run(name="first")
    promote.promote(first.run_id)
    second = _make_run(name="second")
    promote.promote(second.run_id)

    promote.rollback()
    capsys.readouterr()

    record = json.loads(promote.RECORD_PATH.read_text(encoding="utf-8"))
    assert record["run_id"] == first.run_id
    assert tfidf_model.load(deployment) is not None


def test_rollback_can_itself_be_undone(deployment, capsys):
    """
    Finding that the previous artefact was the broken one must not leave the
    only good copy unreachable.
    """
    first = _make_run(name="first")
    promote.promote(first.run_id)
    second = _make_run(name="second")
    promote.promote(second.run_id)

    promote.rollback()
    promote.rollback()
    capsys.readouterr()

    record = json.loads(promote.RECORD_PATH.read_text(encoding="utf-8"))
    assert record["run_id"] == second.run_id


def test_rollback_without_a_previous_artefact_fails_clearly(deployment):
    with pytest.raises(SystemExit, match="No previous artefact"):
        promote.rollback()


# --- staleness -----------------------------------------------------------


def test_status_warns_when_the_corpus_has_moved_on(deployment, monkeypatch, capsys):
    """
    A deployed artefact fitted on a corpus that no longer exists means the
    offline figures describe data the live engine was never fitted on.
    """
    run = _make_run(dataset="old-version")
    promote.promote(run.run_id)

    monkeypatch.setattr(promote, "_current_dataset_version", lambda: "new-version")
    promote.show_status()

    out = capsys.readouterr().out
    assert "STALE" in out
    assert "new-version" in out


def test_status_is_quiet_when_the_dataset_matches(deployment, monkeypatch, capsys):
    run = _make_run(dataset="same-version")
    promote.promote(run.run_id)

    monkeypatch.setattr(promote, "_current_dataset_version", lambda: "same-version")
    promote.show_status()

    assert "STALE" not in capsys.readouterr().out
