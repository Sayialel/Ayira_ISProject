# Matching evaluation

Measures how well the engine ranks gigs for a worker, so the composite weights
are a result rather than an assertion.

```bash
cd apps/ai-engine
python -m eval.corpus_sources.parse_kesco     # occupational standard -> JSON
python -m eval.corpus_sources.build_corpus    # JSON -> the corpus
python -m eval.run_eval                       # baselines vs the live system
python -m eval.tune_weights                   # grid search over the weights
python -m eval.retrieval_eval                 # what the shortlist costs
python -m eval.compare --list                 # recorded runs
python -m eval.promote --status               # what the service is serving
```

Each writes a folder to `eval/results/runs/` holding its metrics, manifest,
predictions, artefacts and plots, so runs can be compared over time.

**See [WORKFLOW.md](WORKFLOW.md)** for how this maps onto the required
experiment workflow, the provenance recorded for each run, and the findings
and limitations so far.

---

## What is being measured

Nothing is trained. `all-MiniLM-L6-v2` is used zero-shot, exactly as in
production — the harness calls `app.services.scoring.score_gigs()`, the same
function that serves live requests, so the evaluation cannot drift from the
system it claims to describe.

What *is* fitted is the TF-IDF vocabulary and document frequencies
(`app/services/tfidf_model.py`, fitted on the training split only), and the
four weights of the composite formula.

## The corpus

Generated, not written. `eval/corpus_sources/` holds the generator and the
sources it draws on; `eval/corpus/` holds its output and is regenerated rather
than edited. See `corpus_sources/README.md` for provenance and licensing.

- **47 worker profiles**, one per occupation
- **104 gigs** — 94 generated, 10 hand-authored
- **565 graded pairs** (33 hand-authored, 532 derived from the KeSCO
  hierarchy); the remaining 4,323 are implicitly grade 0
- split **by profile** into 29 train / 9 validation / 9 test

Occupations, skills and the language describing work come from the **Kenya
Standard Classification of Occupations (KeSCO-2022)**. Pay is drawn from a
lognormal reproducing WorkKE's observed figures for a real Kenyan platform
(median KES 2,000, mean KES 4,664), scaled by KeSCO's own skill-level grouping.

### How relevance is decided

Two layers, kept separate in the output so they can be analysed apart.

**Derived (204 pairs).** KeSCO's codes nest — 2512 Software Developers, 2513
Web and Multimedia Developers and 2514 Applications Programmers all sit inside
minor group 251 — so distance between codes is a published statement about how
related two kinds of work are.

| Relationship | Grade |
| --- | --- |
| Same unit group | 3 — ideal |
| Same minor group | 2 — good |
| Same sub-major group | 1 — marginal |
| Otherwise | 0 — irrelevant |

**Authored (33 pairs).** A hierarchy is a coarse proxy for fit, so the derived
baseline is corrected where it is wrong, each with a recorded reason.

Precision and recall count only grade 2 and above; counting "marginal" as a hit
would flatter every strategy.

### Two things the generator does deliberately

**Paraphrase gigs** describe work in a client's words while avoiding the
occupation's vocabulary entirely — *"Take the admin off my plate"* never says
virtual assistant. They separate semantic matching from keyword matching.

**Profiles and gigs are built from different halves of the task list.** Drawing
both from the whole list would make a worker and their matching gig share
wording no real pair would share. The first version did exactly that, and the
consequence is measured below.

---

## Findings

### 1. Vocabulary leakage inflates lexical matching

The generator initially drew profile skills and gig descriptions from the same
task statements. Splitting the list changed only the construction, not the
method, and moved the numbers:

| strategy | shared source | split source |
| --- | --- | --- |
| tfidf only | 0.781 | **0.732** |
| semantic only | 0.810 | 0.817 |
| composite (tuned) | 0.820 | 0.817 |

Keyword matching lost 0.049 NDCG; semantic matching was unaffected. The leak
was feeding TF-IDF words it would never see in a real pairing. Worth recording
because it is invisible in the output and would have silently overstated the
lexical baseline.

### 2. Semantic similarity carries the signal

On the corrected corpus:

| strategy | P@5 | P@10 | R@10 | MRR | NDCG@10 |
| --- | --- | --- | --- | --- | --- |
| random | 0.104 | 0.096 | 0.175 | 0.255 | 0.142 |
| tfidf only | 0.480 | 0.316 | 0.628 | 0.939 | 0.732 |
| semantic only | 0.544 | 0.380 | 0.727 | 1.000 | **0.817** |
| composite (shipped 0.45/0.25/0.15/0.15) | 0.552 | 0.356 | 0.688 | 0.968 | 0.776 |
| composite (current 0.60/0.20/0.05/0.15) | 0.568 | 0.380 | 0.722 | 1.000 | **0.817** |

The embedding model leads keyword matching by 0.085 NDCG, and it is the only
strategy besides the tuned composite to reach MRR 1.000 — the first relevant
result is always top of the list.

### 3. The weights generalise across independently built corpora

The current weights were fitted on the earlier hand-written corpus. Re-fitting
them on this one — different occupations, different vocabulary, different
construction — barely moves the optimum:

