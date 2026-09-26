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
EMPLOYER_EMAIL = f"eval-employer{SEED_SUFFIX}"


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

    with httpx.Client(timeout=60) as client:
        if _list_seed_users(client):
            print("Seed data already present. Run 'clear' first.")
            return

        employer_id = _create_user(client, EMPLOYER_EMAIL, "Eval Employer", "employer")
        print(f"employer {employer_id}")

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
            print(f"  worker {profile['id']:<18} {user_id}")

        rows = [
            {
                "employer_id": employer_id,
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
        response = client.post(_rest_url("/gigs"), headers=_headers(), json=rows)
        response.raise_for_status()
        print(f"\n{len(profiles)} workers and {len(rows)} open gigs seeded.")


def clear() -> None:
    with httpx.Client(timeout=60) as client:
        users = _list_seed_users(client)
        if not users:
            print("Nothing to clear.")
            return

        ids = [u["id"] for u in users]
        id_list = ",".join(ids)

        # Match logs and gigs reference users, so they go first.
        client.delete(
            _rest_url(f"/ai_match_logs?worker_id=in.({id_list})"), headers=_headers()
        )
        client.delete(_rest_url(f"/gigs?employer_id=in.({id_list})"), headers=_headers())

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
