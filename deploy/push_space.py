"""
Creates the Hugging Face Space and pushes the matching engine to it.

    python deploy/push_space.py --space <user>/ayira-engine

Reads HF_TOKEN from the environment or the repository .env, so the token never
has to be typed into a terminal where it would land in shell history.

What it does, in order:

  1. refuses to run unless a TF-IDF artefact has been promoted, because a Space
     without one falls back to fitting per request and serves a model that was
     never evaluated;
  2. assembles the Space contents into a temporary directory;
  3. scans every file for key material before anything leaves this machine;
  4. creates the Space if it does not exist, as a Docker Space;
  5. uploads the folder;
  6. sets the three secrets the engine needs, if their values are available.

It does not print any secret value. Run it again to redeploy -- upload_folder
replaces what is there.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ENGINE = REPO / "apps" / "ai-engine"
SPACE_FILES = REPO / "deploy" / "huggingface-space"

#: Values that must never be pushed to a public Space.
SECRET_SHAPES = re.compile(r"eyJ[A-Za-z0-9_-]{30,}|sbp_[A-Za-z0-9]{20,}|GOCSPX-[A-Za-z0-9_-]{10,}")

#: Carried into the Space as secrets. The engine refuses to serve without the
#: third, so a public Space is still not an open door.
SECRET_KEYS = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "AI_ENGINE_SECRET")


def load_env() -> dict[str, str]:
    """Reads the repository .env without needing python-dotenv."""
    values: dict[str, str] = {}
    env_file = REPO / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip().strip('"').strip("'")
    # A real environment variable wins over the file.
    values.update({k: v for k, v in os.environ.items() if k in SECRET_KEYS or k == "HF_TOKEN"})
    return values


def assemble(target: Path) -> None:
    """Copies the engine, its artefact and the Space-specific files."""
    artefact = ENGINE / "artifacts" / "tfidf_vectorizer.joblib"
    if not artefact.exists():
        sys.exit(
            "No promoted TF-IDF artefact at apps/ai-engine/artifacts/.\n"
            "  cd apps/ai-engine\n"
            "  python -m eval.run_eval --split validation\n"
            "  python -m eval.promote <run-id>\n"
            "Without it the Space fits TF-IDF per request and serves a model "
            "that was never evaluated."
        )

    shutil.copytree(ENGINE / "app", target / "app")
    shutil.copytree(ENGINE / "artifacts", target / "artifacts")
    shutil.copy(ENGINE / "requirements.txt", target / "requirements.txt")
    shutil.copy(SPACE_FILES / "Dockerfile", target / "Dockerfile")
    shutil.copy(SPACE_FILES / "README.md", target / "README.md")

    # Build noise and the local rollback copies are not the Space's business.
    for cache in target.rglob("__pycache__"):
        shutil.rmtree(cache, ignore_errors=True)
    for stale in target.glob("artifacts/*.previous"):
        stale.unlink()

    (target / ".gitignore").write_text("__pycache__/\n*.pyc\n.env\n", encoding="utf-8")


def scan_for_secrets(target: Path) -> None:
    """Last line of defence before anything is published."""
    offenders = []
    for path in target.rglob("*"):
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue          # a binary artefact; nothing to read
        if SECRET_SHAPES.search(text):
            offenders.append(path.relative_to(target))

    if offenders:
        sys.exit(
            "Refusing to push. These files look like they contain key "
            "material:\n  " + "\n  ".join(str(o) for o in offenders)
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--space",
        required=True,
        help="target Space, as <user-or-org>/<name>, e.g. lenina/ayira-engine",
    )
    parser.add_argument(
        "--private",
        action="store_true",
        help="create it private. Note: free ZeroGPU and some quotas apply to "
        "public Spaces only; a private Space still serves over HTTPS.",
    )
    parser.add_argument(
        "--skip-secrets",
        action="store_true",
        help="upload the code but do not set Space secrets",
    )
    args = parser.parse_args()

    env = load_env()
    token = env.get("HF_TOKEN")
    if not token:
        sys.exit(
            "No HF_TOKEN.\n"
            "Create one at https://huggingface.co/settings/tokens with the\n"
            "'write' role, then add it to the repository .env as:\n"
            "    HF_TOKEN=hf_...\n"
            ".env is gitignored, so it will not be committed."
        )

    try:
        from huggingface_hub import HfApi
    except ImportError:
        sys.exit("huggingface_hub is not installed in this interpreter.")

    api = HfApi(token=token)

    who = api.whoami()
    print(f"Authenticated as {who.get('name')}")

    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "space"
        target.mkdir()

        print("Assembling the Space…")
        assemble(target)

        print("Scanning for key material…")
        scan_for_secrets(target)
        print("  clean")

        print(f"Creating {args.space} if it does not exist…")
        api.create_repo(
            repo_id=args.space,
            repo_type="space",
            space_sdk="docker",
            private=args.private,
            exist_ok=True,
        )

        print("Uploading…")
        api.upload_folder(
            folder_path=str(target),
            repo_id=args.space,
            repo_type="space",
            commit_message="Deploy the Ayira matching engine",
        )

    if not args.skip_secrets:
        print("Setting Space secrets…")
        for key in SECRET_KEYS:
            value = env.get(key)
            if not value:
                print(f"  {key}: not found locally — set it in the Space settings")
                continue
            api.add_space_secret(repo_id=args.space, key=key, value=value)
            print(f"  {key}: set")

    user = args.space.split("/")[0]
    name = args.space.split("/")[1]
    url = f"https://{user}-{name}.hf.space".replace("_", "-").lower()

    print()
    print("Pushed. The Space is building; the first build downloads the encoder")
    print("and takes several minutes.")
    print()
    print(f"  Space page : https://huggingface.co/spaces/{args.space}")
    print(f"  Service URL: {url}")
    print(f"  Health     : {url}/health")
    print()
    print("Put the service URL into the API gateway as AI_ENGINE_URL.")


if __name__ == "__main__":
    main()
