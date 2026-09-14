# AYIRA — Claude Code Development Instructions

## PROJECT OVERVIEW

**Ayira** is an AI-Powered Gig Economy Platform for Africa's Youth Workforce.
- Student: Lenina Sayialel (Admission 161492, Strathmore University)
- Supervisor: Ms. Eunice Manyasi
- This is a final year IS project — code quality, completeness, and documentation matter.

---

## WHAT HAS BEEN BUILT (Phase 1 — Foundation)

The monorepo lives at the project root `ayira/`. Everything below is complete and working:

### 1. Monorepo Root
- `package.json` — npm workspaces (`apps/*`, `packages/*`), concurrently scripts
- `tsconfig.base.json` — shared TS config (ES2022, strict)
- `.env.example` — all env vars documented
- `.gitignore` — node_modules, dist, .env, __pycache__, .venv
- `docker-compose.yml` — 3 services (api, ai-engine, web)

### 2. API Gateway (`apps/api/`)
**Stack:** Node.js 20, Express 4.21, TypeScript, Zod validation

**Existing files:**
- `src/index.ts` — Express entry. Routes mounted as:
  - `POST /api/auth/*` (public) — signup, signin, refresh
  - `GET/POST /api/gigs/*` (protected via authMiddleware)
  - `GET/POST /api/workers/*` (protected)
  - `GET/POST /api/applications/*` (protected)
  - `GET/POST /api/escrow/*` (protected)
  - `GET/POST /api/admin/*` (protected)
- `src/lib/supabase.ts` — TWO clients:
  - `supabaseAdmin` — uses SERVICE_ROLE_KEY, bypasses RLS (for server operations)
  - `createUserClient(accessToken)` — uses ANON_KEY + user's JWT, respects RLS
- `src/middleware/auth.ts` — Validates JWT via `supabaseAdmin.auth.getUser(token)`. Attaches `userId`, `userRole`, `accessToken` to `req`. Exports `requireRole(...roles)` helper.
- `src/middleware/errorHandler.ts` — `AppError` class with statusCode + global handler
- `src/routes/auth.ts` — FULLY IMPLEMENTED: signup (Zod validation, creates auth user + users table row), signin (returns access_token + refresh_token), refresh
- `src/routes/gigs.ts` — STUB: single `GET /` placeholder
- `src/routes/workers.ts` — STUB: single `GET /` placeholder
- `src/routes/applications.ts` — STUB: single `GET /` placeholder
- `src/routes/escrow.ts` — STUB: single `GET /` placeholder
- `src/routes/admin.ts` — STUB: single `GET /` placeholder
- `src/types/database.ts` — Manual Database interface with Row/Insert/Update types for all 9 tables

**Auth middleware pattern (use in all protected routes):**
```typescript
import { AuthRequest, requireRole } from '../middleware/auth';
// req is AuthRequest — has req.userId, req.userRole, req.accessToken
// For user-scoped queries: createUserClient(req.accessToken)
// For admin operations: supabaseAdmin
```

### 3. React Frontend (`apps/web/`)
**Stack:** React 18.3, Vite 5.4, TypeScript, Tailwind 3.4, React Router 6.26, Lucide React icons

**Existing files:**
- `src/main.tsx` — Root with BrowserRouter
- `src/App.tsx` — Routes:
  - `/` → Landing
  - `/signin` → SignIn
  - `/signup` → SignUp
  - `/app` → ProtectedRoute wrapping Layout (Outlet)
  - `/app/gigs` → GigFeed
- `src/hooks/useAuth.tsx` — AuthProvider + useAuth hook (wraps Supabase Auth, provides user/session/loading/signIn/signUp/signOut)
- `src/lib/supabase.ts` — Supabase client using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- `src/lib/api.ts` — `apiFetch<T>(endpoint, options)` helper that auto-attaches the Supabase session JWT as Bearer token. All API calls should use this.
- `src/components/Layout.tsx` — Header with sign-out, mobile bottom nav (Home, Gigs, Profile)
- `src/pages/Landing.tsx` — Hero with Get Started / Sign In buttons
- `src/pages/SignIn.tsx` — Email + password form, calls useAuth().signIn
- `src/pages/SignUp.tsx` — Full name, email, phone, password, role selector (worker/employer)
- `src/pages/Dashboard.tsx` — Role-based stat cards (placeholder values "--")
- `src/pages/GigFeed.tsx` — Placeholder text

