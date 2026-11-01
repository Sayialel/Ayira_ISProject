# Sprint III: what is left, and how to defend it

Written for: Lenina Sayialel, for the Sprint III progress review and the final
defence.

Status as of 1 November 2026. Every figure here is taken from the repository
or the live database and can be checked in front of an examiner. Where
something is not done, it says so.

**Part A** is the work plan — what remains, in order.
**Part B** answers the technical questions the Sprint III brief poses, for this
project specifically. Read Part B before the review; it is the part you will be
examined on.

---

# Part A — What is left

## A0. The honest headline

Ayira has a **complete, working core** and **no deployment**. Everything runs
on `localhost`. Sprint III is, for this project, mostly a deployment and
evidence sprint rather than a feature sprint.

| Sprint III deliverable | Status |
|---|---|
| Completed functionality linked to objectives | **Mostly** — needs a traceability table (A1) |
| Traceability record | **Not started** (A1) |
| Coherent system around real user tasks | **Done** — sidebar, tabs, consistent components |
| **Working operational release over HTTPS** | **Not started** (A2) — the largest remaining item |
| Completed testing and evaluation | **Partly** — 196 automated tests; no UAT, no final test-split run (A3, A4) |
| Complete report and reproducible handover | **Partly** — engine and payment docs exist; Chapters 5–6 outstanding (A6) |

What exists today: 24 migrations, 38 API endpoints, 19 web pages, 29 RLS
policies, 28 `SECURITY DEFINER` functions, 196 automated tests (106 Python,
90 TypeScript), 26 recorded evaluation runs, CI on every push, 58 commits.

---

## A1. Traceability record — **do this first**

The brief asks for "a traceability record connecting each objective or
requirement to its implemented component, test or evaluation, result and
supporting evidence."

**Blocker:** your approved objectives are not written down anywhere in the
repository. I will not invent them — the wording must come from your Chapter 1
exactly as approved.

**What to do:** copy the approved objectives verbatim, then fill this table.
The right-hand columns are already true; only the left column is missing.

| # | Objective (from Chapter 1) | Implemented in | Verified by | Result |
|---|---|---|---|---|
| 1 | *(e.g. match workers to gigs by skill)* | `apps/ai-engine/app/services/scoring.py`, `matcher.py` | `tests/test_scoring.py` (32), `eval/run_eval.py` | NDCG@10 **0.897** validation, **0.850** test |
| 2 | *(e.g. secure payment between parties)* | `supabase/migrations/016,018,021,024`, `apps/api/src/services/mpesa.ts` | `mpesa.test.ts` (42), `admin.schemas.test.ts` (29), SQL rollback harness (13 assertions) | STK push verified end to end against Daraja sandbox |
| 3 | *(e.g. reputation from completed work)* | migration 019, `routes/reviews.ts`, `ReviewRow.tsx` | live data: 399 reviews, reputation recomputed by trigger | Employer reputation feeds ranking at weight 0.03 |
| 4 | *(e.g. platform moderation)* | `routes/admin.ts`, `AdminEscrow.tsx`, `AdminDashboard.tsx` | 13-assertion dispute test, reconciled dashboard figures | Three-way dispute settlement working |

**Effort:** 2–3 hours once you have the objectives in front of you.

---

## A2. Deployment — the largest remaining item

Nothing is deployed. This is the Sprint III centrepiece.

### What I fixed this session (so deployment is now possible)

The three Dockerfiles ran **development servers** and could not have been
deployed as they stood. All three are now release images:

| Was | Now |
|---|---|
| `vite --host` (dev server, unminified) | multi-stage build → nginx serving static `dist/`, SPA fallback |
| `npx tsx src/index.ts` (compiles on every start) | multi-stage build → `node dist/index.js`, prod deps only |
| Python **3.11** | Python **3.12**, matching CI and every reported metric |
| `artifacts/` **never copied** | copied — see the defect below |
| Encoder downloaded on first request | baked in at build time |

**The defect worth knowing about**, because it is exactly the kind of thing an
examiner probes: `tfidf_model.SERVING_PATH` resolves to
`/app/artifacts/tfidf_vectorizer.joblib`, and the old image copied only
`app/`. The promoted vectoriser was therefore **absent at runtime**,
`load_serving()` returned `None`, and `score_gigs` silently fell back to
fitting TF-IDF over whichever gigs happened to be open. **The container would
have served a model that was never evaluated**, and the only signal would have
been one warning line in the log. Fixed, and now the standing argument for why
the deployed pipeline must be the evaluated pipeline.

