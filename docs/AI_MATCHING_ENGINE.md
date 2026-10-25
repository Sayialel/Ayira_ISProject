# The AI Matching Engine

Written for: Lenina Sayialel, preparing to defend this work orally.

Everything here is checked against the code as it stands. Where a number is
quoted it comes from a run in `apps/ai-engine/eval/results/runs/`, and the run
is named so you can open it.

---

## 1. The one-sentence answer

> Ayira matches a worker to gigs by comparing a sentence-embedding of their
> skills and bio against an embedding of each gig, retrieves the 200 nearest
> using a vector index in Postgres, and re-ranks those 200 with a weighted sum
> of four signals: semantic similarity, TF-IDF overlap, location affinity and
> the employer's reputation.

If you only remember one thing, remember that **no model is trained**. The
embedding model is used exactly as published. This is the single most likely
question and the answer below matters.

---

## 2. "Is this really machine learning if you don't train anything?"

Expect this. The honest answer has three parts.

**What the system does not do.** It does not fit model weights. `all-MiniLM-L6-v2`
is used zero-shot — downloaded pre-trained and never updated. There is no
training loop, no loss function, no gradient step anywhere in the repository.

**What it does do.** It uses a learned representation, and it fits two things
of its own:

| Thing | Fitted on | Where it lives |
|---|---|---|
| Sentence embeddings | pre-trained by its authors on ~1B sentence pairs | downloaded model cache |
| TF-IDF vocabulary + IDF weights | **the training split of our corpus** | `apps/ai-engine/artifacts/tfidf_vectorizer.joblib` |
| The four composite weights | **grid search on the training split** | `scoring.py`, `Weights` defaults |

So there *is* a parameter-fitting step with a train/validation/test
discipline — it is just over four weights and a vocabulary, not over a neural
network.

**Why this was the right choice.** 47 worker profiles and 104 gigs is nowhere
near enough to fine-tune a 22M-parameter transformer; it would memorise the
corpus. Using a strong pre-trained encoder and tuning a small number of
interpretable parameters on top is the defensible design at this data scale.
Say that plainly rather than overclaiming.

---

## 3. The live request pipeline

What happens when a worker opens **AI Matches** and the page calls the API.

```
Browser  ──POST /api/match──▶  Express gateway        (apps/api)
                                     │
                                     │ X-Ayira-Key, 60s timeout
                                     ▼
                               POST /ai/match          (apps/ai-engine, FastAPI)
                                     │
                     ┌───────────────┼────────────────┐
                     ▼               ▼                ▼
             1. read worker   2. backfill gig   3. worker vector
                row + vector     embeddings        (cached or rebuilt)
                                     │
                                     ▼
                        4. nearest_open_gigs(...)      ← Postgres + pgvector HNSW
                           returns ≤200 candidates
                                     │
                                     ▼
                        5. score_gigs(...)             ← the composite
                           semantic · tfidf · location · reputation
                                     │
                                     ▼
                        6. sort, take `limit`
                                     │
                                     ▼
                     gateway hydrates gig fields, writes ai_match_logs,
                     returns ranked cards to the browser
```

### Step by step, with the code

**1 — The gateway call.** `apps/api/src/routes/matching.ts`, `callAiEngine()`.
Sends `{ worker_id, limit }` with an `X-Ayira-Key` shared secret and a 60s
timeout. The timeout is long because the *first* request after a cold start
pays for loading the transformer; steady-state scoring is far quicker.

**2 — Authentication at the engine.** `app/security.py` checks the header. The
engine is never exposed to browsers; only the gateway talks to it.

**3 — Read the worker.** `matcher.py:match_worker_to_gigs` selects
`id, skills, bio, location, reputation_score, embedding, embedding_hash`.
Note it reads the worker's *own* reputation but never scores it — see §5.4.

**4 — Backfill stale gig embeddings.** `matcher.py:_backfill_embeddings` calls
the `gigs_needing_embedding` RPC, at most every 30 s (`BACKFILL_CHECK_INTERVAL`),
and re-embeds at most 100 (`EMBED_BATCH`). It runs *before* retrieval because a
gig with no vector cannot be found by vector search. In steady state it does
nothing.

