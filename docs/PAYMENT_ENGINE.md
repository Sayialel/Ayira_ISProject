# The Payment & Escrow Engine

Written for: Lenina Sayialel, preparing to defend this work orally.

Checked against the code as it stands. Migration numbers are given so you can
open the exact SQL.

---

## 1. The one-sentence answer

> An employer funds an escrow by M-Pesa STK push; the money is held against the
> gig until the employer releases it, and if the two sides disagree an
> administrator settles it by releasing in full, refunding in full, or splitting
> it — every move going through one `SECURITY DEFINER` state machine in Postgres
> that writes an audit event for each transition.

**The design claim worth leading with:** the rules live in the database, not in
application code. `transition_escrow` is the only way a status changes, and it
is granted to the service role alone. Even a compromised gateway cannot make an
invalid move.

---

## 2. What escrow means here, and what it does not

Be precise about this, because an examiner will press on it.

**What is real:** an employer's payment is actually collected by Safaricom via
STK push. The money leaves their M-Pesa account and arrives at the configured
shortcode. The escrow row records that this happened, against a specific gig
and a specific worker, and the status controls what happens next.

**What is not implemented:** the **payout leg**. Releasing an escrow marks it
`released` and completes the gig; it does **not** send money to the worker's
M-Pesa. That needs Daraja **B2C**, which requires a production shortcode and
business approval that a student project does not have.

So this is a **custodial ledger with a real collection leg and a recorded
settlement decision**. Say that rather than "escrow is complete". It is the
honest description and it is still a substantial piece of work: the collection,
the state machine, the authorisation rules, the audit trail and the dispute
resolution are all real and tested.

---

## 3. The state machine

Seven statuses, from migration 004:

```
                    ┌──────────────────────────────── cancelled
                    │   (employer or admin, only while pending)
                    │
  open_escrow ──▶ pending ──▶ funded ──┬──▶ released ────▶ gig completed
                    │                   │    (employer)
              STK push sent              │
              awaiting payment           └──▶ disputed ──┬──▶ released
                                              (either     │    (admin)
                                               party)     ├──▶ refunded
                                                          │    (admin)
                                                          └──▶ partial_release
                                                               (admin, + amount)
```

Who may make each move — enforced in SQL, not in TypeScript:

| To | From | Who | Notes |
|---|---|---|---|
| `pending` | — | employer | via `open_escrow`; one live escrow per gig |
| `funded` | `pending` | *Safaricom* | via `mark_escrow_funded`, not `transition_escrow` |
| `released` | `funded` | employer | the happy path |
| `released` | `disputed` | **admin** | settles for the worker |
| `disputed` | `funded` | employer **or** worker | either side may raise it |
| `refunded` | `disputed` | **admin** | settles for the employer |
| `partial_release` | `disputed` | **admin** | needs an amount |
| `cancelled` | `pending` | employer or admin | only before payment |

Every transition inserts a row into `escrow_events` with `from_status`,
`to_status`, `actor_id` and a `detail` string. That table is the audit trail.

### `partial_release` — the newest piece

This status existed in the schema from migration 004 and **was unreachable
until migration 024**. It was in the status `CHECK`, counted in the admin
dashboard's active-escrow total, accepted by the escrow route's validator, and
had a badge and a label in the UI — but `transition_escrow` handled four
statuses and raised `Unsupported transition to %` for this one. The API would
accept the request and the database would reject it.

It was worth building rather than deleting because splitting is the outcome a
dispute over half-finished work actually needs. Before it, an administrator had
to choose between paying in full and refunding in full, and in a genuine
part-delivery dispute neither is true.

Two supporting pieces came with it:

- **`escrow.released_amount`** — what the worker was paid. Equal to `amount` on
  a full release, less than it on a split, `NULL` before any payout. It is set
  on full releases too, so "what did the worker get" is one column rather than
  a `CASE` that someone will forget. The employer's refund is
  `amount − released_amount`.