### What remains

**Recommended route: Example 1 (Cloudflare) + Example 2 (AWS) for the engine.**
Reasons in Part B §B5.

1. **Redeem the Namecheap `.me` domain** through GitHub Education. One year
   free; check the checkout total before confirming.
2. **Delegate DNS to Cloudflare** — set the two assigned nameservers in
   Namecheap under *Domain List → Manage → Nameservers → Custom DNS*.
3. **Cloudflare Pages for `apps/web`.** Root directory `apps/web`, build
   `npm run build`, output `dist`. Set `VITE_API_URL`, `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY` as build variables. Test the `pages.dev` URL before
   attaching the domain.
4. **Deploy `apps/api`.** Either a Cloudflare Worker (needs the Express app
   adapted — non-trivial) **or**, simpler and closer to what you have, the same
   container route as the engine on AWS ECS. *Recommendation: put the gateway
   and engine on AWS as two services and use Cloudflare only for the frontend
   and DNS.* That avoids rewriting Express for Workers in your final sprint.
5. **Deploy `apps/ai-engine`** to ECS Express Mode from ECR. CPU-only — the
   model is a 22M-parameter encoder, so no GPU is needed, which is what makes
   this route viable.
6. **Set a budget alert before provisioning.** ECS Express Mode bills compute
   and load balancing. Student credit is not a spending cap.
7. **Update `DARAJA_CALLBACK_URL`** to the deployed HTTPS address — this is
   also what finally lets you test the callback (A5).
8. **Update Supabase** `site_url` and `uri_allow_list`, and add the deployed
   domain to the Google OAuth redirect URIs.
9. **Smoke-test the live release**: sign in, run a match, fund an escrow, settle
   a dispute. Record URLs, commit SHA, image digest and model version.

**Effort:** 2–3 days including the inevitable DNS and CORS problems.

---

## A3. The final test-split run — **one hour, high value**

`eval/results/runs/` holds **17 validation runs and no test run**. The harness
supports `--split test` and its own docstring says "the final reported figure,
once".

```bash
cd apps/ai-engine && python -m eval.run_eval --split test
```

**State the caveat yourself.** The weight tuner has already scored the test
split six times, so it is **not a pristine holdout**. Selection never used it —
weights were searched on train and adopted on validation with a 0.005 margin —
but the number was visible during development. Saying this before you are asked
is far stronger than being caught by it. Current test NDCG@10 at the deployed
weights: **0.8499**.

---

## A4. User acceptance testing — **needs people, cannot be coded**

The brief asks for "usability and failure scenarios" and testing "with
representative users". You have none of this yet.

**Minimum defensible version:** 5–8 people, each attempting three tasks
without coaching:

| Role | Task |
|---|---|
| Worker | Create an account, add skills, find a match, apply to a gig |
| Employer | Post a gig, accept an applicant, fund escrow by M-Pesa |
| Either | Raise a dispute and read the outcome |

Record task success, time taken, and every point of confusion. Fix the
important issues, retest, and report **actual** sample sizes. Five people
finding four problems is a real finding; "users found it intuitive" is not.

**Effort:** one afternoon of other people's time, plus fixes.

---

## A5. Two things still unverified

**The M-Pesa callback has never received real Safaricom traffic.** The school
network blocks the ports a tunnel needs (cloudflared wants 7844; only 80/443
are open), so validation went through the outbound STK push plus `/sync`
polling instead. **Deploying (A2) fixes this** — point `DARAJA_CALLBACK_URL` at
the live HTTPS address and fund one sandbox escrow.

**`CANDIDATE_POOL = 200` cannot be validated on a 104-gig catalogue** because a
pool of 200 never truncates. The mechanism *is* measured — quality saturates at
a shortlist of **10** — but whether 200 is right at a catalogue of 10,000 is
untested. Say both halves.

---

## A6. The report and handover