**5 — The worker's vector.** `embedding_store.worker_embedding` hashes the
profile text; if the hash matches `users.embedding_hash`, the stored vector is
reused. A worker edits their profile far less often than they search, so this
is almost always a read, not a model call.

**6 — Retrieval.** `nearest_open_gigs` (migration 017) does the heavy lifting
*in the database*:

```sql
ORDER BY (g.embedding <=> p_embedding) NULLS LAST
LIMIT p_limit                           -- 200
```

`<=>` is pgvector's cosine distance, served by an **HNSW** index
(`gigs_embedding_idx`, `vector_cosine_ops`, migration 014). The same function
also applies the hard filters — open status, not expired, not your own gig,
not already applied to — and returns the employer's reputation plus a
**counted** review total.

**7 — Re-rank.** `scoring.score_gigs` computes the composite over those ≤200
candidates only. The model does not run here: semantic scores are derived from
the distances the database already returned.

**8 — Log.** `matching.ts:logMatches` inserts one `ai_match_logs` row per
returned gig. Failures are logged, never raised — analytics must not break a
user's results.

### The key architectural point

The transformer does **not** run during a normal request. Vectors for both
sides are precomputed and cached in Postgres, and the nearest-neighbour search
happens in the database. That is what makes this responsive, and it is worth
saying out loud if asked about performance.

---

## 4. The ML pipeline, end to end

This is the offline half — how the corpus, the TF-IDF artefact and the weights
came to be.

```
  KeSCO-2022 (Kenyan national occupational standard, ISBN 978-9914-49-401-3)
            │
            ▼
  eval/corpus_sources/parse_kesco.py      extract occupations
            │
            ▼
  eval/corpus_sources/category_map.py     map ISCO groups → platform categories
            │
            ▼
  eval/corpus_sources/build_corpus.py     synthesise profiles, gigs, employers
            │                             and derive relevance grades
            ▼
  eval/corpus/  profiles.json  gigs.json  employers.json  relevance.csv
            │
            ▼
  eval/splits.py          split BY PROFILE, seed 20261018 → 29 / 9 / 9
            │
            ├──▶ eval/tune_weights.py     grid search on train, adopt on validation
            ├──▶ eval/harness.py          fit TF-IDF on train only, score, bootstrap CIs
            ├──▶ eval/ablation.py         remove one signal at a time
            └──▶ eval/run_eval.py         the reported baselines table
            │
            ▼
  eval/results/runs/<timestamp>__<name>__<git sha>/
            manifest.json  metrics.json  predictions.json  run.log
            tfidf_vectorizer.joblib
            │
            ▼
  eval/promote.py <run-id>    copies the artefact to app/../artifacts/
            │
            ▼
  artifacts/tfidf_vectorizer.joblib   +  artifacts/deployed.json
            (what the live engine loads)
```

### 4.1 The corpus

| File | Contents |
|---|---|
| `eval/corpus/profiles.json` | **47** worker profiles |
| `eval/corpus/gigs.json` | **104** gigs |
| `eval/corpus/employers.json` | **25** employers |
| `eval/corpus/relevance.csv` | **565** graded (worker, gig) pairs |
| `eval/corpus/splits.json` | the frozen split, `dataset_version: 6ac4675ae766` |

Grade distribution: `3` → 107, `2` → 166, `1` → 291, `0` → 1.
Relevance threshold for precision/recall is **grade ≥ 2**.

Label provenance, from the `layer` column — **be ready for this one**:

| Layer | Count |
|---|---|
| `derived` | **532** |
| `authored` | 33 |

So 94% of labels were produced by a rule, not by a person. §7 is honest about
what that costs.

### 4.2 Splitting

`eval/splits.py`, seed `20261018`, **29 train / 9 validation / 9 test**.

The split is **by profile, never by graded pair**. If the same worker appeared
in both train and test, the model would be scored on a worker it had already
been tuned against — the profile text is the query, so that is direct leakage.
Splitting by pair would look like more data and measure nothing.

### 4.3 Fitting TF-IDF

`eval/harness.py:fit_training_vectorizer` fits on **training documents only**
(`min_df=1`, `sublinear_tf=True`, English stop words), then `transform()`s at
scoring time — never `fit_transform()`.