- **A table constraint** — `released_amount IS NULL OR (> 0 AND <= amount)`.
  On the table, not only in the function, so it holds against a manual
  correction or a future caller.

The function additionally refuses a split that pays **nothing** (that is a
refund, which has its own status) or **everything** (that is a release). Two
statuses describing one outcome would make any report grouped by status
disagree with itself.

---

## 4. The funding pipeline

```
Employer clicks "Fund escrow"
        │
        ▼
POST /api/escrow/fund          apps/api/src/routes/escrow.ts
        │  validate: whole shillings, ≤ 500,000, gig + worker uuids
        │  resolve phone: request body → employer's profile → 400
        ▼
RPC open_escrow(gig, employer, worker, amount)          migration 016
        │  checks: the worker has an ACCEPTED application on this gig
        │          no other live escrow exists for this gig
        │  inserts escrow row at status 'pending'
        │  inserts escrow_events 'Escrow opened'
        ▼
initiateStkPush(phone, amount, "AYIRA-<id prefix>")     services/mpesa.ts
        │  1. getAccessToken()   — OAuth, cached until 60s before expiry
        │  2. build password     — base64(shortcode + passkey + timestamp)
        │  3. POST /mpesa/stkpush/v1/processrequest
        │  4. returns CheckoutRequestID
        ▼
UPDATE escrow SET mpesa_checkout_id = <CheckoutRequestID>
        │
        ▼
201 to the browser: "enter your M-Pesa PIN"
        │
        │  ... the customer's handset rings ...
        │
        ├─────────────── happy path ───────────────┐
        ▼                                          ▼
POST /api/escrow/callback                  POST /api/escrow/:id/sync
  (Safaricom calls us, unauthenticated)      (the browser polls)
        │                                          │
        │  parseCallback(body)                     │  queryStkStatus(checkoutId)
        │  ResultCode 0 → success                  │  resultCode '0' → success
        ▼                                          ▼
         RPC mark_escrow_funded(checkoutId, receipt)        migration 016
                     │  refuses anything not 'pending'
                     │  already 'funded' → returns unchanged (idempotent)
                     ▼
              status 'funded', funded_at = now(), receipt stored
              escrow_events row written
```

### Why the escrow row is opened *before* the push

The callback can arrive before Safaricom's HTTP response reaches us. If the row
did not exist yet, the `CheckoutRequestID` would have nothing to attach to and a
successful payment would be unmatchable.

### What happens if the push fails

The `catch` in the fund handler cancels the escrow it just opened. Without that
it would sit `pending` forever and block any further attempt on the gig, because
`open_escrow` allows only one live escrow per gig.

### Why `/sync` exists

Callbacks get lost — a tunnel drops, a deployment restarts. Without a
reconciliation path a payment that actually succeeded leaves the escrow stuck at
`pending` with no way back. `/sync` asks Safaricom directly via STK query.

**This is also how the whole flow was validated.** The school network blocks the
ports a tunnel needs (cloudflared wants 7844; only 80/443 are open), so the
inbound callback could not be tested. The outbound push plus `/sync` polling
was used instead. **The callback endpoint itself remains untested against real
Safaricom traffic** — say so if asked.

---

## 5. Daraja integration details

`apps/api/src/services/mpesa.ts`. Each item below exists because something went
wrong without it.

### Configuration is validated at call time, not at import

The rest of the API must start and serve normally on a machine with no Daraja
credentials. Only the payment routes should fail, and with a message naming what
is missing rather than a generic 500. `isConfigured()` lets routes report
availability without throwing.

### The placeholder guard — a bug that would have taken real money

```js
const PLACEHOLDER = /your-|example\.com|changeme|<[^>]+>/i;
```

