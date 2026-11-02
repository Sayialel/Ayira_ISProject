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

## New workers and the semantic signal

This is where "new workers cannot match" came from, and it has two halves.

**The engine was crash-looping.** Render's health check probed before the app
had bound its port, marked the service unhealthy and restarted it, forever.
The app took 32 seconds to bind because importing sentence-transformers cost
22.6s and sklearn another 11.6s, both at module scope. Both are now imported
inside the functions that use them: **startup is 1.97s**, measured, and the
scores are unchanged (0.7618 / 0.5847 / 0.5323, `tfidf=0.5045`). While it was
looping, every match returned 502, which the gateway reported to the worker as
"the matching service is still starting up".

**Serving never loads the model, so a brand-new worker has no vector.** The
instance is 512 MB; the process is 129 MB with the model unloaded and 445 MB
once it is loaded and used, so a request that tried to embed was killed. A
worker without a vector still gets a ranking -- from keywords and location,
marked `degraded` -- but not the 72% of the weight that is semantic.

Vectors are therefore computed on a GitHub runner, which has gigabytes and is
free on a public repository. Two triggers:

| Trigger | Latency | Needs |
|---|---|---|
| `repository_dispatch` from the gateway on profile save | about a minute | `GITHUB_REPO`, `GITHUB_DISPATCH_TOKEN` on the gateway |
| `schedule`, every ten minutes | up to ten minutes | nothing beyond the two repository secrets |

The schedule is the backstop; the dispatch is the fast path. Dispatches are
coalesced to one a minute, because the workflow embeds everyone whose stored
hash is stale rather than one named worker.

**Required repository secrets** for either to work at all:
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

To run it by hand from a machine with memory:

```bash
cd apps/ai-engine
python -m eval.backfill_worker_embeddings --dry-run   # who needs one
python -m eval.backfill_worker_embeddings             # do it
```

**An empty profile is not told to wait.** It has nothing to embed, so "check
back shortly" was false and sent exactly the people who needed to add skills
away from doing it. Such a profile keeps the `insufficient` advice, which asks
for skills or a bio. Only a profile that has text to embed is described as
being prepared.

### Verified on the live stack, 2 November 2026

| Check | Result |
|---|---|
| Engine health | 200 in 0.49s |
| Gateway health | 200 in 0.43s |
| `GET /api/match/ready` | 401 — the route exists and is behind auth, not a 404 |
| Match, worker with a vector | 200 in 1.14s, `ok`, semantic 0.502 / 0.446 / 0.421 |
| Match, profile with no skills and no bio | 200, `insufficient`, correct advice |
| Workers covered | 52 of 52 — 51 with a vector, 1 with nothing to embed |

The last row includes a worker who signed up during this session and was
embedded through the same path, which is the scenario that was failing.

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

- **Two repository secrets are not set.** `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY`, under Settings -> Secrets and variables ->
  Actions. Until they are, "Embed new workers" cannot run at all -- it has
  never run -- and a new worker's vector has to be computed by hand. Matching
  still works for them in the meantime, on keywords and location.
- **The gateway has no `GITHUB_DISPATCH_TOKEN`.** Optional: without it the
  embedding run waits for the ten-minute schedule instead of starting on save.
  A fine-grained token with `contents: write` on this repository, plus
  `GITHUB_REPO=Sayialel/Ayira_ISProject`, both as Render environment
  variables.

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