**Tailwind custom colors:** `ayira-50` through `ayira-900` (blue palette) in `tailwind.config.js`

**Vite proxy:** `/api` requests proxy to `http://localhost:3001` (see `vite.config.ts`)

### 4. Python AI Engine (`apps/ai-engine/`)
**Stack:** Python 3.11, FastAPI, Sentence-Transformers, scikit-learn

**Existing files:**
- `app/main.py` — FastAPI app with CORS, mounts health + matching routers
- `app/config.py` — Pydantic Settings (reads from `../../.env`)
- `app/routers/health.py` — `GET /health`
- `app/routers/matching.py` — `POST /ai/match` (takes MatchRequest, returns MatchResponse)
- `app/models/schemas.py` — MatchRequest (worker_id, limit), GigScore (gig_id, title, score, breakdown), MatchResponse
- `app/services/embeddings.py` — `compute_semantic_similarity()` (Sentence-BERT all-MiniLM-L6-v2), `compute_tfidf_similarity()` (TF-IDF), `composite_score()` formula: `0.45*semantic + 0.25*tfidf + 0.15*location + 0.15*reputation`
- `app/services/matcher.py` — `match_worker_to_gigs()`: fetches worker profile + open gigs from Supabase, scores each, returns top N
- `requirements.txt` — All dependencies pinned

### 5. Supabase Schema (`supabase/migrations/`)
10 ordered SQL migration files:

| File | Contents |
|------|----------|
| `001_create_users.sql` | users table (extends auth.users), RLS: anyone reads, owner updates |
| `002_create_gigs.sql` | gigs table (employer_id FK), statuses: draft/open/in_progress/completed/cancelled |
| `003_create_applications.sql` | applications (gig_id + worker_id unique), statuses: pending/shortlisted/accepted/rejected/withdrawn |
| `004_create_escrow.sql` | escrow with 7 states: pending/funded/released/disputed/refunded/partial_release/cancelled |
| `005_create_reviews.sql` | reviews (rating 1-5, unique per gig+reviewer) |
| `006_create_notifications.sql` | notifications (type, title, body, data JSONB, is_read) |
| `007_create_messages.sql` | messages (sender_id, receiver_id, gig_id optional) |
| `008_create_ai_match_logs.sql` | ai_match_logs (semantic_score, tfidf_score, location_match, composite_score) |
| `009_create_skills_ref.sql` | skill_categories with seeded data (Technology, Writing, Design, Marketing, Business) |
| `010_functions.sql` | handle_updated_at() trigger on users/gigs/applications/escrow + update_reputation() trigger after review insert |

**Key columns to know:**
- `users`: id (UUID, FK auth.users), email, full_name, phone, role (worker/employer/admin), skills (TEXT[]), location, reputation_score, bio, is_verified
- `gigs`: id, employer_id, title, description, category, required_skills (TEXT[]), location, is_remote, budget_min/max, currency (default KES), deadline, status
- `applications`: id, gig_id, worker_id, cover_letter, proposed_amount, ai_match_score, status
- `escrow`: id, gig_id, employer_id, worker_id, amount, currency, mpesa_checkout_id, mpesa_receipt, status, funded_at, released_at

### 6. Shared Package (`packages/shared/`)
- `src/index.ts` — GIG_CATEGORIES constant, GigCategory type, APP_NAME, DEFAULT_CURRENCY
- `src/database.types.ts` — Placeholder (run `npm run db:types` to generate from Supabase)

---

## WHAT NEEDS TO BE BUILT (Phases 2–6)

Execute these phases IN ORDER. Each phase builds on the previous. Do NOT skip ahead.

---

## PHASE 2: Core CRUD Operations

### 2A. Gigs API (`apps/api/src/routes/gigs.ts`)

Replace the stub with full CRUD. Use Zod for input validation. Use `createUserClient(req.accessToken)` for user-scoped queries and `supabaseAdmin` only when needed for cross-user reads.

**Endpoints to implement:**

