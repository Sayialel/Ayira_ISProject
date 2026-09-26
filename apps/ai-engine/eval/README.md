# Matching evaluation

Measures how well the engine ranks gigs for a worker, so the composite weights
are a result rather than an assertion.

```bash
cd apps/ai-engine
python -m eval.run_eval        # baselines vs the live system
python -m eval.tune_weights    # grid search over the four weights
```

Both write a timestamped JSON file to `eval/results/`, which is committed so
runs can be compared over time.

---

## What is being measured

Nothing is trained. `all-MiniLM-L6-v2` is used zero-shot, exactly as it is in
production — the harness calls `app.services.scoring.score_gigs()`, the same
function that serves live requests, so the evaluation cannot drift from the
system it claims to describe.

What *is* fitted is four numbers: the weights of the composite formula.

## The corpus

`eval/corpus/` holds 12 worker profiles and 42 gigs, written to resemble the
Kenyan gig market the platform targets, with 68 graded pairs. Any pair not
listed in `relevance.csv` is treated as irrelevant.

| grade | meaning |
| --- | --- |
| 3 | ideal — squarely this worker's job |
| 2 | good — they could do it well |
| 1 | marginal — plausible but a stretch |
| 0 | irrelevant — omitted from the file |

Precision and recall count only grade 2 and above. Counting grade 1 as a hit
would flatter every ranking.

### Two kinds of hard case

The corpus would be worthless without them, and the first version of it was.

**`HARD`** — pairs where the wording pulls one way and the correct grade goes
the other. A React developer against a WordPress job: both are "web work" and
share vocabulary, but the stack is wrong. A mobile developer against a React
landing page whose description mentions "low-end Android phones".

**`PARAPHRASE`** — gigs that are genuinely ideal for a worker while avoiding
that worker's vocabulary entirely. *"Turn our Figma screens into a working web
interface… our team works in a modern JavaScript component framework"* never
says React. *"Take the admin off my plate"* never says virtual assistant.

These exist to separate lexical matching from semantic matching. Without them
the benchmark cannot tell the two apart — see the first finding below.

---

## Findings

### 1. The first benchmark was saturated and proved nothing

The corpus originally had 30 gigs whose relevant pairs shared literal skill
words with the profile ("React" → "React"). Every strategy scored about the
same:

| strategy | NDCG@10 |
| --- | --- |
| tfidf only | 0.964 |
| semantic only | 0.964 |
| composite | 0.960 |

Keyword matching did as well as the embedding model, because the task was
exactly what keyword matching is good at. MRR was 1.000 for all three: the top
result was always relevant, so there was no headroom to measure into.

**A benchmark that cannot separate a strong method from a weak one is not
evidence.** Adding the 12 paraphrase gigs fixed it.

### 2. Semantic similarity is doing the real work

With paraphrase cases present:

| strategy | P@5 | P@10 | R@10 | MRR | NDCG@10 |
| --- | --- | --- | --- | --- | --- |
| random | 0.067 | 0.083 | 0.232 | 0.262 | 0.150 |
| tfidf only | 0.500 | 0.275 | 0.838 | 1.000 | 0.828 |
| semantic only | 0.600 | 0.325 | 0.983 | 1.000 | **0.947** |
| composite (shipped) | 0.583 | 0.317 | 0.956 | 1.000 | 0.922 |
| composite (tuned) | 0.600 | 0.325 | 0.983 | 1.000 | 0.943 |

TF-IDF loses 0.12 NDCG to the embedding model, and it loses it precisely on
the gigs that describe the same work in different words. That is the empirical
case for using an embedding model at all.

Note what the shipped composite was doing: at **0.922 it ranked worse than
semantic similarity alone at 0.947**. The extra signals were subtracting value.

### 3. Reputation cannot affect ranking, at any weight

| reputation weight | NDCG@10 |
| --- | --- |
| 0.00 | 0.9223 |
| 0.15 | 0.9223 |
| 0.50 | 0.9223 |
| 0.90 | 0.9223 |

Identical, because reputation is one number per worker. It adds the same
constant to every gig that worker is scored against, and a constant cannot
reorder a list. Fifteen per cent of the formula was spent on a term that is
mathematically incapable of changing what the worker sees.

