# Claude Code Extraction Prompt for Chapter 5

**Paste this entire prompt into Claude Code while in the `ayira/` project directory.**

---

## TASK

I am building Chapter 5 ("System Implementation and Testing") of my final year IS project proposal at Strathmore University. I need you to extract ALL technical details from the Ayira codebase and produce a structured extraction report that I will use to write the chapter.

**Do NOT write Chapter 5 itself. Only extract and organize the raw technical facts.**

The project is called **Ayira: An AI-Powered Gig Economy Platform for Africa's Youth Workforce**.

## WHAT TO EXTRACT

Read every file in the project and produce a single markdown report (`CHAPTER5_EXTRACTION_REPORT.md`) organized into the sections below. Be exhaustive — include every detail, every file, every function, every route, every component. This report will feed directly into writing Chapter 5.

---

### SECTION 1: IMPLEMENTATION ENVIRONMENT

**1A. Software Stack (for Table 5.2)**

For EACH technology/library/framework used across the entire project, extract:
- Exact name and version (from package.json, requirements.txt, Dockerfiles)
- Which part of the system uses it (API, Frontend, AI Engine, Database, DevOps)
- Its specific role in Ayira (not generic — what it does in THIS project)

Cover ALL of these categories:
- Programming languages (Node.js version, Python version, TypeScript version)
- Backend frameworks (Express version, FastAPI version)
- Frontend framework + build tool (React, Vite, versions)
- CSS framework (Tailwind version)
- Database + Auth platform (Supabase, PostgreSQL version)
- AI/ML libraries (sentence-transformers, scikit-learn, versions)
- Routing library (react-router-dom version)
- Validation library (Zod version)
- HTTP client libraries
- Icon library (lucide-react)
- Security middleware (helmet, cors)
- Logging (morgan)
- Dev tools (tsx, concurrently, Docker)
- Any other dependency in package.json or requirements.txt

**1B. Hardware Specifications (for Table 5.1)**

Note: I developed on a Windows 11 laptop. Extract any hardware-relevant details from the codebase (Docker resource configs, Python model memory requirements for sentence-transformers, etc.) that inform what hardware is needed to run this system.

---

### SECTION 2: DATABASE SCHEMA AND DATA MODEL

Read ALL files in `supabase/migrations/` and extract:

**2A. Complete Table Inventory**

For EACH of the 9 tables + skill_categories:
- Table name
- Every column: name, data type, constraints (PK, FK, UNIQUE, CHECK, DEFAULT, NOT NULL)
- Foreign key relationships (which table and column it references)
- CHECK constraint values (list every enum value, e.g., status IN ('draft','open',...))

**2B. Row Level Security (RLS) Policies**

For EACH table, list every RLS policy:
- Policy name
- Operation (SELECT, INSERT, UPDATE, DELETE)
- USING/WITH CHECK condition (in plain English — who can do what)

**2C. Database Functions and Triggers**

From `010_functions.sql`:
- Every function: name, what it does, which trigger calls it
- Every trigger: name, when it fires (BEFORE/AFTER), on which table

**2D. Seed Data**

From `009_create_skills_ref.sql`:
- What categories are seeded and what skills each contains

---

### SECTION 3: API GATEWAY — MODULE-BY-MODULE IMPLEMENTATION

Read ALL files in `apps/api/src/` and extract:

**3A. Entry Point (`src/index.ts`)**
- Express app setup steps (middleware stack in order)
- All route mounts (path, router name, whether protected)
- Port configuration
- Error handling setup

**3B. Supabase Client Configuration (`src/lib/supabase.ts`)**
- The two-client pattern: admin client vs user client
- What each is used for
- How the user client receives the JWT

**3C. Authentication Middleware (`src/middleware/auth.ts`)**
- The AuthRequest interface (every field it adds to req)
- Token extraction logic (where from, format)
- Validation flow (which Supabase method validates the token)
- The requireRole() helper — how it works
- Error responses for missing/invalid tokens

**3D. Error Handler (`src/middleware/errorHandler.ts`)**
- The AppError class (fields, constructor)
- Global error handler behavior (what it returns)

