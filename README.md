# Ayira

An AI-powered gig economy platform for Africa's youth workforce. Workers build a
skills profile and get open gigs ranked against it by a semantic matching engine;
employers post gigs, review applicants, and pay through M-Pesa escrow.

Final year Information Systems project — Strathmore University.
Student: Lenina Sayialel (161492) 
---

## Architecture

An npm-workspaces monorepo with three deployable services over a single Supabase
(Postgres + Auth) backend.

| Path | Service | Stack |
| --- | --- | --- |
| `apps/web` | React frontend | React 18, Vite 5, TypeScript, Tailwind 3 |
| `apps/api` | API gateway | Node 20, Express 4, TypeScript, Zod |
| `apps/ai-engine` | Matching engine | Python 3.11, FastAPI, Sentence-Transformers, scikit-learn |
| `packages/shared` | Shared constants | TypeScript |
| `supabase/migrations` | Schema, RLS, triggers | SQL |

The browser talks only to the gateway (and to Supabase Auth for sessions). The
gateway holds the service-role key and is the only component that calls the AI
engine.

```
browser ──> apps/web ──> apps/api ──┬──> Supabase (Postgres + RLS)
                                    └──> apps/ai-engine ──> Supabase
```

### How matching works

`apps/ai-engine` scores every open gig against the worker's skills and bio:

```
score = 0.45·semantic + 0.25·tfidf + 0.15·location + 0.15·reputation
```

`semantic` is Sentence-BERT (`all-MiniLM-L6-v2`) cosine similarity, `tfidf` is
lexical overlap, `location` is an exact location match (remote gigs always
count), and `reputation` is the worker's review average normalised to 0–1. Every
run is written to `ai_match_logs` so match quality can be evaluated later.

---

## Getting started

### Prerequisites

Node.js 20+, Python 3.11+, and a Supabase project.

### 1. Install dependencies

```bash
npm install                   # all workspaces, from the repo root
cd apps/ai-engine && pip install -r requirements.txt
```

Use a virtualenv for the Python service if you prefer:

```bash
cd apps/ai-engine
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in at minimum `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
from your Supabase project's API settings. The gateway validates these on
startup and exits with a clear message if any are missing.

The service-role key bypasses row-level security. Keep it out of the frontend
and out of version control — `.env` is gitignored.

### 3. Run the migrations

In the Supabase SQL editor, run `supabase/migrations/001` through `011` **in
order**. They are not idempotent, so run each one exactly once on a fresh
project.

Migration `011_user_provisioning.sql` is required, not optional — it creates the
`public.users` row whenever someone signs up, and blocks users from editing their
own `role`, `is_verified` and `reputation_score`. Without it, signups produce no
profile row and every foreign key fails.

### 4. Start everything

```bash
npm run dev
```

This runs all three services concurrently:

| Service | URL |
| --- | --- |
| Frontend | http://localhost:5173 |
| API gateway | http://localhost:3001 |
| AI engine | http://localhost:8001 |

Vite proxies `/api` to the gateway in development. The first AI match request
downloads and loads the Sentence-BERT model, which can take a minute.

Individual services: `npm run dev:web`, `npm run dev:api`, `npm run dev:ai`.

---

## API

All routes are prefixed `/api`. Everything except `/api/auth/*` requires a
`Bearer` token — the Supabase session JWT, which `apps/web/src/lib/api.ts`
attaches automatically.

Responses are `{ "data": ... }` on success and `{ "error": "...", "details"?: ... }`
on failure.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/auth/signup` `/auth/signin` `/auth/refresh` | Account and session management |
| `GET` `POST` | `/gigs` | Browse with filters; create (employer) |
| `GET` `PATCH` `DELETE` | `/gigs/:id` | Read; edit; cancel (soft delete) |
| `PATCH` | `/gigs/:id/publish` | Move a draft into the feed |
| `GET` | `/gigs/meta/categories` | Seeded skill categories |
| `GET` `PATCH` | `/workers/profile` | Own profile |
| `GET` | `/workers/profile/:id` | Public profile (no email or phone) |
| `GET` | `/workers/dashboard/stats` | Dashboard totals, by role |
| `GET` `POST` | `/applications` | List own / to own gigs; apply (worker) |
| `GET` | `/applications/:id` | Single application |
| `PATCH` | `/applications/:id/status` | Shortlist, accept, reject, withdraw |
| `POST` | `/match` | Rank open gigs for the calling worker |
| `GET` | `/match/history` | Past match runs |
| `GET` | `/admin/dashboard` `/admin/users` `/admin/gigs` | Platform overview (admin) |
| `PATCH` | `/admin/users/:id/verify` | Toggle a user's verified badge |

### Authorisation

Roles come from `public.users`, never from the JWT's `user_metadata` — that field
is writable by the account holder using the public anon key, so trusting it would
let any user grant themselves admin.

User-facing reads go through a per-request client carrying the caller's JWT, so
row-level security applies. The service-role client is used only where a check
belongs in application code — cross-user reads, admin routes, and multi-step
writes such as accepting an applicant.

---



---


## Conventions

