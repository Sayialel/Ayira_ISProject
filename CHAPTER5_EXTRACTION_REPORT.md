# Chapter 5 Extraction Report — Ayira

**Ayira: An AI-Powered Gig Economy Platform for Africa's Youth Workforce**
Source material for Chapter 5 ("System Implementation and Testing"). This report lists technical facts taken from the code. It is not the chapter itself.

| | |
|---|---|
| Repository snapshot | `main` at commit `d1f016e` (2026-10-19 14:57 +03:00), 37 commits since `d3aecaf` "Initial Project Commit" (2026-09-14) |
| Uncommitted at extraction | `apps/ai-engine/eval/seed_db.py` (modified) |
| Tracked files | 383 |
| How facts were obtained | Every source file was read. Resolved versions come from `package-lock.json` and the AI engine's virtual environment. The AI engine test suite was run (106 passed), and both TypeScript projects were type-checked (`tsc --noEmit`, both clean). |
| What was **not** done | No request was sent to the live Supabase project or to Safaricom. The functional test cases in Section 8 are **derived from the code**. They have not been executed. |

---

## 0. Read this first: where the extraction prompt's assumptions differ from the code

The extraction prompt describes an early version of the project. The code has moved well past it. If the chapter is written from the prompt's assumptions, it will describe a system that no longer exists. The differences are:

| The prompt assumes | What the code actually contains | Where |
|---|---|---|
| "9 tables + skill_categories" | **10 tables**: the 9 assumed tables (users, gigs, applications, escrow, reviews, notifications, messages, ai_match_logs, skill_categories) plus **`escrow_events`**, an audit trail added in migration 016 | `supabase/migrations/016_escrow_integrity.sql` |
| Functions and triggers only in `010_functions.sql` | **12 functions and 9 triggers** spread across migrations 010, 011, 012, 015, 016, 017, 018, 019 and 021 | Section 2C |
| 10 migrations | **21 migrations** (001–021) | `supabase/migrations/` |
| gigs, workers, applications, escrow and admin routes are stubs | **None are stubs.** All are fully implemented. There are also two routers the prompt does not mention: **reviews** and **match**. The gateway exposes **41 endpoints**. | Section 3F |
| Escrow/M-Pesa is "planned" | **Implemented**: Daraja OAuth, STK Push, an STK status query, a public callback, and a state machine enforced in PL/pgSQL with an audit log. It has been **tested against the real Daraja sandbox** (token, push and status query). The Safaricom callback has **not** been received end-to-end. | `apps/api/src/services/mpesa.ts`, migrations 016/018/021 |
| Composite formula weights | The current weights are **0.72 semantic / 0.22 TF-IDF / 0.03 location / 0.03 reputation**. The originally shipped 0.45/0.25/0.15/0.15 is kept only as a baseline for comparison. | `apps/ai-engine/app/services/scoring.py:47-50, 84` |
| `composite_score()` lives in `embeddings.py` | It moved to **`scoring.py`**. `embeddings.py` now holds only the similarity functions. | `embeddings.py:74-79` |
| Location is a boolean match (0/1) | Location is a **tiered affinity**: same town 1.0, same county 0.6, same Nairobi metro 0.45, unknown 0.3, different county 0.0, remote 1.0. It uses a Kenyan town→county map. | `scoring.py:149-202`, `kenya_geography.py` |
| Reputation is the **worker's** score ÷ 5 | It is the **employer's** score (the employer who posted the gig) ÷ 5, capped at 1. Unreviewed employers get a neutral prior of 3.0. The worker's own score was dropped because it is the same for every candidate gig, so it could not change the ranking. | `scoring.py:219-250`, migration 017 |
| Gig text = required_skills + description | Gig text = **title + required_skills + description** | `scoring.py:129-139` |
| Matcher fetches all open gigs and encodes them per request | Embeddings are **cached in Postgres (pgvector, 384-dim, HNSW index)**. Retrieval is a SQL nearest-neighbour shortlist of 200 that excludes expired gigs, the worker's own gigs, and gigs already applied to. The shortlist is then re-ranked. | migrations 014/015/017, `matcher.py` |
| TF-IDF fitted per request | TF-IDF is a **fitted artefact** (`artifacts/tfidf_vectorizer.joblib`, trained on the training split only). The engine falls back to per-request fitting only if the file is missing. | `tfidf_model.py`, `artifacts/deployed.json` |
| No evaluation | There is a full offline **evaluation harness**: 47 profiles, 104 gigs, 565 graded pairs, train/validation/test splits, NDCG/P/R/MRR, baselines, ablation, weight tuning and a retrieval study. The test NDCG@10 is **0.8499**. There are **106 automated tests**. | `apps/ai-engine/eval/`, `apps/ai-engine/tests/` |
| ai_match_logs.location_match (boolean) | Replaced by **`location_affinity NUMERIC(4,3)`** in migration 020 | migration 020 |
| Web sign-in goes through `POST /api/auth/signin` | The web app signs in and signs up **directly with Supabase Auth** (`supabase.auth.signInWithPassword` / `signUp`). The gateway's `/api/auth/*` routes exist but **the web app never calls them**. | `apps/web/src/hooks/useAuth.tsx` |
| Pages: Landing, SignIn, SignUp, Dashboard, GigFeed | **18 pages**: those five, plus GigDetail, CreateGig, MyGigs, MyApplications, AIMatches, Escrow, Profile, PublicProfile and four admin pages | Section 4F |
| Notifications and messaging "planned" | **Correct.** Both have tables and RLS policies, but **no API route, no UI, and no SMS/FCM/Realtime code**. Only the environment variables `AT_API_KEY`, `AT_USERNAME` and `FCM_SERVER_KEY` exist. | Section 7 |

**Documents in the repository that are stale.** These contradict the code, so don't quote them:

- `README.md` lines 33-45 still state the 0.45/0.25/0.15/0.15 formula, an "exact location match" and the "worker's review average". Its API table (lines 124-136) omits the escrow, reviews, completion and admin-escrow routes.
- `docs/PRODUCTION_READINESS.md` and `docs/EVALUATION_PROTOCOL.md` say "103 tests". The suite now has **106**.
- `docs/EVALUATION_PROTOCOL.md` reports a validation weight-tuning gain of −0.0001. The latest run folder (`20261019T062341Z__tune-weights__0298b68`) records **−0.0012**. Both are "not adopted", so the conclusion is the same.
- `docs/PRODUCTION_READINESS.md` risk 7 says "M-Pesa escrow is unvalidated against real Daraja credentials". Commit `85dcdac` later verified the token, push and status query against the sandbox.

---

## SECTION 1 — IMPLEMENTATION ENVIRONMENT

### 1A. Software stack (for Table 5.2)