1. `POST /` — Create a gig
   - Only employers (`requireRole('employer')`)
   - Validate: title (string, min 5), description (string, min 20), category (one of GIG_CATEGORIES), required_skills (string[]), location (optional string), is_remote (boolean), budget_min (number, positive), budget_max (number, >= budget_min), deadline (ISO date string, future)
   - Set employer_id from `req.userId`, status defaults to 'draft'
   - Return created gig

2. `GET /` — List gigs with filters
   - Public endpoint (but still behind auth middleware for user context)
   - Query params: category, location, is_remote, min_budget, max_budget, search (text search on title+description), status (default 'open'), page (default 1), limit (default 20)
   - Return gigs with employer info (join users table for employer name/avatar)
   - Paginated response: `{ gigs: [...], total: number, page: number, totalPages: number }`

3. `GET /:id` — Get single gig with employer details
   - Include employer name, avatar, total gigs posted
   - If requester is the employer, include application count

4. `PATCH /:id` — Update gig
   - Only the employer who owns it
   - Can only update if status is 'draft' or 'open'
   - Validate same fields as create (all optional)

5. `PATCH /:id/publish` — Publish a draft gig (set status to 'open')
   - Only the owning employer

6. `DELETE /:id` — Cancel a gig
   - Only the owning employer
   - Set status to 'cancelled' (soft delete, don't actually remove the row)
   - Only if status is 'draft' or 'open'

### 2B. Workers API (`apps/api/src/routes/workers.ts`)

1. `GET /profile` — Get own profile
   - Return full user row for `req.userId`

2. `PATCH /profile` — Update own profile
   - Validate: full_name (string), phone (string), bio (string, max 500), skills (string[]), location (string), avatar_url (string/URL)
   - All fields optional

3. `GET /profile/:id` — Get another user's public profile
   - Return: full_name, avatar_url, bio, skills, location, reputation_score, is_verified, created_at
   - Do NOT return email or phone

4. `GET /dashboard/stats` — Worker dashboard statistics
   - Return: total_applications, active_gigs (where worker has accepted application), completed_gigs, average_rating, total_earnings (from released escrow)

### 2C. Applications API (`apps/api/src/routes/applications.ts`)

1. `POST /` — Apply to a gig
   - Only workers (`requireRole('worker')`)
   - Validate: gig_id (UUID), cover_letter (string, min 20), proposed_amount (number, positive)
   - Check gig exists and status is 'open'
   - Check worker hasn't already applied (unique constraint will catch, but give a nice error)
   - Set worker_id from req.userId, status 'pending'

2. `GET /` — List own applications
   - For workers: their applications with gig details (title, employer name, status)
   - For employers: applications to their gigs, grouped by gig
   - Query params: status, gig_id, page, limit

3. `GET /:id` — Get single application with gig + worker details

4. `PATCH /:id/status` — Update application status
   - Employers can: shortlist, accept, reject (for applications to their gigs)
   - Workers can: withdraw (their own applications)
   - When accepting: set gig status to 'in_progress', reject all other pending/shortlisted applications for that gig

### 2D. Admin API (`apps/api/src/routes/admin.ts`)

1. `GET /dashboard` — Admin stats
   - `requireRole('admin')`
   - Return: total_users, total_workers, total_employers, total_gigs, open_gigs, active_escrow_amount, total_platform_revenue (if applicable)

2. `GET /users` — List all users with pagination + search
3. `PATCH /users/:id/verify` — Verify a user (set is_verified = true)
4. `GET /gigs` — List all gigs (including non-open) with pagination

### 2E. Frontend Pages for Phase 2

**New pages to create in `apps/web/src/pages/`:**

1. `CreateGig.tsx` — Form for employers to post a new gig
   - Fields matching the POST /api/gigs validation
   - Skills input: tag-style multi-select from skill_categories
   - Budget range with currency (KES)
   - Deadline date picker
   - "Save Draft" and "Publish" buttons

2. `GigDetail.tsx` — Single gig view
   - Shows full gig info, employer profile card
   - Workers see "Apply" button (opens application form)
   - Employer sees list of applications with shortlist/accept/reject actions
   - Route: `/app/gigs/:id`

3. `MyGigs.tsx` — Employer's posted gigs
   - List with status badges, application count
   - Route: `/app/my-gigs`

4. `MyApplications.tsx` — Worker's applications
   - List with gig title, status badge, date applied
   - Route: `/app/applications`

5. `Profile.tsx` — Edit own profile
   - Bio, skills (tag input), location, phone
   - Route: `/app/profile`

6. `PublicProfile.tsx` — View someone's profile
   - Route: `/app/users/:id`

**Update `GigFeed.tsx`:**
- Fetch from `GET /api/gigs` via apiFetch
- Search bar, category filter dropdown, location filter, remote toggle
- Gig cards showing: title, employer name, budget range, location/remote, skills tags, deadline
- Click card → navigate to `/app/gigs/:id`

**Update `Dashboard.tsx`:**
- Fetch real stats from `/api/workers/dashboard/stats` (workers) or `/api/gigs?employer_id=me` (employers)
- Replace "--" placeholders with real numbers

**Update `App.tsx` routes:**
```tsx
// Add these routes inside the Layout outlet:
<Route path="gigs/:id" element={<GigDetail />} />
<Route path="gigs/create" element={<CreateGig />} />
<Route path="my-gigs" element={<MyGigs />} />
<Route path="applications" element={<MyApplications />} />
<Route path="profile" element={<Profile />} />
<Route path="users/:id" element={<PublicProfile />} />
```

**Update `Layout.tsx`:**
- Add role-based navigation: workers see Gigs + Applications, employers see Gigs + My Gigs + Post Gig

---

## PHASE 3: AI Matching Integration

### 3A. API Gateway Proxy (`apps/api/src/routes/matching.ts`)

Create a new route file that proxies to the AI engine:

1. `POST /api/match` — Get AI matches for the current worker
   - `requireRole('worker')`
   - Call AI engine: `POST http://localhost:8001/ai/match` with `{ worker_id: req.userId, limit: 10 }`
   - Use `fetch` or `axios` to call the AI engine (use env var `AI_ENGINE_URL`)
   - Log the match results to `ai_match_logs` table via supabaseAdmin
   - Return the scored gig list

2. `GET /api/match/history` — Get worker's past match logs
   - Return from ai_match_logs table, ordered by created_at desc

**Mount in `src/index.ts`:**
```typescript
import matchingRouter from './routes/matching';
app.use('/api/match', authMiddleware, matchingRouter);
```

### 3B. Frontend AI Matches Page

Create `apps/web/src/pages/AIMatches.tsx`:
- "Find Matches" button that calls `POST /api/match`
- Shows loading state while AI engine processes
- Displays results as ranked cards: gig title, match score (percentage), score breakdown (semantic, tfidf, location, reputation as a small chart or bars)
- Each card links to the gig detail page
- Route: `/app/matches`

**Update GigFeed.tsx:**
- Add "AI Match" button/toggle that switches between browse mode and AI-matched mode

---

## PHASE 4: Payments (M-Pesa Escrow)

### 4A. Daraja API Integration

**Important:** Use Safaricom Daraja API 3.0 SANDBOX environment.

Create `apps/api/src/services/mpesa.ts`:

```typescript
// Environment variables needed:
// DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET
// DARAJA_PASSKEY, DARAJA_SHORTCODE
// DARAJA_CALLBACK_URL (your ngrok/public URL for sandbox)

// Functions to implement:
// 1. getAccessToken() — OAuth token from Daraja
// 2. initiateSTKPush(phone, amount, accountRef) — Lipa Na M-Pesa Online (STK Push)
// 3. querySTKStatus(checkoutRequestID) — Check payment status
```

**Daraja sandbox URLs:**
- Auth: `https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials`
- STK Push: `https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest`
- Query: `https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query`

### 4B. Escrow Routes (`apps/api/src/routes/escrow.ts`)

Replace the stub with:

1. `POST /fund` — Employer funds escrow
   - Validate: gig_id, worker_id, amount
   - Create escrow row with status 'pending'
   - Initiate STK Push to employer's phone
   - Return escrow_id + checkout_request_id

2. `POST /callback` — M-Pesa callback (PUBLIC route, no auth)
   - Receives payment confirmation from Daraja
   - Update escrow: status → 'funded', set mpesa_receipt, funded_at
   - **Important:** Validate the callback is genuine (check result code)

3. `POST /:id/release` — Employer releases funds to worker
   - Only the escrow's employer_id
   - Only if status is 'funded'
   - Update status → 'released', set released_at
   - In production this would trigger a B2C payment; for sandbox just update the status

4. `POST /:id/dispute` — Either party disputes
   - Only employer_id or worker_id
   - Only if status is 'funded'
   - Update status → 'disputed'

5. `GET /` — List user's escrow transactions
   - Show all where user is employer or worker
   - Include gig title, other party name

6. `GET /:id` — Single escrow detail

**Escrow state machine:**
```
pending → funded (via M-Pesa callback)
funded → released (employer releases)
funded → disputed (either party)
disputed → released (admin resolves)
disputed → refunded (admin resolves)
pending → cancelled (timeout or employer cancels)
```

### 4C. Frontend Escrow

Create `apps/web/src/pages/Escrow.tsx`:
- List of escrow transactions
- Status badges with colors (pending=yellow, funded=blue, released=green, disputed=red)
- "Fund" button (triggers STK push, shows "Check your phone" modal)
- "Release Payment" button for employers on funded escrow
- "Dispute" button
- Route: `/app/escrow`

Add escrow actions to `GigDetail.tsx`:
- After accepting an application, show "Fund Escrow" form with amount

---

## PHASE 5: Notifications

### 5A. Notification Service (`apps/api/src/services/notifications.ts`)

Create a unified notification service:

```typescript
// Functions:
// 1. createNotification(userId, type, title, body, data) — Insert into notifications table
// 2. sendSMS(phone, message) — Via Africa's Talking API
// 3. sendPushNotification(fcmToken, title, body, data) — Via Firebase Cloud Messaging

// Africa's Talking sandbox:
// API URL: https://api.sandbox.africastalking.com/version1/messaging
// Env vars: AT_API_KEY, AT_USERNAME (default: 'sandbox')

// Firebase Cloud Messaging:
// Use firebase-admin SDK
// Env vars: FCM_SERVER_KEY or FCM_SERVICE_ACCOUNT_JSON
```

### 5B. Notification Triggers

Add notification calls at these points in the existing routes:

| Event | Notify | Channel |
|-------|--------|---------|
| New application on a gig | Employer | In-app + SMS |
| Application accepted | Worker | In-app + SMS + Push |
| Application rejected | Worker | In-app |
| Escrow funded | Worker | In-app + SMS |
| Escrow released | Worker | In-app + SMS + Push |
| Escrow disputed | Both parties | In-app + SMS |
| New message | Receiver | In-app + Push |
| Gig completed | Both parties | In-app |

### 5C. Notification Routes (`apps/api/src/routes/notifications.ts`)

1. `GET /` — List user's notifications (paginated, newest first)
2. `PATCH /:id/read` — Mark as read
3. `PATCH /read-all` — Mark all as read
4. `GET /unread-count` — Return count of unread notifications

**Mount in `src/index.ts`:**
```typescript
import notificationRouter from './routes/notifications';
app.use('/api/notifications', authMiddleware, notificationRouter);
```

### 5D. Frontend Notifications

Create `apps/web/src/components/NotificationBell.tsx`:
- Bell icon in header with unread count badge
- Dropdown showing recent notifications
- Click notification → navigate to relevant page
- "Mark all read" button

Create `apps/web/src/pages/Notifications.tsx`:
- Full page list of all notifications
- Route: `/app/notifications`

---

## PHASE 6: Messaging

### 6A. Messages Routes (`apps/api/src/routes/messages.ts`)

1. `GET /conversations` — List user's conversations
   - Group messages by the other party
   - Return: other user (name, avatar), last message preview, unread count, gig context
   - Sorted by most recent message

2. `GET /:userId` — Get conversation with a specific user
   - Optional query param: gig_id (to scope to a gig context)
   - Paginated, newest first
   - Mark received messages as read

3. `POST /` — Send a message
   - Validate: receiver_id (UUID), content (string, min 1), gig_id (optional UUID)
   - Trigger notification to receiver

**Mount in `src/index.ts`:**
```typescript
import messageRouter from './routes/messages';
app.use('/api/messages', authMiddleware, messageRouter);
```

### 6B. Frontend Messages

Create `apps/web/src/pages/Messages.tsx`:
- Left panel: conversation list
- Right panel: message thread with the selected user
- Message input at bottom
- Route: `/app/messages`

Optional: Use Supabase Realtime for live message updates:
```typescript
supabase.channel('messages')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${userId}` }, handler)
  .subscribe();
