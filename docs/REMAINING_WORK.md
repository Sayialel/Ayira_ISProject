# What is left to complete and refine

Written for: Lenina Sayialel. Status as of 25 October 2026.

Ordered by what would cost you most if an examiner found it before you
mentioned it. Each item says what the gap is, why it matters, and roughly what
closing it involves.

---

## Where the system stands

| | |
|---|---|
| Tests | **196** — 106 Python, 90 TypeScript, all passing |
| CI | GitHub Actions on push and PR, both suites plus typecheck and build |
| Typechecking | api, web and `packages/shared` all covered |
| Migrations | 024, all applied to the live database |
| Auth | email + password, and Google OAuth (live, provider enabled) |
| Payments | Daraja sandbox, STK push working, collection leg real |
| Matching | live, serving ranked results, per-signal scores logged |

Working end to end: sign-up (both routes), profile, gig posting, applications,
AI matching, escrow funding by M-Pesa, gig completion, reviews, reputation,
admin moderation, and three-way dispute resolution.

---

## 1. Decisions only you can make

### 1.1 `messages` and `notifications` — DONE

**Both are built and deployed** (migration 025, 8 November 2026). This section
is kept because the reasoning is worth having in the writeup.

**What the gap was.** Both tables existed (migrations 006 and 007) with 0 rows
and 0 code references anywhere — gateway, web or engine. They were inert, while
appearing in the Chapter 4 ERD: a discrepancy between documented design and
implementation, which is the kind of thing an examiner notices immediately.

**Why messaging was built rather than cut.** The earlier recommendation here
was to build notifications and cut messaging. That was wrong, and the reason is
worth stating: without messaging the core workflow has no middle. An employer
shortlists a worker and then there is no step in which the two agree what the
work actually is, before escrow is funded for it. Cutting it would have left
"how does an employer actually hire someone here?" without a good answer.

**What was built.**

- `GET /api/messages/threads`, `GET /api/messages/threads/:gigId/:otherId`,
  `POST /api/messages`; `/app/messages` and `/app/messages/:gigId/:otherId`;
  entry points on the applicant card and on the worker's own application.
- `GET /api/notifications`, `GET /api/notifications/unread-count`,
  `POST /api/notifications/read`; a bell with an unread badge in the header.
- Nine notification kinds raised at the points where state actually changes:
  application received, shortlisted, accepted, rejected; escrow funded,
  released, disputed; review received; message received.

**Three things migration 025 had to settle first**, each worth a sentence if
asked about security:

1. Both tables had an `UPDATE` policy with `USING` and no `WITH CHECK`. RLS
   cannot see the OLD row in `WITH CHECK`, so "only `is_read` may change" is
   not expressible as a policy — a recipient could have rewritten the
   `content`, or the `sender_id`, of a message already delivered, which would
   make a thread worthless as evidence in a dispute. Marking read now goes
   through `SECURITY DEFINER` functions with `UPDATE` revoked.
2. `messages.gig_id` was nullable, and migration 013's policy ended
   `OR messages.gig_id IS NULL` — so a message with no gig was authorised by
   *any* shared gig between the two parties and then belonged to none of them.
   Every access rule here derives from the gig. Now `NOT NULL`, with
   `ON DELETE CASCADE`.
3. Neither table had an index for either query the feature issues.

**A correction worth keeping.** The first draft of migration 025 claimed that
wiring these tables up would have shipped an open inbox — any user able to
message any other. It would not have: migration 013 (L-02) closed that in the
first weeks with the same reasoning, and the draft was written from migration
007 without reading 013. Two overlapping `INSERT` policies are OR'd together
and are worse than one, so the duplicate was dropped and 013's kept.

**A design point likely to be asked about.** A conversation is keyed on
`(gig, counterparty)`, not on the gig. An employer with three applicants on one
gig is having three conversations about it; keying on the gig alone would have
shown each worker the others' messages — a privacy failure RLS would *not* have
caught, because every one of those rows is legitimately readable by the
employer. `foldThreads` in `apps/api/src/lib/threads.ts` is tested for exactly
that case.

**Verified** against the live deployed stack with three throwaway accounts on
the reserved `.invalid` TLD, deleted afterwards: 16 of 16 checks, including the
five security assertions nothing had ever exercised — employer and applicant
may message each other, a third party is refused in both directions, a forged
`sender_id` is refused, and a recipient cannot rewrite what they were sent.

**Still deliberately absent**, and defensible as scope: attachments, read
receipts, typing indicators, presence, and push or email delivery. The
conversation is polled on a fifteen-second interval rather than subscribed
through Realtime — enough for agreeing a scope and a price, which is what it is
for.

### 1.2 The final test-split figure

**The gap.** `eval/results/runs/` holds **17 validation runs and no test run**.
The harness supports `--split test` and its own docstring says "the final
reported figure, once" — it has not been done.

