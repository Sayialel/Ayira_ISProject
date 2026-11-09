"""
Adds realistic technology gigs to the live catalogue.

    python scripts/seed_tech_gigs.py --dry-run
    python scripts/seed_tech_gigs.py
    python scripts/seed_tech_gigs.py --remove      # undo

WHY. The 103 open gigs were all generated from KeSCO occupational prose by
eval/corpus_sources/build_corpus.py, and the Technology ones read like
"Statistician needed — studying, improving and developing mathematical
theories" and "Surveyor and Cartographer needed — making charts and maps".

The people actually using the platform are software developers. Measured
against a real worker profile (Python, Django, Node.js, TypeScript, Firebase,
ML), the best semantic similarity across those existing gigs was 0.343, and
the mean was 0.208. Against the gigs below it was 0.433 and 0.362.

So the low match scores were ACCURATE: a developer scoring 38% against
"Statistician needed" is a true statement about a catalogue with no software
work in it. This does not inflate the scores -- it gives the matcher relevant
work to find, and the scores rise because the matches are genuinely better.
The TF-IDF term should gain more than the semantic one, because these
descriptions contain the literal words a developer's profile contains
("Python", "Django", "React") and KeSCO task prose does not.

WHAT THIS DOES NOT TOUCH. The evaluation corpus. eval/harness.py loads from
eval/corpus/*, not from the database, so NDCG@10 0.780 is computed over the
same 193 gigs as before and is unaffected. Adding gigs here to move a
reported metric would be gaming it; adding them to make the live product
useful is not the same thing, and keeping the two separate is what makes the
difference legible.

THE EMPLOYERS are fictional and labelled as seed data in their bio. They are
invented rather than borrowed: putting a real Kenyan company's name on a gig
it never posted would be a fabricated record, whatever the intent. Their
emails are on .invalid, which can never route, and email is excluded from
PUBLIC_PROFILE_FIELDS so it is never shown.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

SB = os.environ.get("SUPABASE_URL", "").rstrip("/")
SVC = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

SEED_TAG = "[seed:tech]"

EMPLOYERS = [
    {
        "email": "hiring@sarabi-labs.invalid",
        "full_name": "Sarabi Labs",
        "location": "Nairobi",
        "bio": f"{SEED_TAG} A fictional Nairobi software studio, used as seed data so the "
               "demonstration catalogue has realistic technology work in it.",
    },
    {
        "email": "team@mradi-digital.invalid",
        "full_name": "Mradi Digital",
        "location": "Nairobi",
        "bio": f"{SEED_TAG} A fictional digital agency, used as seed data for the "
               "demonstration catalogue.",
    },
    {
        "email": "jobs@kazibyte.invalid",
        "full_name": "KaziByte",
        "location": "Mombasa",
        "bio": f"{SEED_TAG} A fictional coastal product team, used as seed data for the "
               "demonstration catalogue.",
    },
    {
        "email": "contact@tusome-tech.invalid",
        "full_name": "Tusome Tech",
        "location": "Kisumu",
        "bio": f"{SEED_TAG} A fictional edtech outfit, used as seed data for the "
               "demonstration catalogue.",
    },
]

# Written the way a Kenyan employer posting freelance work writes: the stack
# named plainly, the deliverable concrete, budgets in KES at plausible
# freelance rates. The stack names matter for TF-IDF, which can only match
# words that are actually present.
GIGS = [
    # --- Web, backend -----------------------------------------------------
    ("Django REST API for a logistics startup",
     "We need a Django REST Framework API for order tracking and driver assignment. Endpoints for "
     "creating orders, assigning drivers, updating delivery status, and handling M-Pesa STK push "
     "callbacks. PostgreSQL, token authentication, and pytest coverage on the payment paths. The "
     "mobile app team will consume it, so clean serializers and documented responses matter.",
     ["Python", "Django", "REST APIs", "SQL", "M-Pesa Integration"], "Nairobi", False, 60000, 120000),

    ("Node.js and Express backend for an SME dashboard",
     "Extend an existing TypeScript Express backend. Add JWT authentication, role-based access for "
     "admin and staff, Jest tests, and a GitHub Actions pipeline that runs them. The codebase is "
     "about 8,000 lines and uses Prisma against PostgreSQL.",
     ["Node.js", "TypeScript", "REST APIs", "Git", "QA Testing"], "Nairobi", True, 50000, 95000),

    ("Laravel backend for a school fees portal",
     "Build a PHP Laravel backend for fee statements, invoices and M-Pesa reconciliation. Parents "
     "log in to see balances, bursars post payments, and the system matches Daraja callbacks to "
     "invoices. MySQL, queued jobs for reconciliation, and an audit trail on every posting.",
     ["PHP", "SQL", "REST APIs", "M-Pesa Integration"], "Nakuru", False, 55000, 110000),

    ("FastAPI service for document processing",
     "A Python FastAPI service that accepts uploaded PDFs, extracts text, and returns structured "
     "JSON. Needs background workers, a retry policy, and sensible limits on file size. Docker "
     "image and a health endpoint for the host's checks.",
     ["Python", "REST APIs", "Docker", "Data Analysis"], "Nairobi", True, 45000, 90000),

    # --- Web, frontend ----------------------------------------------------
    ("React and TypeScript inventory dashboard",
     "Front-end for an SME stock system. Product lists with search and filters, stock movement "
     "charts, role-based views for owner and shopkeeper, and a layout that works on a phone. You "
     "will build against an existing Node.js API. Tailwind for styling.",
     ["React", "TypeScript", "JavaScript", "CSS", "UI Design"], "Nairobi", True, 45000, 85000),

    ("Next.js marketing site for a fintech",
     "A fast, SEO-sound Next.js site: five pages, a blog pulled from a headless CMS, and a contact "
     "form that posts to our CRM. Needs to score well on Core Web Vitals on a mid-range Android "
     "phone over 3G, which is how most of our visitors arrive.",
     ["Next.js", "React", "TypeScript", "SEO", "Web Design"], "Nairobi", True, 40000, 80000),

    ("Vue.js front-end for a clinic booking system",
     "Vue 3 with the composition API. Appointment calendar, patient search, and SMS reminder "
     "scheduling. Talks to an existing REST API. Accessibility matters here — the receptionists "
     "use keyboard navigation all day.",
     ["Vue.js", "JavaScript", "CSS", "REST APIs"], "Eldoret", False, 38000, 72000),

    ("WordPress site with a custom booking plugin",
     "A WordPress site for a safari operator, plus a custom plugin for tour availability and "
     "deposits. Needs a child theme, not a page builder, and the plugin must survive core updates. "
     "M-Pesa and card deposits through an existing gateway.",
     ["WordPress", "PHP", "Web Design", "M-Pesa Integration"], "Nairobi", True, 30000, 60000),

    # --- Mobile -----------------------------------------------------------
    ("Flutter app for a savings group (chama)",
     "A Flutter app for chama record keeping: member registry, monthly contributions, loan "
     "tracking, and M-Pesa STK push for payments. Must work offline and sync when a connection "
     "returns — most members are on patchy mobile data. Firebase for auth and sync.",
     ["Flutter", "Android Development", "Firebase", "M-Pesa Integration"], "Nairobi", False, 90000, 180000),

    ("Android app for field data collection",
     "Native Android, Kotlin. Enumerators collect household survey responses offline, attach "
     "photos and GPS, and upload in batches when they reach coverage. Needs a local Room database "
     "and a conflict policy we can explain to the client.",
     ["Android Development", "Java", "GIS Mapping", "Data Collection"], "Kisumu", False, 80000, 160000),

    ("React Native delivery rider app",
     "React Native app for riders: accept jobs, navigate, capture proof of delivery, and go "
     "offline cleanly. Background location with sensible battery behaviour. Talks to our existing "
     "Node.js dispatch API.",
     ["React", "JavaScript", "TypeScript", "Android Development"], "Mombasa", False, 75000, 150000),

    # --- Data -------------------------------------------------------------
    ("Power BI dashboard for sales reporting",
     "Build a Power BI dashboard over our sales data: monthly revenue by region, product mix, and "
     "rep performance. Data comes from SQL Server and two CSV exports. We need the model and the "
     "refresh set up properly, not just the visuals.",
     ["Power BI", "SQL", "Data Analysis", "Microsoft Excel"], "Nairobi", True, 35000, 70000),

    ("Python data pipeline and reporting",
     "Clean and consolidate monthly operations data from several spreadsheets into one Postgres "
     "schema, then generate a monthly PDF report. pandas for the transforms, a scheduled job, and "
     "tests on the reconciliation logic so we can trust the totals.",
     ["Python", "Data Analysis", "SQL", "Report Writing"], "Nairobi", True, 40000, 85000),

    ("Machine learning model for loan default prediction",
     "We have three years of labelled repayment history, about 40,000 rows. Build and evaluate a "
     "classification model, report precision and recall honestly at the thresholds we care about, "
     "and hand over a scoring script plus the notebook. scikit-learn is fine; explainability "
     "matters more than a fractional AUC gain.",
     ["Machine Learning", "Python", "Data Analysis"], "Nairobi", True, 90000, 200000),

    ("SQL reporting and database tuning",
     "Our reports take minutes. Review the schema, add the indexes that are missing, rewrite the "
     "three worst queries, and document what you changed and why. PostgreSQL 15, about 20 GB.",
     ["SQL", "Database Administration", "Data Analysis"], "Nairobi", True, 30000, 65000),

    # --- Platform and QA --------------------------------------------------
    ("Docker and CI setup for a small team",
     "Containerise two services, write a docker-compose for local development, and set up GitHub "
     "Actions to build, test and deploy to our VPS. Document it so the team can run it without "
     "you afterwards.",
     ["Docker", "Git", "Linux", "Technical Support"], "Nairobi", True, 35000, 75000),

    ("Automated test suite for a web application",
     "Write an end-to-end test suite for an existing React and Node application. Playwright "
     "preferred. Cover sign-up, the main purchase flow, and payment callbacks, and wire it into "
     "CI so a broken build is caught before it ships.",
     ["QA Testing", "JavaScript", "TypeScript", "Git"], "Nairobi", True, 40000, 80000),

    ("Linux server setup and hardening",
     "Set up two Ubuntu servers: Nginx, TLS, firewall, fail2ban, automated backups to object "
     "storage, and monitoring with alerts to Slack. We need a runbook at the end, not just a "
     "working box.",
     ["Linux", "Network Administration", "Cybersecurity", "Docker"], "Nairobi", True, 35000, 70000),

    ("Security review of a web application",
     "Review a Node and React application before launch: authentication and session handling, "
     "access control on the API, input validation, dependency audit, and secrets handling. We want "
     "a written report with severities and concrete fixes.",
     ["Cybersecurity", "Node.js", "REST APIs", "Report Writing"], "Nairobi", True, 60000, 130000),

    # --- Smaller, entry-level ---------------------------------------------
    ("Fix responsive layout bugs on an existing site",
     "Our site breaks between 360px and 768px: overlapping nav, a table that overflows, and a form "
     "that is unusable on a phone. HTML, CSS and a little JavaScript. Good first gig for someone "
     "building a portfolio.",
     ["CSS", "HTML", "JavaScript", "Web Design"], "Nairobi", True, 8000, 18000),

    ("Build a landing page from a Figma design",
     "One-page landing site from a finished Figma file. Must match the design closely, load fast, "
     "and work on a phone. HTML, CSS and vanilla JavaScript, or Tailwind if you prefer.",
     ["HTML", "CSS", "Figma", "Web Design"], "Nairobi", True, 12000, 25000),

    ("Data entry and cleanup in Excel",
     "About 4,000 supplier records to clean: deduplicate, standardise phone formats to +254, split "
     "names, and flag the rows that need a human decision. Microsoft Excel or Google Sheets.",
     ["Data Entry", "Microsoft Excel", "Data Analysis"], "Nairobi", True, 10000, 22000),

    ("WordPress maintenance and updates",
     "Monthly care for three WordPress sites: core and plugin updates, backups, uptime checks, and "
     "a short report. Ongoing, with a fixed monthly fee.",
     ["WordPress", "Website Maintenance", "Technical Support"], "Nairobi", True, 15000, 30000),

    ("Technical support for a small office",
     "On-call support for a 25-person office: Windows laptops, printers, the office network and "
     "Microsoft 365 accounts. Two days a week on site in Westlands.",
     ["Technical Support", "Computer Repair", "Network Administration"], "Nairobi", False, 25000, 45000),
]


def call(path: str, method: str = "GET", body=None, base: str | None = None):
    url = (base or SB) + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("apikey", SVC)
    req.add_header("Authorization", f"Bearer {SVC}")
    req.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw) if raw.strip() else None
        except json.JSONDecodeError:
            return e.code, raw[:300]


def ensure_employer(spec: dict, dry: bool) -> str | None:
    status, existing = call(
        f"/rest/v1/users?email=eq.{spec['email']}&select=id"
    )
    if status == 200 and existing:
        return existing[0]["id"]

    if dry:
        print(f"    would create employer {spec['full_name']}")
        return None

    status, body = call(
        "/auth/v1/admin/users",
        "POST",
        {
            "email": spec["email"],
            "password": f"Seed-{abs(hash(spec['email'])) % 10**10}-Aa1!",
            "email_confirm": True,
            "user_metadata": {"full_name": spec["full_name"], "role": "employer"},
        },
    )
    if status not in (200, 201):
        print(f"    FAILED to create {spec['full_name']}: {status} {body}")
        return None

    uid = body["id"]
    call(
        f"/rest/v1/users?id=eq.{uid}",
        "PATCH",
        {
            "role": "employer",
            "role_confirmed": True,
            "full_name": spec["full_name"],
            "location": spec["location"],
            "bio": spec["bio"],
        },
    )
    print(f"    created employer {spec['full_name']}")
    return uid


def remove() -> None:
    print("Removing seeded technology gigs and their employers")
    emails = [e["email"] for e in EMPLOYERS]
    removed_gigs = removed_users = 0
    for email in emails:
        status, rows = call(f"/rest/v1/users?email=eq.{email}&select=id")
        if status != 200 or not rows:
            continue
        uid = rows[0]["id"]
        st, gigs = call(f"/rest/v1/gigs?employer_id=eq.{uid}&select=id")
        for g in gigs or []:
            call(f"/rest/v1/ai_match_logs?gig_id=eq.{g['id']}", "DELETE")
            call(f"/rest/v1/messages?gig_id=eq.{g['id']}", "DELETE")
            call(f"/rest/v1/applications?gig_id=eq.{g['id']}", "DELETE")
            call(f"/rest/v1/gigs?id=eq.{g['id']}", "DELETE")
            removed_gigs += 1
        call(f"/auth/v1/admin/users/{uid}", "DELETE")
        removed_users += 1
    print(f"  removed {removed_gigs} gig(s) and {removed_users} employer(s)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--remove", action="store_true")
    args = parser.parse_args()

    if not SB or not SVC:
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")

    if args.remove:
        remove()
        return

    print(f"{len(GIGS)} technology gigs across {len(EMPLOYERS)} employers")
    print("Employers:")
    owners: list[str] = []
    for spec in EMPLOYERS:
        uid = ensure_employer(spec, args.dry_run)
        if uid:
            owners.append(uid)

    if not owners and not args.dry_run:
        sys.exit("No employers available; nothing inserted.")

    print("Gigs:")
    inserted = skipped = 0
    for i, (title, description, skills, location, remote, lo, hi) in enumerate(GIGS):
        owner = owners[i % len(owners)] if owners else None

        status, existing = call(
            f"/rest/v1/gigs?title=eq.{urllib.request.quote(title)}&select=id"
        )
        if status == 200 and existing:
            skipped += 1
            continue

        if args.dry_run:
            print(f"    would insert: {title}  (KES {lo:,}-{hi:,}, {location}"
                  f"{', remote' if remote else ''})")
            inserted += 1
            continue

        status, body = call(
            "/rest/v1/gigs",
            "POST",
            {
                "employer_id": owner,
                "title": title,
                "description": description,
                "category": "Technology",
                "required_skills": skills,
                "location": location,
                "is_remote": remote,
                "budget_min": lo,
                "budget_max": hi,
                "currency": "KES",
                "status": "open",
            },
        )
        if status in (200, 201):
            inserted += 1
        else:
            print(f"    FAILED {title}: {status} {body}")

    print(f"\n{inserted} inserted, {skipped} already present")
    if not args.dry_run:
        print("\nNow embed them, or they will not be retrievable by vector search:")
        print("  POST /ai/embed-gigs on the engine, or")
        print("  cd apps/ai-engine && python -m eval.backfill_worker_embeddings")


if __name__ == "__main__":
    main()