```

---

## PHASE 7: Polish & Deploy

### 7A. Frontend Polish

1. **Loading states** — Add skeleton loaders for all data-fetching pages
2. **Error boundaries** — Wrap routes in React error boundary
3. **Empty states** — Design empty states for: no gigs found, no applications, no messages, no notifications
4. **Toast notifications** — Add a toast system for success/error feedback (use react-hot-toast or build a simple one)
5. **Responsive design** — Ensure all pages work on mobile (375px) through desktop (1440px)
6. **Form validation** — Client-side validation matching server-side Zod schemas
7. **SEO** — Add page titles via `document.title` in each page component

### 7B. Security Hardening

1. **Rate limiting** — Add express-rate-limit to auth routes (max 5 attempts/15 min)
2. **Input sanitization** — Sanitize all text inputs (prevent XSS)
3. **CORS** — Tighten to only allow the actual frontend URL
4. **Helmet** — Already added, verify CSP headers
5. **Environment validation** — Validate all required env vars on startup, fail fast if missing

### 7C. Testing

Create `apps/api/src/__tests__/`:
1. `auth.test.ts` — Test signup, signin, refresh, invalid credentials
2. `gigs.test.ts` — Test CRUD, authorization, validation
3. `applications.test.ts` — Test apply, status changes, authorization

Use Vitest or Jest. Mock Supabase client.

### 7D. Deployment

**Frontend (Vercel):**
- Framework: Vite
- Build command: `cd apps/web && npm run build`
- Output dir: `apps/web/dist`
- Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`