**The complication.** The weight tuner scores the test split on every run and
has done so **six times**. Selection never used it — weights were searched on
train and adopted on validation with a 0.005 margin — but the number was
visible during development. So describing test as an untouched holdout would be
an overclaim.

**What to do.** Run `python -m eval.run_eval --split test` once, report that
number as the headline result, and state plainly in the methodology that the
tuner had previously computed test scores so the split is not a pristine
holdout. Being the one who says this is far stronger than being asked.

Current test NDCG@10 at the deployed weights: **0.8499**.

---

## 2. Evaluation gaps that need people, not code

These are the real methodological limits. They cannot be closed by writing
software, which is worth saying explicitly in the dissertation.

### 2.1 A second annotator

**532 of 565 relevance labels are derived by a rule**, not judged by a person.
I annotated 100 pairs blind and agreement with the rule was **κ = 0.243** —
poor. Those labels are recorded as `ai_assisted`, not `human`, in
`data/annotation/relevance_ai_assisted_v1.jsonl`, because I designed both the
derivation rule and the ranker and so cannot be an independent annotator.

**What closing it needs:** one other person labelling the same 100 pairs from
`data/annotation/sheet_v1.json` using `docs/ANNOTATION_GUIDE.md` (v1.1), then
Cohen's κ between the two. A classmate or your supervisor would do. Even one
annotator on 100 pairs would let you report a real agreement figure.

### 2.2 Labels that vary with location and employer

Location correlates with the grades at **−0.0033** and reputation at
**+0.0072** — i.e. not at all, because the grades come from occupational
similarity and know nothing about towns or employers. So their weights (0.03
each) are a product judgement that the ground truth cannot validate.

**What closing it needs:** judgements from people who actually care where the
work is and who is hiring. Not a code change.

### 2.3 Benchmark circularity

Naive word overlap alone puts a grade-3 gig first for **41 of 47 profiles
(87%)**. A large part of the measured performance is agreement between two
text-similarity methods rather than demonstrated matching quality. Already
quantified and documented; make sure it is in the limitations section.

---

## 3. Measurable with existing tooling

### 3.1 ~~Evaluate `CANDIDATE_POOL = 200`~~ — **done**

Run `20261025T123721Z__retrieval-validation__e04d74f`. Quality saturates at a
shortlist of **10**: NDCG@10 of 0.8992 against 0.8977 for exhaustive scoring,
and sharp degradation below that (−0.104 at 5, −0.143 at 3).

**But 200 itself is untestable here**, because the catalogue is 104 gigs so a
pool of 200 never truncates. Keep it generous rather than cutting it to 10: the
shortlist is by semantic similarity alone, and 10-of-104 is ~10% of the
catalogue where 200-of-10,000 would be ~2%. Whether the proportion holds at
scale is the open question, and it needs a bigger catalogue, not a better
script. Full table in `docs/AI_MATCHING_ENGINE.md` §7.

### 3.2 Recency and pay — **blocked on schema and data, not on code**

Worth stating as a finding rather than a to-do, because the product questions
cannot be answered yet:

| Question | Why it cannot be answered |
|---|---|
| Compare hourly, daily and fixed-price gigs? | `gigs` has **no rate type or pay period** — only `budget_min`/`budget_max`/`currency`. The three are indistinguishable. |
| Prioritise pay, or enforce a worker's minimum? | `users` has **no pay expectation field**. There is nothing to compare a budget against. |
| Should older gigs decay? | All 105 gigs were seeded **within 63 minutes**, and the eval corpus has **no date field at all**. |

The recency one is the decisive objection. With no spread in `created_at`,
recency has **zero variance** — it would shift every candidate by the same
amount and could not reorder anything. That is precisely the defect
`rank_invariant_signals` was built to catch after the worker's-own-reputation
term did the same thing, and the tuner would reject it immediately.

Implementing it now would mean shipping a weight on a signal that provably
cannot change a ranking. **Prerequisites:** a `rate_type` column on gigs, a pay
expectation on users, gigs with real spread in `created_at`, and a date on
corpus gigs so the harness can score it.

### 3.3 ~~Surface `ai_match_logs`~~ — **done**

`/app/matches/history`, linked from AI Matches. Shows each recommended gig, the
combined score and the three signals behind it, with the location tier named
rather than printed as 0.45.

**Still outstanding, and this is the part that matters:** it is not an online
evaluation. That needs outcomes — whether the worker opened the
recommendation, applied, was accepted, completed the gig — and none are
collected. Those events also need care in interpretation: an application is not
proof the recommendation was good, and no application is not proof it was bad.
Collecting them is the next real step toward an online figure.

---

## 4. Payments

### 4.1 The payout leg does not exist

Releasing an escrow marks it `released` and completes the gig. It does **not**
send money to the worker's M-Pesa. That needs Daraja **B2C**, which requires a
production shortcode and business approval a student project cannot obtain.

**This is a scope boundary, not a bug** — but describe the system as a
custodial ledger with a real collection leg, not as complete escrow. See
`docs/PAYMENT_ENGINE.md` §2.