| Item | Status |
|---|---|
| Chapter 5 | Outstanding. `docs/AI_MATCHING_ENGINE.md` and `docs/PAYMENT_ENGINE.md` contain most of the substance |
| Chapter 6 | Outstanding |
| Chapters 1–4 realignment | Outstanding — Chapter 4 ERD must match what was built (A7) |
| Final release tag | Not created. `git tag -a v1.0 -m "Final submission"` |
| `.env.example` without secrets | **Done**, verified clean this session |
| Setup and run instructions | In `README.md`; add the deployed URL once A2 is done |
| Test records | Automated: CI. Manual: needs the A4 table |
| Known limitations | **Done** — `docs/REMAINING_WORK.md` |

---

## A7. The one scope decision only you can make

**`messages` and `notifications`.** Both tables exist (migrations 006, 007),
both have **0 rows**, and both have **0 code references** anywhere. They are
almost certainly in your Chapter 4 ERD.

An ERD containing tables the system never touches is a discrepancy between
documented design and implementation, and it is the first thing an examiner
notices. Two honest options:

- **Cut them** from the ERD and say in the scope section that in-platform
  messaging and notifications were descoped. Half a day. Entirely defensible.
- **Build `notifications` only.** Higher value — the events already exist and
  currently tell nobody ("your application was accepted", "escrow funded",
  "payment released", "you have a review to write"). Roughly two days.

**Recommendation: build `notifications`, cut `messages`.** Do not submit with
the gap unaddressed either way.

---

## A8. Suggested order

| | Task | Effort | Why this position |
|---|---|---|---|
| 1 | Traceability table (A1) | 3h | Everything else is evidence *for* this |
| 2 | Decide messages/notifications (A7) | 0.5–2d | Changes the ERD, so earlier is cheaper |
| 3 | Deploy (A2) | 2–3d | The biggest item, and unblocks A5 |
| 4 | Test the callback live (A5) | 1h | Free once deployed |
| 5 | Run `--split test` (A3) | 1h | Your headline number |
| 6 | UAT with 5–8 people (A4) | 1d | Needs the deployed URL to be realistic |
| 7 | Chapters 5 and 6 (A6) | 3–4d | Written against finished evidence |
| 8 | Release tag, handover, rehearse | 1d | |

---
---

# Part B — Defence answers

Organised by the brief's own headings, so you can find an answer under the
question you are asked.

---

## B1. "From system design to a complete working solution"

### Who uses this, and what are they trying to achieve?

Three roles, and the system is genuinely three applications sharing a frame:

| Role | Goal | Entry point |
|---|---|---|
| **Worker** | Find work matching their skills, get paid safely | Dashboard → AI matches → apply |
| **Employer** | Find a capable person, pay only for delivered work | Dashboard → post gig → review applicants → fund escrow |
| **Administrator** | Keep the platform honest, settle disputes | Admin overview → disputes queue |

### The main user journey, and its alternative paths

**Normal path:** worker signs up → chooses role → fills skills and bio →
opens AI Matches → sees ranked gigs with reasons → applies → employer accepts →
employer funds escrow by M-Pesa → worker does the work → employer releases →
gig completes → both review each other → reputation updates → that reputation
feeds the next ranking.

That loop closing is the thing worth demonstrating: **the output of the system
becomes an input to the system.**

**Alternative paths that are implemented:**

| Path | What happens |
|---|---|
| Invalid data | Zod rejects at the gateway with a specific message; database constraints catch anything that gets past |
| Payment cancelled on the handset | Callback records failure, escrow stays `pending`, employer can retry |
| Callback never arrives | `POST /escrow/:id/sync` asks Safaricom directly |
| Parties disagree | Either raises a dispute; admin settles — release, refund, **or split** |
| AI engine unavailable | 503 with a message naming the problem; rest of the platform keeps working |
| M-Pesa not configured | `isConfigured()` reports it; payment routes 503, nothing else breaks |
| Session expires | 401 triggers a single shared refresh-and-retry in `lib/api.ts` |
| Google signup with no role | `RequireRole` holds them at the chooser until they answer |

### Separation of presentation, rules, data and model

```
Browser (React)        presentation only — no business rules it can be trusted on
      │ HTTPS, user JWT
Gateway (Express)      authn/authz, validation, orchestration. Holds the service key.
      │                         │ X-Ayira-Key
Postgres (Supabase)      AI engine (FastAPI)
  RLS + SECURITY DEFINER    scoring only, no business rules
  ← the real boundary
```