**API Gateway (Railway):**
- Root directory: `apps/api`
- Build: `npm install && npm run build`
- Start: `node dist/index.js`
- Env vars: all from .env.example (SUPABASE_*, DARAJA_*, AT_*, AI_ENGINE_URL)

**AI Engine (Railway — separate service):**
- Root directory: `apps/ai-engine`
- Build: `pip install -r requirements.txt`
- Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

**Supabase:**
- Run migrations in order (001 through 010) in the Supabase SQL editor
- Enable Realtime on the messages table
- Configure auth email templates

---

## CODING CONVENTIONS

1. **TypeScript** — Strict mode, no `any` types. Use Zod schemas for all API input validation.
2. **Error handling** — Throw `AppError` with appropriate status codes. Never expose internal errors to clients.
3. **Supabase queries** — Always use `createUserClient(req.accessToken)` for user-facing queries (respects RLS). Use `supabaseAdmin` only for operations that need to bypass RLS (e.g., admin routes, server-side inserts during signup).
4. **API responses** — Consistent shape: `{ data: T }` for success, `{ error: string, details?: any }` for errors.
5. **Frontend** — Use `apiFetch<T>()` from `src/lib/api.ts` for ALL API calls. It handles auth headers automatically.
6. **Tailwind** — Use the `ayira-*` custom color palette. Keep components responsive with mobile-first breakpoints.
7. **File naming** — PascalCase for React components, camelCase for utilities, kebab-case for CSS.
8. **Imports** — Use the `@/*` path alias in the frontend (maps to `src/*`).

---

## EXECUTION ORDER

**Work through each phase completely before moving to the next:**

1. Phase 2A → 2B → 2C → 2D → 2E (Core CRUD — backend then frontend)
2. Phase 3A → 3B (AI Matching)
3. Phase 4A → 4B → 4C (Payments)
4. Phase 5A → 5B → 5C → 5D (Notifications)
5. Phase 6A → 6B (Messaging)
6. Phase 7A → 7B → 7C → 7D (Polish & Deploy)

After completing each sub-phase, test the endpoints manually or write quick tests before proceeding.

---

## ENVIRONMENT SETUP

Before running locally, the developer needs:
1. `npm install` at root (installs all workspaces)
2. `cd apps/ai-engine && pip install -r requirements.txt` (or use a venv)
3. Copy `.env.example` to `.env` and fill in Supabase credentials
4. Run Supabase migrations (001-010) in the SQL editor
5. `npm run dev` at root starts all 3 services concurrently