Matched **anywhere** in the value, not just at the start. The original check was
`startsWith('your-')`, which passed
`https://your-public-url/api/escrow/callback` — that string does not *begin*
with the placeholder. Safaricom would have accepted the push, **the customer
would have paid**, and the confirmation would have been delivered to a hostname
that does not resolve, leaving the escrow `pending` with the money gone.

A missing callback URL is safer than a wrong one. Covered by tests.

### The timestamp must be Nairobi time

```js
new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hourCycle: 'h23', ... })
```

The STK password is derived from this timestamp and Daraja rejects one far from
the shortcode's local time. Reading the server's own clock works on a laptop set
to Nairobi and **fails on a UTC host** — which is where this deploys. The bug
would have appeared only in production.

`hourCycle: 'h23'` rather than `hour12: false`, because the latter can render
midnight as `24`, producing a timestamp Daraja rejects. Both are tested.

### `500.001.1001` is not a failure

It comes back from the STK **query** while the customer has not yet acted on the
prompt. It arrives as **HTTP 500 with an empty error message**, which reads like
a server fault and is in fact the normal state of every push while the handset
is still ringing. Treated as a failure, `/sync` told employers their payment had
been rejected while it was still in flight.

### Rate limiting is an operating condition

Daraja applies a spike arrest of 30 requests/minute with a burst of 3. Two
employers funding escrow in the same second is enough to hit it. Retried with
backoff `[2s, 5s, 12s]` rather than surfaced as an error.

### Token caching

OAuth tokens are cached and expired **60 seconds early**, so a token is never
used in the moment it lapses.

### Phone normalisation

`normalisePhone` accepts `07…`, `7…`, `+2547…`, `2547…`, and spaced, hyphenated
or bracketed forms, normalising to the `2547XXXXXXXX` Daraja requires. Eight
accepted forms and four rejected ones are tested.

### Whole shillings only

Daraja's STK endpoint rejects decimals, so the service rounds on the way out.
The gateway now **refuses** a decimal instead: a request for `100.40` used to
open an escrow recording `100.40` and ask M-Pesa for `100`, leaving the row
holding a figure nobody had paid.

---

## 6. The callback endpoint's security

`POST /api/escrow/callback` **cannot** require authentication — Safaricom's
servers call it and carry no credential of ours. It is secured by what it will
act on:

1. It accepts only a `CheckoutRequestID` that already exists on a **pending**
   escrow row. That value is issued by Safaricom and is not guessable.
2. `mark_escrow_funded` refuses any row that is not `pending`, so a replayed
   callback cannot fund an escrow twice or revive a cancelled one.
3. It **always** answers HTTP 200. Safaricom retries anything else, and retrying
   will not fix a malformed body — it would only produce a queue of duplicates.

**The honest limit, and state it yourself:** anyone who learns a
`CheckoutRequestID` could post a forged success. Closing that properly needs IP
allow-listing of Safaricom's ranges at the edge, which is a deployment concern
rather than an application one. It is listed as outstanding.

---

## 7. Dispute resolution

### Raising one

`POST /api/escrow/:id/dispute` — either the employer or the worker, only from
`funded`. Not from `pending` (nothing has been paid) and not after settlement.

### Settling one

`POST /api/admin/escrow/:id/resolve`, admin only.

```json
{ "outcome": "released" | "refunded" | "partial_release",
  "reason":  "at least 10 characters",
  "worker_amount": 600 }
```

Validation lives in `apps/api/src/routes/admin.schemas.ts` — separated from the
route so the rules can be tested without standing up the gateway:

- `reason` is **required**, minimum 10 characters after trimming. A decision that
  moves someone's money should not be recordable without a reason, and the
  reason is written onto the `escrow_events` row.
- `worker_amount` is **required** for a split and **refused** on the other two.
  Rejected rather than ignored: a caller who sends an amount believes it will be
  honoured, and silently dropping it is how someone ends up thinking they split
  an escrow they actually released in full.
- Whole shillings, positive. The upper bound is left to the database, which is
  the only place that knows the escrow's amount.

