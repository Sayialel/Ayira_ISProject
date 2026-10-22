

import logging
from pathlib import Path

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

logger = logging.getLogger(__name__)

# Bumped whenever the fitting parameters below change, so a stale artefact is
# detected rather than silently reused with the wrong settings.
ARTEFACT_VERSION = 1

# The artefact the running service loads.
#
# Every experiment writes its own copy into its run folder; promoting one to
# this path is the deliberate act of deploying it, which `eval.promote` does.
# Keeping the two separate is what stops a stray experiment from changing how
# the live engine scores.
SERVING_PATH = Path(__file__).resolve().parents[2] / "artifacts" / "tfidf_vectorizer.joblib"


def fit(documents: list[str]) -> TfidfVectorizer:
    """
    Fits a vectoriser on the training documents.

    min_df=1 because the corpus is small and dropping rare terms would discard
    most of the skill vocabulary, which is precisely the signal TF-IDF is here
    to contribute.
    """
    if not documents:
        raise ValueError("Cannot fit a vectoriser on no documents")

    vectorizer = TfidfVectorizer(stop_words="english", min_df=1, sublinear_tf=True)
    vectorizer.fit(documents)
    logger.info(
        "Fitted TF-IDF on %d documents, vocabulary %d terms",
        len(documents),
        len(vectorizer.vocabulary_),
    )
    return vectorizer


def save(vectorizer: TfidfVectorizer, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"version": ARTEFACT_VERSION, "vectorizer": vectorizer}, path)
    return path


def load(path: Path) -> TfidfVectorizer | None:
    """Returns None rather than raising, so a missing artefact degrades visibly."""
    if not path.exists():
        return None
    try:
        payload = joblib.load(path)
    except Exception:
        logger.exception("Could not read the TF-IDF artefact at %s", path)
        return None

    if payload.get("version") != ARTEFACT_VERSION:
        logger.warning(
            "TF-IDF artefact at %s was written by version %s, expected %s — ignoring it",
            path,
            payload.get("version"),
            ARTEFACT_VERSION,
        )
        return None

    return payload["vectorizer"]


def _clamp(value: float) -> float:
    return float(max(0.0, min(1.0, value)))


def similarities(
    vectorizer: TfidfVectorizer, query: str, documents: list[str]
) -> list[float]:
    """
    Scores one query against many documents using an already-fitted vectoriser.

    transform(), never fit_transform(): the point of the artefact is that
    nothing is learned at scoring time. A term the training documents never
    contained is simply out of vocabulary and contributes nothing, which is the
    correct behaviour rather than a gap to patch.
    """
    if not documents:
        return []
    if not query.strip():
        return [0.0] * len(documents)

    matrix = vectorizer.transform([query] + documents)
    scores = cosine_similarity(matrix[0:1], matrix[1:])[0]
    return [_clamp(s) for s in scores]


# Loaded once per process. The vectoriser is read-only after fitting, so one
# shared instance is safe across requests and avoids re-reading the file.
_serving: TfidfVectorizer | None = None
_serving_checked = False


def load_serving() -> TfidfVectorizer | None:
    """
    The deployed artefact, or None if none has been promoted.

    None is a usable answer: `score_gigs` falls back to fitting over the
    candidates, which is how the engine behaved before artefacts existed. The
    warning matters though, because that fallback makes scores depend on which
    gigs happen to be open, so a figure measured offline will not reproduce
    live. A deployment that logs this line is misconfigured, not broken.
    """
    global _serving, _serving_checked

    if not _serving_checked:
        _serving = load(SERVING_PATH)
        _serving_checked = True
        if _serving is None:
            logger.warning(
                "No TF-IDF artefact at %s; falling back to fitting per request, "
                "which is not reproducible. Promote one with: "
                "python -m eval.promote <run-id>",
                SERVING_PATH,
            )
        else:
            logger.info(
                "Loaded TF-IDF artefact from %s (%d terms)",
                SERVING_PATH,
                len(_serving.vocabulary_),
            )

    return _serving


def reset_serving_cache() -> None:
    """Forces the next `load_serving()` to re-read the file. Used by tests."""
    global _serving, _serving_checked
    _serving = None
    _serving_checked = False
