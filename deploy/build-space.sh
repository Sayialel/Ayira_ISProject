#!/usr/bin/env bash
#
# Assembles the Hugging Face Space directory for the matching engine.
#
#   ./deploy/build-space.sh [target]        (default: ../ayira-engine-space)
#
# A Space is its own git repository containing only this service, so it needs
# the engine's source, its promoted artefact and a Dockerfile with the port
# Spaces expects. Copying those by hand is where the artefact gets forgotten,
# which is the failure that silently serves an unevaluated model -- so this
# script copies it and then checks it arrived.
#
# It does not push. Review what it produced, then:
#     cd <target> && git init && git add -A && git commit -m "Engine"
#     git remote add origin https://huggingface.co/spaces/<user>/ayira-engine
#     git push -u origin main
#
# Never commit secrets here. SUPABASE_SERVICE_ROLE_KEY and AI_ENGINE_SECRET go
# in the Space's own Settings -> Variables and secrets.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
ENGINE="$REPO/apps/ai-engine"
TARGET="${1:-$REPO/../ayira-engine-space}"

echo "Repository : $REPO"
echo "Target     : $TARGET"
echo

if [ ! -f "$ENGINE/artifacts/tfidf_vectorizer.joblib" ]; then
  echo "ERROR: no promoted TF-IDF artefact at apps/ai-engine/artifacts/." >&2
  echo "       Run an evaluation and promote it first:" >&2
  echo "         cd apps/ai-engine" >&2
  echo "         python -m eval.run_eval --split validation" >&2
  echo "         python -m eval.promote <run-id>" >&2
  echo "       Without it the Space would fit TF-IDF per request and serve a" >&2
  echo "       model that was never evaluated." >&2
  exit 1
fi

mkdir -p "$TARGET"

# rsync is not always present on Windows shells; cp -r is enough here.
rm -rf "$TARGET/app" "$TARGET/artifacts"
cp -r "$ENGINE/app"        "$TARGET/app"
cp -r "$ENGINE/artifacts"  "$TARGET/artifacts"
cp    "$ENGINE/requirements.txt" "$TARGET/requirements.txt"
cp    "$HERE/huggingface-space/Dockerfile" "$TARGET/Dockerfile"
cp    "$HERE/huggingface-space/README.md"  "$TARGET/README.md"

# __pycache__ would be committed otherwise, and a stale .pyc in a built image
# is a confusing thing to debug.
find "$TARGET/app" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

# The rollback copy is local history, not something the Space needs.
rm -f "$TARGET/artifacts/tfidf_vectorizer.joblib.previous" \
      "$TARGET/artifacts/deployed.json.previous"

cat > "$TARGET/.gitignore" <<'EOF'
__pycache__/
*.pyc
.env
EOF

echo "Checking what was assembled:"
for f in Dockerfile README.md requirements.txt app/main.py artifacts/tfidf_vectorizer.joblib artifacts/deployed.json; do
  if [ -e "$TARGET/$f" ]; then
    printf '  ok      %s\n' "$f"
  else
    printf '  MISSING %s\n' "$f"
    exit 1
  fi
done

echo
echo "Deployed artefact:"
sed 's/^/  /' "$TARGET/artifacts/deployed.json" 2>/dev/null || true

echo
echo "Looking for anything that should not be published:"
if grep -rlE 'eyJ[A-Za-z0-9_-]{30,}|sbp_[A-Za-z0-9]{20,}|GOCSPX-' "$TARGET" 2>/dev/null; then
  echo "  STOP: the files above look like they contain key material." >&2
  exit 1
fi
echo "  none found"

echo
echo "Ready. Review $TARGET, then init a git repo there and push to the Space."