The route then calls `transition_escrow` and **translates** its refusal rather
than duplicating the rules — so the two cannot drift apart.

### Error messages say which rule was broken

Migration 021 exists for this. The guard used to be:

```sql
IF v_escrow.status <> 'disputed' OR NOT v_is_admin THEN
  RAISE EXCEPTION 'Only an administrator can refund a disputed escrow';
```

So an **administrator** settling an already-settled dispute was told "only an
administrator can refund a disputed escrow". The guard was right and the
explanation was wrong — and in a path that moves money the obvious reading is
"my account lacks a permission", sending someone to look for one instead of
re-reading the state. The arms now test the two conditions separately.

### Settlement completes the gig

Releasing — in full **or** as a split — sets the gig to `completed`, which is
what makes it reviewable. Guarded to `in_progress` only, so an admin settling a
disputed escrow cannot resurrect a cancelled gig as finished work.

A split counts as completion deliberately: the engagement is over and both sides
should be able to say how it went, arguably more so than when it went smoothly.

---

## 8. Why the rules are in the database

This is the design decision most worth defending.

**`SECURITY DEFINER` + `REVOKE … FROM PUBLIC, anon, authenticated` + `GRANT …
TO service_role`.** Every escrow function follows this pattern. The browser's
own Supabase client — which holds a real, valid user token — simply cannot
execute them. Only the gateway's service role can.

**`SELECT … FOR UPDATE`** at the top of each function takes a row lock, so two
simultaneous releases cannot both succeed.

**Each arm names who may move from where.** An invalid transition fails in SQL,
not in application code that might be bypassed.

The alternative — enforcing this in Express — would mean a bug in one route
handler could move money incorrectly. Here, a bug in a route handler produces a
database exception.

### A worked example of why this matters

Migration 019 fixed a bug of exactly this shape. `update_reputation` was **not**
`SECURITY DEFINER`, so when it tried to write a recomputed score the
`protect_user_privileges` trigger reverted it — a 5-star review left the
employer sitting at `0.00`. The fix was to make it `SECURITY DEFINER` and raise
a transaction-local flag (`ayira.recomputing_reputation`) that lets that one
deliberate write past the guard while the guard stays intact for everyone else.
`confirm_user_role` (migration 023) reuses the same mechanism.

---

## 9. File-by-file reference

### Gateway

| File | What it does |
|---|---|
| `apps/api/src/routes/escrow.ts` | 8 endpoints: list, detail, **fund**, release, dispute, cancel, **sync**, plus the public **callback** router |
| `apps/api/src/routes/admin.ts` | `GET /admin/escrow`, `GET /admin/escrow/:id`, **`POST /admin/escrow/:id/resolve`**, `POST /admin/gigs/:id/cancel` |
| `apps/api/src/routes/admin.schemas.ts` | `resolveSchema` — the dispute validation, extracted to be testable |
| `apps/api/src/services/mpesa.ts` | all Daraja I/O: token, STK push, STK query, callback parsing, phone normalisation, placeholder guard, retry |
| `apps/api/src/services/mpesa.test.ts` | **42 tests** |
| `apps/api/src/routes/admin.schemas.test.ts` | **29 tests** |

### Web

| File | What it does |
|---|---|
| `apps/web/src/pages/Escrow.tsx` | the employer's and worker's escrow list, with per-state actions and the split breakdown |
| `apps/web/src/components/FundEscrow.tsx` | the funding form (amount + optional phone) |
| `apps/web/src/pages/admin/AdminEscrow.tsx` | the admin view; status tabs and the three-way settle panel |

### Database