It does change the number displayed. A worker with no reviews has their score
capped at 85%, so **a new worker's perfect match shows as worse than an
established worker's mediocre one** — which is backwards, since reputation says
nothing about whether *this gig* suits *this worker*. Reputation belongs in
ranking only if gigs are ever ranked across workers, as an employer's applicant
list would be. That is the honest place for it.

### 4. Location as an additive bonus makes ranking worse

| location weight | NDCG@10 |
| --- | --- |
| 0.15 (shipped) | 0.9223 |
| 0.10 | 0.9349 |
| 0.05 | 0.9430 |
| 0.00 | 0.9504 |

Monotonic: every reduction helps. A flat bonus rewards *being nearby*
independently of *being suitable*, so an irrelevant Nairobi gig outranks a
well-matched Mombasa one. Remote gigs always score the bonus, which makes it
close to free.

**This result is the one to treat with most suspicion.** The corpus is
Nairobi-heavy, so location has little to distinguish and its value here is
understated. The defensible reading is not "location does not matter" but
"a flat additive bonus is the wrong mechanism" — it belongs as a filter or a
tie-breaker, not as a term competing with fit.

A weight of 0.05 is kept rather than 0.00 for that reason: the corpus cannot
fairly judge it, so the evidence is not taken further than it reaches.

### 5. Tuned weights

Grid search over 1,771 combinations on a 0.05 step, constrained to sum to 1:

| | semantic | tfidf | location | reputation | NDCG@10 |
| --- | --- | --- | --- | --- | --- |
| shipped | 0.45 | 0.25 | 0.15 | 0.15 | 0.9223 |
| best on corpus | 0.65 | 0.25 | 0.00 | 0.10 | 0.9504 |
| **adopted** | **0.60** | **0.20** | **0.05** | **0.15** | **0.9430** |

The adopted set is deliberately not the grid's best. It keeps a location signal
for the reason in finding 4, and keeps reputation because removing it is a
product decision about displayed scores rather than a ranking one.

Weights can be overridden without a deploy via `MATCH_WEIGHT_SEMANTIC`,
`MATCH_WEIGHT_TFIDF`, `MATCH_WEIGHT_LOCATION` and `MATCH_WEIGHT_REPUTATION`.

### 6. Does the tuning generalise?

Choosing weights on the same data you then report on measures how well the
search memorised the corpus. Leave-one-profile-out cross-validation — each
profile scored using weights chosen without it — gives the honest figure:

| | NDCG@10 |
| --- | --- |
| shipped weights | 0.9223 |
| tuned, on profiles never used for tuning | 0.9412 |
| **generalised gain** | **+0.019** |

Smaller than the +0.028 measured on the full corpus, as expected. The gain is
real but modest, and most of it comes from trusting the embedding model more.

---

## What this evaluation does not establish

State these plainly before citing any number above.

- **The corpus is synthetic and self-graded.** Profiles, gigs and grades were
  written by one person. No second annotator exists, so there is no
  inter-annotator agreement to report. This is the single largest threat to
  validity, and the first thing a pilot with real users would fix.
- **Twelve profiles is a small sample.** Cross-validated figures rest on twelve
  held-out measurements; treat differences under about 0.02 as noise.
- **Grades were authored alongside the gigs**, so they encode the author's
  model of relevance rather than any worker's. A real worker might reasonably
  disagree.
- **English only.** Nothing here tests Swahili, Sheng or code-switched text,
  which the model does not handle and which the platform's users write in.
  Benchmarking `paraphrase-multilingual-MiniLM-L12-v2` against this corpus
  would be a genuinely useful next result.
- **Ranking quality is not outcome quality.** A well-ranked gig is not evidence
  anyone applied to it, was hired, or was paid. Once `applications` carries
  real data, it becomes implicit relevance feedback and supersedes all of this.

## Files

| path | purpose |
| --- | --- |
| `corpus/profiles.json` | 12 worker profiles |
| `corpus/gigs.json` | 42 gigs, including 12 paraphrase cases |
| `corpus/relevance.csv` | 68 graded pairs; unlisted pairs are grade 0 |
| `metrics.py` | Precision@k, Recall@k, MRR, NDCG@k |
| `harness.py` | corpus loading, ranking strategies, metric averaging |
| `run_eval.py` | baselines against the live system |
| `tune_weights.py` | grid search and cross-validation |
| `results/` | committed output of each run |