**3E. Auth Routes (`src/routes/auth.ts`) — FULLY IMPLEMENTED**
- `POST /signup`: Every step (Zod schema fields, Supabase auth call, users table insert, response shape)
- `POST /signin`: Every step (Zod schema, signInWithPassword call, what tokens are returned)
- `POST /refresh`: Every step (how refresh works)
- List the exact Zod validation rules for each endpoint

**3F. Stub Routes**
For each of gigs.ts, workers.ts, applications.ts, escrow.ts, admin.ts:
- What endpoint exists
- What it currently returns

**3G. Database Types (`src/types/database.ts`)**
- The Database interface structure
- Every table's Row, Insert, Update type definitions
- All enum types defined (UserRole, GigStatus, AppStatus, EscrowStatus)

---

### SECTION 4: REACT FRONTEND — MODULE-BY-MODULE IMPLEMENTATION

Read ALL files in `apps/web/src/` and extract:

**4A. App Shell**
- `main.tsx`: What it renders, providers used
- `App.tsx`: Complete route table (every Route, path, element, nesting). Which routes are protected and how (ProtectedRoute logic)
- `index.css`: Tailwind directives

**4B. Auth System (`hooks/useAuth.tsx`)**
- AuthContext shape (every field and method)
- AuthProvider implementation: session initialization, onAuthStateChange listener, cleanup
- signIn method: what Supabase method it calls, error handling
- signUp method: what metadata it passes
- signOut method
- ProtectedRoute component logic (how it redirects unauthenticated users)

**4C. API Client (`lib/api.ts`)**
- apiFetch function signature
- How it gets the session token from Supabase
- How it attaches the Authorization header
- Error handling behavior

**4D. Supabase Client (`lib/supabase.ts`)**
- Which env vars it reads
- Client creation

**4E. Layout Component (`components/Layout.tsx`)**
- Header: what it shows (brand, role badge, sign-out button)
- Navigation: what links exist, how they differ by role
- Mobile bottom nav: what icons and links
- Outlet rendering

**4F. Every Page Component**

For EACH page (Landing, SignIn, SignUp, Dashboard, GigFeed):
- Component name and file path
- What it renders (describe every UI element)
- What state it manages (useState calls)
- What API calls it makes (or will make)
- Form fields and validation (for SignIn, SignUp)
- User interactions (buttons, navigation)

**4G. Tailwind Configuration (`tailwind.config.js`)**
- Custom color palette (every color and its hex value)
- Content paths

**4H. Vite Configuration (`vite.config.ts`)**
- Plugins
- Path aliases
- Dev proxy configuration (what path proxies where)

---

### SECTION 5: AI MATCHING ENGINE — MODULE-BY-MODULE IMPLEMENTATION

Read ALL files in `apps/ai-engine/` and extract:

**5A. FastAPI App (`app/main.py`)**
- App metadata (title, version)
- CORS configuration (allowed origins)
- Router mounts

**5B. Configuration (`app/config.py`)**
- Every setting field, its type, and default value
- Where it reads from (.env path)

**5C. Data Models (`app/models/schemas.py`)**
- MatchRequest: every field, types, defaults
- GigScore: every field, types
- MatchResponse: every field, types

**5D. Embeddings Service (`app/services/embeddings.py`)**
- `get_model()`: model name, lazy loading pattern
- `compute_semantic_similarity()`: exact algorithm (Sentence-BERT model name, encode → cosine_similarity)
- `compute_tfidf_similarity()`: exact algorithm (TfidfVectorizer with stop_words, fit_transform → cosine_similarity)
- `composite_score()`: THE EXACT FORMULA with all weights. Write it as a mathematical equation.
  - What each weight represents
  - How location_match is scored (boolean → 0/1)
  - How reputation is normalized (divided by 5, capped at 1.0)

**5E. Matcher Service (`app/services/matcher.py`)**
- `get_supabase()`: how it connects
- `match_worker_to_gigs()`: 
  - Step 1: How it fetches the worker profile (which table, which fields)
  - Step 2: How it constructs the worker text representation (skills + bio concatenation)
  - Step 3: How it fetches open gigs (filter condition)
  - Step 4: How it constructs gig text representation (required_skills + description)
  - Step 5: How it computes each score component
  - Step 6: How it sorts and limits results
  - The complete data flow from input to output

