"""
Run identity and evidence.

Step 3 of the institutional workflow requires every experiment to record the
Git commit, dataset version, dependencies, parameters, random seeds and a run
identifier. Step 4 requires the outputs to be preserved in a clearly named
folder per run, with enough information to connect every output back to the
code and data that produced it.

This module is both of those. Nothing else in the evaluation writes results
directly — they go through `Run`, so a result that exists without its
provenance cannot be produced by accident.

Where the evidence goes
-----------------------
In Colab, Drive is mounted and runs are written under it, because files left in
the Colab runtime are deleted when the session ends and are not a record.
Locally they are written into the repository so a run can be inspected and
compared without Drive, and committed alongside the code that produced it.
"""

import json
import platform
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
LOCAL_RUNS = HERE / "results" / "runs"

# Where Drive appears once mounted in a Colab runtime.
DRIVE_ROOT = Path("/content/drive/MyDrive/ayira/runs")

# Recorded for every run. A result is only reproducible if the versions of the
# things that actually compute it are known.
TRACKED_PACKAGES = [
    "sentence-transformers",
    "scikit-learn",
    "numpy",
    "torch",
    "supabase",
    "joblib",
    "matplotlib",
]


def in_colab() -> bool:
    return "google.colab" in sys.modules


def drive_mounted() -> bool:
    return Path("/content/drive/MyDrive").exists()


def runs_root() -> Path:
    """
    Drive when it is available, the repository otherwise.

    Running in Colab *without* Drive mounted is the dangerous case: the run
    would appear to succeed and then vanish with the runtime. That is refused
    rather than silently written somewhere temporary.
    """
    if in_colab():
        if not drive_mounted():
            raise SystemExit(
                "Running in Colab with Drive not mounted. Mount it first:\n"
                "    from google.colab import drive\n"
                "    drive.mount('/content/drive')\n"
                "Otherwise the run would be lost when the runtime ends."
            )
        return DRIVE_ROOT
    return LOCAL_RUNS


# Evidence written by runs themselves. Changes here say nothing about whether
# the code could be rebuilt from its commit, so they are excluded from the
# dirty assessment below.
EVIDENCE_PREFIXES = ("apps/ai-engine/eval/results/",)


def git_state() -> dict[str, Any]:
    """
    The commit the code came from, and whether it had uncommitted edits.

    `dirty` matters more than it looks: a run made from a modified working tree
    cannot be reproduced from its commit, and saying so is the difference
    between evidence and an anecdote. `eval.promote` refuses to deploy an
    artefact from a dirty run for exactly that reason.

    Which is why the run's own output folder must not count. Runs write their
    evidence into the repository, so a local run would otherwise observe the
    directory it had just created and report itself as unreproducible --
    marking every run dirty and making the flag useless.
    """
    repo = HERE.parents[2]

    def git(*args: str) -> str | None:
        try:
            out = subprocess.run(
                ["git", *args], cwd=repo, capture_output=True, text=True, timeout=15
            )
            return out.stdout.strip() if out.returncode == 0 else None
        except Exception:
            return None

    commit = git("rev-parse", "HEAD")
    status = git("status", "--porcelain")

    changed: list[str] | None = None
    if status is not None:
        changed = [
            path
            for path in (_porcelain_path(line) for line in status.splitlines())
            if path and not path.startswith(EVIDENCE_PREFIXES)
        ]

    return {
        "commit": commit,
        "short_commit": commit[:7] if commit else None,
        "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
        "dirty": bool(changed) if changed is not None else None,
        "uncommitted_files": len(changed) if changed else 0,
        "uncommitted_paths": sorted(changed or [])[:20],
    }


def _porcelain_path(line: str) -> str | None:
    """
    The path out of one `git status --porcelain` line.

    Split on whitespace rather than slicing a fixed column: the status field is
    two characters, but the surrounding output gets stripped before it reaches
    here, so a leading space may or may not still be present and a fixed offset
    silently loses the first character of the path.
    """
    parts = line.split(maxsplit=1)
    if len(parts) < 2:
        return None
    # A rename reads "old -> new"; the new path is the one that exists.
    return parts[1].split(" -> ")[-1].strip().strip('"')


