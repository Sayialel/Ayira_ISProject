# The live deployment

Deployed 1 November 2026. Every figure below was checked against the running
system, not copied from a plan.

## Addresses

| Piece | URL | Host |
|---|---|---|
| Web application | **https://ayiraventures.pages.dev** | Cloudflare Pages |
| API gateway | https://ayira-api-t8wf.onrender.com | Render (Docker, free) |
| Matching engine | https://ayira-engine.onrender.com | Render (Python, free) |
| Database, auth | Supabase project `walpitphjdjnjbslfmpr` | Supabase |

The engine is reachable but not open: every route except `/health` needs the
shared secret the gateway holds, and the engine refuses to serve without it.

## The two URLs that look broken and are not

Opening **https://ayira-api-t8wf.onrender.com** or
**https://ayira-engine.onrender.com** in a browser returns **404**, and that
is correct. They are APIs: neither defines a route at `/`, so there is nothing
to serve there. The same is true of `/api` on the gateway, which is the
catch-all for an unknown API path.

Use `/health` on either to check a service is up. Everything else needs a
method, a path and -- on the engine -- the shared secret.

## Verified on the live stack

| Check | Result |
|---|---|
| Site serves, deep routes resolve | `/app/matches/history` returns the app, not a 404 |
| Gateway health | 200 |
| Engine health | 200 |
| Engine rejects an unauthenticated call | 401 |
| End-to-end match, browser `Origin` set | 200, three ranked gigs |
| Deployed scores match local | 0.7618 / 0.5847 / 0.5323, `tfidf=0.5045` — identical |
| CORS: production origin | reflected |
| CORS: preview subdomain | reflected |
| CORS: `evil.com.ayiraventures.pages.dev` | blocked |
| CORS: `evil-ayiraventures.pages.dev` | blocked |
| CORS: unrelated origin | blocked |

**The scores matching local is the one that matters.** It demonstrates the
deployed pipeline is the evaluated pipeline — the promoted TF-IDF artefact
shipped intact and is being used, rather than the engine silently falling back
to fitting per request.

## Deployed artefact

```
run_id          20261101T091723Z__baselines-validation__f4e2657
git_commit      f4e2657dfffbe78cf3b24efee7ef84964e178b43
git_dirty       false
dataset_version b65642cd681e
fitted_on       train
```

Held-out test result for this artefact and these weights: **NDCG@10 0.780**
[0.729, 0.830] over 17 profiles.

## Performance

Measured from Nairobi on 2 November 2026, against the live stack.

| | |
|---|---|
| Match, warm | **~1.2s** |
| Engine startup | **3.9s** (was 25.0s) |
| Second API call on an open connection | **0.42s** (was 1.17s) |
| Page, time to first byte | 0.8-1.2s |

Three things got it there.

**The transformer import is lazy.** It was 22.6 of the 25 seconds the engine
spent starting, and nothing could be served during it -- not even `/health`.
Almost no request needs the model: worker and gig vectors are cached in
Postgres and the nearest-neighbour search runs there, so it is touched only
when a profile or gig has been edited. It now loads on first genuine use.

**The page preconnects to the API and Supabase.** Every endpoint had a floor
of about 0.7s and a trivial category lookup was no faster than a real query,
so the cost was never the database -- it was DNS, TCP and TLS to Frankfurt.
Opening those connections during page load means the first fetch after sign-in
starts on one that is already up.

**`reviews/pending` lost a round trip.** It made three sequential calls to the
database where the first two are independent; they now go together.

What is *not* the bottleneck: the database. Supabase is in `eu-west-1` and the
services in Frankfurt, about 25ms apart. The distance that costs is Nairobi to
Europe, and no amount of query tuning shortens it. Render has no African
region.

## Sleeping, and what to do about it

Render's free instances spin down after about fifteen minutes idle. Waking the
engine is a cold container **plus** loading the sentence-transformer, and a
request arriving during it gets a 502. This was observed repeatedly while
deploying and is the single most likely way a live demonstration goes wrong.

A Cloudflare Worker, **ayira-keepwarm**, pings both services every ten minutes
from 06:00–17:59 UTC — 09:00 to 21:00 in Nairobi.

It replaced a GitHub Actions schedule that was not reliable: scheduled
workflows on free runners are frequently delayed, and a ten-minute schedule
that actually fires every twenty-five lets a service that idles after fifteen
sleep anyway. That was observed directly — a health check took 133 seconds
despite the workflow existing. Cloudflare's cron triggers fire on time.

The window exists because of the hours, and the arithmetic is worth keeping:

| | |
|---|---|
| Two services, 24/7 | 2 × 730 = **1,460** — far over |
| Two services, 14h/day | 2 × 420 = **840** — over |
| Two services, 12h/day | 2 × 360 = **720** — fits, 30 to spare |

**Before a demonstration outside those hours**, open
**https://ayira-keepwarm.ayiraventures.workers.dev** — it runs the same check
on demand. Then load the site and run one real match. Allow two minutes.

If sleeping is unacceptable for the assessment window, Render's Starter plan
(about $7/month per service) removes the spin-down.

## Still outstanding

- **The M-Pesa callback has never received real Safaricom traffic.** It is now
  possible: `DARAJA_CALLBACK_URL` points at the live HTTPS address. Fund one
  sandbox escrow through the deployed site to close it.
- **No user acceptance testing.** Needs people, and now has a URL to use.
- **A custom domain.** The project runs on the hosts' own subdomains. The
  Namecheap student `.me` offer is still unredeemed.

## Rotate these

The Hugging Face, Cloudflare and Render tokens, and the Supabase and Daraja
credentials, have all passed through a chat transcript. Rotate them once the
project is marked.