**The claim worth defending:** the rules live in the database, not in
application code. `transition_escrow` is the only way an escrow status
changes; it is `SECURITY DEFINER`, `REVOKE`d from `PUBLIC`/`anon`/
`authenticated`, and `GRANT`ed to the service role alone. 29 RLS policies and
28 `SECURITY DEFINER` functions enforce this. **Even a compromised gateway
cannot make an invalid state transition.** A bug in a route handler produces a
database exception, not lost money.

**Evidence that this is not theoretical:** migration 019 exists because
`update_reputation` was *not* `SECURITY DEFINER`, so the
`protect_user_privileges` trigger reverted its write and a 5-star review left
the employer at 0.00. The guard worked exactly as designed — against the wrong
caller.

---

## B2. "Build and verify one module at a time"

Worked example — **the dispute settlement module**, built this project:

| Step | What was done |
|---|---|
| 1. Purpose and completion criteria | An admin settling a disputed escrow must be able to pay the worker, refund the employer, **or split**. Reason mandatory. One settlement only. |
| 2. Complete interaction | Three choices; amount field appears only for a split; live preview of both sides' figures; submit disabled until valid |
| 3. Vertical slice | UI → `POST /admin/escrow/:id/resolve` → Zod → `transition_escrow` RPC → `escrow` + `escrow_events` rows. No mocks at any layer |
| 4. Behaviour and recovery | 13 assertions: the split itself, gig completion, audit trail, null/zero/full/over amounts, employer caller, worker caller, table constraint, full release. Run inside a transaction that rolls back |
| 5. Review and commit | Error messages rewritten after migration 021 — see B3 |
| 6. Integrate and regress | Two dashboard figures were wrong the moment the state became reachable; both fixed in the same change |

**Why this is a good example to volunteer:** `partial_release` existed in the
schema from migration 004, was counted in the admin dashboard, accepted by the
validator, and had a UI badge — **and was unreachable**. `transition_escrow`
raised `Unsupported transition to %` for it. The API accepted the request and
the database rejected it. It took building the module properly to find that.

---

## B3. HCI — "what the system should look and feel like"

| Brief's check | Ayira's answer |
|---|---|
| **Screens organised around tasks and roles** | Navigation differs by role, served from `WORKER_NAV` / `EMPLOYER_NAV` / `ADMIN_NAV`. Sidebar groups sub-pages (matches → history) instead of hiding them. Honest empty states throughout — "No reviews yet", not a fabricated chart |
| **Consistent visual language** | One `Button` with five variants; `money` is a distinct variant so actions that move money never look like ordinary ones. One `inputClass`, one `Card`, one `PageHeader`. This was **fixed** this project: an audit found nine different hand-rolled primary buttons and two drifted input styles |
| **Prevent errors and explain corrections** | Validated on client **and** server (Zod + database constraints). Specific messages: "Enter a whole number of shillings — M-Pesa cannot charge cents", not "Something went wrong" |
| **System state visible** | Seven distinct escrow states with their own badges. `pending` vs `funded` vs `disputed` vs `partial_release` are visually different. Spinners only during real work |
| **User control and accessible interaction** | Keyboard-operable controls, one global `:focus-visible` ring, `aria-pressed`/`aria-selected`/`role="radiogroup"` on custom controls, `prefers-reduced-motion` honoured globally. **Never colour alone** — every status badge carries text |
| **Verified with realistic users** | **Not done.** This is A4 and it is the honest gap |

**Two concrete HCI bugs found and fixed, worth volunteering:**

1. **`min={1} step={100}`** on four money inputs. A number input treats `step`
   as an offset from `min`, so the only valid amounts were **1, 101, 201…** —
   every even number rejected, everything between 2 and 100 rejected. The one
   escrow row in the database is exactly `101.00`, which is the bug's
   fingerprint. Reported from use, not found by testing.
2. **Error messages that named the wrong rule.** `transition_escrow` tested
   status and role in one condition and raised a message about the role, so an
   **administrator** settling an already-settled dispute was told "only an
   administrator can refund a disputed escrow". The guard was right and the
   explanation was wrong — in a money path, the obvious reading is "my account
   lacks a permission". Migration 021 splits the conditions.

---

## B4. "Intelligent data handling in AI/ML interfaces"

The brief's example is image classification; Ayira's inference is **ranking**.
Mapped:

| Brief's requirement | Ayira |
|---|---|
| **Guide and check the input** | The profile form states what the matcher reads. The completion ring is weighted by it — skills and bio count triple and double, because `profile_text` is built from exactly those two fields |
| **Make preparation visible** | The profile page names the missing items rather than showing a bare percentage. Nothing is silently defaulted |
| **Present results in context** | Every match card shows its **four-signal breakdown**, not just a score. Location is shown as a *named tier* — "same commuter region" — not `0.45`, because the number is a tier, not a distance |
| **Represent uncertainty honestly** | **This is the most examinable item.** The composite is a weighted sum of cosine similarities. It is **not a calibrated probability** and is never labelled "confidence". It is shown as "% fit". The weights are stated in the UI and match `DEFAULT_WEIGHTS` in `scoring.py` — they had drifted once, showing 0.45/0.25/0.15/0.15 long after the engine moved to 0.72/0.22/0.03/0.03, which meant the panel was explaining the ranking with numbers the ranking no longer used |
| **Handle inference as a real workflow** | 60s timeout for cold start; 503 names the problem; `ai_match_logs` records every scored result |
| **Keep provenance meaningful** | `artifacts/deployed.json` records run id, git commit, dataset version and which split the artefact was fitted on. `ai_match_logs` keeps per-signal scores for every match ever served |
| **Protect data and decisions** | RLS restricts every read to the parties involved. Service keys server-side only. Admin actions are audited with a mandatory reason |

### If asked "is your percentage a confidence?"

> No. It is a weighted sum of four normalised signals — cosine similarity from
> a sentence embedding, TF-IDF cosine, a location tier and the employer's
> rating — each scaled to 0–1 so the weights alone decide influence. It orders
> gigs; it does not estimate a probability that the match is correct, and we
> have not evaluated calibration. That is why it is labelled "fit" and shown
> with its breakdown rather than as a confidence figure.

---

## B5. Deployment and model serving — which route, and why

### What the three examples are

| Example | What it is | Fit for Ayira |
|---|---|---|
| **1. Namecheap + Cloudflare** | Domain, DNS, Pages for the frontend, Worker as gateway | **Frontend and DNS: yes.** Worker as gateway: no — Express would need rewriting for the Workers runtime in the final sprint |
| **2. AWS ECR + ECS Express Mode** | Container on Fargate with HTTPS routing | **Yes, for the gateway and engine.** Both are already containerised; the model is CPU-only so no GPU is needed |
| **3. Hugging Face** | Model Hub + Space or Inference Endpoint | **Partly.** There is no fine-tuned checkpoint to host — the encoder is used zero-shot — so the Hub would hold the TF-IDF artefact and a model card, not weights |

### The recommendation, and the reasoning

> **Cloudflare for the frontend and DNS; AWS ECS for the gateway and the
> engine.** The frontend is a static bundle, which is exactly what Pages
> serves. The gateway and engine are already containers, so ECS runs them
> unchanged. Rewriting Express for Workers in the final sprint would be
> rework with no benefit to the objectives.

**Deployment makes the application available; model serving runs the evaluated
model for prediction.** For Ayira the second is the subtler half:

- `artifacts/tfidf_vectorizer.joblib` **must** ship in the image — the defect
  in A2 is exactly what happens when it does not.
- `artifacts/deployed.json` records which run produced it.
- The encoder is baked in at build time, so a prediction request never
  downloads a model.
- **A live request never trains anything.** Scoring is `transform()`, never
  `fit_transform()` — deliberately, so document frequencies stay fixed and
  scores do not depend on which gigs happen to be open.

### If asked "why not Hugging Face?"

> Because there is no trained checkpoint to host. The encoder is
> `all-MiniLM-L6-v2` used zero-shot; what we fitted is a TF-IDF vocabulary and
> four composite weights. A Model Hub repository would be an appropriate home
> for that artefact and a model card documenting intended use and limitations,
> and that is worth doing for assessor inspection — but it is not where the
> prediction service lives.

---

## B6. "Serving your model reliably"

| Brief's requirement | Ayira |
|---|---|
| **Deploy the evaluated pipeline** | Same `score_gigs` serves live requests and the evaluation harness — `tests/test_parity.py` asserts they produce identical numbers, so a measured figure describes what actually serves users |
| **Keep evaluation valid** | Split **by profile, never by graded pair** — the profile text is the query, so splitting by pair would leak. TF-IDF fitted on training documents only. Weights searched on train, adopted on validation. **Disclosed:** the tuner scored test six times, so it is not a pristine holdout |
| **Protect the service and its users** | Engine reachable only from the gateway via `X-Ayira-Key`, and under the new compose it is not published to the host at all. Rate limiting on the gateway. Service keys server-side |
| **Demonstrate operational behaviour** | Cold start is the dominant cost — hence the 60s timeout and baking the encoder into the image. **Not yet measured under load; record response times during A2** |