### 4.2 The callback is untested against real Safaricom traffic

The school network blocks the ports a tunnel needs (cloudflared wants 7844;
only 80/443 are open), so the inbound callback could never be exercised.
Validation went through the outbound push plus `/sync` polling instead.

**To close it:** run the API from a network that allows a tunnel, or deploy to
any host with a public HTTPS URL, and fund one sandbox escrow.

### 4.3 The callback can be forged

Anyone who learns a `CheckoutRequestID` could post a forged success. Closing it
properly needs IP allow-listing of Safaricom's ranges at the edge — a
deployment concern rather than an application one. Documented in
`docs/PAYMENT_ENGINE.md` §6.

### 4.4 `/sync` is only ever polled by a browser

A pending escrow that nobody looks at stays pending. A scheduled reconciliation
job would fix it; there is no job runner in the project.

---

## 5. Operational

### 5.1 No scheduled jobs at all

Two things are opportunistic that should not be:

- **Embedding backfill** runs inside a match request, rate-limited to one check
  every 30 s. A gig posted when nobody is searching is not matchable until
  someone searches.
- **Escrow reconciliation** — as above.

Both are correct-but-fragile. A cron would make them reliable.

### 5.2 No monitoring

No error tracking, no uptime check, no alerting. For a project defence this is
fine; say it is out of scope rather than leaving it to be noticed.

### 5.3 Secrets need rotating after submission

Supabase anon and service-role keys, the database password, the Supabase access
token, Daraja sandbox credentials, and the Google OAuth client secret have all
been in a chat transcript at some point. `.env` is gitignored and was verified
untracked before every commit, but rotate them once the project is marked.

### 5.4 Google OAuth consent screen

If the Cloud project's consent screen is in **Testing** mode, only accounts
added under *Audience → Test users* can sign in; everyone else gets "Access
blocked" after entering their email. Add any address you plan to demo with.

---

## 6. Smaller items

| Item | Why |
|---|---|
| `GET /api/match/history` has no UI | see 3.3 — kept deliberately |
| Reviews are not paginated past 50 | the "show all" button loads 50; fine at current scale |
| No rate limit on the matching route specifically | it is behind the general `apiLimiter`, but it is the expensive endpoint |
| `escrow.currency` is always `KES` | harmless, but the column implies flexibility that does not exist |
| No `.env.example` check in CI | a new contributor finds out by failing at runtime |
| Admin role is resolved per request | correct, but uncached beyond `invalidateRoleCache`; fine at this scale |

---

## 7. What was closed this session

For the record, since several of these were on the previous version of this
list:

| Commit | What it fixed |
|---|---|
| `3c07505` | the role is asked **before** Google, not after — carried across the redirect in `sessionStorage` |
| `1caaf04` | `partial_release` made reachable; `released_amount`; two wrong dashboard figures |
| `f998537` | `step={100}` on four money inputs made 1, 101, 201 … the only valid amounts |
| `c995252` | reviews now readable on a profile, not just the aggregate score |
| `6e993d5` | **three auth endpoints removed — one issued pre-verified accounts for addresses nobody owned** |
| `04c81b0` | first 90 TypeScript tests; `packages/shared` typechecked for the first time |
| `4d8222b` | CI runs both suites on push |
| `289db25` | a split escrow shows both parties what actually changed hands |

The `6e993d5` one is worth being able to talk about: `POST /api/auth/signup`
called `supabaseAdmin.auth.admin.createUser` with `email_confirm: true` on an
**unauthenticated** route. Confirmed against the running server — an
unauthenticated POST returned 201 for a `.invalid` address with no mailbox, and
that account then signed in successfully as an `employer`. The probe account was
deleted immediately. The confirmation email is the only thing tying an account
to a person, and everything downstream that assumes a verified identity —
escrow parties, reviews, reputation — rested on it.

---

## 8. If you only have a week

In order:

1. ~~**Decide `messages`/`notifications`** (§1.1)~~ — **done**: both built,
   deployed and verified on the live stack. The documented-vs-built
   discrepancy is closed.
2. **Run `--split test` once** (§1.2) — an hour, including writing the honest
   caveat. Gives you a headline number.
3. **Find a second annotator** (§2.1) — a few hours of someone else's time.
   Turns your biggest methodological weakness into a reported figure.
4. **Evaluate `CANDIDATE_POOL`** (§3.1) — one run. Closes an unmeasured
   assumption.
5. **Test the callback from an unrestricted network** (§4.2) — one afternoon.
   Lets you say the payment path is end-to-end verified.

Items 1–3 affect what you can *claim*. Items 4–5 affect what you can *prove*.
Both matter in a viva, but the claims matter more.

---

See also: `docs/AI_MATCHING_ENGINE.md`, `docs/PAYMENT_ENGINE.md`,
`docs/EVALUATION_PROTOCOL.md`, `docs/PRODUCTION_READINESS.md`,
`docs/ANNOTATION_GUIDE.md`.
