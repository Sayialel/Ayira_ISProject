"""
Scores the running engine against the corpus ground truth.

    python -m eval.seed_db seed
    python -m eval.live_eval

Every other script here measures scoring in isolation. This one goes through
the real HTTP endpoint, so it exercises what offline runs cannot: the shared
secret, the pgvector retrieval, the SQL pre-filter, the embedding cache and the
re-rank — the whole production path.

It exists because block 4 changed *which* gigs reach the scorer. Only an
end-to-end measurement can show that change cost nothing.
"""

import json
import sys
from datetime import datetime, timezone

import httpx

from app.config import settings
from eval import metrics
from eval.harness import RESULTS_DIR, load_corpus
from eval.seed_db import SEED_SUFFIX

ENGINE_URL = "http://127.0.0.1:8001/ai/match"


def _headers() -> dict:
    key = settings.supabase_service_role_key
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def _seeded_workers(client: httpx.Client) -> dict[str, str]:
    """Maps corpus profile id -> the account id the seeder created for it."""
    response = client.get(
        f"{settings.supabase_url}/auth/v1/admin/users?per_page=200", headers=_headers()
    )
    response.raise_for_status()

    mapping = {}
    for user in response.json().get("users", []):
        email = user.get("email", "")
        if email.endswith(SEED_SUFFIX) and email.startswith("eval-w-"):
            mapping[email[len("eval-") : -len(SEED_SUFFIX)]] = user["id"]
    return mapping


def _title_to_corpus_id(corpus) -> dict[str, str]:
    """Seeded gigs get fresh UUIDs, so titles are the link back to the grades."""
    return {g["title"]: g["id"] for g in corpus.gigs}


def main() -> None:
    corpus = load_corpus()
    titles = _title_to_corpus_id(corpus)

    with httpx.Client(timeout=300) as client:
        workers = _seeded_workers(client)
        if not workers:
            print("No seeded workers found. Run: python -m eval.seed_db seed")
            sys.exit(1)

        print(f"\nScoring the live engine for {len(workers)} seeded workers...\n")

        ndcg, p5, rr, latencies = [], [], [], []
        for profile_id, user_id in sorted(workers.items()):
            started = datetime.now(timezone.utc)
            response = client.post(
                ENGINE_URL,
                headers={"X-Ayira-Key": settings.ai_engine_secret},
                json={"worker_id": user_id, "limit": 10},
            )
            elapsed = (datetime.now(timezone.utc) - started).total_seconds()
            latencies.append(elapsed)

            if response.status_code != 200:
                print(f"  {profile_id:<18} FAILED {response.status_code} {response.text[:120]}")
                continue

            returned = response.json()["matches"]
            # Map the live results back onto corpus ids so the grades apply.
            ranked = [titles.get(m["title"]) for m in returned]
            ranked = [r for r in ranked if r]

            grades = corpus.grades.get(profile_id, {})
            n = metrics.ndcg_at_k(ranked, grades, 10)
            p = metrics.precision_at_k(ranked, grades, 5)
            r = metrics.reciprocal_rank(ranked, grades)
            ndcg.append(n)
            p5.append(p)
            rr.append(r)

            top = returned[0]["title"][:40] if returned else "(none)"
            print(f"  {profile_id:<18} NDCG {n:.3f}  P@5 {p:.2f}  {elapsed:.2f}s   top: {top}")

    summary = {
        "ndcg_at_10": metrics.mean(ndcg),
        "precision_at_5": metrics.mean(p5),
        "mrr": metrics.mean(rr),
        "median_latency_s": sorted(latencies)[len(latencies) // 2] if latencies else 0,
    }

    print(f"\n  NDCG@10 {summary['ndcg_at_10']:.4f}   P@5 {summary['precision_at_5']:.3f}"
          f"   MRR {summary['mrr']:.3f}   median {summary['median_latency_s']:.2f}s")
    print("\n  Compare NDCG@10 against the offline figure in eval/results/baseline-*.json.")
    print("  They should agree closely; a gap means retrieval is dropping good gigs.\n")

    RESULTS_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = RESULTS_DIR / f"live-{stamp}.json"
    path.write_text(
        json.dumps(
            {"generated_at": datetime.now(timezone.utc).isoformat(), **summary},
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Written to {path.relative_to(path.parents[2])}\n")


if __name__ == "__main__":
    main()
