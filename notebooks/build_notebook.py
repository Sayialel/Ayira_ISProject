"""
Generates ayira_experiment.ipynb.

The notebook is kept as a generator rather than hand-edited JSON because a
notebook saved from Colab carries execution counts and output blobs, which make
every run look like a code change in git. Regenerating from this script keeps
the committed notebook clean and reviewable:

    python notebooks/build_notebook.py
"""

import json
from pathlib import Path

REPO_URL = "https://github.com/Sayialel/Ayira_ISProject.git"
OUT = Path(__file__).resolve().parent / "ayira_experiment.ipynb"


def md(*lines: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": list(lines)}


def code(*lines: str) -> dict:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": list(lines),
    }


CELLS = [
    md(
        "# Ayira — matching engine experiment\n",
        "\n",
        "Runs the offline evaluation of the gig-matching engine, and writes the\n",
        "evidence for each run into Google Drive.\n",
        "\n",
        "**Order matters.** Run the cells top to bottom. Drive is mounted first\n",
        "because the experiment refuses to run in Colab without it — a run saved\n",
        "only to the Colab runtime disappears when the session ends, which is the\n",
        "one failure that leaves you with a number and no evidence for it.\n",
        "\n",
        "**No credentials needed.** The evaluation reads the corpus committed to the\n",
        "repository, not the live database, so nothing here requires the project's\n",
        "`.env`. That is also what makes a run reproducible: the data is pinned by\n",
        "the commit, and its content hash is recorded in every manifest.\n",
    ),
    md(
        "## 1. Mount Drive\n",
        "\n",
        "Run folders are written to `MyDrive/ayira/runs/`, one per experiment.\n",
    ),
    code(
        "from google.colab import drive\n",
        "\n",
        "drive.mount('/content/drive')\n",
    ),
    md(
        "## 2. Get the code\n",
        "\n",
        "The code comes from GitHub rather than being pasted into the notebook, so\n",
        "the commit that produced a result is recorded and can be checked out again.\n",
        "\n",
        "Set `COMMIT` to a specific SHA to reproduce an earlier run exactly; leave it\n",
        "empty to take the current tip of the branch.\n",
    ),
    code(
        f"REPO_URL = {REPO_URL!r}\n",
        "BRANCH = 'main'\n",
        "COMMIT = ''  # e.g. '78c9f5c' to reproduce a specific earlier run\n",
        "\n",
        "import os\n",
        "import subprocess\n",
        "\n",
        "REPO_DIR = '/content/ayira'\n",
        "\n",
        "\n",
        "def run(*args, cwd=None):\n",
        "    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True)\n",
        "    print(result.stdout.strip() or result.stderr.strip())\n",
        "    result.check_returncode()\n",
        "\n",
        "\n",
        "if not os.path.exists(REPO_DIR):\n",
        "    run('git', 'clone', '--branch', BRANCH, REPO_URL, REPO_DIR)\n",
        "else:\n",
        "    run('git', 'fetch', '--all', cwd=REPO_DIR)\n",
        "    run('git', 'checkout', BRANCH, cwd=REPO_DIR)\n",
        "    run('git', 'pull', '--ff-only', cwd=REPO_DIR)\n",
        "\n",
        "if COMMIT:\n",
        "    run('git', 'checkout', COMMIT, cwd=REPO_DIR)\n",
        "\n",
        "run('git', 'log', '-1', '--oneline', cwd=REPO_DIR)\n",
    ),
    md(
        "### If the repository is private\n",
        "\n",
        "Cloning will ask for credentials and fail. Create a fine-grained personal\n",
        "access token with read-only access to this one repository, store it with the\n",
        "Colab secrets manager (the key icon in the sidebar) under the name\n",
        "`GH_TOKEN`, and run the cell below **instead of** the clone cell above.\n",
        "\n",
        "Do not paste a token into a notebook cell. The notebook is committed to the\n",
        "repository, and a token pasted here would be published with it.\n",
    ),
    code(
        "# Only needed for a private repository.\n",
        "from google.colab import userdata\n",
        "\n",
        "token = userdata.get('GH_TOKEN')\n",
        "authed = REPO_URL.replace('https://', f'https://{token}@')\n",
        "\n",
        "if not os.path.exists(REPO_DIR):\n",
        "    run('git', 'clone', '--branch', BRANCH, authed, REPO_DIR)\n",
        "\n",
        "# Keep the token out of the stored remote so it is not written to .git/config.\n",
        "run('git', 'remote', 'set-url', 'origin', REPO_URL, cwd=REPO_DIR)\n",
        "run('git', 'log', '-1', '--oneline', cwd=REPO_DIR)\n",
    ),
    md(
        "## 3. Install dependencies\n",
        "\n",
        "`requirements-eval.txt` pins exact versions, including the ones that only\n",
        "matter indirectly. A result measured against different library versions is\n",
        "not the same result, so every manifest records what was actually resolved.\n",
        "\n",
        "Colab ships its own numpy, and installing matplotlib will happily upgrade it\n",
        "past the pin, so the versions are checked after installing rather than\n",
        "assumed. **Restart the runtime if asked**, then continue from the next cell.\n",
    ),
    code(
        "ENGINE_DIR = f'{REPO_DIR}/apps/ai-engine'\n",
        "\n",
        "!pip install --quiet -r {ENGINE_DIR}/requirements-eval.txt\n",
        "!pip check\n",
    ),
    md(
        "## 4. Check the environment\n",
        "\n",
        "Prints what the run will be recorded against, before spending time on it:\n",
        "the commit, the corpus content hash, the split sizes and the library\n",
        "versions. If the dataset version here differs from one in an earlier run,\n",
        "the two are measuring different data and their numbers are not comparable.\n",
    ),
    code(
        "%cd {ENGINE_DIR}\n",
        "\n",
        "import json\n",
        "import sys\n",
        "\n",
        "if ENGINE_DIR not in sys.path:\n",
        "    sys.path.insert(0, ENGINE_DIR)\n",
        "\n",
        "from eval import experiment, splits\n",
        "\n",
        "print('git       ', experiment.git_state())\n",
        "print('runs go to', experiment.runs_root())\n",
        "print()\n",
        "\n",
        "assignment = splits.load()\n",
        "print('dataset version', assignment.dataset_version)\n",
        "print('split sizes    ', json.dumps(assignment.as_dict()['counts']))\n",
        "print()\n",
        "print(json.dumps(experiment.dependency_versions(), indent=2))\n",
    ),
    md(
        "## 5. Baselines on the validation split\n",
        "\n",
        "The composite against three baselines: random, keyword-only (TF-IDF) and the\n",
        "embedding model alone. The baselines are the point — a score on its own does\n",
        "not say whether the model is earning its complexity.\n",
        "\n",
        "Validation is the default split. The test split is reserved for the final\n",
        "figure and reading it repeatedly destroys what makes it worth reporting.\n",
    ),
    code(
        "!python -m eval.run_eval --split validation --note \"Colab run\"\n",
    ),
    md(
        "## 6. Composite weights\n",
        "\n",
        "Searches the weight grid on the training split, decides on validation, and\n",
        "reports on test.\n",
        "\n",
        "Two of the four weights are held fixed rather than searched, and the run\n",
        "explains which and why. Reputation is constant across the gigs being ranked,\n",
        "so it cannot change their order; location is uncorrelated with the relevance\n",
        "grades, so the labels carry no information about its weight. Searching either\n",
        "returns a confident number for the wrong reason.\n",
    ),
    code(
        "!python -m eval.tune_weights --note \"Colab run\"\n",
    ),
    md(
        "## 7. Cost of two-stage retrieval\n",
        "\n",
        "The live engine shortlists by vector similarity in Postgres and re-ranks the\n",
        "shortlist with the full composite. That is faster, but it can only rank what\n",
        "the shortlist contains. This measures what the shortcut costs at each size.\n",
    ),
    code(
        "!python -m eval.retrieval_eval --note \"Colab run\"\n",
    ),
    md(
        "## 8. What was saved\n",
        "\n",
        "Each run folder in Drive holds the manifest (commit, dataset version, seeds,\n",
        "parameters, dependencies), the metrics, the predictions behind them, the\n",
        "fitted preprocessing artefact, the plots and the log.\n",
        "\n",
        "Keep unsuccessful runs. A change that did not work is evidence about the\n",
        "problem, and deleting it is how the same idea gets retried three times.\n",
    ),
    code(
        "for directory in experiment.list_runs(limit=10):\n",
        "    manifest_file = directory / 'manifest.json'\n",
        "    note = ''\n",
        "    if manifest_file.exists():\n",
        "        note = json.loads(manifest_file.read_text()).get('notes', '')\n",
        "    print(directory.name, '-', note)\n",
        "    for item in sorted(directory.iterdir()):\n",
        "        print(f'    {item.name:<28} {item.stat().st_size:>8,} bytes')\n",
        "    print()\n",
    ),
    md(
        "## 9. Comparing runs\n",
        "\n",
        "`eval.compare` reports the difference between two runs, and refuses when\n",
        "their dataset versions or splits differ — subtracting those would produce a\n",
        "number that looks like a result but is not one.\n",
    ),
    code(
        "!python -m eval.compare --list\n",
    ),
    md(
        "## 10. Back to the working system\n",
        "\n",
        "The one artefact the service needs is the TF-IDF vectoriser fitted on the\n",
        "training split. Until it is deployed, the engine falls back to fitting over\n",
        "whatever gigs are open, so the live scores will not reproduce the figures\n",
        "measured here.\n",
        "\n",
        "Deployment is deliberate and happens locally, from a run made on committed\n",
        "code — the folders are in Drive, which syncs to the desktop:\n",
        "\n",
        "```\n",
        "python -m eval.promote                 # list runs with a promotable artefact\n",
        "python -m eval.promote <run-id>        # deploy it\n",
        "python -m eval.promote --status        # confirm what is deployed\n",
        "```\n",
        "\n",
        "`promote` refuses a run produced from a modified working tree, because an\n",
        "artefact that cannot be rebuilt from a commit cannot be reproduced.\n",
    ),
]

NOTEBOOK = {
    "nbformat": 4,
    "nbformat_minor": 0,
    "metadata": {
        "colab": {"provenance": [], "toc_visible": True},
        "kernelspec": {"name": "python3", "display_name": "Python 3"},
        "language_info": {"name": "python"},
    },
    "cells": CELLS,
}


if __name__ == "__main__":
    OUT.write_text(json.dumps(NOTEBOOK, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({len(CELLS)} cells)")