Two reasons, and both are examinable:

1. **Leakage.** Fitting across the whole corpus lets validation and test
   documents influence the IDF weights.
2. **Reproducibility.** Fitting at request time makes a score depend on which
   gigs happen to be open, so an offline figure would not reproduce live.

`tfidf_model.load_serving()` logs a warning if no artefact has been promoted
and falls back to per-request fitting — degraded but working.

### 4.4 Tuning the weights

`eval/tune_weights.py`. Grid search over the simplex on **train**, adopted only
if validation improves by more than `adopt_margin = 0.005`.

The guard that matters — **a naive tuner got this wrong**. With weights forced
to sum to 1, an inert signal absorbs whatever is left over, and the search
happily reported `reputation 0.55` as "best". Two checks were added:

- `rank_invariant_signals` — a signal identical across all candidates for a
  profile cannot reorder anything, so it is excluded from the search. The
  **worker's own** reputation was exactly this.
- `label_uninformative_signals` — correlation of each signal against the
  grades. Measured: `location −0.0033`, `reputation +0.0072`. Neither
  correlates, so neither weight can be chosen from this ground truth.

The vectorised NDCG used in the search is asserted equal to a reference
implementation to 1e-9, so a fast path cannot silently disagree with the
metric being reported.

### 4.5 The weights, and why they are what they are

`app/services/scoring.py`:

```python
semantic   = 0.72
tfidf      = 0.22
location   = 0.03
reputation = 0.03
```

Overridable per-environment via `MATCH_WEIGHT_*`, so a tuning result can be
tried before being committed. The originals are kept as `SHIPPED_WEIGHTS`
(0.45 / 0.25 / 0.15 / 0.15) so evaluations report the change honestly instead
of presenting tuned figures as the baseline.

**semantic and tfidf are measured.** Removing semantic costs 0.24 NDCG@10.

**location and reputation are a product prior, not a measurement.** They vary
across candidates, so they *can* reorder — but they do not correlate with the
grades, because the grades come from occupational similarity and know nothing
about towns or employers. A search drives both toward zero only because any
weight on an unjudgeable signal dilutes the ones the labels reward.

They are kept small and non-zero deliberately: zero would overfit to a known
blind spot in the labels and discard information a worker plainly cares about.
The previous 0.15 on reputation put a fifth of the score on signals nothing
could validate and cost 0.035 NDCG@10.

### 4.6 Run provenance

`eval/experiment.py` captures, per run: git commit and dirty state, dataset
version, dependency versions, seeds and parameters — into `manifest.json`
before the run starts. `eval/results/` is excluded from the dirty check, since
runs write their own output into the repo.

Currently deployed (`artifacts/deployed.json`):

```json
{ "run_id": "20261019T062532Z__baselines-validation__4c3f4c4",
  "dataset_version": "6ac4675ae766", "fitted_on": "train", "git_dirty": false }
```

---

## 5. The four signals in detail

### 5.1 Semantic similarity — weight 0.72

`all-MiniLM-L6-v2`, 384 dimensions, normalised at encode time so similarity is
a plain dot product and matches the cosine operator the index uses.

- Worker text: `skills` joined + `bio` (`scoring.profile_text`)
- Gig text: `title` + `required_skills` joined + `description` (`scoring.gig_text`)

Live, this comes from `1 − cosine_distance` returned by Postgres
(`matcher._similarity_from_distance`). A gig with no embedding yet returns
`NULL` distance → scored 0, so it ranks last rather than disappearing.

### 5.2 TF-IDF overlap — weight 0.22

Catches exact vocabulary the embedding may blur — a specific tool, a
certification, a named skill. Loaded from the promoted artefact; out-of-vocabulary
terms contribute nothing, which is correct rather than a gap.

### 5.3 Location affinity — weight 0.03

`scoring.location_affinity` + `app/services/kenya_geography.py`.

| Tier | Value |
|---|---|
| Remote gig, or same town | 1.00 |
| Same county | 0.60 |
| Same metro (different county) | 0.45 |
| **Unknown either side** | **0.30** |
| Different county | 0.00 |

Two design points worth defending:

