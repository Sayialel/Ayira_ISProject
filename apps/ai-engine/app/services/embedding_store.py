"""
Cached embeddings.

An embedding depends only on the text it was built from, so recomputing one
for text that has not changed is pure waste — and the engine used to do it for
every gig on every request. Vectors live in Postgres alongside a hash of the
exact text that produced them, so a stale vector is detectable rather than
merely old.
"""

import hashlib
import logging

from app.services.embeddings import get_model

logger = logging.getLogger(__name__)


def text_hash(text: str) -> str:
    """
    Identifies the text a stored vector was built from.

    sha256 truncated to 16 hex characters: this guards against accidental
    staleness, not against an adversary, and 64 bits makes a collision between
    two gig descriptions effectively impossible.
    """
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def to_pgvector(values) -> str:
    """
    pgvector accepts its text form over PostgREST: "[0.1,0.2,...]".

    Formatting with repr() would emit numpy scalars, so each value is coerced
    to a plain float first.
    """
    return "[" + ",".join(f"{float(v):.6f}" for v in values) + "]"


def parse_pgvector(raw) -> list[float] | None:
    """Reads back what to_pgvector wrote; PostgREST returns it as a string."""
    if raw is None:
        return None
    if isinstance(raw, list):
        return [float(v) for v in raw]
    text = str(raw).strip()
    if not text.startswith("[") or not text.endswith("]"):
        return None
    inner = text[1:-1].strip()
    if not inner:
        return None
    return [float(part) for part in inner.split(",")]


def embed_texts(texts: list[str]) -> list[list[float]]:
    """
    Encodes a batch of texts into normalised vectors.

    Normalising here means similarity downstream is a plain dot product, and it
    matches the cosine distance operator the database index uses.
    """
    if not texts:
        return []

    model = get_model()
    vectors = model.encode(texts, normalize_embeddings=True)
    return [[float(v) for v in vector] for vector in vectors]


def refresh_gig_embeddings(sb, rows: list[dict], gig_text_fn) -> int:
    """
    Recomputes and stores embeddings for gigs whose text has changed.

    Returns how many were rebuilt, which is the number worth watching: in a
    healthy steady state it is zero on almost every request, and non-zero only
    after gigs are posted or edited.
    """
    stale: list[tuple[dict, str, str]] = []

    for row in rows:
        text = gig_text_fn(row)
        digest = text_hash(text)
        if row.get("embedding_hash") != digest:
            stale.append((row, text, digest))

    if not stale:
        return 0

    logger.info("Embedding %d gig(s) with missing or changed text", len(stale))
    vectors = embed_texts([text for _, text, _ in stale])

    for (row, _, digest), vector in zip(stale, vectors):
        try:
            sb.table("gigs").update(
                {"embedding": to_pgvector(vector), "embedding_hash": digest}
            ).eq("id", row["id"]).execute()
        except Exception:
            # One gig failing to persist should not lose the rest of the batch,
            # and the next request will simply try it again.
            logger.exception("Could not store embedding for gig %s", row["id"])

    return len(stale)


def worker_embedding(sb, worker: dict, profile_text_fn) -> list[float]:
    """
    Returns the worker's embedding, rebuilding it only if their profile changed.

    A worker edits their skills or bio far less often than they search, so this
    is almost always a read.
    """
    text = profile_text_fn(worker)
    digest = text_hash(text)

    cached = parse_pgvector(worker.get("embedding"))
    if cached is not None and worker.get("embedding_hash") == digest:
        return cached

    vector = embed_texts([text])[0]

    try:
        sb.table("users").update(
            {"embedding": to_pgvector(vector), "embedding_hash": digest}
        ).eq("id", worker["id"]).execute()
    except Exception:
        # Losing the cache write costs a recomputation next time, nothing more.
        logger.exception("Could not store embedding for worker %s", worker["id"])

    return vector