---

## B7. Mobile — not in scope

Ayira is a **responsive web application**. There is no Android or iOS build, no
Play Console account, no TestFlight.

**Defensible because** the target users are Kenyan youth on varied devices, and
a responsive web app reaches all of them without a store review, a US$25
registration fee, or the 12-testers-for-14-days requirement — none of which
serve the approved objectives. The layouts are tested at phone width with a
bottom navigation bar and a safe-area inset.

**Say this plainly rather than implying a mobile app exists.**

---

## B8. The worked example, mapped to Ayira

The brief's example is image classification. Ayira's equivalent journey:

| Brief's step | Ayira |
|---|---|
| **1. Authenticate and control access** | Supabase GoTrue — email/password and Google OAuth. **Not a hand-rolled password system.** Authentication establishes identity; authorisation is checked server-side on every request, with RLS underneath |
| **2. Select input and help correct mistakes** | The profile *is* the input. The completion ring names what is missing and why it matters |
| **3. Process reliably and track each item** | Vectors cached in Postgres with a hash of the text that produced them, so a stale vector is detectable rather than merely old. Backfill is rate-limited and batched so one bulk import cannot make one user's search slow |
| **4. Decide whether the model can support a result** | Honest limitation: **Ayira has no abstention policy.** It always returns a ranking. A worker with no skills listed gets a list ranked on almost nothing. The completion prompt mitigates it; a real fix would be a minimum-profile threshold before matching |
| **5. Tool calling** | Not used, deliberately. Ranking is a scoring function, not an agent. Adding an orchestration model would introduce a dependency with no measurable benefit to the objectives |
| **6. Present results and close the loop** | Per-gig cards with signal breakdowns; `ai_match_logs` records every served match; reviews feed reputation, which feeds the next ranking |
| **7. Build in modules and demonstrate failure paths** | See B2. The failure paths to demonstrate are listed in B1 |

### On §4 — be ready for this

> **Q: What does your system do when it cannot produce a good match?**
>
> It still returns a ranking, which is a limitation I would fix with more time.
> The composite always produces a score, so a worker with a sparse profile
> receives a list ranked on very little. What the system does do is make that
> visible: every result shows its four signals, so a row of low semantic scores
> is legible as a weak match rather than presented as a good one, and the
> profile page names what is missing. An abstention threshold — "your profile
> is too sparse to match well, add skills first" — is the correct fix and is
> not implemented.

---

## B9. Complete testing and evaluation

### What exists

| Layer | Count | What it covers |
|---|---|---|
| Python | **106** | Scoring (32), metrics (18), splits (13), TF-IDF artefact (13), promotion (13), experiment provenance (10), **harness/live parity (7)** |
| TypeScript | **90** | M-Pesa (42), dispute validation (29), role carrier (19) |
| SQL | 13 assertions | `partial_release` end to end, inside a rolling-back transaction |
| CI | every push | Both suites + typecheck + build, two jobs |

### Evaluation results — validation split, 9 profiles, 88 graded pairs

| System | NDCG@10 | NDCG@5 | P@5 | R@10 |
|---|---|---|---|---|
| Random | 0.081 | 0.030 | 0.044 | 0.117 |
| TF-IDF only | 0.812 | 0.848 | 0.533 | 0.636 |
| Semantic only | 0.891 | 0.858 | 0.556 | 0.904 |
| **Composite (tuned)** | **0.897** | **0.879** | **0.600** | 0.867 |

### Say these three things before you are asked

1. **The composite beats random by an order of magnitude** — 0.897 vs 0.081.
2. **It does not beat semantic-only by a meaningful margin.** 0.897 vs 0.891,
   and the 95% CIs overlap heavily ([0.843, 0.949] vs [0.823, 0.950]). With 9
   validation profiles the study is underpowered to separate them. The
   defensible claim is "at least as good as semantic alone, and adds signals a
   worker cares about" — **not** "better".
3. **MRR is saturated at 1.000** for every non-random system, so it cannot
   discriminate between them. Do not present it as evidence.

### The limitations to raise yourself