| Migration | What it added |
|---|---|
| **004** | `escrow` table, 7-status `CHECK`, RLS policies |
| **013** | `ON DELETE RESTRICT` on all three foreign keys — financial records must not vanish with a user |
| **016** | `escrow_events`, `open_escrow`, `mark_escrow_funded`, `transition_escrow` |
| **018** | `complete_gig`; release completes the gig in the same transaction |
| **021** | split the conflated status/role conditions in the error messages |
| **022** | gigs SELECT policy + `has_application_on_gig()` — workers could not review employers without this |
| **024** | `released_amount`, the range constraint, and `partial_release` made reachable |

---

## 10. Where every piece of data lives

| Table · column | What it holds |
|---|---|
| `escrow.id` | the escrow |
| `escrow.gig_id`, `.employer_id`, `.worker_id` | the three parties, all `ON DELETE RESTRICT` |
| `escrow.amount` | what the employer funded, whole shillings |
| `escrow.released_amount` | **what the worker was paid** (migration 024) |
| `escrow.currency` | `KES` |
| `escrow.status` | one of the seven |
| `escrow.mpesa_checkout_id` | Safaricom's `CheckoutRequestID` — the join key for callbacks |
| `escrow.mpesa_receipt` | `MpesaReceiptNumber` from the callback |
| `escrow.funded_at`, `.released_at` | timestamps |
| `escrow_events` | **the audit trail** — one row per transition, with actor and reason |

Credentials live in `.env`, which is gitignored (verified before every commit):
`DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_PASSKEY`,
`DARAJA_SHORTCODE`, `DARAJA_CALLBACK_URL`.

Current state of the live database: **1 escrow row**, status `pending`,
amount `101.00` — which is the fingerprint of the `step={100}` input bug that
made 1, 101, 201 … the only amounts the form would accept.

---

## 11. Limitations to raise yourself

1. **No payout leg.** Release records a decision; it does not transfer money to
   the worker. Needs Daraja B2C and a production shortcode.
2. **The callback is untested against real Safaricom traffic.** The school
   network blocks tunnel ports, so validation went through outbound push plus
   `/sync` polling.
3. **The callback can be forged** by anyone who learns a `CheckoutRequestID`.
   Needs IP allow-listing at the edge.
4. **Sandbox only.** Daraja sandbox credentials, not production.
5. **No partial refunds of a `funded` escrow** — only through a dispute. That is
   deliberate: an employer who wants to pay less than they committed has a
   disagreement, and a disagreement is a dispute.
6. **No commission.** `total_platform_revenue` is reported as 0 rather than
   implied from transaction volume, because no fee is charged.
7. **`/sync` is polled by the browser**, not driven by a scheduled job. A
   pending escrow nobody looks at stays pending.

---

## 12. Likely questions, shortest honest answers

**Is the money really held by you?** It is collected to the configured M-Pesa
shortcode and recorded against the gig. The release leg is not implemented, so
settlement is a recorded decision rather than an automatic transfer.

**What stops an employer releasing an escrow twice?** `SELECT … FOR UPDATE`
takes a row lock, and the state machine refuses any transition out of
`released`.

**What stops a worker releasing their own escrow?** `transition_escrow` checks
`v_is_employer` for a release from `funded`. A worker gets
"Only the employer who funded this escrow can release it".

**What if Safaricom calls the callback twice?** `mark_escrow_funded` returns the
row unchanged when it is already `funded`, so it is idempotent, and the endpoint
answers 200 either way.

**Who can see an escrow?** RLS: `employer_id = auth.uid() OR worker_id =
auth.uid()`. Admins go through the gateway's service role, which is why admin
routes resolve the role from the `users` table rather than trusting a token
claim.

**Why is a reason mandatory on a dispute settlement?** It is written to
`escrow_events` and is the only record of why someone's money moved. Both
parties can be shown it.

**What happens if the AI engine or Daraja is down?** Payments return 503 with a
message naming the problem; the rest of the platform keeps working. Credentials
are validated at call time precisely so this is true.

---

See also: `docs/AI_MATCHING_ENGINE.md`, `docs/PRODUCTION_READINESS.md`,
`docs/REMAINING_WORK.md`.
