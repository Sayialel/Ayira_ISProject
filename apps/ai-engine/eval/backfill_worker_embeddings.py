"""
Computes and stores the worker embeddings the engine would otherwise have to
compute inside a request.

    python -m eval.backfill_worker_embeddings [--dry-run]

Why this exists. The deployed engine runs on a 512 MB instance. Measured, it
sits at 129 MB with the model unloaded and reaches 445 MB once the model is
loaded and used -- so a request that has to embed a profile is killed, and the
caller sees a 502. Matching worked for the three workers who happened to have
cached vectors and failed for the other forty-eight, which read as "new
workers cannot match".

Gig vectors are already handled: matcher._backfill_embeddings refreshes them
before retrieval. Worker vectors were only ever computed on the worker's own
first match, which is precisely the request that cannot afford it.

Running this from a machine with memory to spare leaves every existing worker
with a cached vector, so the engine never loads the model for them. It reads
the same profile_text the scorer reads and writes the same hash the engine
checks, so the engine cannot disagree about whether a vector is current.
"""

from __future__ import annotations

import argparse
import sys

from supabase import create_client

from app.config import settings
from app.services.embedding_store import embed_texts, text_hash, to_pgvector
from app.services.scoring import profile_text

#: Encoded per call. Small enough to keep peak memory modest, large enough
#: that the model is not the bottleneck.
BATCH = 16


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would be embedded without writing anything",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="re-embed every worker, not only those whose stored hash is stale",
    )
    args = parser.parse_args()

    if not settings.supabase_url or not settings.supabase_service_role_key:
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")

    sb = create_client(settings.supabase_url, settings.supabase_service_role_key)

    rows = (
        sb.table("users")
        .select("id, email, skills, bio, embedding_hash")
        .eq("role", "worker")
        .execute()
    ).data or []

    print(f"{len(rows)} worker(s) found")

    stale: list[tuple[dict, str, str]] = []
    empty = 0

    for row in rows:
        text = profile_text(row)
        if not text.strip():
            # Nothing to embed. profile_sufficiency reports these as
            # 'insufficient' and the interface says so, which is the right
            # outcome -- an empty vector would be worse than none.
            empty += 1
            continue

        digest = text_hash(text)
        if args.all or row.get("embedding_hash") != digest:
            stale.append((row, text, digest))

    print(f"  {empty} with nothing to embed (no skills and no bio)")
    print(f"  {len(stale)} needing a vector")

    if not stale:
        print("Nothing to do.")
        return

    if args.dry_run:
        for row, _, _ in stale[:10]:
            print(f"    would embed {row.get('email')}")
        if len(stale) > 10:
            print(f"    ... and {len(stale) - 10} more")
        return

    written = failed = 0

    for start in range(0, len(stale), BATCH):
        chunk = stale[start : start + BATCH]
        vectors = embed_texts([text for _, text, _ in chunk])

        for (row, _, digest), vector in zip(chunk, vectors):
            try:
                sb.table("users").update(
                    {"embedding": to_pgvector(vector), "embedding_hash": digest}
                ).eq("id", row["id"]).execute()
                written += 1
            except Exception as exc:
                # One failure should not lose the batch; the next run retries it.
                print(f"    failed {row.get('email')}: {exc}")
                failed += 1

        print(f"  {min(start + BATCH, len(stale))}/{len(stale)}")

    print(f"\nWrote {written} embedding(s); {failed} failed.")
    print("Workers with a cached vector no longer make the engine load the model.")


if __name__ == "__main__":
    main()