**Unknown is not a mismatch.** It sits below every verified-reachable tier and
above a verified mismatch. Absence of information is neither good nor bad news,
so it must not outrank a commute we have confirmed, nor be grouped with one we
have ruled out. The previous exact-match version scored a blank location as a
failure, quietly punishing every gig whose location was not filled in.

**The metro tier exists because county tiering alone did not fix the original
bug.** Thika is in Kiambu and Nairobi is its own county, so a 40 km daily
commute scored identically to Mombasa→Nairobi (490 km). `METRO_AREAS` groups
Nairobi, Kiambu, Kajiado, Machakos and Murang'a as one labour market.

35 towns are mapped. Several counties appear more than once on purpose: a map
where every town had its own county would make the "same county" tier
unreachable, which is the state this replaced.

### 5.4 Employer reputation — weight 0.03

`scoring.employer_reputation`. **Per gig, not per worker** — this is the
redesign and it is examinable.

The engine originally scored the *worker's own* reputation. That value is
identical for every candidate gig, so it shifted all of a worker's scores by
the same amount and **could not change the ranking at all**. It cost a weight
and bought nothing. The employer's reputation varies gig to gig, which is what
lets it reorder — and it is also what a worker choosing between gigs actually
cares about.

Unknown is distinct from bad: `users.reputation_score` is `0.00` both for
"never reviewed" and "every review was one star". An unreviewed employer gets
`NEUTRAL_REPUTATION = 3.0` rather than the bottom of the scale, because 0 is
not reachable on a 1–5 review scale and so almost always means "no reviews".
`nearest_open_gigs` counts reviews rather than trusting a cached column, so the
two cases can be told apart.

### 5.5 Combining them

`scoring.composite_score`. Every term is normalised to 0–1 before weighting —
reputation is divided by `REPUTATION_SCALE = 5.0` — so the weights alone decide
influence and the displayed percentage means something.

---

## 6. Results

From `eval/results/runs/20261019T062941Z__baselines-validation__b8a18c0`,
**validation** split (9 profiles, 88 graded pairs):

| System | NDCG@10 | NDCG@5 | P@5 | R@10 | MRR |
|---|---|---|---|---|---|
| Random | 0.081 | 0.030 | 0.044 | 0.117 | 0.142 |
| TF-IDF only | 0.812 | 0.848 | 0.533 | 0.636 | 1.000 |
| Semantic only | 0.891 | 0.858 | 0.556 | 0.904 | 1.000 |
| Composite (shipped weights) | 0.846 | 0.851 | 0.556 | 0.717 | 1.000 |
| **Composite (tuned)** | **0.897** | **0.879** | **0.600** | 0.867 | 1.000 |

Test split, current weights: **NDCG@10 = 0.8499**
(`20261019T062341Z__tune-weights__0298b68`).

### How to present this honestly

**The composite beats random by an order of magnitude.** 0.897 against 0.081.

**The composite does not beat semantic-only by a meaningful margin.** 0.897 vs
0.891 — a gain of 0.006, and the 95% confidence intervals overlap heavily:

- Semantic only: [0.823, 0.950]
- Composite tuned: [0.843, 0.949]

Say this before you are asked. With 9 validation profiles the study is
underpowered to separate them. The defensible claim is "the composite is at
least as good as semantic alone and adds signals a worker cares about", not
"the composite is better".

**MRR is saturated at 1.000.** The first result is relevant for every profile,
so MRR cannot discriminate between these systems at all. Do not present it as
evidence.

---

## 7. The limitations to raise yourself

Raising these first is much stronger than being caught by them.

**1. The benchmark is partly circular.** 532 of 565 labels are derived by a
rule from occupational similarity, and the ranker also works on text
similarity. Quantified: naive word overlap alone puts a grade-3 gig first for
**41 of 47 profiles (87%)**. So a large part of the measured performance
reflects agreement between two text-similarity methods, not demonstrated
real-world matching quality.

**2. Location and reputation are unvalidatable on this ground truth.**
Correlations of −0.0033 and +0.0072. Their weights are a product judgement.
Fixing this needs labels that vary with location and employer — i.e. people,
not code.

