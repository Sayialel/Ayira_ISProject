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
import shutil
from datetime import datetime, timezone
from pathlib import Path

from app.services import tfidf_model
from eval import experiment

ARTEFACT_NAME = "tfidf_vectorizer.joblib"
RECORD_PATH = tfidf_model.SERVING_PATH.parent / "deployed.json"


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
    else:
        print("  (no deployment record — provenance unknown)")
    print()


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id", nargs="?", help="the run whose artefact to deploy")
    parser.add_argument("--status", action="store_true", help="show what is deployed")
    parser.add_argument(
        "--allow-dirty",
        action="store_true",
        help="deploy even if the run came from a modified working tree",
    )
    args = parser.parse_args()

    if args.status:
        show_status()
    elif args.run_id:
        promote(args.run_id, allow_dirty=args.allow_dirty)
    else:
        list_candidates()


if __name__ == "__main__":
    main()
