"""
Run provenance.

A run that records the wrong provenance is worse than one that records none,
because it looks trustworthy. The dirty-state check in particular has already
been wrong once: runs write their evidence into the repository, so the first
version observed the folder it had just created and marked every run as
unreproducible.
"""

import json

from eval import experiment


def test_git_state_reports_the_current_commit():
    state = experiment.git_state()
    assert state["commit"] and len(state["commit"]) == 40
    assert state["short_commit"] == state["commit"][:7]
    assert state["branch"]


def test_dirty_state_ignores_the_runs_folder():
    """
    Evidence written by a run says nothing about whether the code could be
    rebuilt from its commit.
    """
    assert experiment.EVIDENCE_PREFIXES
    for path in experiment.git_state()["uncommitted_paths"]:
        assert not path.startswith(experiment.EVIDENCE_PREFIXES)


def test_porcelain_paths_are_parsed_whole():
    """
    Git's output is stripped before parsing, so the leading space of the first
    line is gone and a fixed column offset loses the first character of that
    path. This reproduces that bug directly.
    """
    assert experiment._porcelain_path(" M apps/ai-engine/app.py") == "apps/ai-engine/app.py"
    assert experiment._porcelain_path("M apps/ai-engine/app.py") == "apps/ai-engine/app.py"
    assert experiment._porcelain_path("?? notebooks/new.ipynb") == "notebooks/new.ipynb"
    assert experiment._porcelain_path('R  old.py -> new.py') == "new.py"
    assert experiment._porcelain_path("") is None


def test_dependency_versions_cover_what_computes_the_result():
    versions = experiment.dependency_versions()
    for package in ("scikit-learn", "numpy", "sentence-transformers"):
        assert package in versions
        assert versions[package] != "not installed", f"{package} missing from the env"
    assert "python" in versions


def test_run_writes_a_complete_manifest(tmp_path, monkeypatch):
    monkeypatch.setattr(experiment, "LOCAL_RUNS", tmp_path / "runs")

    run = experiment.Run(
        name="unit-test",
        params={"alpha": 1},
        seeds={"split": 123},
        dataset_version="deadbeef",
        notes="a note",
    )
    directory = run.finish({"ndcg_at_10": 0.5})

    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    for key in (
        "run_id", "name", "started_at", "finished_at", "git",
        "dataset_version", "seeds", "parameters", "dependencies",
        "environment", "notes",
    ):
        assert key in manifest, f"manifest is missing {key}"

    assert manifest["dataset_version"] == "deadbeef"
    assert manifest["seeds"] == {"split": 123}
    assert manifest["parameters"] == {"alpha": 1}

    metrics = json.loads((directory / "metrics.json").read_text(encoding="utf-8"))
    assert metrics == {"ndcg_at_10": 0.5}
    assert (directory / "run.log").exists()


def test_run_id_carries_the_name_and_commit(tmp_path, monkeypatch):
    monkeypatch.setattr(experiment, "LOCAL_RUNS", tmp_path / "runs")
    run = experiment.Run(name="unit-test")

    assert "unit-test" in run.run_id
    assert experiment.git_state()["short_commit"] in run.run_id
    run.finish()


def test_git_state_is_captured_at_start_not_at_finish(tmp_path, monkeypatch):
    """
    The manifest must describe the code that produced the result, not the tree
    after the run wrote its outputs.
    """
    monkeypatch.setattr(experiment, "LOCAL_RUNS", tmp_path / "runs")
    run = experiment.Run(name="unit-test")
    captured = dict(run.git)

    monkeypatch.setattr(
        experiment, "git_state", lambda: {"commit": "x" * 40, "short_commit": "xxxxxxx"}
    )
    directory = run.finish()

    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["git"] == captured


def test_failed_run_still_leaves_evidence(tmp_path, monkeypatch):
    """An unsuccessful run is evidence too; finish() is called either way."""
    monkeypatch.setattr(experiment, "LOCAL_RUNS", tmp_path / "runs")
    run = experiment.Run(name="unit-test")
    directory = run.finish(None)

    assert (directory / "manifest.json").exists()
    assert not (directory / "metrics.json").exists()


def test_load_run_round_trips(tmp_path, monkeypatch):
    monkeypatch.setattr(experiment, "LOCAL_RUNS", tmp_path / "runs")
    run = experiment.Run(name="unit-test", dataset_version="v1")
    run.finish({"ndcg_at_10": 0.25})

    loaded = experiment.load_run(run.directory)
    assert loaded["manifest"]["run_id"] == run.run_id
    assert loaded["metrics"]["ndcg_at_10"] == 0.25


def test_runs_root_is_local_when_not_in_colab():
    assert not experiment.in_colab()
    assert experiment.runs_root() == experiment.LOCAL_RUNS