**3. No second annotator.** I annotated 100 pairs blind against the derived
rule: **κ = 0.243**, which is poor agreement. Those labels are recorded as
`ai_assisted`, not `human`, in `data/annotation/relevance_ai_assisted_v1.jsonl`
— I designed the derivation rule and the ranker, so I cannot be an independent
annotator and the file says so. Inter-annotator agreement needs a second
person.

**4. The test split is not a virgin holdout.** The weight tuner scores test on
every run and has done so six times. No automated selection used it — weights
were searched on train and adopted on validation — but the number was visible
during development, so "untouched holdout" would be an overclaim.

**5. Scale.** 47 profiles, 104 gigs, 25 employers. Confidence intervals are
wide and will stay wide at this size.

**6. `CANDIDATE_POOL = 200` has never been evaluated.** If the vector pre-filter
drops a relevant gig, no amount of re-ranking recovers it. That is an unmeasured
recall ceiling, and the existing harness could measure it.

**7. No recency or pay signal.** A gig posted three months ago ranks level with
one posted today, and pay does not enter the ranking at all.

---

## 8. File-by-file reference

### `apps/ai-engine/app/` — what serves live traffic

| File | Lines | What it does |
|---|---|---|
| `main.py` | 16 | FastAPI app, mounts the routers |
| `config.py` | 40 | Settings; `model_name = "all-MiniLM-L6-v2"` |
| `security.py` | 37 | `X-Ayira-Key` check — the gateway is the only caller |
| `models/schemas.py` | 15 | `GigScore` request/response shapes |
| `routers/health.py` | 7 | `/health` |
| `routers/matching.py` | 28 | `POST /ai/match` |
| `services/matcher.py` | 151 | **Orchestrates a request.** Supabase client, backfill, retrieval, re-rank |
| `services/scoring.py` | 344 | **The composite.** Weights, four signals, `score_gigs` |
| `services/embeddings.py` | 76 | Loads the transformer; similarity helpers |
| `services/embedding_store.py` | 129 | Vector caching: hashing, pgvector text format, backfill writes |
| `services/tfidf_model.py` | 141 | The TF-IDF artefact: fit, save, load, serving cache |
| `services/kenya_geography.py` | 137 | 35 towns → counties, metro grouping |

### `apps/ai-engine/eval/` — the offline pipeline

| File | Lines | What it does |
|---|---|---|
| `experiment.py` | 274 | Run identity: git state, versions, seeds → `manifest.json` |
| `splits.py` | 211 | Split by profile, seed 20261018 |
| `harness.py` | 336 | `Corpus`, `for_split`, `fit_training_vectorizer`, bootstrap CIs |
| `metrics.py` | 75 | NDCG@k, P@k, R@k, MRR |
| `run_eval.py` | 164 | The baselines table. `--split {train,validation,test}` |
| `tune_weights.py` | 510 | Grid search + the rank-invariance and correlation guards |
| `ablation.py` | 194 | Remove one signal at a time |
| `compare.py` | 232 | Diff two runs |
| `promote.py` | 261 | Deploy an artefact; `--rollback`, `--status` |
| `plots.py` | 138 | Figures for the writeup |
| `retrieval_eval.py` | 156 | Retrieval stage on its own |
| `live_eval.py` | 124 | Evaluate against the live database |
| `seed_db.py` | 296 | Load the corpus into Supabase |
| `corpus_sources/parse_kesco.py` | 279 | Parse the KeSCO standard |
| `corpus_sources/category_map.py` | 163 | ISCO groups → platform categories |
| `corpus_sources/build_corpus.py` | 532 | Build profiles, gigs, employers, grades |

### Tests

`apps/ai-engine/tests/` — **106 tests**, all passing:

| File | Tests |
|---|---|
| `test_scoring.py` | 32 |
| `test_metrics.py` | 18 |
| `test_splits.py` | 13 |
| `test_tfidf_model.py` | 13 |
| `test_promote.py` | 13 |
| `test_experiment.py` | 10 |
| `test_parity.py` | 7 |

`test_parity.py` is the one worth knowing: it asserts the evaluation harness
and the live scorer produce the same numbers, so a measured figure describes
what actually serves users.

---

## 9. Where every piece of data lives

### In Postgres

