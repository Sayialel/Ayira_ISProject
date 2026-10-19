"""
Deploys a run's preprocessing artefact to the serving path.

    python -m eval.promote                    # list runs that have an artefact
    python -m eval.promote <run-id>           # deploy that run's artefact
    python -m eval.promote --status            # what is deployed right now

Step 5 of the workflow is bringing results back from the experiment into the
working system. For this project that is one file: the TF-IDF vectoriser
fitted on the training split. Until it is promoted, the service falls back to
fitting over whatever gigs are open, so the figure measured offline does not
describe what the live engine does.

Promotion is a separate command rather than something an experiment does on its
own, because an experiment that redeployed the service as a side effect would
make every exploratory run a production change.

A record of what was deployed, and which run it came from, is written beside
the artefact so the deployed state can always be traced back to its evidence.
"""

import argparse
import json
import pathlib
import shutil
from datetime import datetime, timezone
from pathlib import Path

from app.services import tfidf_model
from eval import experiment

ARTEFACT_NAME = "tfidf_vectorizer.joblib"
RECORD_PATH = tfidf_model.SERVING_PATH.parent / "deployed.json"

# The artefact that was serving before the current one, kept so a bad
# promotion can be undone without rebuilding anything. One generation is
# enough: every older artefact is still in its own run folder.
PREVIOUS_PATH = tfidf_model.SERVING_PATH.with_suffix(".joblib.previous")
PREVIOUS_RECORD_PATH = RECORD_PATH.with_suffix(".json.previous")


def runs_with_artefact() -> list[Path]:
    return [
        directory
        for directory in experiment.list_runs(limit=200)
        if (directory / ARTEFACT_NAME).exists()
    ]


def show_status() -> None:
    if not tfidf_model.SERVING_PATH.exists():
        print(f"\nNothing deployed at {tfidf_model.SERVING_PATH}")
        print("The service is fitting TF-IDF per request, which is not reproducible.\n")
        return

    vectorizer = tfidf_model.load(tfidf_model.SERVING_PATH)
    print(f"\nDeployed: {tfidf_model.SERVING_PATH}")
    if vectorizer is not None:
        print(f"  vocabulary: {len(vectorizer.vocabulary_)} terms")

    if RECORD_PATH.exists():
        record = json.loads(RECORD_PATH.read_text(encoding="utf-8"))
        print(f"  from run : {record.get('run_id')}")
        print(f"  commit   : {record.get('git_commit')}")
        print(f"  dataset  : {record.get('dataset_version')}")
        print(f"  deployed : {record.get('deployed_at')}")
        _warn_if_stale(record)
    else:
        print("  (no deployment record - provenance unknown)")

    if PREVIOUS_PATH.exists():
        print(f"  rollback : available ({PREVIOUS_PATH.name})")
    print()


def _current_dataset_version() -> str | None:
    try:
        from eval import splits

        return splits.load().dataset_version
    except SystemExit:
        return None


def _warn_if_stale(record: dict) -> None:
    """
    Warns when the deployed artefact was fitted on a corpus that no longer
    exists.

    This is the quiet failure the whole mechanism exists to prevent: the
    offline figures would be describing data the live engine was never fitted
    on, and nothing else would report it.
    """
    current = _current_dataset_version()
    deployed = record.get("dataset_version")
    if not current or deployed == current:
        return

    print()
    print(f"  STALE: the corpus is now {current}, but this artefact was fitted")
    print(f"  on {deployed}. Re-run the evaluation and promote again, or the")
    print("  offline figures do not describe what is serving.")


def list_candidates() -> None:
    candidates = runs_with_artefact()
    if not candidates:
        raise SystemExit(
            "No run has produced an artefact yet. Run: python -m eval.run_eval"
        )

    print("\nRuns with a promotable artefact, newest first:\n")
    for directory in candidates:
        manifest_file = directory / "manifest.json"
        detail = ""
        if manifest_file.exists():
            manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
            dirty = " (dirty tree)" if manifest.get("git", {}).get("dirty") else ""
            detail = f"  dataset {manifest.get('dataset_version')}{dirty}"
        print(f"  {directory.name}{detail}")

    print("\nDeploy one with: python -m eval.promote <run-id>\n")


