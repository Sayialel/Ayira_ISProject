"""
Loads the evaluation corpus into a live Supabase project, and removes it again.

    python -m eval.seed_db seed      # create accounts, profiles and open gigs
    python -m eval.seed_db clear     # remove everything it created

Useful for exercising the real request path — retrieval, embedding backfill,
latency — against a catalogue with something in it, rather than the empty
database a fresh project starts with.

Everything it creates is addressed by the e-mail suffix below, so `clear`
never touches real accounts.
"""

import json
import sys
from pathlib import Path

import httpx

from app.config import settings

CORPUS_DIR = Path(__file__).resolve().parent / "corpus"

# Every seeded account carries this suffix. Nothing else is ever deleted.
SEED_SUFFIX = "@ayira-eval.invalid"
SEED_PASSWORD = "EvalSeed12345!"
NEWLINE = chr(10)


def _headers() -> dict:
    key = settings.supabase_service_role_key
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _auth_url(path: str) -> str:
    return f"{settings.supabase_url}/auth/v1{path}"


def _rest_url(path: str) -> str:
    return f"{settings.supabase_url}/rest/v1{path}"


def _list_seed_users(client: httpx.Client) -> list[dict]:
    response = client.get(_auth_url("/admin/users?per_page=200"), headers=_headers())
    response.raise_for_status()
    return [u for u in response.json().get("users", []) if u.get("email", "").endswith(SEED_SUFFIX)]