def dependency_versions() -> dict[str, str]:
    from importlib.metadata import PackageNotFoundError, version

    found = {}
    for name in TRACKED_PACKAGES:
        try:
            found[name] = version(name)
        except PackageNotFoundError:
            found[name] = "not installed"
    found["python"] = platform.python_version()
    return found


@dataclass
class Run:
    """One experiment, and the folder holding everything it produced."""

    name: str
    params: dict[str, Any] = field(default_factory=dict)
    seeds: dict[str, int] = field(default_factory=dict)
    dataset_version: str | None = None
    notes: str = ""

    run_id: str = field(init=False)
    directory: Path = field(init=False)
    started_at: str = field(init=False)
    # Captured once, before the run folder exists, and reused in the manifest.
    # Re-reading it at finish would describe the tree *after* the run wrote its
    # own outputs, not the code that produced the result.
    git: dict = field(init=False, default_factory=dict)
    _log: list[str] = field(init=False, default_factory=list)

    def __post_init__(self) -> None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.git = git_state()
        # The id carries the name and the commit, so a folder is identifiable
        # from its name alone without opening anything.
        commit = self.git.get("short_commit") or "nocommit"
        self.run_id = f"{stamp}__{self.name}__{commit}"
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.directory = runs_root() / self.run_id
        self.directory.mkdir(parents=True, exist_ok=True)
        self.log(f"run {self.run_id} started")

    # -- evidence ---------------------------------------------------------

    def log(self, message: str) -> None:
        line = f"{datetime.now(timezone.utc).isoformat()}  {message}"
        self._log.append(line)
        print(message)

    def write_json(self, filename: str, payload: Any) -> Path:
        path = self.directory / filename
        path.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
        return path

    def write_text(self, filename: str, text: str) -> Path:
        path = self.directory / filename
        path.write_text(text, encoding="utf-8")
        return path

    def artefact_path(self, filename: str) -> Path:
        """A path inside the run folder, for a caller writing its own file."""
        return self.directory / filename

    # -- lifecycle --------------------------------------------------------

    def manifest(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "name": self.name,
            "started_at": self.started_at,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "git": self.git,
            "dataset_version": self.dataset_version,
            "seeds": self.seeds,
            "parameters": self.params,
            "dependencies": dependency_versions(),
            "environment": {
                "colab": in_colab(),
                "drive_mounted": drive_mounted(),
                "platform": platform.platform(),
                "hostname": platform.node(),
            },
            "notes": self.notes,
        }

    def finish(self, metrics: dict[str, Any] | None = None) -> Path:
        """
        Closes the run, writing the manifest and the log.

        Called even when an experiment fails: an unsuccessful run is evidence
        too, and the protocol asks for those to be preserved rather than
        discarded.
        """
        if metrics is not None:
            self.write_json("metrics.json", metrics)

        self.write_json("manifest.json", self.manifest())
        self.log(f"run {self.run_id} finished")
        self.write_text("run.log", "\n".join(self._log) + "\n")
        return self.directory


def list_runs(limit: int = 20) -> list[Path]:
    root = runs_root()
    if not root.exists():
        return []
    return sorted((p for p in root.iterdir() if p.is_dir()), reverse=True)[:limit]


def load_run(run_id_or_path: str | Path) -> dict[str, Any]:
    """Reads back a finished run: its manifest and its metrics."""
    path = Path(run_id_or_path)
    if not path.is_absolute():
        path = runs_root() / str(run_id_or_path)

    manifest_file = path / "manifest.json"
    if not manifest_file.exists():
        raise SystemExit(f"No manifest at {manifest_file}")

    metrics_file = path / "metrics.json"
    return {
        "path": str(path),
        "manifest": json.loads(manifest_file.read_text(encoding="utf-8")),
        "metrics": json.loads(metrics_file.read_text(encoding="utf-8"))
        if metrics_file.exists()
        else None,
    }