"Declared" is the version range in `package.json` or `requirements.txt`. "Resolved" is what is actually installed (from `package-lock.json` for npm, and from the AI engine's `.venv` for Python).

#### Programming languages and runtimes

| Technology | Declared | Resolved / used | Part | Role in Ayira |
|---|---|---|---|---|
| TypeScript | `^5.5.0` (root, api, web) | 5.9.3 | API, Frontend, Shared | Language for the gateway and the web app. `strict: true` in `tsconfig.base.json`. |
| Node.js | `engines: ">=20.0.0"` | `node:20-slim` in Docker; v24.5.0 on the dev laptop | API, Frontend build | Runs the Express gateway. Provides the global `fetch` the gateway uses to call the AI engine and Daraja. |
| Python | not pinned in a file | `python:3.11-slim` in Docker; **3.12.8** in the dev venv (`apps/ai-engine/.venv/pyvenv.cfg`) | AI Engine | Runs the FastAPI matching service and the evaluation harness. |
| SQL / PL/pgSQL | — | — | Database | Schema, RLS policies, triggers, and the transactional functions (hiring, escrow state machine, gig completion, retrieval). |

#### Backend frameworks

| Technology | Declared | Resolved | Part | Role in Ayira |
|---|---|---|---|---|
| Express | `^4.21.0` | 4.22.3 | API | HTTP server and router for the API gateway (`apps/api/src/index.ts`) |
| FastAPI | `==0.115.0` | 0.115.0 | AI Engine | HTTP framework for the matching service (`app/main.py`) |
| Uvicorn (`[standard]`) | `==0.30.6` | 0.30.6 | AI Engine | ASGI server that runs FastAPI on port 8001 |
| Pydantic | `==2.9.1` | 2.9.1 (core 2.23.3) | AI Engine | Request/response models (`MatchRequest`, `GigScore`, `MatchResponse`) |
| pydantic-settings | `==2.5.2` | 2.5.2 | AI Engine | Loads engine configuration from the root `.env` (`app/config.py`) |

#### Frontend

| Technology | Declared | Resolved | Role in Ayira |
|---|---|---|---|
| React | `^18.3.1` | 18.3.1 | UI library. Every page and component. |
| react-dom | `^18.3.1` | 18.3.1 | Mounts the app (`main.tsx`, `ReactDOM.createRoot`) |
| Vite | `^5.4.0` | 5.4.21 | Dev server (port 5173, `/api` proxy) and production bundler with manual vendor chunks |
| @vitejs/plugin-react | `^4.3.1` | 4.7.0 | JSX transform and fast refresh in Vite |
| react-router-dom | `^6.26.0` | 6.30.6 | Client-side routing: public routes, the protected `/app` tree and admin routes. Lazy-loaded route chunks. |
| Tailwind CSS | `^3.4.10` | 3.4.19 | Utility CSS with a custom `ayira`, `slate` and `gold` palette |
| PostCSS | `^8.4.45` | 8.5.28 | Runs Tailwind and Autoprefixer (`postcss.config.js`) |
| Autoprefixer | `^10.4.20` | 10.6.0 | Adds vendor prefixes to the CSS output |
| lucide-react | `^0.441.0` | 0.441.0 | Icon set: nav icons, status, M-Pesa phone, stars and similar |
| Google Fonts | — | Plus Jakarta Sans (400–800), JetBrains Mono (400/500) | Loaded in `index.html`. Mapped to `font-sans` / `font-mono`. |

#### Database, authentication and data access

| Technology | Declared | Resolved | Part | Role in Ayira |
|---|---|---|---|---|
| Supabase (hosted) | — | — | Database + Auth | Managed PostgreSQL, Supabase Auth (JWT sessions) and PostgREST. RLS on every table. |
| PostgreSQL | **not recorded in the repository** | — | Database | The engine version isn't pinned anywhere in the code. Read it from the Supabase dashboard (Project Settings → Infrastructure) before stating it in Table 5.2. |
| pgvector extension | `CREATE EXTENSION IF NOT EXISTS vector` | — | Database | `vector(384)` columns on `gigs` and `users`, an HNSW index with `vector_cosine_ops`, and the `<=>` cosine-distance operator (migration 014). An HNSW index needs pgvector ≥ 0.5.0. |
| @supabase/supabase-js | `^2.45.0` (api, web) | 2.116.0 | API, Frontend | Gateway: the admin (service-role) client and per-request user clients. Web: Supabase Auth sessions. |
| supabase (Python) | `==2.7.2` | 2.7.2 | AI Engine | Service-role client: reads profiles, calls the `gigs_needing_embedding` and `nearest_open_gigs` RPCs, writes embeddings |
| Supabase CLI | — (invoked by the `db:types` script) | not installed in repo | DevOps | `supabase gen types typescript` to regenerate `packages/shared/src/database.types.ts` |

#### AI / ML

| Technology | Declared | Resolved | Role in Ayira |
|---|---|---|---|
| sentence-transformers | `==3.0.1` | 3.0.1 | Loads `all-MiniLM-L6-v2` and encodes worker and gig text into 384-dim normalised embeddings |
| Model `all-MiniLM-L6-v2` | `model_name` default in `app/config.py` | 87.3 MB in the local Hugging Face cache | Zero-shot semantic similarity. Nothing is trained. |
| PyTorch (`torch`) | transitive (not in requirements.txt) | 2.14.0 (502 MB installed) | Inference backend for sentence-transformers |
| transformers | transitive | 4.57.6 | Model architecture/tokenizer used by sentence-transformers |
| scikit-learn | `==1.5.1` | 1.5.1 | `TfidfVectorizer` (keyword signal) and `cosine_similarity` |
| NumPy | `==1.26.4` | 1.26.4 | Vector arithmetic for embeddings and metrics |
| joblib | `==1.6.0` (requirements-eval.txt) | 1.6.0 | Saves and loads the fitted TF-IDF artefact (`tfidf_model.py`). Also a transitive dependency of scikit-learn, which is how the serving image gets it. |
| matplotlib | `==3.9.2` (eval only) | 3.9.2 | Evaluation plots (baselines, weight sensitivity, ablation, shortlist curve) |
| contourpy | `==1.2.1` (eval only, pinned deliberately) | — | Pinned so that matplotlib cannot upgrade NumPy past 1.26.4 |
| pytest | `==8.3.3` (eval only) | 8.3.3 | Runs the 106 AI-engine tests |

#### Validation, HTTP, security, logging, configuration

| Technology | Declared | Resolved | Part | Role in Ayira |
|---|---|---|---|---|
| Zod | `^3.23.0` | 3.25.76 | API | Validates every request body and query string (signup, gigs, applications, escrow, reviews, admin, pagination) |
| Native `fetch` (Node 20) | built-in | — | API | Calls the AI engine (`POST /ai/match`, with a 60 s timeout) and the Daraja REST API (20 s timeout) |
| Native `fetch` (browser) | built-in | — | Frontend | `lib/api.ts` → gateway, with the bearer token attached |
| httpx | `==0.27.2` | 0.27.2 | AI Engine (eval) | Used by `eval/live_eval.py` and `eval/seed_db.py`. Not imported by the serving code. |
| helmet | `^7.1.0` | 7.2.0 | API | Security headers (`app.use(helmet())`) |
| cors | `^2.8.5` | 2.8.6 | API | Allows only `CORS_ORIGIN` (default `http://localhost:5173`) |
| express-rate-limit | `^7.4.0` | 7.5.1 | API | `authLimiter`: 5 failed attempts per 15 min. `apiLimiter`: 120 requests per minute. |
| FastAPI `CORSMiddleware` | — | — | AI Engine | Allows `http://localhost:5173` and `http://localhost:3001` |
| Python `secrets.compare_digest` | stdlib | — | AI Engine | Constant-time check of the `X-Ayira-Key` shared secret |
| morgan | `^1.10.0` | 1.12.1 | API | HTTP request logging, `'dev'` format |
| Python `logging` | stdlib | — | AI Engine | Engine logs: backfill counts, artefact load warnings, matching failures |
| dotenv | `^16.4.5` | 16.6.1 | API | Loads the root `.env` before any module reads `process.env` (`lib/env.ts`) |
| python-dotenv | `==1.0.1` | 1.0.1 | AI Engine | Listed. pydantic-settings reads the `.env` itself. |

#### Development tools and DevOps

| Technology | Declared | Resolved | Role in Ayira |
|---|---|---|---|
| tsx | `^4.19.0` | 4.23.13 | `tsx watch src/index.ts` (API dev server). Also the Docker CMD for the API. Runs the Daraja scripts. |
| concurrently | `^9.0.1` | 9.2.4 | Root `npm run dev` starts the API, web and AI engine together |
| ESLint | `^9.0.0` | 9.39.5 | `npm run lint` is defined, but **there is no ESLint config file in the repo**, so ESLint 9 has nothing to run against |
| @types/node, @types/express, @types/cors, @types/morgan, @types/react, @types/react-dom | `^22.0.0`, `^4.17.21`, `^2.8.17`, `^1.9.9`, `^18.3.5`, `^18.3.0` | 22.20.2, 4.17.25, …, 18.3.31 | Type definitions |
| Docker / Docker Compose | compose file `version: "3.8"` | `docker` was **not on the PATH** of the dev machine at extraction time | Three-service local stack (Section 6) |
| npm workspaces | `"workspaces": ["apps/*", "packages/*"]` | — | Monorepo management |
| Git / GitHub | — | — | Version control. Experiment runs record the commit hash and whether the tree was dirty. |
| Google Colab + Google Drive | — | — | Experiment notebook `notebooks/ayira_experiment.ipynb` (generated by `notebooks/build_notebook.py`) writes run folders to `MyDrive/ayira/runs/` |
| ngrok / cloudflared | referenced in `.env.example` and commit `85dcdac` | not usable on the dev network | Public tunnel for the Daraja callback. Outbound port 7844 was blocked, so the callback was never received. |

#### External services

| Service | Status in code | Role |
|---|---|---|
| Safaricom Daraja (M-Pesa), sandbox | **Implemented** (`services/mpesa.ts`) | OAuth token, STK Push (`CustomerPayBillOnline`), STK status query, callback parsing. Base URL `https://sandbox.safaricom.co.ke`, or `https://api.safaricom.co.ke` when `DARAJA_ENV=production`. |
| Africa's Talking (SMS) | **Env vars only** (`AT_API_KEY`, `AT_USERNAME=sandbox`) | Planned SMS notifications. No code. |
| Firebase Cloud Messaging | **Env var only** (`FCM_SERVER_KEY`) | Planned push notifications. No code. |
| Hugging Face Hub | implicit | Downloads `all-MiniLM-L6-v2` on first use |
| Kenya Standard Classification of Occupations (KeSCO-2022) | `eval/corpus_sources/parse_kesco.py` | Source of occupations, skills and task language for the evaluation corpus |

### 1B. Hardware specifications (for Table 5.1)

**Development machine.** These values were read from Windows at extraction time:

| Component | Specification |
|---|---|
| Device | HP OmniBook 5 Flip Laptop 14-fp0xxx |
| Processor | Intel Core 7 150U (10 cores / 12 logical processors) |
| Memory (RAM) | 15.7 GB, as reported by Windows (`TotalPhysicalMemory`) |
| Storage | WD PC SN5000S NVMe SSD, 512 GB (477 GB formatted) |
| Graphics | Intel Graphics (integrated). **No discrete GPU.** The model runs on CPU. |
| Operating system | Windows 11 Home, version 10.0.26200 |

**Hardware-relevant facts in the code:**

| Fact | Value | Source |
|---|---|---|
| Embedding model | `all-MiniLM-L6-v2`, 384-dimensional output | `config.py:16`, migration 014 |
| Model on disk | 87.3 MB (Hugging Face cache) | measured |
| AI engine Python environment | 1,177 MB, of which PyTorch is 502 MB | measured (`apps/ai-engine/.venv`) |
| TF-IDF artefact | `artifacts/tfidf_vectorizer.joblib`, vocabulary of 1,160 terms | `deployed.json`, run manifest |
| Model load time | Lazy-loaded on the first request. The gateway allows a 60 s timeout because "the first request after a cold start pays for loading the Sentence-BERT model". | `routes/matching.ts:21-23`, `.env.example` (`AI_ENGINE_TIMEOUT_MS=60000`) |
| Encoding cost without caching | 0.389 s for 42 gigs, 1.890 s for 250 gigs, 6.925 s for 1,000 gigs (linear). This is why embeddings are cached in Postgres. | `eval/README.md` "Cost" |
| Steady-state match latency | 0.42–0.50 s end to end over 42 gigs, dominated by network round trips | `eval/README.md` |
| Per-request work bounds | Shortlist of at most 200 candidates. At most 100 stale gig embeddings rebuilt per request. Backfill check at most every 30 s. | `matcher.py:26-34` |
| Test suite runtime on the dev machine | 104 s for 106 tests | measured |
| Docker resource limits | **None set** in `docker-compose.yml` (no `mem_limit`, `cpus` or `deploy.resources`) | `docker-compose.yml` |
| Ports | API 3001, AI engine 8001, web 5173 | `docker-compose.yml`, `.env.example` |
| Request size limit | `express.json({ limit: '100kb' })` | `index.ts:33` |
| GPU | Not required. No CUDA configuration anywhere. sentence-transformers runs on CPU. | — |

> General knowledge, not from the repository (label it as such if you use it): all-MiniLM-L6-v2 has about 22.7 million parameters. It runs comfortably on a modern laptop CPU, and a serving host with about 2 GB of RAM for the engine process is a reasonable minimum.

---
## SECTION 2 — DATABASE SCHEMA AND DATA MODEL

### Migration inventory

| # | File | What it does |
|---|---|---|
| 001 | `001_create_users.sql` | `public.users` (extends `auth.users`), RLS |
| 002 | `002_create_gigs.sql` | `public.gigs`, RLS |
| 003 | `003_create_applications.sql` | `public.applications`, `UNIQUE(gig_id, worker_id)`, RLS |
| 004 | `004_create_escrow.sql` | `public.escrow`, RLS |
| 005 | `005_create_reviews.sql` | `public.reviews`, `UNIQUE(gig_id, reviewer_id)`, RLS |
| 006 | `006_create_notifications.sql` | `public.notifications`, RLS |
| 007 | `007_create_messages.sql` | `public.messages`, RLS |
| 008 | `008_create_ai_match_logs.sql` | `public.ai_match_logs`, RLS |
| 009 | `009_create_skills_ref.sql` | `public.skill_categories` and seed data |
| 010 | `010_functions.sql` | `handle_updated_at()` and 4 `set_updated_at` triggers. `update_reputation()` and `on_review_insert`. |
| 011 | `011_user_provisioning.sql` | `handle_new_user()` (auto-creates a profile on signup). `protect_user_privileges()` (blocks self-promotion). Backfill. |
| 012 | `012_harden_policies.sql` | Restricts who may review whom. Removes client inserts to `ai_match_logs`. Tightens the users INSERT policy. Adds the atomic `accept_application()`. |
| 013 | `013_search_and_constraints.sql` | Full-text `search_vector` with a GIN index. Six supporting B-tree indexes. Escrow FKs `ON DELETE RESTRICT`. Messages limited to a shared gig. |
| 014 | `014_vector_embeddings.sql` | `pgvector`. `embedding vector(384)` and `embedding_hash` on gigs and users. HNSW index. |
| 015 | `015_match_retrieval.sql` | `gigs_needing_embedding()` and `nearest_open_gigs()` RPCs |
| 016 | `016_escrow_integrity.sql` | Escrow made read-only to clients. `escrow_events` audit table. `open_escrow()`, `mark_escrow_funded()`, `transition_escrow()`. |
| 017 | `017_employer_reputation.sql` | `nearest_open_gigs()` now also returns `employer_reputation` and `employer_review_count` |
| 018 | `018_gig_completion.sql` | `complete_gig()`. Releasing escrow now also completes the gig. |
| 019 | `019_fix_reputation_write.sql` | Fixes reputation never updating (the privilege guard was reverting it). Adds update and delete review triggers. Backfill. |
| 020 | `020_match_log_location_affinity.sql` | `ai_match_logs.location_match BOOLEAN` → `location_affinity NUMERIC(4,3)` |
| 021 | `021_clearer_escrow_errors.sql` | `transition_escrow()` error messages now say which rule failed: the status or the role |

### 2A. Complete table inventory (final state after migration 021)

There are 10 tables. Columns added by later migrations are marked with the migration number.

#### `public.users` — every account. Extends Supabase `auth.users`.

| Column | Type | Constraints / default |
|---|---|---|
| id | UUID | **PK**, **FK → auth.users(id) ON DELETE CASCADE** |
| email | TEXT | NOT NULL, **UNIQUE** |
| full_name | TEXT | NOT NULL |
| phone | TEXT | nullable |
| role | TEXT | NOT NULL, **CHECK (role IN ('worker','employer','admin'))**, DEFAULT 'worker' |
| avatar_url | TEXT | nullable |
| bio | TEXT | nullable |
| skills | TEXT[] | DEFAULT '{}' |
| location | TEXT | nullable |
| reputation_score | NUMERIC(3,2) | DEFAULT 0.00 (kept equal to the mean of the reviews received, by trigger) |
| is_verified | BOOLEAN | DEFAULT FALSE |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() (maintained by trigger) |
| embedding *(014)* | vector(384) | nullable. Cached Sentence-BERT vector of skills + bio. |
| embedding_hash *(014)* | TEXT | nullable. sha256 (first 16 hex characters) of the text that produced the embedding. |

#### `public.gigs` — work posted by employers

| Column | Type | Constraints / default |
|---|---|---|
| id | UUID | **PK**, DEFAULT gen_random_uuid() |
| employer_id | UUID | NOT NULL, **FK → users(id) ON DELETE CASCADE** |
| title | TEXT | NOT NULL |
| description | TEXT | NOT NULL |
| category | TEXT | NOT NULL (no CHECK in the DB. The API restricts it with a Zod enum to Technology, Writing, Design, Marketing, Business.) |
| required_skills | TEXT[] | DEFAULT '{}' |
| location | TEXT | nullable |
| is_remote | BOOLEAN | DEFAULT FALSE |
| budget_min | NUMERIC(10,2) | nullable |
| budget_max | NUMERIC(10,2) | nullable |
| currency | TEXT | DEFAULT 'KES' |
| deadline | TIMESTAMPTZ | nullable |
| status | TEXT | NOT NULL, **CHECK (status IN ('draft','open','in_progress','completed','cancelled'))**, DEFAULT 'draft' |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() (trigger) |
| search_vector *(013)* | tsvector | **GENERATED ALWAYS AS** `setweight(to_tsvector('english', coalesce(title,'')),'A') ‖ setweight(to_tsvector('english', coalesce(description,'')),'B')` **STORED** |
| embedding *(014)* | vector(384) | nullable. Vector of title + skills + description. |
| embedding_hash *(014)* | TEXT | nullable |

#### `public.applications` — a worker's application to a gig

| Column | Type | Constraints / default |
|---|---|---|
| id | UUID | **PK**, DEFAULT gen_random_uuid() |
| gig_id | UUID | NOT NULL, **FK → gigs(id) ON DELETE CASCADE** |
| worker_id | UUID | NOT NULL, **FK → users(id) ON DELETE CASCADE** |
| cover_letter | TEXT | nullable (the API requires at least 20 characters) |
| proposed_amount | NUMERIC(10,2) | nullable (the API requires a value > 0) |
| ai_match_score | NUMERIC(5,4) | nullable. **No code writes this column.** It is always NULL. |
| status | TEXT | NOT NULL, **CHECK (status IN ('pending','shortlisted','accepted','rejected','withdrawn'))**, DEFAULT 'pending' |
| created_at / updated_at | TIMESTAMPTZ | DEFAULT now() (updated_at by trigger) |
| — | — | **UNIQUE (gig_id, worker_id)**, so a worker can apply to a gig only once |

#### `public.escrow` — money held for a gig

| Column | Type | Constraints / default |
|---|---|---|
| id | UUID | **PK**, DEFAULT gen_random_uuid() |
| gig_id | UUID | NOT NULL, **FK → gigs(id) ON DELETE RESTRICT** (013) |
| employer_id | UUID | NOT NULL, **FK → users(id) ON DELETE RESTRICT** (013) |
| worker_id | UUID | NOT NULL, **FK → users(id) ON DELETE RESTRICT** (013) |
| amount | NUMERIC(10,2) | NOT NULL (`open_escrow` requires > 0. The API caps it at 500,000.) |
| currency | TEXT | DEFAULT 'KES' |
| mpesa_checkout_id | TEXT | nullable. Daraja `CheckoutRequestID`. |
| mpesa_receipt | TEXT | nullable. M-Pesa receipt number from the callback. |
| status | TEXT | NOT NULL, **CHECK (status IN ('pending','funded','released','disputed','refunded','partial_release','cancelled'))**, DEFAULT 'pending' |
| funded_at | TIMESTAMPTZ | nullable. Set by `mark_escrow_funded`. |
| released_at | TIMESTAMPTZ | nullable. Set by `transition_escrow` on release. |
| created_at / updated_at | TIMESTAMPTZ | DEFAULT now() (updated_at by trigger) |

#### `public.escrow_events` *(016)* — audit trail of every escrow transition

| Column | Type | Constraints / default |
|---|---|---|
| id | UUID | **PK**, DEFAULT gen_random_uuid() |
| escrow_id | UUID | NOT NULL, **FK → escrow(id) ON DELETE CASCADE** |
| from_status | TEXT | nullable (NULL for "Escrow opened") |
| to_status | TEXT | NOT NULL |
| actor_id | UUID | nullable, **FK → users(id)** (NULL when the M-Pesa callback is the actor) |
| detail | TEXT | nullable (reason, receipt, or dispute text) |
| created_at | TIMESTAMPTZ | DEFAULT now() |

#### `public.reviews` — ratings between the employer and the hired worker

| Column | Type | Constraints / default |
|---|---|---|
| id | UUID | **PK**, DEFAULT gen_random_uuid() |
| gig_id | UUID | NOT NULL, **FK → gigs(id)** |
| reviewer_id | UUID | NOT NULL, **FK → users(id)** |
| reviewee_id | UUID | NOT NULL, **FK → users(id)** |
| rating | INTEGER | NOT NULL, **CHECK (rating BETWEEN 1 AND 5)** |
| comment | TEXT | nullable (the API caps it at 1,000 characters) |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| — | — | **UNIQUE (gig_id, reviewer_id)**, one review per gig per reviewer |

#### `public.notifications` — schema only. No code reads or writes it.

| Column | Type | Constraints / default |
|---|---|---|
| id | UUID | **PK**, DEFAULT gen_random_uuid() |
| user_id | UUID | NOT NULL, **FK → users(id) ON DELETE CASCADE** |
| type | TEXT | NOT NULL |
| title | TEXT | NOT NULL |
| body | TEXT | nullable |
| data | JSONB | DEFAULT '{}' |
| is_read | BOOLEAN | DEFAULT FALSE |
| created_at | TIMESTAMPTZ | DEFAULT now() |

#### `public.messages` — schema only. No code reads or writes it.

| Column | Type | Constraints / default |
|---|---|---|
| id | UUID | **PK**, DEFAULT gen_random_uuid() |
| gig_id | UUID | nullable, **FK → gigs(id)** |
| sender_id | UUID | NOT NULL, **FK → users(id)** |
| receiver_id | UUID | NOT NULL, **FK → users(id)** |
| content | TEXT | NOT NULL |
| is_read | BOOLEAN | DEFAULT FALSE |
| created_at | TIMESTAMPTZ | DEFAULT now() |

#### `public.ai_match_logs` — one row per gig returned by each match run

| Column | Type | Constraints / default |
|---|---|---|
| id | UUID | **PK**, DEFAULT gen_random_uuid() |
| worker_id | UUID | NOT NULL, **FK → users(id)** |
| gig_id | UUID | NOT NULL, **FK → gigs(id)** |
| semantic_score | NUMERIC(5,4) | nullable |
| tfidf_score | NUMERIC(5,4) | nullable |
| composite_score | NUMERIC(5,4) | nullable |
| location_affinity *(020)* | NUMERIC(4,3) | nullable. Tiered 0–1. Replaced `location_match BOOLEAN`, which was dropped. |
| created_at | TIMESTAMPTZ | DEFAULT now() |

Note: the employer-reputation component of the score is **not** logged. The gateway writes only semantic, tfidf, location and composite.

#### `public.skill_categories` — reference data

| Column | Type | Constraints / default |
|---|---|---|
| id | UUID | **PK**, DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL, **UNIQUE** |
| skills | TEXT[] | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | DEFAULT now() |

#### Foreign-key relationships (summary for the ERD)

```
auth.users 1──1 users                       (users.id, CASCADE)
users      1──* gigs           employer_id  (CASCADE)
gigs       1──* applications   gig_id       (CASCADE)
users      1──* applications   worker_id    (CASCADE)
gigs       1──* escrow         gig_id       (RESTRICT)
users      1──* escrow         employer_id  (RESTRICT)
users      1──* escrow         worker_id    (RESTRICT)
escrow     1──* escrow_events  escrow_id    (CASCADE)
users      1──* escrow_events  actor_id     (NO ACTION, nullable)
gigs       1──* reviews        gig_id       (NO ACTION)
users      1──* reviews        reviewer_id / reviewee_id (NO ACTION)
users      1──* notifications  user_id      (CASCADE)
gigs       1──* messages       gig_id       (NO ACTION, nullable)
users      1──* messages       sender_id / receiver_id (NO ACTION)
users      1──* ai_match_logs  worker_id    (NO ACTION)
gigs       1──* ai_match_logs  gig_id       (NO ACTION)
skill_categories  (no relationships; matched to gigs.category by name only)
```

#### Indexes (beyond primary keys and UNIQUE constraints)

| Index | Table | Definition | Migration | Purpose |
|---|---|---|---|---|
| gigs_search_vector_idx | gigs | GIN (search_vector) | 013 | Full-text gig search |
| gigs_status_created_at_idx | gigs | (status, created_at DESC) | 013 | The feed: open gigs, newest first |
| gigs_employer_id_idx | gigs | (employer_id) | 013 | "My gigs" |
| gigs_category_idx | gigs | (category) | 013 | Category filter |
| applications_gig_id_idx | applications | (gig_id) | 013 | Employer's applicant list |
| applications_worker_id_idx | applications | (worker_id) | 013 | Worker's own applications |
| gigs_embedding_idx | gigs | **HNSW (embedding vector_cosine_ops)** | 014 | Approximate nearest-neighbour search |
| gigs_embedding_missing_idx | gigs | (status) WHERE embedding IS NULL | 014 | Finds gigs still awaiting an embedding |
| escrow_events_escrow_id_idx | escrow_events | (escrow_id, created_at DESC) | 016 | Escrow history |
| escrow_checkout_id_idx | escrow | (mpesa_checkout_id) WHERE NOT NULL | 016 | M-Pesa callback lookup |
| escrow_parties_idx | escrow | (employer_id, worker_id, status) | 016 | "My payments" |

### 2B. Row Level Security policies (final state)

RLS is **enabled on all 10 tables**. The gateway uses two kinds of client (Section 3B). The service-role key **bypasses RLS entirely**, so these policies govern only (a) per-request user clients and (b) anyone calling Supabase's REST API directly with the public anon key.

| Table | Policy name | Operation | Condition in plain English | Migration |
|---|---|---|---|---|
| users | Users can view any profile | SELECT | Anyone may read any profile row (`USING (true)`) | 001 |
| users | Users can update own profile | UPDATE | Only the row whose `id` is the caller | 001 |
| users | Users can insert own profile | INSERT | A user may insert only their own row (`auth.uid() = id`). Replaced 001's "Service role can insert" (`WITH CHECK (true)`). | 012 |
| gigs | Anyone can view open gigs | SELECT | Open gigs are visible to all. Any other status is visible only to the employer who posted it. | 002 |
| gigs | Employers can create gigs | INSERT | `employer_id` must be the caller | 002 |
| gigs | Employers can update own gigs | UPDATE | Only the employer who owns the gig | 002 |
| applications | Workers see own applications | SELECT | `worker_id` is the caller | 003 |
| applications | Employers see applications to their gigs | SELECT | The caller owns the gig the application is for | 003 |
| applications | Workers can apply | INSERT | `worker_id` must be the caller | 003 |
| applications | Workers can withdraw | UPDATE | `worker_id` is the caller | 003 |
| applications | Employers can update application status | UPDATE | The caller owns the gig | 003 |
| escrow | Parties can view own escrow | SELECT | The caller is the employer or the worker on the escrow | 004 |
| escrow | *(Employers can create escrow / Employers can update escrow)* | — | **Dropped in 016.** Clients have no write access to escrow at all. Every mutation goes through SECURITY DEFINER functions that only the service role can call. | 016 |
| escrow_events | Parties can read escrow history | SELECT | The caller is the employer or the worker on the parent escrow. No INSERT policy, so only the service role writes. | 016 |
| reviews | Anyone can read reviews | SELECT | All reviews are public | 005 |
| reviews | Gig participants can review each other | INSERT | All of these must hold: the reviewer is the caller; reviewer ≠ reviewee; the gig is `completed`; there is an `accepted` application; and the pair is either (employer reviewing their hired worker) or (hired worker reviewing the employer). Replaced 005's "Parties can write reviews". | 012 |
| notifications | Users see own notifications | SELECT | `user_id` is the caller | 006 |
| notifications | Users can mark own as read | UPDATE | `user_id` is the caller | 006 |
| messages | Parties can view their messages | SELECT | The caller is the sender or the receiver | 007 |
| messages | Participants of a shared gig can message | INSERT | The sender is the caller; sender ≠ receiver; the two are connected by a gig (one is the employer and the other applied to it); and if `gig_id` is set, it must be that gig. Replaced 007's "Users can send messages". | 013 |
| messages | Receivers can mark as read | UPDATE | `receiver_id` is the caller | 007 |
| ai_match_logs | Workers see own match logs | SELECT | `worker_id` is the caller | 008 |
| ai_match_logs | *(Service can insert)* | — | **Dropped in 012.** No INSERT policy, so only the gateway (service role) can write logs. | 012 |
| skill_categories | Anyone can read skills | SELECT | Public reference data | 009 |

**Protection beyond RLS.** Postgres policies cannot restrict individual columns. So the `protect_user_privileges` trigger (Section 2C) resets `role`, `is_verified`, `email`, `id` and `reputation_score` to their old values on any update not made by the service role. This stops a user promoting themselves to admin through the REST API.

**Gaps a reviewer could raise.** These are read from the policies; none has been exploited or tested:

1. `users` SELECT is `USING (true)` with no role restriction. So **email and phone are readable by anyone holding the public anon key** through Supabase REST. The gateway's public-profile route deliberately omits them, but the table itself does not.
2. `applications` "Workers can withdraw" has no `WITH CHECK` and no column restriction. A worker calling Supabase REST directly could therefore set their own application's status to any allowed value, including `accepted`. The gateway enforces the transition table, but the database does not.
3. `gigs` "Employers can update own gigs" allows the owner to change `status` directly through REST. That bypasses `complete_gig()` and the gateway's edit-only-draft/open rule.
4. The `gigs` INSERT policy checks ownership but not role. The gateway's `requireRole('employer')` is the only check that stops a worker posting a gig.

### 2C. Database functions and triggers

#### Functions (12)

| Function | Defined / last replaced | Security | Called by | What it does |
|---|---|---|---|---|
| `handle_updated_at()` | 010 | invoker | trigger `set_updated_at` | Sets `NEW.updated_at = now()` |
| `update_reputation()` | 010 → **019** | **SECURITY DEFINER** (019) | triggers `on_review_insert`, `on_review_update` | Sets the transaction-local flag `ayira.recomputing_reputation = 'on'`. Sets the reviewee's `reputation_score = round(avg(rating), 2)` over all reviews they have received. Clears the flag. |
| `update_reputation_on_delete()` | 019 | SECURITY DEFINER | trigger `on_review_delete` | Same as above, using `OLD.reviewee_id`. Uses `coalesce(..., 0)` when no reviews remain. |
| `handle_new_user()` | 011 | SECURITY DEFINER | trigger `on_auth_user_created` | Inserts `public.users(id, email, full_name, phone, role)` from `auth.users.raw_user_meta_data`. `full_name` falls back to the part of the email before the @. `role` is accepted only if it is `worker` or `employer`; anything else (including `admin`) becomes `worker`. `ON CONFLICT (id) DO NOTHING`. |
| `protect_user_privileges()` | 011 → **019** | SECURITY DEFINER | trigger `protect_user_privileges` | If the caller is not the service role, resets `role`, `is_verified`, `email` and `id` to their OLD values. It also resets `reputation_score`, **unless** `ayira.recomputing_reputation = 'on'`. |
| `accept_application(p_application_id UUID) → applications` | 012 | SECURITY DEFINER. EXECUTE granted **only to service_role**. | `PATCH /api/applications/:id/status` with `accepted` | In one transaction: locks the application and the gig (`FOR UPDATE`). Requires the application to be `pending`/`shortlisted` and the gig to be `open`. Sets the application to `accepted`, the gig to `in_progress`, and every other pending/shortlisted application on the gig to `rejected`. |
| `gigs_needing_embedding(p_limit INT DEFAULT 500)` | 015 | SECURITY DEFINER, STABLE, service_role only | AI engine `_backfill_embeddings` | Returns open, unexpired gigs (id, title, description, required_skills, embedding_hash). Unembedded gigs come first, then by `updated_at DESC`. |
| `nearest_open_gigs(p_worker_id, p_embedding vector(384), p_limit INT DEFAULT 200, p_category TEXT DEFAULT NULL, p_max_budget NUMERIC DEFAULT NULL)` | 015 → **017** | SECURITY DEFINER, STABLE, service_role only | AI engine `match_worker_to_gigs` | Returns candidate gigs, nearest first by `embedding <=> p_embedding` with `NULLS LAST`. Keeps only gigs that are `open`, not past their deadline, not posted by the worker, and not already applied to by the worker, plus the optional category and budget filters. Returns id, title, description, required_skills, location, is_remote, **employer_reputation**, **employer_review_count** (counted from reviews) and distance. (The engine currently passes no category or budget filter.) |
| `open_escrow(p_gig_id, p_employer_id, p_worker_id, p_amount) → escrow` | 016 | SECURITY DEFINER, service_role only | `POST /api/escrow/fund` | Checks that amount > 0, that the caller is the gig's employer, and that the worker has an **accepted** application. Refuses if the gig already has a live escrow (pending, funded, disputed or partial_release). Inserts a `pending` escrow and logs the event "Escrow opened". |
| `mark_escrow_funded(p_checkout_id TEXT, p_receipt TEXT) → escrow` | 016 | SECURITY DEFINER, service_role only | M-Pesa callback, `POST /api/escrow/:id/sync` | Finds the escrow by `mpesa_checkout_id` and locks it. **Idempotent**: an escrow that is already funded is returned unchanged. Requires `pending`. Sets `funded`, `mpesa_receipt` and `funded_at`. Logs "M-Pesa receipt …". |
| `transition_escrow(p_escrow_id, p_actor_id, p_to_status, p_detail DEFAULT NULL) → escrow` | 016 → 018 → **021** | SECURITY DEFINER, service_role only | release / dispute / cancel / admin resolve | The escrow state machine (shown below). Writes an `escrow_events` row. On `released`, if the gig is `in_progress` it also sets the gig to `completed` and logs "Gig marked completed because escrow was released". |
| `complete_gig(p_gig_id, p_actor_id) → gigs` | 018 | SECURITY DEFINER, service_role only | `POST /api/gigs/:id/complete` | Employer or admin only. **Idempotent** on a gig that is already `completed`. Requires `in_progress` and at least one `accepted` application. Sets the gig to `completed`. |

**Escrow state machine** (`transition_escrow`, migration 021):

```
(none)   ──open_escrow() [employer]──────────────▶ pending
pending  ──mark_escrow_funded() [M-Pesa]─────────▶ funded
pending  ──cancel [employer | admin]─────────────▶ cancelled
funded   ──release [employer]────────────────────▶ released   (+ gig → completed)
funded   ──dispute [employer | worker]───────────▶ disputed
disputed ──resolve: release [admin]──────────────▶ released   (+ gig → completed)
disputed ──resolve: refund  [admin]──────────────▶ refunded
```

| From | To | Who | Error when the status is wrong / when the role is wrong (021) |
|---|---|---|---|
| pending | cancelled | employer, admin | "Only an escrow that has not been paid can be cancelled, and this one is %" / "Only the employer or an administrator can cancel this escrow" |
| funded | released | employer | "Only a funded or disputed escrow can be released, and this one is %" / "Only the employer who funded this escrow can release it" |
| funded | disputed | employer, worker | "Only a funded escrow can be disputed, and this one is %" / "Only the employer or the worker can dispute this escrow" |
| disputed | released | admin | "Only an administrator can release a disputed escrow" |
| disputed | refunded | admin | "Only a disputed escrow can be refunded, and this one is %" / "Only an administrator can refund a disputed escrow" |
| any | other | — | "Unsupported transition to %". A caller who is not a party and not an admin gets "Not a party to this escrow". |

`partial_release` is allowed by the CHECK constraint, but **no function ever produces it**.

**Gig lifecycle:**
`draft` →(publish)→ `open` →(`accept_application`)→ `in_progress` →(`complete_gig`, or escrow `released`)→ `completed`. `draft`/`open` →(DELETE, or admin cancel)→ `cancelled`.

#### Triggers (9)

| Trigger | Timing | Table | Function | Migration |
|---|---|---|---|---|
| set_updated_at | BEFORE UPDATE, FOR EACH ROW | users | handle_updated_at() | 010 |
| set_updated_at | BEFORE UPDATE, FOR EACH ROW | gigs | handle_updated_at() | 010 |
| set_updated_at | BEFORE UPDATE, FOR EACH ROW | applications | handle_updated_at() | 010 |
| set_updated_at | BEFORE UPDATE, FOR EACH ROW | escrow | handle_updated_at() | 010 |
| on_review_insert | AFTER INSERT, FOR EACH ROW | reviews | update_reputation() | 010 (recreated 019) |
| on_review_update | AFTER UPDATE, FOR EACH ROW | reviews | update_reputation() | 019 |
| on_review_delete | AFTER DELETE, FOR EACH ROW | reviews | update_reputation_on_delete() | 019 |
| on_auth_user_created | AFTER INSERT, FOR EACH ROW | **auth.users** | handle_new_user() | 011 |
| protect_user_privileges | BEFORE UPDATE, FOR EACH ROW | users | protect_user_privileges() | 011 |

**One-off data steps inside migrations:**

- 011 backfills profiles for any `auth.users` that existed before the trigger.
- 019 recomputes every reviewed user's reputation, which had been stuck at 0.00 because of the guard/trigger conflict.
- 020 converts the old boolean `location_match` to 1.0 / 0.0 / NULL.

**The defect fixed by migration 019, worth a sentence in the chapter.** Migration 010's reputation trigger ran with the reviewer's privileges. Migration 011's privilege guard then reverted `reputation_score` for any non-service-role caller. The result: reviews were saved, but reputation stayed at 0.00 forever. The migration's comment says this was verified against the live database: a 5-star review left the employer at 0.00.

### 2D. Seed data (migration 009)

Five categories, with 27 skills in total:

| Category | Skills |
|---|---|
| Technology | Python, JavaScript, React, Node.js, Flutter, Data Analysis, UI/UX Design |
| Writing | Content Writing, Copywriting, Technical Writing, Translation, Transcription |
| Design | Graphic Design, Logo Design, Video Editing, Photography, Animation |
| Marketing | Social Media, SEO, Email Marketing, Digital Advertising, Influencer Marketing |
| Business | Virtual Assistant, Data Entry, Customer Service, Project Management, Accounting |

The same five names are hard-coded as `GIG_CATEGORIES` in `apps/api/src/lib/constants.ts` (the Zod enum for gig categories) and in `packages/shared/src/index.ts`. The web app reads the categories and skills from `GET /api/gigs/meta/categories`, both for the category dropdowns and for the skill suggestions in `SkillsInput`.

---
## SECTION 3 — API GATEWAY (`apps/api/src/`)

### File inventory

| File | Lines | Purpose |
|---|---|---|
| `index.ts` | 72 | Express app, middleware stack, route mounts, listen |
| `lib/env.ts` | 58 | Loads `.env` first and fails fast on missing Supabase keys. Exports the `env` object. |
| `lib/supabase.ts` | 21 | `supabaseAdmin` (service role) and `createUserClient(jwt)` |
| `lib/http.ts` | 77 | `requireUser`, `userClient`, `assertNoDbError`, pagination helpers, search sanitisers, Postgres error codes |
| `lib/asyncHandler.ts` | 18 | Forwards rejected promises from async handlers to the error middleware (Express 4 does not do this itself) |
| `lib/constants.ts` | 18 | `GIG_CATEGORIES`, `DEFAULT_CURRENCY = 'KES'` |
| `middleware/auth.ts` | 103 | `AuthRequest`, `authMiddleware`, `requireRole`, role cache |
| `middleware/errorHandler.ts` | 33 | `AppError` and the global error handler |
| `middleware/rateLimit.ts` | 33 | `authLimiter`, `apiLimiter` |
| `routes/auth.ts` | 107 | signup / signin / refresh |
| `routes/gigs.ts` | 423 | Gig CRUD, publish, complete, categories |
| `routes/workers.ts` | 211 | Own profile, public profile, dashboard stats |
| `routes/applications.ts` | 261 | Apply, list, read, change status (hire) |
| `routes/escrow.ts` | 388 | Escrow list/read/fund/release/dispute/cancel/sync and the public M-Pesa callback |
| `routes/reviews.ts` | 225 | List, pending, create |
| `routes/matching.ts` | 187 | Calls the AI engine, adds gig details to the results, logs matches, history |
| `routes/admin.ts` | 392 | Platform dashboard, users, verify, gigs, escrow oversight, dispute resolution, gig moderation |
| `services/mpesa.ts` | 390 | Daraja client |
| `types/database.ts` | 303 | Hand-written `Database` type for supabase-js |

### 3A. Entry point (`src/index.ts`)

**Startup order:**

1. `import { env } from './lib/env'` must come **first**. It loads the root `.env` (candidates: `../../.env`, `./.env`, `__dirname/../../../../.env`). It then exits the process with an explanatory message if `SUPABASE_URL`, `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` is missing.
2. `const app = express()`
3. If `NODE_ENV === 'production'`: `app.set('trust proxy', 1)`, so rate limiting sees the client IP behind Railway's proxy.

**Global middleware, in order:**

| # | Middleware | Config |
|---|---|---|
| 1 | `helmet()` | default security headers |
| 2 | `cors({ origin: env.corsOrigin })` | `CORS_ORIGIN` or `http://localhost:5173` |
| 3 | `express.json({ limit: '100kb' })` | JSON body parser |
| 4 | `morgan('dev')` | request logging |

**Route mounts, in order:**

| Path | Middleware chain | Router | Protected? |
|---|---|---|---|
| `GET /health` | — | inline: `{ status: 'ok', service: 'ayira-api', timestamp }` | No |
| `/api/auth` | `authLimiter` | `authRouter` | **No** (public) |
| `/api/escrow/callback` | — | `escrowCallbackRouter` | **No.** Safaricom calls it. |
| `/api` | `apiLimiter` | — (applies to everything below) | — |
| `/api/gigs` | `authMiddleware` | `gigRouter` | Yes |
| `/api/workers` | `authMiddleware` | `workerRouter` | Yes |
| `/api/applications` | `authMiddleware` | `applicationRouter` | Yes |
| `/api/escrow` | `authMiddleware` | `escrowRouter` | Yes |
| `/api/admin` | `authMiddleware` (+ `requireRole('admin')` inside the router) | `adminRouter` | Yes, admin only |
| `/api/reviews` | `authMiddleware` | `reviewRouter` | Yes |
| `/api/match` | `authMiddleware` | `matchingRouter` | Yes |
| `/api/*` (fallthrough) | — | `404 { error: 'Endpoint not found' }` | — |

- **Error handling:** `app.use(errorHandler)` is last.
- **Port:** `env.apiPort = Number(process.env.API_PORT || 3001)`. Logs `🚀 Ayira API running on http://localhost:<port>`.
- `export default app`.

**Rate limiting (`middleware/rateLimit.ts`):**

| Limiter | Window | Limit | Notes | Message |
|---|---|---|---|---|
| `authLimiter` | 15 min | 5 | `skipSuccessfulRequests: true`, so only failures count | "Too many attempts. Please wait 15 minutes before trying again." |
| `apiLimiter` | 1 min | 120 | all requests | "Too many requests. Please slow down and try again shortly." |

Both send `standardHeaders: 'draft-7'` and no legacy headers.

### 3B. Supabase client configuration (`src/lib/supabase.ts`)

| Client | Created with | RLS | Used for |
|---|---|---|---|
| `supabaseAdmin` | `createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })` | **Bypassed** | Token validation (`auth.getUser`), role lookup, signup (`auth.admin.createUser`), cross-user reads (gig detail, applicant counts, stats), every RPC (`accept_application`, `open_escrow`, `transition_escrow`, `mark_escrow_funded`, `complete_gig`), admin routes, writing `ai_match_logs` |
| `createUserClient(accessToken)` | `createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: 'Bearer ' + accessToken } }, auth: { autoRefreshToken: false, persistSession: false } })` | **Enforced** as the calling user | Creating and updating gigs, feed listing, inserting applications, own-profile read/update, own escrow list, **inserting reviews** (so that the migration-012 policy decides who may review), match history |

**How the user client receives the JWT.** `authMiddleware` stores the bearer token on `req.accessToken`. `lib/http.ts` `userClient(req)` then calls `createUserClient(requireUser(req).accessToken)`, which puts the token in the global `Authorization` header. PostgREST therefore evaluates RLS with `auth.uid()` set to the caller's id.

### 3C. Authentication middleware (`src/middleware/auth.ts`)

**The `AuthRequest` interface** (extends Express `Request`):

| Field | Type | Set to |
|---|---|---|
| `userId?` | string | `user.id` from Supabase |
| `userRole?` | string | Role resolved from `public.users`, **never from the JWT** |
| `accessToken?` | string | The raw bearer token, passed on to `createUserClient` |

**`authMiddleware(req, res, next)` flow:**

1. Reads `req.headers.authorization`. If it does not start with `"Bearer "` → **401** `{ error: 'Missing or invalid authorization header' }`.
2. `token = authHeader.split(' ')[1]`
3. Validates the token with **`supabaseAdmin.auth.getUser(token)`**. On an error or no user → **401** `{ error: 'Invalid or expired token' }`.
4. Sets `req.userId`, `req.accessToken`, and `req.userRole = await resolveRole(user.id, user.user_metadata?.role)`.
5. If the call to Supabase itself throws (a network fault or timeout) → **503** `{ error: 'Could not verify your session right now. Please try again.' }`. This is deliberately not a 401, so a transient fault does not log the user out.

**`resolveRole(userId, fallback)`:**

- Keeps an in-memory `Map` cache with a **30 s TTL** (`ROLE_CACHE_TTL_MS = 30_000`).
- Reads `users.role` with the admin client.
- On a DB error it returns `'worker'` (least privilege) and caches nothing.
- If no profile row exists yet (signup still in flight), it uses the token's role only if that is `'employer'`; otherwise `'worker'`. It **never** grants admin from a token.
- `invalidateRoleCache(userId)` is exported. The admin verify route calls it.
- Why the token is not trusted: `user_metadata` can be edited by the account holder through `supabase.auth.updateUser`.

**`requireRole(...roles)`.** Returns middleware: if `!req.userRole || !roles.includes(req.userRole)` → **403** `{ error: 'Insufficient permissions' }`. Otherwise `next()`.

Where it is used: `POST /gigs`, `PATCH /gigs/:id`, `PATCH /gigs/:id/publish` and `DELETE /gigs/:id` (employer); `POST /gigs/:id/complete` (employer, admin); `POST /applications` (worker); `POST /escrow/fund` (employer); `POST /match` (worker); the whole `adminRouter` (admin).

### 3D. Error handler (`src/middleware/errorHandler.ts`)

**`class AppError extends Error`:**

- Fields: `statusCode: number`, `details?: unknown`, `name = 'AppError'`.
- Constructor: `(message: string, statusCode = 500, details?: unknown)`.

**`errorHandler(err, req, res, next)`:**

| Error type | Response |
|---|---|
| `ZodError` | **400** `{ error: 'Validation failed', details: err.errors }` |
| `AppError` | `err.statusCode`, `{ error: err.message, details? }`. Logged as `AppError <code>: <message>`. |
| anything else | **500** `{ error: 'Internal server error' }`. The full error is logged; internals are never sent to the client. |

**Response envelope.** Success responses are `{ data: … }`. Errors are `{ error, details? }`. The auth routes are the exception: they return bare objects (see 3E).

**Helpers in `lib/http.ts`:**

| Helper | What it does |
|---|---|
| `requireUser(req)` | Returns `{ userId, role, accessToken }`, or throws `AppError('Authentication required', 401)` |
| `assertNoDbError(error, message, status = 500)` | Logs, then throws `AppError(message, status)` |
| `paginationSchema` | `page` int ≥ 1, default 1; `limit` int 1–100, default 20 (both coerced) |
| `toRange(page, limit)` | `{ from: (page-1)*limit, to: from+limit-1 }` |
| `buildPageMeta(total, page, limit)` | `{ total, page, limit, totalPages: max(1, ceil(total/limit)) }` |
| `sanitizeSearchTerm(term)` | Strips `, ( ) . * % \ " '`, trims, caps at 100 characters. Used for admin `ilike` searches inside a PostgREST `or=(…)` filter. |
| `normalizeSearchQuery(term)` | Trims and caps at 200 characters. Used for full-text `websearch` queries, which are sent as a parameter and so need no escaping. |
| Constants | `PG_UNIQUE_VIOLATION = '23505'`, `PGRST_NO_ROWS = 'PGRST116'` |

### 3E. Auth routes (`src/routes/auth.ts`)

All three are public and sit behind `authLimiter`. They are **not** wrapped in `asyncHandler`; each has its own try/catch (except `/refresh`, which has none). **The web app does not call any of these routes** (see 4B).

**Zod schemas:**

```ts
signUpSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  phone:    z.string().min(10),
  role:     z.enum(['worker', 'employer']),
});
signInSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
});
```

**`POST /api/auth/signup`:**

1. `signUpSchema.parse(req.body)`
2. `supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name, phone, role } })`. Because `email_confirm: true`, no confirmation email is sent. If Supabase returns an error (for example, a duplicate email) → **400** `{ error: <Supabase message> }`.
3. The `on_auth_user_created` trigger (migration 011) has already inserted a `public.users` row. The route then **upserts** `{ id, email, full_name, phone, role }` with `onConflict: 'id'`. On error → **400** `{ error }`.
4. **201** `{ message: 'Account created', userId }`
5. A Zod failure → **400** `{ error: 'Validation failed', details }`. Anything else → **500** `{ error: 'Registration failed' }`.

**`POST /api/auth/signin`:**

1. `signInSchema.parse(req.body)`
2. `supabaseAdmin.auth.signInWithPassword({ email, password })`. On error → **401** `{ error: <Supabase message> }`.
3. **200** `{ accessToken: session.access_token, refreshToken: session.refresh_token, user: { id, email, role: user.user_metadata?.role } }`. Note that the role comes from metadata here, unlike in `authMiddleware`.
4. A Zod failure → 400. Anything else → **500** `{ error: 'Login failed' }`.

**`POST /api/auth/refresh`:**

1. Reads `req.body.refreshToken`. **No Zod schema.** If it is missing → **400** `{ error: 'Refresh token required' }`.
2. `supabaseAdmin.auth.refreshSession({ refresh_token })`. On error → **401** `{ error }`.
3. **200** `{ accessToken, refreshToken }`

### 3F. All gateway routes. None are stubs.

The prompt calls gigs, workers, applications, escrow and admin "stub routes". **All are fully implemented**, and there are two more routers (reviews, match). There are **41 endpoints** in total.

#### Gigs (`routes/gigs.ts`), mounted at `/api/gigs`

Schemas:

- `gigBodySchema`:
  - `title`: trim, min 5 ("Title must be at least 5 characters")
  - `description`: trim, min 20
  - `category`: `z.enum(GIG_CATEGORIES)`
  - `required_skills`: array of strings (min 1 character each), max 20, default []
  - `location`: optional, 1–120 characters
  - `is_remote`: boolean, default false
  - `budget_min` / `budget_max`: positive numbers
  - `currency`: length 3, default 'KES'
  - `deadline`: string, min 1
- `createGigSchema` adds three refinements: `budget_max ≥ budget_min`; the deadline is a valid date; the deadline is in the future.
- `updateGigSchema` = `gigBodySchema.partial()`.
- `listQuerySchema` = pagination plus `category`, `location`, `is_remote` (the strings 'true'/'false' are transformed to a boolean), `min_budget`, `max_budget`, `search`, `status` (default 'open'), and `employer_id` ('me' or a UUID).

| Method & path | Role | Behaviour | Success | Errors |
|---|---|---|---|---|
| `GET /meta/categories` | any | Reads `skill_categories` (id, name, skills) through the user client, ordered by name | 200 `{ data: [...] }` | 500 |
| `POST /` | employer | Validates, then inserts through the **user client** with `status: 'draft'`. The deadline is converted to ISO. Returns the gig with the employer embedded. | **201** `{ data: gig }` | 400 Zod, 403 role |
| `GET /` | any | User client. `.eq('status', q.status)`; employer filter (`'me'` → caller); category; is_remote; `location ilike %x%`; budget overlap (`budget_max ≥ min_budget`, `budget_min ≤ max_budget`); **full-text** `textSearch('search_vector', term, { type: 'websearch', config: 'english' })`. Ordered by `created_at DESC`, then paginated. When the caller lists their own gigs, adds `application_count` per gig (one extra query). | 200 `{ data: { gigs, total, page, limit, totalPages } }` | 400 |
| `GET /:id` | any | Admin client read. If the caller is not the owner and the gig is not open, the caller must have applied to it; otherwise 404. Adds `employer_total_gigs` (non-draft count), `application_count` (owner only) and `is_owner`. | 200 | 404 "Gig not found" (also for an invalid UUID) |
| `PATCH /:id` | employer | `loadOwnedGig` (404 if not found, **403** "You do not have permission to modify this gig"). The gig must be `draft`/`open`, otherwise **409** `A gig with status "x" can no longer be edited`. Partial body. Cross-field checks against the merged values. Update through the user client. | 200 | 400 "No fields to update", 400 budget/deadline, 403, 404, 409 |
| `PATCH /:id/publish` | employer | Owned gig. `open` → **409** "This gig is already published". Any status other than draft → 409. Sets `status = 'open'`. | 200 | 403, 404, 409 |
| `DELETE /:id` | employer | **Soft delete.** Owned gig, `draft`/`open` only, sets `status = 'cancelled'`. | 200 `{ data: gig }` | 403, 404, 409 |
| `POST /:id/complete` | employer, admin | `supabaseAdmin.rpc('complete_gig', { p_gig_id, p_actor_id })`, then re-reads the gig. Error mapping: "not found" → 404, "only the employer" → 403, any other message → 409. | 200 | 403, 404, 409 |

`GIG_COLUMNS` are listed explicitly so that `search_vector` and `embedding` never leave the server. The employer is embedded as `users!employer_id(id, full_name, avatar_url, reputation_score, is_verified, location)`.

#### Workers / profiles (`routes/workers.ts`), mounted at `/api/workers`

`updateProfileSchema` (partial):

- `full_name`: 2–120
- `phone`: 10–20
- `bio`: ≤ 500
- `skills`: array, ≤ 30
- `location`: 1–120
- `avatar_url`: URL

| Method & path | Behaviour | Success | Errors |
|---|---|---|---|
| `GET /profile` | The caller's full `users` row, read through the user client | 200 | 404 "Profile not found" |
| `PATCH /profile` | Updates the caller's row through the user client. The privilege trigger ignores role, is_verified, reputation and email. | 200 | 400 "No fields to update" / Zod |
| `GET /dashboard/stats` | **Employer:** total_gigs, open_gigs, active_gigs (in_progress), completed_gigs, total_applicants, escrow_held (sum of funded + disputed), total_paid_out (sum of released). **Worker:** total_applications, active_gigs and completed_gigs (accepted applications, split by gig status), average_rating (2 dp), total_reviews, total_earnings (sum of released escrow). | 200 `{ data: { role, ... } }` | 500 |
| `GET /profile/:id` | Public fields only: id, full_name, avatar_url, bio, skills, location, reputation_score, is_verified, role, created_at. **Email and phone are excluded.** Adds `completed_gigs` and `total_reviews`. | 200 | 404 |

#### Applications (`routes/applications.ts`), mounted at `/api/applications`

- `createApplicationSchema`: `gig_id` UUID; `cover_letter` trim min 20; `proposed_amount` positive.
- `statusSchema`: `status ∈ {shortlisted, accepted, rejected, withdrawn}`.

Allowed transitions:

| Party | From | Allowed to |
|---|---|---|
| Employer | pending | shortlisted, accepted, rejected |
| Employer | shortlisted | accepted, rejected |
| Worker | pending, shortlisted | withdrawn |
| either | accepted, rejected, withdrawn | none (terminal) |

| Method & path | Role | Behaviour | Success | Errors |
|---|---|---|---|---|
| `POST /` | worker | Loads the gig. Own gig → **400** "You cannot apply to your own gig". Not open → **409** "This gig is no longer accepting applications". Inserts through the user client with status pending. A unique violation (23505) → **409** "You have already applied to this gig". | **201** `{ data: application + gig }` | 400, 403, 404, 409 |
| `GET /` | any | Employer: applications to their gigs (`gig.employer_id = caller`), sorted by gig_id then newest. Worker: their own. Filters: `status`, `gig_id`. Embeds the gig (with employer) and the worker. | 200 `{ data: { applications, ...page } }` | — |
| `GET /:id` | party | Admin read. Returns 404 unless the caller is the worker or the gig's employer. | 200 | 404 |
| `PATCH /:id/status` | party | Checks the transition table. If it is not allowed → **409** `Cannot change an application from "x" to "y"`. `accepted` on a gig that is not open → 409. **`accepted`** calls `supabaseAdmin.rpc('accept_application')` (atomic hire); an RPC failure → **409** "This application could not be accepted — it may have changed. Reload and retry." Any other status: an update with an optimistic-concurrency guard `.eq('status', row.status)`; no row updated → 409 "This application was updated by someone else — reload and retry". Re-reads the application with the same embeds. | 200 | 404, 409 |

#### Escrow (`routes/escrow.ts`), mounted at `/api/escrow` (protected) and `/api/escrow/callback` (public)

- `fundSchema`: `gig_id` UUID; `worker_id` UUID; `amount` positive, **max 500,000**; `phone` optional, 9–20 characters.
- `escrowError()` maps database messages to statuses: "not found" → 404; "not a party / only the employer / only an admin(istrator)" → 403; any other message → 409.

| Method & path | Role | Behaviour | Success |
|---|---|---|---|
| `GET /` | party | The caller's escrow (as employer or worker) through the user client, with an optional status filter. Embeds the gig, employer and worker. Adds `mpesa_configured: isConfigured()`. | 200 `{ data: { escrow, mpesa_configured, ...page } }` |
| `GET /:id` | party | One escrow plus its `events[]` (from_status, to_status, detail, created_at, oldest first) | 200 |
| `POST /fund` | employer | The phone is `body.phone`, or the profile phone, or **400** "Add a phone number to your profile…". Then `rpc('open_escrow')` (the row exists **before** the push, so an early callback has something to attach to). Then `initiateStkPush(phone, amount, 'AYIRA-' + first 8 characters of the escrow id)`. Saves `mpesa_checkout_id`. If the push fails, it calls `transition_escrow(..., 'cancelled', 'Payment request could not be started')` so the gig is not blocked, then re-throws. | **201** `{ data: { escrow_id, checkout_request_id, amount, message } }` |
| `POST /:id/release` | party (the DB requires the employer) | `rpc('transition_escrow', 'released', 'Released by the employer')`. Also completes the gig. Sandbox only: **no B2C payout is made**. | 200 |
| `POST /:id/dispute` | party | Body `{ reason }` trimmed, 10–500 characters. Then `transition_escrow(..., 'disputed', reason)`. | 200 |
| `POST /:id/cancel` | party (the DB requires the employer or an admin, and status pending) | `transition_escrow(..., 'cancelled', 'Cancelled before payment')` | 200 |
| `POST /:id/sync` | party | If the escrow is not `pending` or has no checkout id → `{ status, changed: false }`. Otherwise calls `queryStkStatus`. `resultCode === '0'` → `rpc('mark_escrow_funded', receipt null)` → `{ status: 'funded', changed: true, detail }`. Otherwise `{ status, changed: false, detail }`. Exists to recover from lost callbacks. | 200 |
| `POST /callback` | **public** | `parseCallback(body)`. Unparseable → logged, then 200. Failed payment → writes an `escrow_events` row "Payment not completed: <desc>" and leaves the escrow pending. Success → `rpc('mark_escrow_funded', checkoutId, receipt)`. **Always** answers `200 { ResultCode: 0, ResultDesc: 'Accepted' }`, so Safaricom does not retry. | 200 |

The callback relies on the checkout id being unguessable and on the escrow having to be pending. The code's own comment records the gap: anyone who learns a CheckoutRequestID could forge a success, and closing that needs an IP allow-list of Safaricom's address ranges.

#### Reviews (`routes/reviews.ts`), mounted at `/api/reviews`

- `createSchema`: `gig_id` UUID; `reviewee_id` UUID; `rating` int 1–5; `comment` optional, ≤ 1,000.
- List query: pagination, `user_id?`, `gig_id?`.

| Method & path | Behaviour | Success | Errors |
|---|---|---|---|
| `GET /` | Reviews **about** `user_id` (defaults to the caller), optionally filtered to one gig. Embeds the reviewer (id, full_name, avatar_url, role) and the gig (id, title, category). Adds `average_on_page`. | 200 `{ data: { reviews, average_on_page, ...page } }` | — |
| `GET /pending` | Completed gigs where the caller was the employer (one entry per accepted worker) or the hired worker (one entry for the employer), minus gigs the caller has already reviewed | 200 `{ data: { pending: [{ gig_id, title, reviewee_id, role }] } }` | — |
| `POST /` | Self-review → **400** "You cannot review yourself.". Inserts through the **user client**, so RLS decides who may review whom. 23505 → **409** "You have already reviewed this gig.". RLS refusal (42501) → **403** "You can only review the other party on a gig you completed together.". | **201** | 400, 403, 409 |

#### Matching (`routes/matching.ts`), mounted at `/api/match`

- `matchRequestSchema`: `limit` int 1–50, default 10.
- The engine's response is checked with Zod: `{ worker_id, matches: [{ gig_id, title, score, breakdown: { semantic?, tfidf?, location?, employer_reputation? } }] }`.

| Method & path | Role | Behaviour |
|---|---|---|
| `POST /` | worker | `callAiEngine(userId, limit)`:<br>• `AI_ENGINE_SECRET` unset → **503** "Matching is not configured on this server."<br>• `fetch(AI_ENGINE_URL + '/ai/match', { method: 'POST', headers: { 'X-Ayira-Key': secret }, body: { worker_id, limit }, signal: AbortSignal.timeout(60_000) })`<br>• Network failure or timeout → **503** "The matching service is unavailable. Please try again shortly."<br>• Non-2xx → **502** "…could not score your profile right now."<br>• Payload that fails the schema → **502** "…returned an unexpected response."<br>Empty result → `{ matches: [], generated_at }`. Otherwise it fetches the gig fields for the matched ids and returns, in the engine's order, `[{ gig, score, score_percent: round(score*100), breakdown }]`. `logMatches()` inserts one `ai_match_logs` row per match (semantic, tfidf, location_affinity, composite). A logging failure is logged but never fails the request. |
| `GET /history` | any | The caller's `ai_match_logs`, newest first, paginated, with the gig embedded. Read through the user client. |

#### Admin (`routes/admin.ts`), mounted at `/api/admin`, with `requireRole('admin')` on the whole router

| Method & path | Behaviour |
|---|---|
| `GET /dashboard` | total_users, total_workers, total_employers, total_gigs, open_gigs, in_progress_gigs, total_applications, active_escrow_amount (funded + disputed + partial_release), total_released_amount, **total_platform_revenue: 0** (no commission is charged) |
| `GET /users` | Paginated. Filters: `role`, `is_verified`, `search` (`full_name`/`email` ilike, sanitised). Returns email, phone, role, location, skills, reputation, is_verified, created_at. |
| `PATCH /users/:id/verify` | Body `{ is_verified: boolean = true }`. Updates `users.is_verified` with the service role, then calls `invalidateRoleCache(id)`. 404 if the user is not found. |
| `GET /gigs` | Every gig (drafts and cancelled included), with optional `status` and `search` (title/description ilike). Embeds the employer, including email. |
| `GET /escrow` | Every escrow, optional `status`, paginated. Also returns `disputed_count`. |
| `GET /escrow/:id` | `{ escrow, events }`, with each event's actor embedded (id, full_name, role) |
| `POST /escrow/:id/resolve` | Body `{ outcome: 'released' \| 'refunded', reason: 10–1000 characters }`. Calls `transition_escrow(id, adminId, outcome, 'Dispute resolved by an administrator: ' + reason)`. Error mapping: not found → 404; "only an administrator / not a party" → 403; otherwise 409. |
| `POST /gigs/:id/cancel` | Body `{ reason: 5–500 characters }`. 404 if not found. 409 if already completed or cancelled. **409** if the gig has live escrow (pending, funded, disputed or partial_release). Otherwise sets `status = 'cancelled'` and logs a warning with the reason. **The web UI has no button for this endpoint.** |

### 3G. Database types (`src/types/database.ts`)

The types are written by hand to mirror the migrations; the file header still says "001..010", but it does include `escrow_events`, `location_affinity` and `complete_gig`. `packages/shared/src/database.types.ts` is still the generated-types placeholder.

**Enum types:**

```ts
type UserRole          = 'worker' | 'employer' | 'admin';
type GigStatus         = 'draft' | 'open' | 'in_progress' | 'completed' | 'cancelled';
type ApplicationStatus = 'pending' | 'shortlisted' | 'accepted' | 'rejected' | 'withdrawn';
type EscrowStatus      = 'pending' | 'funded' | 'released' | 'disputed' | 'refunded' | 'partial_release' | 'cancelled';
```

**Row types.** `UserRow`, `GigRow`, `ApplicationRow`, `EscrowRow`, `ReviewRow`, `NotificationRow`, `MessageRow`, `AiMatchLogRow`, `EscrowEventRow` and `SkillCategoryRow` mirror the columns in 2A. The exceptions are `users.embedding*`, `gigs.embedding*` and `gigs.search_vector`, which are deliberately left out.

**Generic helpers:**

- `Insertable<T, RequiredKeys>` = `Pick<T, RequiredKeys> & Partial<Omit<T, RequiredKeys>>`
- `FkTo<Name, Column, Target>` describes a foreign key in the shape supabase-js expects for embedded selects, e.g. `users!escrow_employer_id_fkey(...)`

**`interface Database { public: { Tables, Views, Functions } }`:**

| Table | Insert requires | Update excludes | Relationships |
|---|---|---|---|
| users | id, email, full_name | id | — |
| gigs | employer_id, title, description, category | id, employer_id | gigs_employer_id_fkey |
| applications | gig_id, worker_id | id, gig_id, worker_id | applications_gig_id_fkey, applications_worker_id_fkey |
| escrow | gig_id, employer_id, worker_id, amount | id, gig_id | escrow_gig_id_fkey, escrow_employer_id_fkey, escrow_worker_id_fkey |
| reviews | gig_id, reviewer_id, reviewee_id, rating | id | 3 FKs |
| notifications | user_id, type, title | id | notifications_user_id_fkey |
| messages | sender_id, receiver_id, content | id | 3 FKs |
| ai_match_logs | worker_id, gig_id | id | 2 FKs |
| escrow_events | escrow_id, to_status | id | escrow_events_escrow_id_fkey, escrow_events_actor_id_fkey |
| skill_categories | name | id | — |

`Views: Record<never, never>`. `Functions` covers `accept_application`, `open_escrow`, `mark_escrow_funded`, `transition_escrow` and `complete_gig`, with typed `Args`/`Returns`. `gigs_needing_embedding` and `nearest_open_gigs` are absent because only the Python engine calls them.

### 3H. M-Pesa / Daraja client (`src/services/mpesa.ts`)

| Element | Detail |
|---|---|
| Base URL | `https://sandbox.safaricom.co.ke`, or `https://api.safaricom.co.ke` if `DARAJA_ENV=production` |
| Timeout | `DARAJA_TIMEOUT_MS` or 20,000 ms per request |
| `config()` | Reads `DARAJA_CONSUMER_KEY`, `_CONSUMER_SECRET`, `_PASSKEY`, `_SHORTCODE` and `_CALLBACK_URL` **at call time**. Rejects empty values and placeholders (the regex `/your-\|example\.com\|changeme\|<[^>]+>/i`, matched anywhere in the value) with **503** "M-Pesa is not configured on this server (missing: …)". The rest of the API still starts without them. |
| `isConfigured()` | A boolean wrapper around `config()` |
| `darajaFetch(url, init, what, tolerate[])` | Retries on HTTP 429 (Daraja's limit is 30 requests/min, burst 3) up to **3 times**, with backoff of **2 s, 5 s, 12 s**. A network failure → 503 "Could not reach M-Pesa…". A non-2xx response whose errorCode is not in `tolerate` → 502 "M-Pesa rejected the request…". The response body is logged, not returned. |
| `getAccessToken()` | `GET /oauth/v1/generate?grant_type=client_credentials` with HTTP Basic `key:secret` in base64. The token is cached until `expires_in − 60 s` (at least 60 s). |
| `timestamp()` | `yyyyMMddHHmmss` in **Africa/Nairobi** time (`Intl.DateTimeFormat`, `hourCycle: 'h23'`), so it is correct on a UTC server |
| `normalisePhone(raw)` | Strips non-digits. `254…` is kept; `0…` → `254…`; 9 digits → `254…`. Anything else → 400 "That phone number is not a valid Kenyan number. Use the 07XXXXXXXX format." |
| `initiateStkPush(phone, amount, accountRef, description = 'Ayira escrow funding')` | `POST /mpesa/stkpush/v1/processrequest` with BusinessShortCode, Password = base64(shortcode + passkey + timestamp), Timestamp, `TransactionType: 'CustomerPayBillOnline'`, `Amount: Math.round(amount)`, PartyA = PhoneNumber = normalised phone, PartyB = shortcode, CallBackURL, `AccountReference` (≤ 12 characters), `TransactionDesc` (≤ 13 characters). Returns `{ checkoutRequestId, merchantRequestId, customerMessage }`. |
| `queryStkStatus(checkoutRequestId)` | `POST /mpesa/stkpushquery/v1/query`. Tolerates errorCode **`500.001.1001`** (the customer has not acted yet) and maps it to `{ resultCode: null, resultDesc: 'Payment is still being processed.' }`. Otherwise returns `{ resultCode, resultDesc }`. |
| `parseCallback(payload)` | Reads `Body.stkCallback`: `CheckoutRequestID`, `ResultCode` (`'0'` = success), `ResultDesc`, and from `CallbackMetadata.Item[]` the `MpesaReceiptNumber` and `Amount`. Returns `null` for a malformed body; it never throws. |
| Sandbox test scripts | `scripts/daraja_smoke.ts` (token → 1 KES push to `254708374149` → three status polls; touches no database). `scripts/daraja_query.ts` (polls one checkout id). |
| Verified (commit `85dcdac`) | OAuth token issued; STK push accepted ("Success. Request accepted for processing", with a real checkoutRequestId); three status polls reported pending |
| **Not verified** | Safaricom delivering the callback. The dev network blocked the tunnel, so `/sync` polling is the fallback path. |

---
## SECTION 4 — REACT FRONTEND (`apps/web/src/`)

### File inventory (36 source files, 5,344 lines)

| Area | Files |
|---|---|
| Shell | `main.tsx` (13), `App.tsx` (118), `index.css` (56), `types.ts` (314), `vite-env.d.ts` (12) |
| Hooks | `hooks/useAuth.tsx` (76), `hooks/useApi.ts` (51), `hooks/useDebounced.ts` (13) |
| Lib | `lib/api.ts` (129), `lib/supabase.ts` (44), `lib/format.ts` (66) |
| Components | `Layout.tsx` (119), `ui.tsx` (298), `Button.tsx` (73), `Toast.tsx` (109), `ErrorBoundary.tsx` (50), `GigCard.tsx` (62), `SkillsInput.tsx` (108), `FundEscrow.tsx` (152), `ReviewSection.tsx` (202) |
| Pages | `Landing` (20), `SignIn` (48), `SignUp` (63), `Dashboard` (175), `GigFeed` (183), `GigDetail` (528), `CreateGig` (276), `MyGigs` (136), `MyApplications` (126), `AIMatches` (219), `Escrow` (289), `Profile` (226), `PublicProfile` (94) |
| Admin pages | `admin/AdminDashboard` (164), `admin/AdminUsers` (196), `admin/AdminGigs` (171), `admin/AdminEscrow` (365) |
| Other | `index.html`, `tailwind.config.js`, `postcss.config.js`, `vite.config.ts`, `tsconfig.json` |

### 4A. App shell

**`main.tsx`** renders `<React.StrictMode><BrowserRouter><App/></BrowserRouter></React.StrictMode>` into `#root` and imports `index.css`.

**`App.tsx` provider stack:** `AuthProvider` → `ToastProvider` → `ErrorBoundary` → `Routes`.

**Code splitting.** Landing, SignIn, SignUp and Layout are eager imports. The 14 pages behind sign-in are loaded with `React.lazy`, each wrapped in `<Lazy>`, which is `<Suspense fallback={<LoadingBlock/>}>`.

**Route table:**

| Path | Element | Guard |
|---|---|---|
| `/` | `Landing` | public |
| `/signin` | `SignIn` | public |
| `/signup` | `SignUp` | public |
| `/app` | `Layout` (renders `<Outlet/>`) | **ProtectedRoute** |
| `/app` (index) | `Dashboard` | Protected |
| `/app/gigs` | `GigFeed` | Protected |
| `/app/gigs/create` | `CreateGig` (declared before `:id`) | Protected (the API enforces employer) |
| `/app/gigs/:id` | `GigDetail` | Protected |
| `/app/my-gigs` | `MyGigs` | Protected |
| `/app/applications` | `MyApplications` | Protected |
| `/app/matches` | `AIMatches` | Protected (the API enforces worker) |
| `/app/escrow` | `EscrowPage` | Protected |
| `/app/profile` | `Profile` | Protected |
| `/app/users/:id` | `PublicProfile` | Protected |
| `/app/admin` | `AdminDashboard` | Protected + **AdminRoute** |
| `/app/admin/users` | `AdminUsers` | Protected + AdminRoute |
| `/app/admin/gigs` | `AdminGigs` | Protected + AdminRoute |
| `/app/admin/escrow` | `AdminEscrow` | Protected + AdminRoute |
| `*` | `<Navigate to="/" replace/>` | — |

**`ProtectedRoute`:**

- While `loading` is true, it shows a full-screen `LoadingBlock` with the label "Signing you in…".
- If there is no `user`, it renders `<Navigate to="/signin" replace/>`.
- Otherwise it renders the children.

**`AdminRoute`.** If `user.user_metadata.role !== 'admin'`, it renders `<Navigate to="/app" replace/>`. The code comment says plainly that this is **convenience, not security**: `user_metadata` can be edited by the user, and the real boundary is the gateway's `resolveRole`.

**`index.css`:**

- `@tailwind base; @tailwind components; @tailwind utilities;`
- Base layer: `font-variant-numeric: tabular-nums` on `:root`; `body` uses `font-sans` and `optimizeLegibility`; `h1–h3` get `tracking-tight` and `text-wrap: balance`; a global `:focus-visible` ring (`ring-ayira-500`); a `prefers-reduced-motion` override that sets animations and transitions to 0.01 ms.
- Components layer: `.skeleton` with a shimmer sweep (`::after`, 1.6 s infinite).

**`index.html`:**

- Title "Ayira — AI-Powered Gig Platform"
- `theme-color #1d4ed8`
- Meta description "Ayira matches Kenya's youth workforce to gigs that fit their skills."
- Google Fonts preconnect and stylesheet
- `<body class="bg-slate-50 text-slate-900 antialiased">`
- The favicon `/ayira-icon.svg` is referenced, but **there is no `public/` folder**, so the favicon will 404.

### 4B. Auth system (`hooks/useAuth.tsx`)

**`AuthContextType`:**

| Member | Type |
|---|---|
| `user` | `User \| null` (Supabase) |
| `session` | `Session \| null` |
| `loading` | `boolean` (initially `true`) |
| `signIn(email, password)` | `Promise<void>` |
| `signUp(email, password, metadata: Record<string,string>)` | `Promise<void>` |
| `signOut()` | `Promise<void>` |

**`AuthProvider`:**

1. On mount it calls `supabase.auth.getSession()`, then sets the session and user. `.catch` logs "Could not restore session:" and sets both to null, so an unreachable Supabase does not leave the app stuck loading. `.finally` sets `loading` to false.
2. `supabase.auth.onAuthStateChange((_event, session) => { setSession(session); setUser(session?.user ?? null) })`.
3. Cleanup: `subscription.unsubscribe()`.

**Methods. All three call Supabase Auth directly from the browser, not the gateway:**

- `signIn`: `supabase.auth.signInWithPassword({ email, password })`. Throws the Supabase error.
- `signUp`: `supabase.auth.signUp({ email, password, options: { data: metadata } })`. SignUp.tsx passes `{ full_name, phone, role }`. The `on_auth_user_created` trigger creates the `public.users` row from this metadata, and anything other than worker or employer becomes worker. Whether the user is signed in immediately depends on the Supabase project's "Confirm email" setting, which **is not in the repository**.
- `signOut`: `supabase.auth.signOut()`. Throws on error.

`useAuth()` throws "useAuth must be used within AuthProvider" outside the provider.

**Where the role is read in the UI.** `Layout`, `Dashboard`, `GigDetail` and `AdminRoute` read `user.user_metadata.role`. The default is `'worker'`.

### 4C. API client (`lib/api.ts`)

| Element | Detail |
|---|---|
| `resolveApiBase()` | If `VITE_API_URL` is unset → `'/api'` (dev, through the Vite proxy). Otherwise strips the trailing `/` and any `/api`, then appends `/api`. Callers pass bare paths such as `/gigs`. |
| `getAuthHeaders()` | `supabase.auth.getSession()` → `{ 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token }`. The Authorization header is left out when there is no session. |
| `apiFetch<T>(path, options = {}): Promise<T>` | Sends the request. **On a 401** it calls `refreshSession()`. If the refresh succeeds it retries once; if it fails it calls `supabase.auth.signOut()` and throws `ApiError('Your session has expired. Please sign in again.', 401)`. A 204 returns `undefined`. A non-OK response throws `ApiError(body.error \|\| 'Request failed (status)', status, body.details)`. OK responses return `body.data`, unwrapping the envelope. |
| `send()` | `fetch(API_BASE + path, { ...options, headers: { ...auth, ...options.headers } })`. A network failure throws `ApiError('Could not reach the server. Check your connection.', 0)`. |
| `refreshSession()` | Shares one in-flight promise (`refreshInFlight`), so several simultaneous 401s spend the refresh token only once |
| `class ApiError extends Error` | `status: number`, `details?: unknown`, `name = 'ApiError'` |
| `toQueryString(params)` | `URLSearchParams`, dropping `undefined` and `''`. Returns `'?…'` or `''`. |

**`hooks/useApi<T>(path | null)`** returns `{ data, loading, error, refetch }`. `path` acts as the cache key; `null` skips the request. An `active` flag stops a slow earlier response from overwriting a newer one, and `refetch` increments a reload token.

**`hooks/useDebounced(value, delay = 300)`** returns the value once it has stopped changing for `delay` ms.

### 4D. Supabase client (`lib/supabase.ts`)

- Reads **`import.meta.env.VITE_SUPABASE_URL`** and **`VITE_SUPABASE_ANON_KEY`**.
- If either is missing, it writes a "Configuration missing" explanation straight into `document.body` (React never mounts) and throws.
- Creates the client with `createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })`.
- `vite-env.d.ts` also declares the optional `VITE_API_URL`.
- `vite.config.ts` sets `envDir` to the monorepo root, so the single root `.env` is used.

### 4E. Layout component (`components/Layout.tsx`)

- **Header** (sticky, white, bottom border): the "Ayira" brand link to `/app` (`text-ayira-700`, bold); a desktop nav (`md:flex`); a **role badge** (the role as capitalised text, hidden below the `sm` breakpoint); and a **sign-out** button (the `LogOut` icon, `aria-label="Sign out"`), which calls `signOut()` and then `navigate('/')`.
- **Navigation is chosen by role:** `admin` → ADMIN_NAV, `employer` → EMPLOYER_NAV, anything else → WORKER_NAV.

| Worker | Employer | Admin |
|---|---|---|
| Home `/app` (`Home`) | Home `/app` (`Home`) | Overview `/app/admin` (`ShieldCheck`) |
| Gigs `/app/gigs` (`Briefcase`) | Gigs `/app/gigs` (`Briefcase`) | Accounts `/app/admin/users` (`Users`) |
| Matches `/app/matches` (`Sparkles`) | My gigs `/app/my-gigs` (`LayoutList`) | Gigs `/app/admin/gigs` (`LayoutList`) |
| Applied `/app/applications` (`FileText`) | Post `/app/gigs/create` (`Plus`) | Payments `/app/admin/escrow` (`Wallet`) |
| Payments `/app/escrow` (`Wallet`) | Payments `/app/escrow` (`Wallet`) | Profile `/app/profile` (`User`) |
| Profile `/app/profile` (`User`) | Profile `/app/profile` (`User`) | |

- `NavLink` `end` is set on the Home/Overview items. The active style is `bg-ayira-50 text-ayira-700`.
- **Main:** `<main className="mx-auto w-full max-w-5xl flex-1 p-4 pb-20 md:pb-4"><Outlet/></main>`.
- **Mobile bottom nav** (`md:hidden`, fixed to the bottom): the same items, each as a 20 px icon above its label. Active = `text-ayira-600`.

### Shared components

| Component | Purpose |
|---|---|
| `ui.tsx` | `GigStatusBadge`, `ApplicationStatusBadge` and `EscrowStatusBadge` (colour-coded; money states use gold; labels such as "In progress", "Awaiting payment" and "Partly released"); `Tag`, `Card` (optionally interactive), `SectionHeading`, `Spinner`, `LoadingBlock`, `SkeletonList`, `ErrorMessage` (with "Try again"), `SuccessMessage`, `EmptyState`, `Avatar` (falls back to initials), `Pagination` (Previous / Page x of y / Next), `usePageTitle(title)` (sets `document.title = "<title> · Ayira"`) |
| `Button.tsx` | `Button` and `ButtonLink`. Variants: primary, secondary, ghost, danger, **money** (gold, used only for actions that move money). Sizes sm and md. A `loading` spinner. |
| `Toast.tsx` | `ToastProvider` and `useToast()` → `{ success, error, info }`. At most 3 toasts at once. Lifetimes: success 3.5 s, error 7 s, info 4.5 s. `role="status" aria-live="polite"`. |
| `ErrorBoundary.tsx` | Class component. On a render crash it shows "Something went wrong" with a "Reload page" button. |
| `GigCard.tsx` | Gig summary link card: title, category, budget range, two-line description, up to 5 skills (+N more), employer avatar and name, Remote/location, deadline ("Due in x days", or "Deadline passed" in red) |
| `SkillsInput.tsx` | Tag input. Enter or comma adds a skill; Backspace removes the last. Case-insensitive de-duplication. A `max` limit (20 by default, 30 on the profile). Up to 12 suggestion chips from `skill_categories`. |
| `FundEscrow.tsx` | Employer escrow form: amount (pre-filled with the worker's proposed amount) and an optional M-Pesa number. `POST /escrow/fund`. Then shows "Check your phone… Enter your PIN" with a link to the payments page. |
| `ReviewSection.tsx` | On a completed gig: lists the reviews (`GET /reviews?gig_id`). If `GET /reviews/pending` shows this viewer still owes a review, it shows a 1–5 star picker and an optional comment (≤ 1,000), posted with `POST /reviews`. Exports `Stars`. |

### 4F. Every page component

#### `Landing` (`pages/Landing.tsx`)

- **Renders:** a full-screen gradient (`from-ayira-50 to-white`) with the heading "Ayira", the tagline "AI-powered gig platform connecting Africa's youth workforce with opportunities", and two links: **Get Started** → `/signup` and **Sign In** → `/signin`.
- **State:** none. **API calls:** none.

#### `SignIn` (`pages/SignIn.tsx`)

- **State:** `email`, `password`, `error`, `loading`.
- **Fields:** email (`type="email"`, required) and password (required). Validation is the browser's HTML5 checks only.
- **Submit:** `signIn(email, password)` from `useAuth`, which is **Supabase directly**. On success it calls `navigate('/app')`. On error it shows `err.message` in red. While loading, the button reads "Signing in...".
- **Link:** "No account? Sign up".

#### `SignUp` (`pages/SignUp.tsx`)

- **State:** `form = { email, password, fullName, phone, role: 'worker' }`, `error`, `loading`.
- **Fields:**
  - Full Name (required)
  - Email (`type="email"`, required)
  - Phone (`type="tel"`, placeholder "+254...", required)
  - Password (required, `minLength={8}`)
  - Role `<select>`: "I'm looking for gigs (Worker)" or "I'm hiring (Employer)"
- **Submit:** `signUp(email, password, { full_name, phone, role })` → `navigate('/app')`. Errors are shown inline.
- There is no client-side check of phone length; the gateway's `min(10)` rule applies only to `/api/auth/signup`, which this page does not use.

#### `Dashboard` (`pages/Dashboard.tsx`)

- **API:** `GET /workers/dashboard/stats` and `GET /reviews/pending`.
- **Renders:**
  - "Welcome, {full_name}" and "Your {role} dashboard"
  - A **PendingReviews** banner (gold) listing up to 4 completed gigs awaiting a review, with links. Hidden when there are none.
  - Stat cards:
    - **Worker:** Applications, Active gigs, Completed, Rating (2 dp, with the review count), Earned (KES)
    - **Employer:** Gigs posted, Open gigs, In progress, Applicants, In escrow (with "x paid out")
  - **Quick actions:**
    - Employer: "Post a gig" and "My gigs"
    - Worker: "Find AI matches" and "Browse gigs"
- **States:** a skeleton while loading; an error with retry.

#### `GigFeed` (`pages/GigFeed.tsx`)

- **State:** `search`, `category`, `location`, `remoteOnly`, `page`, `showFilters`. Search and location are debounced by 350 ms. Any filter change resets `page` to 1.
- **API:** `GET /gigs/meta/categories` for the category options, and `GET /gigs?status=open&search&category&location&is_remote&page&limit=20`.
- **Renders:**
  - The heading "Browse gigs" and an **AI Match** button → `/app/matches`
  - A search box ("Search gigs by title or description", which uses the full-text index)
  - A Filters toggle that reveals the category select, the location text box and a "Remote only" checkbox
  - "N gigs found", a list of `GigCard`s, and `Pagination`
  - The empty state says "No gigs found", with different text depending on whether filters are active

#### `GigDetail` (`pages/GigDetail.tsx`), the main workflow page

- **API:** `GET /gigs/:id` and `GET /applications?gig_id=:id&limit=100`.
- **State:** `actionError`, `busyId`. `ApplyForm` keeps its own `coverLetter`, `amount`, `submitting`, `error` and `submitted`.
- **Renders:**
  - A header card: status badge, category, title, budget, location or Remote, deadline (red when past), applicant count (owner only), description, required-skill tags
  - A "Posted by" card: employer avatar, name with a verified badge, number of gigs posted, location
- **Role-dependent sections:**

| Viewer / state | Section | Action → API |
|---|---|---|
| Owner, draft | Publish gig | `PATCH /gigs/:id/publish` |
| Owner, draft or open | Cancel gig | `DELETE /gigs/:id` → navigate to `/app/my-gigs` |
| Owner, in_progress | "Work finished?" → **Mark as complete** | `POST /gigs/:id/complete` |
| Owner, in_progress, with a hired worker | `FundEscrow` | `POST /escrow/fund` |
| Anyone, completed | `ReviewSection` | `POST /reviews` |
| Worker, already applied | "Your application": status badge, cover letter, **Withdraw** (pending or shortlisted) | `PATCH /applications/:id/status {withdrawn}` |
| Worker, gig open, not applied | `ApplyForm`: cover letter (≥ 20 characters, live counter) and proposed amount (KES > 0) → "Submit application" | `POST /applications` |
| Worker, gig not open | "This gig is no longer accepting applications." | — |
| Owner | Applicant list (`ApplicantCard`): avatar and profile link, status, "asking KES x", up to 6 skills, cover letter, and **Shortlist** / **Accept** / **Reject** while the gig is open | `PATCH /applications/:id/status`. Accept asks for confirmation: "Accepting this applicant will close the gig and reject all other applications. Continue?" |

#### `CreateGig` (`pages/CreateGig.tsx`)

- **State:** `title`, `description`, `category`, `skills[]`, `isRemote`, `location`, `budgetMin`, `budgetMax`, `deadline`, `submitting`, `error`.
- **API:** `GET /gigs/meta/categories`; `POST /gigs`; optionally `PATCH /gigs/:id/publish`.
- **Fields:**
  - Title
  - Description (with a "n/20 characters minimum" counter)
  - Category select
  - Required skills (`SkillsInput`; suggestions follow the chosen category, or all seeded skills if none is chosen)
  - "This gig can be done remotely" checkbox, plus location
  - Budget from and Budget to (KES, step 100)
  - Deadline (`type="date"`, earliest tomorrow)
- **Client-side `validate()`**, which mirrors the server's rules:
  - title ≥ 5
  - description ≥ 20
  - a category is chosen
  - a location is required unless the gig is remote
  - min > 0, max > 0, max ≥ min
  - a deadline is chosen and is in the future
- **Buttons:**
  - **Publish gig** creates the gig, then publishes it.
  - **Save draft** creates it only.
  - The deadline is sent as `${date}T23:59:59` converted to ISO.
  - Both then navigate to `/app/gigs/:id`.

#### `MyGigs` (`pages/MyGigs.tsx`)

- **State:** `status` (default `open`), `page`.
- **API:** `GET /gigs?employer_id=me&status&page&limit=20`.
- **Renders:** "My gigs" with a "Post gig" button; tabs Open / Drafts / In progress / Completed / Cancelled; cards showing title, category, "posted x ago", status badge, budget, location, and applicant count; pagination; an empty state with "Post your first gig".

#### `MyApplications` (`pages/MyApplications.tsx`)

- **State:** `status` ('' = All), `page`.
- **API:** `GET /applications?status&page&limit=20`.
- **Renders:** tabs All / Pending / Shortlisted / Accepted / Rejected / Withdrawn; cards showing gig title, employer, "applied x ago", status badge, and "You asked for KES x"; an empty state with "Browse gigs".

#### `AIMatches` (`pages/AIMatches.tsx`)

- **State:** `matches` (null before the first run), `generatedAt`, `loading`, `error`.
- **API:** `POST /match` with `{ limit: 10 }`.
- **Renders:**
  - The heading "AI matches" and "Open gigs ranked against your skills, bio, location and reputation."
  - A **Find matches** / **Refresh matches** button and "Updated x ago"
  - While loading: "Scoring open gigs… The first run can take up to a minute while the matching model loads."
  - Before the first run, an empty state "No matches yet" with "Update profile"
  - With zero results: "No gigs to match against"
  - Otherwise a ranked list of **MatchCard**s: rank number, title, category, employer, a "**{score_percent}% match**" pill, budget, location, skills, and a **ScoreBreakdown** ("Why this ranked here") with one bar per signal

| Signal (label) | Key | Displayed weight |
|---|---|---|
| Skills & description fit | semantic | ×0.72 |
| Keyword overlap | tfidf | ×0.22 |
| Location | location | ×0.03 |
| Employer reputation | employer_reputation (shown ÷ 5) | ×0.03 |

The weights are hard-coded in the page. A comment says they must match `scoring.py` `DEFAULT_WEIGHTS`. They do match now; they had previously drifted.

#### `EscrowPage` (`pages/Escrow.tsx`)

- **State:** `status` tab, `page`, `busyId`.
- **API:** `GET /escrow?status&page&limit=20`. Actions call `POST /escrow/:id/{release|dispute|cancel|sync}`.
- **Renders:**
  - "Payments" heading
  - A gold warning if `mpesa_configured === false`
  - A "Currently held in escrow" total, summed over funded rows **on the current page**
  - Tabs All / Awaiting payment / Held / Released / Disputed
  - A card per escrow: status badge, "You are paying" or "You are being paid", gig link, the other party, "Opened x ago", receipt, amount
- **Actions by state:**

| Status | Employer | Worker |
|---|---|---|
| pending | **Check payment** (sync), **Cancel** | "Waiting for the employer to complete payment." |
| funded | **Release payment** (confirm: "Release KES x to {worker}? This cannot be undone."), **Raise a dispute** | **Raise a dispute** |
| released | "Paid x ago." | same |
| disputed | "Under review by an administrator." | same |

- Dispute uses `window.prompt` for the reason (≥ 10 characters).
- Toasts confirm each action.

#### `Profile` (`pages/Profile.tsx`)

- **API:** `GET /workers/profile`, `GET /gigs/meta/categories` (skill suggestions), `PATCH /workers/profile`.
- **State:** `fullName`, `phone`, `bio`, `location`, `skills[]`, `saving`, `saveError`, `saved`. The form is filled in once the profile arrives.
- **Renders:**
  - An avatar, the name with a verified badge, and "{role} · rating x.xx"
  - A "Public view" link
  - Fields:
    - Full name
    - Email (disabled, "managed by your sign-in account")
    - Phone
    - Location (hint: "Matching gives a small boost to gigs in your location.")
    - Bio (≤ 500, with a counter)
    - Skills (`SkillsInput`, max 30, hint: "Your skills and bio are what the AI matcher scores gigs against.")
- **Validation:** name ≥ 2; phone ≥ 10 if given; bio ≤ 500.
- **Save changes** shows a success or error message.

#### `PublicProfile` (`pages/PublicProfile.tsx`)

- **API:** `GET /workers/profile/:id`.
- **Renders:** avatar, name with verified badge, role, location, "Member since"; a three-column stat strip (Rating, Reviews, Completed); an About section (bio); a Skills section.

#### `AdminDashboard` (`pages/admin/AdminDashboard.tsx`)

- **API:** `GET /admin/dashboard`.
- **Renders three sections of stat cards:**
  - **People:** Total accounts, Workers, Employers. Each links to a filtered `/app/admin/users`.
  - **Work:** Total gigs, Open, In progress, Applications.
  - **Money** (gold): Held in escrow, Released to workers, Platform revenue ("No commission is charged yet").

#### `AdminUsers` (`pages/admin/AdminUsers.tsx`)

- **State:** the `role` comes from the URL search params; also `search` (debounced 300 ms), `page`, and `pending` (the row being updated).
- **API:** `GET /admin/users?role&search&page&limit=20`; `PATCH /admin/users/:id/verify { is_verified }`.
- **Renders:** role tabs All / Workers / Employers / Admins; a search box ("Search by name or email"); a table (stacked rows on mobile) with Account (avatar, name, email), Role, Location, Joined, and a **Verify / Verified** toggle button.

#### `AdminGigs` (`pages/admin/AdminGigs.tsx`)

- **API:** `GET /admin/gigs?status&search&page&limit=20`.
- **Renders:** status tabs All / Open / In progress / Completed / Drafts / Cancelled; a search box; cards showing title, "Posted by {employer}", status badge, budget, location and category.
- **There is no cancel/moderate action**, even though `POST /admin/gigs/:id/cancel` exists.

#### `AdminEscrow` (`pages/admin/AdminEscrow.tsx`)

- **State:** `status` from the URL (default **disputed**), `page`, `openId` (the expanded card). `EscrowDetail` keeps its own `outcome`, `reason` and `busy`.
- **API:** `GET /admin/escrow`, `GET /admin/escrow/:id`, `POST /admin/escrow/:id/resolve`.
- **Renders:**
  - A banner "N disputes waiting on a decision. The money stays frozen until you settle it."
  - Tabs Disputes (with a count badge) / All / Awaiting payment / Funded / Released / Refunded / Cancelled
  - A card per escrow: gig, amount, status, employer, worker, M-Pesa receipt, "View history" / "Review and settle"
  - The expanded view shows the event history (from → to, by actor, when, detail)
  - For a disputed escrow it adds **Settle this dispute**: choose "Release to worker" or "Refund employer", give a reason (≥ 10 characters), then **Settle**

### 4G. Tailwind configuration (`tailwind.config.js`)

- **Content paths:** `['./index.html', './src/**/*.{js,ts,jsx,tsx}']`
- **Fonts:** `sans: ["Plus Jakarta Sans", system-ui, -apple-system, Segoe UI, sans-serif]`; `mono: ["JetBrains Mono", ui-monospace, Consolas, monospace]`.

**Custom colours:**

| Shade | `ayira` (primary) | `slate` (neutral, slight blue tint; overrides Tailwind's slate) | `gold` (money only) |
|---|---|---|---|
| 50 | #f0f7ff | #f7f9fc | #fffaeb |
| 100 | #e0effe | #eef2f8 | #fef0c7 |
| 200 | #bae0fd | #dfe5f0 | — |
| 300 | #7cc8fb | #c5cfe0 | — |
| 400 | #36acf7 | #94a2bb | #fbbf24 |
| 500 | #3b82f6 | #64748b | #f59e0b |
| 600 | #2563eb | #4a5771 | #d97706 |
| 700 | #1d4ed8 | #36415a | #b45309 |
| 800 | #1e40af | #232c42 | — |
| 900 | #1e3a5f | #141b2d | — |

**Other extensions:**

- **boxShadow:**
  - `card`: `0 1px 2px 0 rgb(20 27 45/.04), 0 1px 3px 0 rgb(20 27 45/.06)`
  - `lift`: `0 4px 12px -2px …/.10, 0 2px 6px -2px …/.06`
  - `pop`: `0 12px 32px -8px …/.18`
- **borderRadius:** `xl: 0.875rem`
- **keyframes:** `slide-up` (opacity 0 → 1, translateY 8 px → 0) and `shimmer` (translateX → 100%)
- **animation:** `slide-up 160ms ease-out`
- **Plugins:** none

One class uses a gold shade the palette does not define: `border-gold-200` on the Dashboard pending-reviews banner (`Dashboard.tsx:147`). Tailwind silently generates nothing for it, so the border falls back to the default colour.

### 4H. Vite configuration (`vite.config.ts`)

| Setting | Value |
|---|---|
| Plugins | `react()` from `@vitejs/plugin-react` |
| `envDir` | `path.resolve(__dirname, '../..')`, the monorepo root, so the single `.env` supplies the `VITE_*` variables |
| Path alias | `'@'` → `./src` (mirrored in `tsconfig.json`: `"paths": { "@/*": ["src/*"] }`) |
| Dev server | `port: 5173`, **`proxy: { '/api': 'http://localhost:3001' }`** |
| Build | `rollupOptions.output.manualChunks = { react: ['react','react-dom','react-router-dom'], supabase: ['@supabase/supabase-js'] }` |
| Scripts | `dev: vite`, `build: tsc -b && vite build`, `preview: vite preview` |

`tsconfig.json` (web): extends the base config, `jsx: react-jsx`, `outDir: dist`, `baseUrl: .`, includes `src`.

---
## SECTION 5 — AI MATCHING ENGINE (`apps/ai-engine/`)

### File inventory (serving code)

| File | Lines | Role |
|---|---|---|
| `app/main.py` | 16 | FastAPI app, CORS, routers |
| `app/config.py` | 40 | `Settings` (pydantic-settings) |
| `app/security.py` | 37 | `require_api_key` dependency (`X-Ayira-Key`) |
| `app/models/schemas.py` | 15 | `MatchRequest`, `GigScore`, `MatchResponse` |
| `app/routers/health.py` | 7 | `GET /health` |
| `app/routers/matching.py` | 28 | `POST /ai/match` |
| `app/services/embeddings.py` | 79 | Model loading, semantic and TF-IDF similarity |
| `app/services/scoring.py` | 345 | **The composite formula**, location tiers, employer reputation, text builders, `score_gigs()` |
| `app/services/tfidf_model.py` | 160 | Fitted TF-IDF artefact: fit, save, load, serve |
| `app/services/embedding_store.py` | 129 | pgvector cache: hashing, (de)serialising, refresh gig embeddings, worker embedding |
| `app/services/kenya_geography.py` | 164 | Town → county map, Nairobi metropolitan grouping |
| `app/services/matcher.py` | 151 | `match_worker_to_gigs()`: the live pipeline |
| `artifacts/tfidf_vectorizer.joblib` + `deployed.json` | — | The TF-IDF artefact being served, and its provenance |

### 5A. FastAPI app (`app/main.py`)

- `app = FastAPI(title="Ayira AI Engine", version="0.1.0")`
- **CORS:** `allow_origins=["http://localhost:5173", "http://localhost:3001"]`, `allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]`.
- **Routers:**
  - `health.router` (tag "health"), no prefix
  - `matching.router` with prefix **`/ai`** (tag "matching")
- Run with `uvicorn app.main:app --reload --port 8001` (root `dev:ai` script), or in Docker with `--host 0.0.0.0 --port 8001`.

### 5B. Configuration (`app/config.py`)

`ENV_FILE = Path(__file__).resolve().parents[3] / ".env"`, the monorepo root, resolved from the file's own location rather than the working directory.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `supabase_url` | str | `""` | Supabase project URL |
| `supabase_service_role_key` | str | `""` | Service-role key. The engine bypasses RLS. |
| `model_name` | str | `"all-MiniLM-L6-v2"` | Sentence-Transformers model |
| `api_port` | int | `8001` | Declared. Uvicorn's CLI flag sets the port in practice. |
| `ai_engine_secret` | str | `""` | Shared secret with the gateway. **Empty means every match request is refused with 503.** |

`model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore", protected_namespaces=())`:

- `extra="ignore"` because the shared `.env` holds DARAJA, AT, FCM and VITE keys. Without it the engine crashed on startup.
- `protected_namespaces=()` stops the `model_` prefix warning.

Weights can also be overridden **without a deploy**, through the environment variables `MATCH_WEIGHT_SEMANTIC`, `MATCH_WEIGHT_TFIDF`, `MATCH_WEIGHT_LOCATION` and `MATCH_WEIGHT_REPUTATION` (`scoring._weights_from_env()`).

### 5C. Data models (`app/models/schemas.py`)

```python
class MatchRequest(BaseModel):
    worker_id: str
    limit: int = 10          # no bound in the engine; the gateway restricts it to 1–50

class GigScore(BaseModel):
    gig_id: str
    title: str
    score: float             # composite 0–1, rounded to 4 dp
    breakdown: dict          # {"semantic": 4dp, "tfidf": 4dp, "location": 2dp, "employer_reputation": 2dp (0–5)}

class MatchResponse(BaseModel):
    worker_id: str
    matches: list[GigScore]
```

### 5D. Similarity functions (`app/services/embeddings.py`) and the composite (`app/services/scoring.py`)

**`get_model() -> SentenceTransformer`.** A module-level global `_model = None`. On the first call it constructs `SentenceTransformer(settings.model_name)`, i.e. **`all-MiniLM-L6-v2`**, and reuses it afterwards. This is lazy loading: the cold-start cost is paid on the first request, not at import.

**`compute_semantic_similarities(query, documents) -> list[float]`.** Used by the evaluation, and by the live path only when cached vectors are not supplied.

1. Empty `documents` → `[]`. A query that is only whitespace → `[0.0]*n`.
2. `embeddings = model.encode([query] + documents)`, a **single batch**.
3. `sims = cosine_similarity([embeddings[0]], embeddings[1:])[0]`
4. Each value is clamped to [0, 1].

`compute_semantic_similarity(a, b)` is the single-pair wrapper.

**`compute_tfidf_similarities(query, documents)`.** This is the **fallback**, used only when no fitted artefact exists.

1. `TfidfVectorizer(stop_words="english")`, then `fit_transform([query] + documents)`, fitted over the candidates being scored.
2. `ValueError` (empty vocabulary) → `[0.0]*n`.
3. `cosine_similarity(matrix[0:1], matrix[1:])[0]`, then clamp.

**The fitted TF-IDF path (`tfidf_model.py`)**, used by both live serving and the evaluation:

- `fit(documents)`: `TfidfVectorizer(stop_words="english", min_df=1, sublinear_tf=True).fit(documents)`, **on training-split documents only**.
- `save` / `load`: joblib payload `{"version": ARTEFACT_VERSION (=1), "vectorizer": …}`. A missing, corrupt or wrong-version file → `None`.
- `similarities(vectorizer, query, documents)`: **`transform()` only, never refit.** `cosine_similarity`, then clamp. Terms outside the vocabulary contribute 0.
- `load_serving()`: loads `artifacts/tfidf_vectorizer.joblib` once per process. If it is missing, it logs a warning ("falling back to fitting per request, which is not reproducible") and returns `None`.
- The deployed artefact (`deployed.json`): run `20261019T062532Z__baselines-validation__4c3f4c4`, commit `4c3f4c4` (clean tree), dataset `6ac4675ae766`, `fitted_on: "train"`, deployed 2026-10-19T06:25:55Z. Vocabulary: 1,160 terms.

**Text representations (`scoring.py`):**

```python
profile_text(worker) = " ".join(skills) + " " + bio            # empty parts dropped, stripped
gig_text(gig)        = title + " " + " ".join(required_skills) + " " + description
```

**`location_affinity(worker_location, gig) -> float`.** Tiered, in this order:

| Condition | Score | Constant |
|---|---|---|
| `gig.is_remote` | **1.0** | SAME_TOWN |
| Worker or gig location missing | **0.3** | UNKNOWN_LOCATION |
| Same town (case-insensitive, trimmed) | **1.0** | SAME_TOWN |
| Either town not in the map (county unknown) | **0.3** | UNKNOWN_LOCATION |
| Same county | **0.6** | SAME_COUNTY |
| Different counties in the same metro area (Nairobi Metropolitan: Nairobi, Kiambu, Kajiado, Machakos, Murang'a) | **0.45** | SAME_METRO |
| Different counties, no shared metro | **0.0** | DIFFERENT_COUNTY |

`kenya_geography.TOWN_COUNTY` maps 34 lower-case town names to 22 counties. For example: nairobi → Nairobi; thika, ruiru, kikuyu, limuru, juja → Kiambu; mombasa → Mombasa; kisumu, ahero → Kisumu; eldoret → Uasin Gishu.

`county_of()` also resolves values like "Ruiru, Kiambu" (comma-separated parts, rightmost first) and plain county names. The source given is the 47 counties in the First Schedule of the Constitution of Kenya 2010 and the NaMATA definition of the metro area.

`is_location_match()` and `ScoredGig.location_match` mean affinity ≥ 0.6. They are kept for display only; the ranking uses the affinity.

**`employer_reputation(gig) -> float`** (0–5 scale):

```
raw = gig.employer_reputation              (from nearest_open_gigs; = employer's users.reputation_score)
if raw is None                → 3.0        NEUTRAL_REPUTATION
if employer_review_count <= 0 → 3.0
if raw <= 0                   → 3.0
else                          → min(raw, 5.0)
```

**`composite_score(semantic, tfidf, location, reputation, weights=DEFAULT_WEIGHTS)`:**

```python
loc = min(max(location, 0.0), 1.0)
rep = min(max(reputation, 0.0) / 5.0, 1.0)
return w.semantic*semantic + w.tfidf*tfidf + w.location*loc + w.reputation*rep
```

**The formula as written for the chapter:**

$$
S(w,g) = 0.72\,\mathrm{sim}_{\text{sem}}(w,g) + 0.22\,\mathrm{sim}_{\text{tfidf}}(w,g) + 0.03\,A_{\text{loc}}(w,g) + 0.03\,\min\!\left(\frac{R_{\text{emp}}(g)}{5},\,1\right)
$$

where:

- $\mathrm{sim}_{\text{sem}} = \max(0, \min(1,\ 1 - d_{\cos}(\mathbf{e}_w, \mathbf{e}_g)))$. Here $\mathbf{e}$ are the 384-dimensional normalised MiniLM embeddings, and $d_{\cos}$ is pgvector's `<=>` cosine distance. Because the vectors are normalised, this equals the clamped cosine similarity.
- $\mathrm{sim}_{\text{tfidf}}$ = clamped cosine similarity of the TF-IDF vectors from the training-fitted vectoriser (sublinear tf, English stop words).
- $A_{\text{loc}} \in \{1.0, 0.6, 0.45, 0.3, 0.0\}$ is the tiered location affinity.
- $R_{\text{emp}}(g)$ is the posting employer's mean review rating on the 1–5 scale, or **3.0** if the employer is unreviewed.
- The weights sum to 1, so $S \in [0,1]$. It is rounded to 4 dp, and the UI shows $\text{round}(100S)$ % as "% match".

**What each weight represents** (from the `Weights` docstring):

| Weight | Value | Status |
|---|---|---|
| semantic | **0.72** | *Measured.* Chosen by grid search on train, confirmed on validation. Removing it costs about 0.12 NDCG@10 (ablation). |
| tfidf | **0.22** | *Measured.* Adds about 0.011–0.016 NDCG@10 on top of semantic. |
| location | **0.03** | *Product prior, not a measurement.* The labels cannot judge location (r = −0.024 with the grades), so the tuner holds it fixed. |
| reputation | **0.03** | *Product prior.* r = −0.039 with the grades, held fixed. The earlier 0.15 cost 0.035 NDCG@10. |

`SHIPPED_WEIGHTS = Weights(0.45, 0.25, 0.15, 0.15)` is kept only so that the evaluation can report the change from the original configuration.

**`score_gigs(worker, gigs, weights, semantic_scores=None, vectorizer=None) -> list[ScoredGig]`:**

1. No gigs → `[]`.
2. Builds `profile_text(worker)`, `worker_location` and `texts = [gig_text(g) for g in gigs]`.
3. Semantic: uses the supplied `semantic_scores` (live path) or computes them (evaluation). A length mismatch raises `ValueError`.
4. TF-IDF: `tfidf_model.similarities(vectorizer, …)` if a vectoriser is supplied, else the per-request fallback.
5. For each gig: affinity and reputation are computed once, then the composite is rounded to 4 dp, giving a `ScoredGig(gig_id, title, score, semantic, tfidf, location_affinity, employer_reputation)`.
6. Sorted by score, descending.

`ScoredGig.breakdown()` returns `{semantic: 4dp, tfidf: 4dp, location: 2dp, employer_reputation: 2dp}`.

### 5E. Matcher service (`app/services/matcher.py`)

**`get_supabase()`** is decorated with `@lru_cache(maxsize=1)`, giving one `create_client(settings.supabase_url, settings.supabase_service_role_key)` per process.

**Constants:**

- `WORKER_COLUMNS = "id, skills, bio, location, reputation_score, embedding, embedding_hash"`
- `CANDIDATE_POOL = 200`
- `EMBED_BATCH = 100`
- `BACKFILL_CHECK_INTERVAL = 30.0` seconds

**`async match_worker_to_gigs(worker_id, limit=10) -> list[GigScore]`, step by step:**

| Step | What happens | Code |
|---|---|---|
| 1. Fetch the worker | `sb.table("users").select(WORKER_COLUMNS).eq("id", worker_id).limit(1)`. No row → `[]`. | lines 99-109 |
| 2. Backfill gig embeddings | `_backfill_embeddings(sb)`. At most once every 30 s: `rpc("gigs_needing_embedding", {p_limit: 100})`, then `refresh_gig_embeddings()` hashes `gig_text` for each row (`sha256(text)[:16]`). Rows whose stored `embedding_hash` differs are re-encoded in one batch (`model.encode(texts, normalize_embeddings=True)`) and written back as `embedding` + `embedding_hash`. A failure for one gig is logged and skipped. | lines 58-86, `embedding_store.py:70-102` |
| 3. Worker vector | `worker_embedding()`. If the stored `users.embedding` exists and its hash equals `text_hash(profile_text(worker))`, the cached vector is reused. Otherwise it is encoded and written back. **Editing skills or bio therefore triggers re-embedding on the next match.** | `embedding_store.py:105-129` |
| 4. Retrieve candidates | `rpc("nearest_open_gigs", {p_worker_id, p_embedding: to_pgvector(vector), p_limit: 200})`. Postgres keeps open, unexpired gigs that are not the worker's own and not already applied to, ordered by cosine distance with nulls last. Each row includes `employer_reputation` and `employer_review_count`. Empty → `[]`. | lines 117-127 |
| 5. Semantic | `semantic = [clamp(1 - distance)]`. A gig with no embedding (NULL distance) scores 0 rather than being dropped. | `_similarity_from_distance` |
| 6. Full scoring | `score_gigs(profile, gigs, semantic_scores=semantic, vectorizer=tfidf_model.load_serving())`. TF-IDF uses the deployed artefact; location and employer reputation are as in 5D. | lines 136-141 |
| 7. Rank and limit | `score_gigs` sorts descending. The engine returns `ranked[:limit]` as `GigScore(gig_id, title, score, breakdown)`. | lines 143-151 |
| 8. (Gateway) | The gateway adds the gig fields to each result, computes `score_percent`, and writes `ai_match_logs`. | `routes/matching.ts` |

**End-to-end data flow:**

```
Worker clicks "Find matches" (AIMatches.tsx)
  └─ POST /api/match {limit:10}  + Bearer JWT
       └─ authMiddleware → requireRole('worker')
            └─ POST {AI_ENGINE_URL}/ai/match {worker_id, limit}  + X-Ayira-Key  (timeout 60 s)
                 └─ require_api_key (constant-time compare)
                      └─ match_worker_to_gigs
                           ├─ users row (skills, bio, location, embedding, hash)
                           ├─ [≤ every 30 s] gigs_needing_embedding → re-embed stale gigs
                           ├─ worker vector (cache hit, or encode + store)
                           ├─ nearest_open_gigs (pgvector HNSW, top 200, SQL filters)
                           ├─ semantic = 1 − distance;  tfidf = fitted artefact
                           ├─ location tier;  employer reputation (neutral prior 3.0)
                           └─ composite → sort → top `limit`
            ◀─ {worker_id, matches:[{gig_id,title,score,breakdown}]}
       ├─ Zod-validate → hydrate gigs (one IN query) → score_percent
       └─ insert ai_match_logs (one row per match)
  ◀─ {data:{matches:[{gig, score, score_percent, breakdown}], generated_at}}
```

### 5F. Health endpoint (`app/routers/health.py`)

`GET /health` → `{"status": "ok", "service": "ayira-ai-engine"}`. **Public**; no API key is needed, so platform health checks keep working.

### 5G. Matching endpoint (`app/routers/matching.py`)

- `router = APIRouter(dependencies=[Depends(require_api_key)])`, mounted under `/ai`.
- **`POST /ai/match`**, `response_model=MatchResponse`. Body: `MatchRequest`.

| Condition | Response |
|---|---|
| `AI_ENGINE_SECRET` unset | **503** "AI_ENGINE_SECRET is not configured. Set it in .env for both the engine and the API gateway." |
| Header `X-Ayira-Key` missing or wrong (`secrets.compare_digest`) | **401** "Invalid or missing API key." |
| Body fails Pydantic validation | **422** (FastAPI default) |
| Worker not found / no candidates | **200** `{worker_id, matches: []}` |
| Any exception during matching | Logged with `logger.exception`, then **500** "Matching failed. Please try again." (internals are not exposed) |

### 5H. Requirements

`requirements.txt` (serving; installed in the Docker image):

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
pydantic==2.9.1
pydantic-settings==2.5.2
supabase==2.7.2
sentence-transformers==3.0.1
scikit-learn==1.5.1
numpy==1.26.4
httpx==0.27.2
python-dotenv==1.0.1
```

`requirements-eval.txt` = `-r requirements.txt` plus `matplotlib==3.9.2`, `joblib==1.6.0`, `contourpy==1.2.1` and `pytest==8.3.3`.

Resolved transitive versions in the dev venv: torch 2.14.0, transformers 4.57.6, pydantic_core 2.23.3.

**Deployment gap.** `apps/ai-engine/Dockerfile` copies only `app/`, **not `artifacts/`**. A container built from it has no TF-IDF artefact, so `load_serving()` logs its warning and TF-IDF falls back to per-request fitting. Offline evaluation figures would then not reproduce exactly inside Docker.

### 5I. Evaluation harness and results (`apps/ai-engine/eval/`), the evidence for the Testing section

**What is fitted.** Nothing is trained. MiniLM is used zero-shot. Only the TF-IDF vocabulary and the four weights are fitted.

**Corpus** (`eval/corpus/`, generated by `corpus_sources/build_corpus.py` from KeSCO-2022):

| Item | Count |
|---|---|
| Worker profiles | **47** (one per occupation, 5 categories) |
| Gigs | **104** (94 generated, 10 hand-authored "paraphrase" gigs that avoid the occupation's vocabulary) |
| Employers | 25 |
| Graded (worker, gig) pairs | **565** (532 rule-derived from distance in the KeSCO hierarchy, 33 hand-authored corrections). The other pairs are implicitly grade 0. |
| Grades | 3 = same unit group (ideal), 2 = same minor group (good), 1 = same sub-major group (marginal), 0 = irrelevant |
| Pay | Lognormal reproducing WorkKE's observed figures (median KES 2,000, mean KES 4,664), scaled by KeSCO skill level |
| Splits | **29 train / 9 validation / 9 test**, split **by profile** and stratified by category. Seed `20261018`. Dataset version `6ac4675ae766`. |

**Metrics** (`eval/metrics.py`):

- Precision@5 and @10, counting grade ≥ 2 as relevant
- Recall@10
- MRR, which is saturated (1.000 for every non-random strategy) and so does not discriminate
- **NDCG@10** (the headline) with gain $2^{g}-1$, and NDCG@5
- A 95% bootstrap CI over profiles
- Noise floor: differences under 0.005 NDCG.

**Validation results.** Run `20261019T062941Z__baselines-validation__b8a18c0` (9 profiles × 104 gigs). The clean-tree run `20261019T062532Z__…__4c3f4c4` reproduces the same P/R/MRR/NDCG@10 figures; the CI and NDCG@5 columns were added in the later run.

| Strategy | P@5 | P@10 | R@10 | MRR | NDCG@5 | **NDCG@10** | NDCG@10 95% CI |
|---|---|---|---|---|---|---|---|
| Random | 0.044 | 0.056 | 0.117 | 0.142 | 0.030 | 0.081 | [0.022, 0.151] |
| TF-IDF only | 0.533 | 0.300 | 0.636 | 1.000 | 0.848 | 0.812 | [0.742, 0.886] |
| Semantic only | 0.556 | 0.456 | 0.904 | 1.000 | 0.858 | 0.891 | [0.823, 0.950] |
| Composite, as first shipped (0.45/0.25/0.15/0.15) | 0.556 | 0.356 | 0.717 | 1.000 | 0.851 | 0.846 | [0.788, 0.910] |
| **Composite, current (0.72/0.22/0.03/0.03)** | **0.600** | 0.433 | 0.867 | 1.000 | **0.879** | **0.897** | [0.843, 0.949] |

**Interpretation, as recorded in `docs/EVALUATION_PROTOCOL.md`.** The composite is clearly better than random and better than TF-IDF alone. Its CI overlaps almost entirely with semantic-only, so with 9 validation profiles it is "at least as good as" the best single signal, not demonstrably better than it.

**Ablation.** Run `20261019T062120Z__ablation-validation__0298b68`; NDCG@10 on validation, with weights renormalised within each subset:

| Subset | NDCG@10 | vs full (0.8977) |
|---|---|---|
| Full | 0.8977 | — |
| Text only (semantic + tfidf) | 0.9079 | +0.0101 |
| Semantic alone | 0.8914 | −0.0063 |
| TF-IDF alone | 0.8124 | −0.0853 |
| Location alone | 0.0530 | −0.8447 |
| Reputation alone | 0.0785 | −0.8192 |
| Without semantic | 0.7753 | −0.1224 |
| Without TF-IDF | 0.8817 | −0.0160 |
| Without location | 0.9046 | +0.0069 |
| Without reputation | 0.8945 | −0.0032 |

Every row was read directly from that run's `metrics.json`. They agree with `docs/EVALUATION_PROTOCOL.md`.

**Weight tuning.** Run `20261019T062341Z__tune-weights__0298b68`. It searches a 0.05 grid on train, selects on validation, and reads test once.

- Searched signals: semantic and tfidf. Location and reputation were detected as **label-uninformative** (r = −0.024 and −0.039) and held at 0.03.
- Train: current 0.8075; best found (0.60/0.35/0.03/0.03) 0.8094.
- Validation: current 0.8977; best found 0.8965. Gain **−0.0012**, below the 0.005 margin, so **not adopted**. The incumbent weights stand.
- **Test NDCG@10 = 0.8499**, read once, with the chosen weights 0.72/0.22/0.03/0.03.

**Retrieval (shortlist) study.** Run `20261019T062445Z__retrieval-validation__0298b68`; exhaustive NDCG@10 = 0.8977.

| Shortlist size | NDCG@10 | P@5 | R@10 |
|---|---|---|---|
| 3 | 0.7547 | 0.778 | 0.535 |
| 5 | 0.7940 | 0.556 | 0.597 |
| 10 | 0.8992 | 0.600 | 0.904 |
| 15 / 20 / 30 / exhaustive | 0.8977 | 0.600 | 0.867 |

The production `CANDIDATE_POOL = 200` is larger than the 104-gig corpus, so the production setting itself has never been evaluated.

**Provenance caveat.** The manifests show that the runs behind the ablation, tuning (including the 0.8499 test figure) and retrieval numbers (`…__0298b68`) were recorded with **uncommitted changes in the tree** (`dirty: true`). The clean-tree run `…__4c3f4c4` reproduces only the baseline table. If the chapter claims that every figure is reproducible from a committed tree, re-run tuning, ablation and retrieval on a clean commit first.

**Second labelling study** (commit `edce2d7`, `data/annotation/`, `docs/ANNOTATION_GUIDE.md`):

- 100 worker–gig pairs were labelled for *suitability* (skills, location, arrangement, pay, experience). They are recorded as `label_source: "ai_assisted"`. The commit states that they **must not** be reported as human annotation or used for inter-annotator agreement, because the labeller also built the ranker.
- Results:
  - Agreement with the derived rule: **Cohen's κ = 0.243**; 50/100 exact; 88/100 within one grade.
  - Correlation of location affinity with the labels rose from +0.005 to **+0.167**.
  - Reputation stayed flat (+0.081 vs +0.095); the rubric did not mention reputation, and guide v1.1 adds it.
- The limitation recorded: there is still **no independent annotator**, so no inter-annotator agreement can be reported.

**Automated tests** (`apps/ai-engine/tests/`, `pytest.ini` turns `DeprecationWarning` from `app.*`/`eval.*` into errors). **Executed during this extraction: 106 passed in 104.10 s.**

| File | Tests | Covers |
|---|---|---|
| `test_scoring.py` | 32 | Weights sum to 1; score in [0, 1]; clamping; reputation comes from the gig, not the worker; reputation can reorder; unreviewed employer is neutral; location tiers and their strict order; unknown ≠ mismatch; county-suffix addresses; remote handling; null/empty inputs; determinism; sort order; breakdown consistency |
| `test_metrics.py` | 18 | P@k threshold, recall, MRR, DCG exponential gain, NDCG ideal/reversed/empty, fast NDCG = reference to 1e-9, bootstrap CI |
| `test_splits.py` | 13 | Disjoint, full coverage, non-empty, deterministic, stratified, bounded churn, dataset hash, train-only fit scope |
| `test_tfidf_model.py` | 13 | Fit, empty-corpus refusal, ranking, unit range, never refits, OOV, save/load, stale version, corrupt file, vocabulary contains only training terms |
| `test_promote.py` | 13 | Refuses dirty trees, unknown runs, missing or corrupt artefacts; provenance; keeps the previous artefact; rollback and undo; staleness warning |
| `test_experiment.py` | 10 | Git state captured at start; porcelain parsing; dependency versions; manifest completeness; failed runs still leave evidence |
| `test_parity.py` | 7 | distance → similarity; offline and live rank identically; deployed artefact = training fit; missing-artefact fallback; SQL-shaped rows |

**Not covered by automated tests:** the API gateway and the web app (they type-check only; there is no Jest, Vitest or Playwright in the repo), and the live Supabase path end to end (`eval/live_eval.py` is a manual check against a seeded database: `python -m eval.seed_db seed` → `python -m eval.live_eval` → `python -m eval.seed_db clear`; seeded accounts use the `@ayira-eval.invalid` suffix).

**Other evaluation tooling:**

| Module | Purpose |
|---|---|
| `run_eval.py` | Baselines on validation (warns if asked to use test) |
| `tune_weights.py` | Grid search; `rank_invariant_signals()` and `label_uninformative_signals()` |
| `ablation.py` | Each signal alone, and the full composite minus each signal |
| `retrieval_eval.py` | Cost of the shortlist |
| `compare.py` | Compares runs. Refuses runs with different datasets or splits. |
| `promote.py` | Deploys a run's artefact to `artifacts/`; `--status`, `--rollback` |
| `experiment.py` | Run identity `<UTC>__<name>__<commit>`. Manifest with git commit, dirty flag, dataset version, dependency versions, seeds, parameters. |
| `harness.py` | Corpus loading, strategies, train-only TF-IDF fit |
| `plots.py` | Figures (`baselines.png`, `weight_sensitivity.png`, `ablation.png`, `shortlist_curve.png`) |
| `live_eval.py`, `seed_db.py` | Live-service check against a seeded database |
| `corpus_sources/parse_kesco.py`, `category_map.py`, `build_corpus.py`, `overrides.json` | Corpus generation from KeSCO-2022 |

`eval/results/runs/` holds **25 run folders** (failed and superseded runs are kept on purpose), plus 15 older flat result JSONs.

---

> **Sections 6–9 (Infrastructure and DevOps, System Modules Summary, Functional Test Cases, Repository Structure) are not yet written.** This file covers Sections 0–5.