**5F. Health Endpoint (`app/routers/health.py`)**
- Endpoint path, response

**5G. Matching Endpoint (`app/routers/matching.py`)**
- Endpoint path, method, request/response models
- Error handling

**5H. Requirements (`requirements.txt`)**
- Every dependency with exact version

---

### SECTION 6: INFRASTRUCTURE AND DEVOPS

**6A. Docker Compose (`docker-compose.yml`)**
- Every service: name, build context, Dockerfile path, ports, env_file, volumes, depends_on

**6B. Dockerfiles**
For each (api, ai-engine, web):
- Base image
- Build steps
- Exposed port
- Start command

**6C. Monorepo Configuration**
- Root `package.json`: workspaces, scripts (dev, build, db:types)
- `tsconfig.base.json`: compiler options
- `.env.example`: every environment variable grouped by service
- `.gitignore`: what's excluded

**6D. Shared Package (`packages/shared/`)**
- Exported constants and types
- database.types.ts placeholder

---

### SECTION 7: SYSTEM MODULES SUMMARY

Create a consolidated summary of the system's functional modules (this maps to "System Implementation" section in Chapter 5):

1. **Authentication and User Management Module** — What it does, which files implement it (both API and frontend)
2. **Gig Management Module** — Current state (stub), planned functionality
3. **Application/Hiring Module** — Current state, planned functionality
4. **AI-Powered Matching Module** — Full implementation details, the algorithm, the scoring formula
5. **Escrow/Payment Module** — Current state, planned M-Pesa integration
6. **Notification Module** — Current state, planned channels (SMS, push)
7. **Messaging Module** — Current state, planned Supabase Realtime

For each module: list every file involved (API route, service, frontend page, database table).

---

### SECTION 8: FUNCTIONAL TEST CASES

Based on the implemented and planned functionality, generate a comprehensive test case table. For each test case provide:

| Test Case ID | Module | Description | Test Data/Preconditions | Expected Result |
|---|---|---|---|---|

Cover AT MINIMUM these scenarios:
- TC-01: User registration with valid worker details
- TC-02: User registration with valid employer details  
- TC-03: Registration with duplicate email (should fail)
- TC-04: Sign in with valid credentials
- TC-05: Sign in with invalid password (should fail)
- TC-06: Sign in with non-existent email (should fail)
- TC-07: Access protected route without authentication (should redirect)
- TC-08: Token refresh
- TC-09: Create a gig (employer)
- TC-10: Create a gig as worker (should fail — wrong role)
- TC-11: List open gigs
- TC-12: View single gig details
- TC-13: Apply to a gig (worker)
- TC-14: Apply to same gig twice (should fail — duplicate)
- TC-15: Accept an application (employer)
- TC-16: AI match — get personalized gig recommendations
- TC-17: AI match — empty results (no open gigs)
- TC-18: Fund escrow via M-Pesa STK Push
- TC-19: Release escrow payment
- TC-20: Dispute escrow
- TC-21: Send a message
- TC-22: View notification list
- TC-23: Mark notification as read
- TC-24: Update worker profile (skills, bio)
- TC-25: Admin verify a user

---

### SECTION 9: GITHUB REPOSITORY STRUCTURE

Generate a complete directory tree of the project showing every file and folder, formatted as:

```
ayira/
├── package.json
├── tsconfig.base.json
├── docker-compose.yml
├── .env.example
├── .gitignore
├── apps/
│   ├── api/
│   │   ├── ...
│   ├── ai-engine/
│   │   ├── ...
│   └── web/
│       ├── ...
├── packages/
│   └── shared/
│       ├── ...
└── supabase/
    └── migrations/
        ├── ...
```

---

## OUTPUT

Save the complete extraction report as `CHAPTER5_EXTRACTION_REPORT.md` in the project root directory. Make it thorough — every function signature, every route, every column, every component. I will use this report word-for-word as the source material for Chapter 5.