| Table · column | What it holds |
|---|---|
| `users.embedding` | `vector(384)` — the worker's profile vector |
| `users.embedding_hash` | 16 hex chars of sha256 of the text that produced it |
| `users.skills`, `.bio`, `.location` | the inputs to `profile_text` |
| `users.reputation_score` | 0–5, maintained by `update_reputation` (migration 019) |
| `gigs.embedding` | `vector(384)` — the gig vector |
| `gigs.embedding_hash` | staleness marker; a mismatch means the gig was edited |
| `gigs.title`, `.description`, `.required_skills` | the inputs to `gig_text` |
| `gigs.location`, `.is_remote` | the inputs to `location_affinity` |
| `reviews` | 399 rows; the source of every reputation score |
| `ai_match_logs` | 58 rows — per-signal scores for every match ever served |

### Indexes and functions

| Object | Migration | Purpose |
|---|---|---|
| `gigs_embedding_idx` (HNSW, cosine) | 014 | vector search |
| `gigs_embedding_missing_idx` | 014 | find gigs needing embedding cheaply |
| `nearest_open_gigs(...)` | 017 | retrieval + hard filters + employer reputation |
| `gigs_needing_embedding(...)` | 014/015 | the backfill worklist |
| `update_reputation()` | 019 | recompute a score when a review changes |

### On disk

| Path | Contents |
|---|---|
| `apps/ai-engine/artifacts/tfidf_vectorizer.joblib` | the **deployed** vectoriser |
| `apps/ai-engine/artifacts/deployed.json` | which run it came from |
| `apps/ai-engine/artifacts/*.previous` | the rollback copy |
| `apps/ai-engine/eval/corpus/` | profiles, gigs, employers, relevance, splits |
| `apps/ai-engine/eval/corpus_sources/kesco_occupations.json` | parsed KeSCO |
| `apps/ai-engine/eval/results/runs/<run-id>/` | per-run manifest, metrics, predictions, log, artefact |
| `data/annotation/sheet_v1.json` | 100 blind annotation pairs |
| `data/annotation/relevance_ai_assisted_v1.jsonl` | my labels, honestly tagged |
| `data/raw/esco/` | ESCO concepts (not used — see `docs/DATA_SOURCES.md`) |

---

## 10. Commands

```bash
cd apps/ai-engine

python -m pytest tests -q                      # 106 tests

python -m eval.run_eval --split validation     # the baselines table
python -m eval.run_eval --split test           # the final figure — once

python -m eval.tune_weights                    # grid search + guards
python -m eval.ablation                        # one signal at a time
python -m eval.compare <run-a> <run-b>         # diff two runs

python -m eval.promote --status                # what is deployed
python -m eval.promote <run-id>                # deploy an artefact
python -m eval.promote --rollback              # undo
```

---

## 11. Likely questions, shortest honest answers

**Which model, and why?** `all-MiniLM-L6-v2`. 384 dimensions, strong on short
semantic-similarity tasks, small enough to run on modest hardware. Gig titles
and skill lists are short text, which is what it is good at.

**Why not fine-tune?** 47 profiles. It would memorise, not generalise.

**Why not use an LLM?** Per-request cost and latency for a ranking that must
run over every open gig, and a dependency on an external API for the platform's
core function. A 384-dim encoder with vectors cached in Postgres does this in
one indexed query.

**How do you know it is better than keyword search?** NDCG@10 0.891 for semantic
versus 0.812 for TF-IDF on validation — but note the CIs overlap, and that
TF-IDF is itself a strong baseline here.

**Why is location weighted only 0.03?** Because the ground truth cannot
validate it — correlation −0.0033 — so a larger weight would be unjustified.
It is non-zero because that is a limitation of the labels, not evidence that
location does not matter.

**What would you do with more time?** Real relevance judgements from Kenyan
workers and employers, a second annotator for agreement, evaluate
`CANDIDATE_POOL`, and add recency and pay as ranking signals.

---

See also: `docs/EVALUATION_PROTOCOL.md`, `docs/DATA_SOURCES.md`,
`docs/DATA_DICTIONARY.md`, `docs/PAYMENT_ENGINE.md`, `docs/REMAINING_WORK.md`.