| Limitation | The number |
|---|---|
| Benchmark partly circular | 532 of 565 labels derived by rule; naive word overlap alone puts a grade-3 gig first for **41/47 profiles (87%)** |
| Location and reputation unvalidatable | Correlations **−0.0033** and **+0.0072** against the grades. Their weights are a product judgement, stated as such |
| No second annotator | I annotated 100 pairs blind: **κ = 0.243**, poor. Recorded as `ai_assisted`, not `human`, because the same person designed the rule and the ranker |
| Test split not pristine | Scored six times by the tuner |
| Scale | 47 profiles, 104 gigs, 25 employers |
| Recency and pay absent | Not implementable — see below |

### Why recency and pay are not ranking signals

Worth volunteering, because "why doesn't it consider pay?" is an obvious
question with a strong answer:

- `gigs` has **no rate type or pay period** — only `budget_min`/`budget_max`.
  Hourly, daily and fixed-price work are indistinguishable, so a pay signal
  would rank a monthly salary above a day rate as comparable numbers.
- `users` has **no pay expectation**, so "meets the worker's requirements" has
  nothing to compare against.
- All 105 gigs were seeded **within 63 minutes**, and the evaluation corpus has
  **no date field at all**. A recency signal would have **zero variance** —
  shifting every candidate equally and reordering nothing.

That last point is the strong one: it is precisely the defect
`rank_invariant_signals` was built to catch, after the worker's-own-reputation
term did the same thing. **Shipping it would mean putting a weight on a signal
that provably cannot change a ranking.**

---

## B10. Questions I would prepare for

| Question | Short answer |
|---|---|
| *Is this really machine learning if you train nothing?* | It uses a learned representation zero-shot, and fits two things of its own — a TF-IDF vocabulary and four composite weights — under a train/validation/test discipline. 47 profiles is nowhere near enough to fine-tune a 22M-parameter transformer; it would memorise. See `docs/AI_MATCHING_ENGINE.md` §2 |
| *Why MiniLM?* | 384 dimensions, strong on short semantic-similarity tasks, small enough to run on modest hardware. Gig titles and skill lists are short text |
| *Why not an LLM?* | Per-request cost and latency for a ranking over every open gig, plus an external dependency for the platform's core function. A 384-dim encoder with vectors cached in Postgres does it in one indexed query |
| *How do you stop a double release?* | `SELECT … FOR UPDATE` row lock, and the state machine refuses any transition out of `released` |
| *What if Safaricom calls the callback twice?* | `mark_escrow_funded` returns the row unchanged when already funded — idempotent — and the endpoint answers 200 either way |
| *Is the money actually held by you?* | It is collected to the configured shortcode and recorded against the gig. **The payout leg is not implemented** — that needs Daraja B2C and a production shortcode. Describe it as a custodial ledger with a real collection leg |
| *Why is location weighted only 0.03?* | The ground truth cannot validate it — correlation −0.0033. Non-zero because that is a limitation of the labels, not evidence location does not matter |
| *Who can see an escrow?* | RLS: `employer_id = auth.uid() OR worker_id = auth.uid()`. Admins go through the gateway's service role, and admin routes resolve the role from the `users` table rather than trusting a token claim |
| *What would you do with more time?* | Real relevance judgements from Kenyan workers and employers, a second annotator, an abstention threshold, and the B2C payout leg |

---

## B11. Honesty checklist for the defence

Things that would be **wrong** to claim, with what to say instead:

| Do not say | Say |
|---|---|
| "The system has full escrow" | "A real collection leg and a recorded settlement decision. The payout leg needs Daraja B2C" |
| "The composite outperforms semantic matching" | "At least as good, with overlapping confidence intervals at this sample size" |
| "Validated with human-labelled data" | "532 of 565 labels are rule-derived; one blind annotation pass gave κ = 0.243" |
| "Tested on a held-out test set" | "Held out from weight selection; the tuner scored it six times, so it is not pristine" |
| "The model is X% confident" | "A weighted sum of four normalised signals, not a calibrated probability" |
| "Users found it easy to use" | Whatever the A4 sessions actually show, with the sample size |
| "It's deployed" | Only after A2 is actually done |

---

See also: `docs/AI_MATCHING_ENGINE.md`, `docs/PAYMENT_ENGINE.md`,
`docs/REMAINING_WORK.md`, `docs/EVALUATION_PROTOCOL.md`.
