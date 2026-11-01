---
title: Ayira Matching Engine
emoji: 🪡
colorFrom: red
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# Ayira — matching engine

The semantic matching service behind [Ayira](https://github.com/Sayialel/Ayira_ISProject),
an AI-powered gig platform for Kenya's youth workforce. Final-year Information
Systems project, Strathmore University.

## What it does

Given a worker, it ranks open gigs against their profile and returns each
gig's score with the four signals behind it:

| Signal | Weight | What it measures |
|---|---|---|
| Semantic | 0.72 | Sentence-embedding cosine between the worker's skills and bio and the gig text |
| TF-IDF | 0.22 | Exact vocabulary overlap, from a vectoriser fitted on the training split only |
| Location | 0.03 | A Kenyan county and commuter-region tier, not a distance |
| Employer reputation | 0.03 | The *employer's* rating, which varies by gig and so can reorder |

The encoder is **`all-MiniLM-L6-v2` used zero-shot** — not fine-tuned. What is
fitted is the TF-IDF vocabulary and the four weights, under a
train/validation/test discipline. 384 dimensions.

## Measured performance

Held-out test split, 17 worker profiles, 286 graded pairs:

| System | NDCG@10 | 95% CI |
|---|---|---|
| Random | 0.035 | [0.012, 0.062] |
| TF-IDF only | 0.744 | [0.684, 0.797] |
| Semantic only | 0.750 | [0.680, 0.813] |
| **Composite (tuned)** | **0.780** | [0.729, 0.830] |

The intervals for the composite and semantic-only overlap, so the honest claim
is that the composite is consistently the best system measured on both splits
— not that the difference is proven. Relevance labels are largely derived from
KeSCO occupational similarity rather than judged by people, which makes the
benchmark partly circular; both limitations are documented in the repository.

## Endpoints

```
GET  /health          liveness, public
POST /ai/match        requires the X-Ayira-Key header
```

`POST /ai/match` takes `{"worker_id": "<uuid>", "limit": 10}` and returns the
ranked gigs plus a `sufficiency` block saying how much of the ranking the
profile could actually drive. A worker with no skills and no bio scores exactly
zero on both text signals, so the engine says so rather than presenting a
location-ordered list as a skills match.

## Access

The service is not open. Every route except `/health` requires a shared secret
that only the Ayira API gateway holds, and the engine refuses to serve if that
secret is unset. It reads and writes a Supabase project it authenticates to
with credentials held as Space secrets, never in this repository.

This Space exists to run the model for the platform, not as a public demo.

## Configuration

Set as **Space secrets**, never in a file:

| Secret | Purpose |
|---|---|
| `SUPABASE_URL` | the project the engine reads workers and gigs from |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side access; bypasses row-level security by design |
| `AI_ENGINE_SECRET` | the shared secret the gateway presents |