| | semantic | tfidf | location | reputation | NDCG@10 |
| --- | --- | --- | --- | --- | --- |
| current | 0.60 | 0.20 | 0.05 | 0.15 | 0.8169 |
| best on this corpus | 0.50 | 0.15 | 0.00 | 0.35 | 0.8243 |

Cross-validated gain: **+0.0031**, well below the ~0.02 that counts as noise at
this sample size. **The weights were therefore left unchanged** — refitting for
a gain that small would be fitting the corpus rather than the problem, and the
fact that weights from one corpus hold on another is better evidence than the
0.007 would have been.

### 4. Reputation cannot affect ranking, at any weight

NDCG@10 is identical whether reputation's weight is 0.00 or 0.90. It is one
number per worker, so it adds the same constant to every gig that worker is
scored against, and a constant cannot reorder a list. The weight search is
correspondingly indifferent to it: the top combinations place it anywhere from
0.10 to 0.45 with no change in score.

It does shift the number displayed. A worker with no reviews is capped at 85%,
so a newcomer's perfect match shows worse than an established worker's mediocre
one — backwards, since reputation says nothing about whether *this* gig suits
*this* worker. It belongs in ranking only where gigs are compared across
workers, as an employer's applicant list would.

### 5. Location as an additive bonus still makes ranking worse

Every one of the top weight combinations sets location to **0.00**.

This finding was previously caveated: the old corpus was Nairobi-heavy, so it
could not judge location fairly. This corpus draws from nine Kenyan towns
weighted toward where platform work concentrates, and location still comes out
at zero. The earlier caveat is substantially answered.

A flat bonus rewards being *nearby* independently of being *suitable*, so an
irrelevant local gig outranks a well-matched distant one — and since remote
gigs always collect it, it is close to free. The defensible reading remains
that **a flat additive bonus is the wrong mechanism**: location belongs as a
filter or tie-breaker, not as a term competing with fit. A weight of 0.05 is
kept rather than 0.00 so the signal is not discarded outright.

---

## Retrieval: does the shortlist cost anything?

The engine does not score every open gig. Postgres returns the nearest
candidates by vector and only those are re-ranked. That is faster by
construction but can only rank what the shortlist contains.

| shortlist | NDCG@10 | vs exhaustive |
| --- | --- | --- |
| 3 | 0.6745 | −0.1424 |
| 5 | 0.7341 | −0.0828 |
| 10 | 0.8213 | +0.0045 |
| 20 | 0.8169 | exact |
| score everything | 0.8169 | — |

Exact from 20 candidates upward. The engine keeps **200**, an order of
magnitude more headroom than the measurement requires.

## Cost

What the previous architecture paid on *every* request, and the current one
pays only when a gig is created or edited:

| catalogue | model encode time per request |
| --- | --- |
| 42 gigs | 0.389 s |
| 250 gigs | 1.890 s |
| 1,000 gigs | 6.925 s |

Linear in catalogue size, paid per request. The current path spends none of it.
Measured end to end, the service held 0.42–0.50 s over 42 gigs where it
previously took 0.43–0.45 s over 3 — the same latency for fourteen times the
catalogue, with what remains dominated by network round trips rather than
computation.

---

## What this evaluation does not establish

- **Relevance grading is still the project's own.** The derived layer comes
  from the national classification, which is a real improvement over assertion,
  but the mapping from hierarchy distance to a 0–3 grade is a choice, and the
  33 authored corrections are judgements. **No second annotator has reviewed
  them, so no inter-annotator agreement can be reported.** This remains the
  largest threat to validity.
- **The corpus is generated, not observed.** Its occupations, vocabulary and
  pay distribution come from published Kenyan sources, but no real worker wrote
  a profile and no real employer posted a gig.
- **Twenty-five profiles is a small sample.** Treat differences under about
  0.02 NDCG as noise — which is precisely why finding 3 left the weights alone.
- **English only.** Nothing here tests Swahili, Sheng or code-switched text,
  which the model does not handle and which this platform's users write in.
- **Ranking quality is not outcome quality.** A well-ranked gig is not evidence
  anyone applied, was hired or was paid. Once `applications` carries real data
  it becomes implicit relevance feedback and supersedes all of this.

## Files

| path | purpose |
| --- | --- |
| `corpus_sources/parse_kesco.py` | downloads and parses KeSCO-2022 |
| `corpus_sources/category_map.py` | which occupations are in scope, and their pay scaling |
| `corpus_sources/build_corpus.py` | generates the corpus and the derived grades |
| `corpus_sources/overrides.json` | hand-authored gigs and grade corrections |
| `corpus/` | generated output — regenerate, do not edit |
| `metrics.py` | Precision@k, Recall@k, MRR, NDCG@k |
| `harness.py` | corpus loading, ranking strategies, metric averaging |
| `run_eval.py` | baselines against the live system |
| `tune_weights.py` | grid search and cross-validation |
| `retrieval_eval.py` | what the candidate shortlist costs |
| `live_eval.py` | scores the running service over HTTP |
| `seed_db.py` | loads the corpus into Supabase, and removes it again |

## Working with a seeded database

```bash
python -m eval.seed_db seed     # workers and open gigs
python -m eval.live_eval        # score the running engine against them
python -m eval.seed_db clear    # remove everything it created
```

Seeded accounts carry the `@ayira-eval.invalid` suffix and `clear` matches on
it, so real accounts are never touched.