def _create_user(client: httpx.Client, email: str, name: str, role: str) -> str:
    response = client.post(
        _auth_url("/admin/users"),
        headers=_headers(),
        json={
            "email": email,
            "password": SEED_PASSWORD,
            "email_confirm": True,
            "user_metadata": {"full_name": name, "role": role},
        },
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Could not create {email}: {response.text[:200]}")
    return response.json()["id"]


def seed() -> None:
    profiles = json.loads((CORPUS_DIR / "profiles.json").read_text(encoding="utf-8"))
    gigs = json.loads((CORPUS_DIR / "gigs.json").read_text(encoding="utf-8"))
    employers = json.loads((CORPUS_DIR / "employers.json").read_text(encoding="utf-8"))

    with httpx.Client(timeout=120) as client:
        if _list_seed_users(client):
            print("Seed data already present. Run 'clear' first.")
            return

        # One account per corpus employer, not one for everything.
        #
        # A single shared employer would give every gig the same employer
        # reputation, which is constant across a worker's candidates and so
        # cannot reorder them -- reintroducing live exactly the defect the
        # employer-specific redesign fixed, and making live rankings disagree
        # with the offline figures.
        employer_ids: dict[str, str] = {}
        for employer in employers:
            email = f"eval-{employer['id']}{SEED_SUFFIX}"
            user_id = _create_user(client, email, f"Eval Employer {employer['id']}", "employer")
            employer_ids[employer["id"]] = user_id
        print(f"{len(employer_ids)} employers")

        worker_ids: list[str] = []
        for profile in profiles:
            email = f"eval-{profile['id']}{SEED_SUFFIX}"
            user_id = _create_user(client, email, profile["label"], "worker")
            # The signup trigger creates the row; fill in what the matcher reads.
            client.patch(
                _rest_url(f"/users?id=eq.{user_id}"),
                headers=_headers(),
                json={
                    "skills": profile["skills"],
                    "bio": profile["bio"],
                    "location": profile["location"],
                    "reputation_score": profile["reputation_score"],
                },
            ).raise_for_status()
            worker_ids.append(user_id)
            print(f"  worker {profile['id']:<18} {user_id}")

        rows = [
            {
                "employer_id": employer_ids[gig["employer_id"]],
                "title": gig["title"],
                "description": gig["description"],
                "category": gig["category"],
                "required_skills": gig["required_skills"],
                "location": gig.get("location"),
                "is_remote": gig["is_remote"],
                "budget_min": gig["budget_min"],
                "budget_max": gig["budget_max"],
                "currency": "KES",
                "deadline": "2027-06-30T23:59:59+00:00",
                "status": "open",
            }
            for gig in gigs
        ]
        # return=representation so the inserted ids come back; reviews need them.
        response = client.post(
            _rest_url("/gigs"),
            headers={**_headers(), "Prefer": "return=representation"},
            json=rows,
        )
        response.raise_for_status()
        inserted = response.json()

        # corpus employer id -> the gigs now in the database for that employer
        gigs_by_employer: dict[str, list[str]] = {}
        for gig, row in zip(gigs, inserted):
            gigs_by_employer.setdefault(gig["employer_id"], []).append(row["id"])

        reviews = _seed_reviews(client, employers, employer_ids, gigs_by_employer, worker_ids)

        print(f"{NEWLINE}{len(profiles)} workers, {len(employer_ids)} employers, "
              f"{len(rows)} open gigs and {reviews} reviews seeded.")


def _seed_reviews(
    client: httpx.Client,
    employers: list[dict],
    employer_ids: dict[str, str],
    gigs_by_employer: dict[str, list[str]],
    worker_ids: list[str],
) -> int:
    """
    Writes the individual ratings behind each employer's reputation.

    reputation_score is not set directly. The update_reputation() trigger
    recomputes it as AVG(reviews.rating), so inserting the corpus's exact
    integer ratings makes the database arrive at the corpus's exact reputation
    -- which is why build_corpus generates reputations as means of integer
    ratings rather than drawing the aggregate.

    Setting the column directly would have been overwritten by the trigger on
    the next review anyway, and would have left employer_review_count at 0, so
    the engine would have read every employer as unreviewed and fallen back to
    the neutral prior for all of them.
    """
    rows = []
    for employer in employers:
        ratings = employer.get("ratings") or []
        gig_ids = gigs_by_employer.get(employer["id"]) or []
        if not ratings or not gig_ids:
            continue

        # reviews is UNIQUE(gig_id, reviewer_id), so each reviewer may appear
        # once per gig. Spreading the ratings across the employer's gigs keeps
        # within that, and needs no more reviewers than there are workers.
        for index, rating in enumerate(ratings):
            gig_id = gig_ids[index % len(gig_ids)]
            reviewer = worker_ids[(index // len(gig_ids)) % len(worker_ids)]
            rows.append(
                {
                    "gig_id": gig_id,
                    "reviewer_id": reviewer,
                    "reviewee_id": employer_ids[employer["id"]],
                    "rating": rating,
                    "comment": "Seeded by eval.seed_db",
                }
            )

    if not rows:
        return 0

    # Inserted in batches: one request with several thousand rows is the kind
    # of call that times out halfway and leaves the trigger half-applied.
    inserted = 0
    for start in range(0, len(rows), 200):
        batch = rows[start : start + 200]
        response = client.post(_rest_url("/reviews"), headers=_headers(), json=batch)
        response.raise_for_status()
        inserted += len(batch)

    return inserted


def clear() -> None:
    with httpx.Client(timeout=60) as client:
        users = _list_seed_users(client)
        if not users:
            print("Nothing to clear.")
            return

        ids = [u["id"] for u in users]
        id_list = ",".join(ids)

        # Order matters, and getting it wrong fails rather than corrupting.
        # reviews.gig_id and reviews.reviewer_id/reviewee_id reference gigs and
        # users with no ON DELETE clause, so the referencing rows must go
        # first: deleting a reviewed gig is restricted by the foreign key.
        client.delete(
            _rest_url(f"/ai_match_logs?worker_id=in.({id_list})"), headers=_headers()
        )
        for column in ("reviewer_id", "reviewee_id"):
            client.delete(
                _rest_url(f"/reviews?{column}=in.({id_list})"), headers=_headers()
            ).raise_for_status()

        client.delete(
            _rest_url(f"/gigs?employer_id=in.({id_list})"), headers=_headers()
        ).raise_for_status()

        for user_id in ids:
            client.delete(_auth_url(f"/admin/users/{user_id}"), headers=_headers())

        print(f"Removed {len(ids)} seeded account(s) and everything they owned.")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "seed":
        seed()
    elif command == "clear":
        clear()
    else:
        print(__doc__)
        sys.exit(1)