def promote(run_id: str, allow_dirty: bool = False) -> None:
    directory = experiment.runs_root() / run_id
    if not directory.exists():
        raise SystemExit(f"No run folder at {directory}")

    source = directory / ARTEFACT_NAME
    if not source.exists():
        raise SystemExit(f"Run {run_id} has no {ARTEFACT_NAME} to promote.")

    manifest_file = directory / "manifest.json"
    manifest = (
        json.loads(manifest_file.read_text(encoding="utf-8"))
        if manifest_file.exists()
        else {}
    )

    # An artefact built from uncommitted code cannot be rebuilt from its
    # commit, so what is serving could not be reproduced. Allowed, but only
    # when asked for explicitly.
    if manifest.get("git", {}).get("dirty") and not allow_dirty:
        raise SystemExit(
            f"Run {run_id} was produced from a modified working tree, so the "
            "artefact cannot be\nrebuilt from its commit. Commit the code and "
            "re-run, or pass --allow-dirty if you\naccept that the deployed "
            "artefact is not reproducible."
        )

    # Verify it loads before overwriting what is already serving, so a corrupt
    # or stale-version file cannot take down scoring.
    if tfidf_model.load(source) is None:
        raise SystemExit(
            f"{source} did not load as a version {tfidf_model.ARTEFACT_VERSION} "
            "artefact; refusing to deploy it."
        )

    tfidf_model.SERVING_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Keep what is serving now, so a promotion that turns out to be wrong can
    # be undone without rebuilding it.
    if tfidf_model.SERVING_PATH.exists():
        shutil.copy2(tfidf_model.SERVING_PATH, PREVIOUS_PATH)
        if RECORD_PATH.exists():
            shutil.copy2(RECORD_PATH, PREVIOUS_RECORD_PATH)

    shutil.copy2(source, tfidf_model.SERVING_PATH)

    RECORD_PATH.write_text(
        json.dumps(
            {
                "run_id": run_id,
                "artefact": ARTEFACT_NAME,
                "artefact_version": tfidf_model.ARTEFACT_VERSION,
                "git_commit": manifest.get("git", {}).get("commit"),
                "git_dirty": manifest.get("git", {}).get("dirty"),
                "dataset_version": manifest.get("dataset_version"),
                "fitted_on": manifest.get("parameters", {}).get("tfidf_fitted_on"),
                "deployed_at": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"\nDeployed {ARTEFACT_NAME} from {run_id}")
    print(f"  to {tfidf_model.SERVING_PATH}")
    print(f"  record written to {RECORD_PATH.name}")
    print("\nRestart the engine for it to take effect.\n")


def _swap(a: pathlib.Path, b: pathlib.Path) -> None:
    """Exchanges two files, so the operation can itself be undone."""
    if not a.exists() or not b.exists():
        return
    spare = a.with_suffix(a.suffix + ".swap")
    shutil.move(str(a), str(spare))
    shutil.move(str(b), str(a))
    shutil.move(str(spare), str(b))


def rollback() -> None:
    """
    Restores the artefact that was serving before the last promotion.

    Swaps rather than overwrites, so a rollback can be undone too --
    discovering that the previous artefact was the broken one should not
    leave the only good copy unreachable.
    """
    if not PREVIOUS_PATH.exists():
        raise SystemExit(
            "No previous artefact to roll back to. Promote one from a run "
            "instead: python -m eval.promote <run-id>"
        )

    if tfidf_model.load(PREVIOUS_PATH) is None:
        raise SystemExit(
            f"{PREVIOUS_PATH} did not load as a version "
            f"{tfidf_model.ARTEFACT_VERSION} artefact; refusing to roll back."
        )

    _swap(tfidf_model.SERVING_PATH, PREVIOUS_PATH)
    _swap(RECORD_PATH, PREVIOUS_RECORD_PATH)

    print()
    print("Rolled back to the previously deployed artefact.")
    print("Restart the engine for it to take effect.")
    show_status()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id", nargs="?", help="the run whose artefact to deploy")
    parser.add_argument("--status", action="store_true", help="show what is deployed")
    parser.add_argument(
        "--rollback",
        action="store_true",
        help="restore the artefact that was serving before the last promotion",
    )
    parser.add_argument(
        "--allow-dirty",
        action="store_true",
        help="deploy even if the run came from a modified working tree",
    )
    args = parser.parse_args()

    if args.rollback:
        rollback()
    elif args.status:
        show_status()
    elif args.run_id:
        promote(args.run_id, allow_dirty=args.allow_dirty)
    else:
        list_candidates()


if __name__ == "__main__":
    main()
