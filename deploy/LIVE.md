# The live deployment

Deployed 1 November 2026. Every figure below was checked against the running
system, not copied from a plan.

## Addresses

| Piece | URL | Host |
|---|---|---|
| Web application | **https://ayira-87w.pages.dev** | Cloudflare Pages |
| API gateway | https://ayira-api-t8wf.onrender.com | Render (Docker, free) |
| Matching engine | https://ayira-engine.onrender.com | Render (Python, free) |
| Database, auth | Supabase project `walpitphjdjnjbslfmpr` | Supabase |

The engine is reachable but not open: every route except `/health` needs the
shared secret the gateway holds, and the engine refuses to serve without it.

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
| CORS: `evil.com.ayira-87w.pages.dev` | blocked |
| CORS: `evil-ayira-87w.pages.dev` | blocked |
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

## Sleeping, and what to do about it

Render's free instances spin down after about fifteen minutes idle. Waking the
engine is a cold container **plus** loading the sentence-transformer, and a
request arriving during it gets a 502. This was observed repeatedly while
deploying and is the single most likely way a live demonstration goes wrong.

`.github/workflows/keep-warm.yml` pings both services every ten minutes from
06:00–19:00 UTC on weekdays — 09:00–22:00 in Nairobi. Weekday daytime only,
because two services kept alive continuously would need roughly 1,460
instance-hours a month against the 750 the free plan includes.

**Before any demonstration outside those hours**, run it by hand: *Actions →
Keep warm → Run workflow*. Then load the site and run one real match, so the
encoder is in memory. Allow three minutes.

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
