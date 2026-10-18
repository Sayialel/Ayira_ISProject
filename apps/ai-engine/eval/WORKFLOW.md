# The experiment workflow

How the matching engine's machine-learning work is organised, and where each
part of the required workflow is implemented.

The workflow has seven steps, and each one below names the files that carry it
out, the command that runs it, and what it actually produced. Findings are
reported as measured, including the ones that went the wrong way.

> **Terminology.** Nothing in this system is trained. `all-MiniLM-L6-v2` is
> used zero-shot, exactly as in production. What is *fitted* is the TF-IDF
> vocabulary and document frequencies, and four composite weights. The split
> discipline below exists for those.

---

## Step 1 — Define the question, the baseline, the metrics and the splits

**The question.** Given a worker's profile, does the engine rank the gigs a
Kenyan youth worker would actually want above the ones they would not?

**The baselines**, so a score is never reported on its own:

| baseline | what it tests |
|---|---|
| random | the floor — any method must beat shuffling |
| TF-IDF only | whether the embedding model earns its cost over keyword overlap |
| semantic only | whether the composite earns its complexity over the model alone |

**The metrics** — `eval/metrics.py`:

- **NDCG@10** is the headline. The `2^grade − 1` gain is why: it rewards
  putting an ideal match above a merely adequate one, which precision cannot
  see.
- **Precision@5, Precision@10** with a relevance threshold of grade ≥ 2.
  Grade 1 means "plausible but a stretch", and counting those as hits would
  flatter every ranking.
- **Recall@10**, **MRR**.

**The splits** — `eval/splits.py`. Three splits with distinct jobs:

| split | profiles | job |
|---|---|---|
| train | 29 | fit the TF-IDF vocabulary and search the weight grid |
| validation | 9 | every development decision |
| test | 9 | the final figure, read once |

Split **by profile, not by graded pair**. A profile is the query and the gigs
are the collection being searched. Splitting by pair would put some of a
worker's judged gigs in train and others in test, so weights fitted on the
first would already know that worker's preferences. Splitting by profile keeps
a held-out worker genuinely unseen.

Stratified by category, so each split has a similar occupational mix — a plain
random split of 47 profiles can easily put every Writing profile in train.
Assignment is by a hash of the profile id rather than a shuffle, so adding a
profile later moves only that profile instead of reshuffling everyone.

```bash
python -m eval.corpus_sources.build_corpus   # writes corpus/ and splits.json
```

---

## Step 2 — Develop locally and version the work

The engine is a normal part of the monorepo, versioned in git with everything
else. The evaluation calls the same `score_gigs()` that serves live requests
(`app/services/scoring.py`), so the harness cannot drift from the system it
claims to describe.

| file | role |
|---|---|
| `eval/splits.py` | the only place that decides which profile is in which split |
| `eval/harness.py` | loads the corpus, fits preprocessing on train, runs a strategy over a split |
| `eval/metrics.py` | the metric definitions |
| `eval/experiment.py` | run identity and the evidence folder |
| `eval/plots.py` | the figures |
| `app/services/tfidf_model.py` | TF-IDF as a persisted artefact |

The corpus itself is generated, not hand-written, and `eval/corpus/` is
regenerated rather than edited. Provenance and licensing are in
`corpus_sources/README.md`. Occupations come from the **Kenya Standard
Classification of Occupations (KeSCO-2022)**.

---

## Step 3 — Make the experiment reproducible

`eval/experiment.py` records, for every run:

- the **Git commit**, the branch, and **whether the working tree was dirty**
- the **dataset version** — a SHA-256 content hash of the corpus files
- the **dependency versions** actually resolved, and the Python version
- the **random seeds** (`SPLIT_SEED = 20261018`, and the random baseline's seed)
- the **parameters** of the run
- a **run identifier**: `<UTC timestamp>__<name>__<commit>`

Nothing else writes results. A result that exists without its provenance
cannot be produced by accident.

Two of these earn their place immediately:

- **`dirty`** marks a run made from uncommitted code. Such a run cannot be
  rebuilt from its commit, and `eval/promote.py` refuses to deploy its
  artefact for that reason.
- **Dependency capture caught a real problem on its first use.** Installing
  matplotlib silently upgraded numpy from the pinned 1.26.4 to 2.5.4, via
  matplotlib's `contourpy` dependency. The manifest recorded the upgrade, the
  pin was restored, and `contourpy==1.2.1` is now pinned explicitly in
  `requirements-eval.txt` with a comment explaining why.

**Preprocessing is fitted on training data only.** This was a real defect, not
a formality. TF-IDF was previously fitted on every request over the whole
candidate pool, which meant two things:

1. *Leakage.* Inverse document frequency learned from the full pool let the
   weighting reflect validation and test gigs.
2. *Irreproducibility.* IDF computed over "whatever is posted right now" meant
   the same worker and the same gig scored differently next week with neither
   changed, so two runs could not be compared at all.

`app/services/tfidf_model.py` makes it a fitted, persisted artefact, and
`harness.fit_training_vectorizer()` fits it on the training split only —
specifically the gigs reachable from training profiles plus the hand-authored
probes (`splits.fit_scope()`). Current vocabulary: 1,160 terms.

**Validation for decisions, test reserved.** `eval/run_eval.py` defaults to
the validation split, and logs a warning when asked for test. `eval/tune_weights.py`
searches on train, decides on validation, and reads test once at the end.

---

## Step 4 — Preserve the evidence

Every run writes a folder named for the run id, holding:

| file | what it is |
|---|---|
| `manifest.json` | commit, dataset version, seeds, parameters, dependencies, environment |
| `metrics.json` | the numbers |
| `metrics.txt` | the same table as printed |
| `predictions.json` | the top 10 for every profile, per strategy |
| `tfidf_vectorizer.joblib` | the preprocessing artefact |
| `splits.json` | the split assignment used |
| `baselines.png` / `weight_sensitivity.png` / `shortlist_curve.png` | the plots |
| `run.log` | the run's own log |

**Where it goes.** In Colab the folder is written to
`MyDrive/ayira/runs/<run-id>/`, and the run **refuses to start** if Drive is
not mounted — a run saved only to the Colab runtime vanishes with the session,
which is the one failure that leaves a number with no evidence behind it.
Locally it is written to `eval/results/runs/`.

---

## Step 5 — Bring the results back

Drive syncs the run folders to the desktop, so the evidence is readable from
the local IDE without re-running anything.

The one artefact the running service needs is the TF-IDF vectoriser.
`eval/promote.py` deploys it:

```bash
python -m eval.promote              # list runs with a promotable artefact
python -m eval.promote <run-id>     # deploy it
python -m eval.promote --status     # what is deployed, and which run it came from
```

Promotion is a separate command rather than something an experiment does on its
own, because an experiment that redeployed the service as a side effect would
turn every exploratory run into a production change. It refuses a run from a
dirty tree, verifies the artefact loads before overwriting what is already
serving, and writes `artifacts/deployed.json` recording the run, commit and
dataset version behind the deployed file.

Until an artefact is promoted, `tfidf_model.load_serving()` returns `None`,
`score_gigs()` falls back to per-request fitting, and a warning is logged. The
fallback works, but figures measured offline will not reproduce live.

**Currently deployed:** `artifacts/tfidf_vectorizer.joblib`, 1,160 terms, from
run `20261018T183641Z__baselines-validation__92d821c` on dataset
`140a66f39f04`. Verified to produce rankings identical to the offline harness,
so the evaluation and the service now measure the same system.

The promote step also surfaced a defect in the provenance capture itself. Runs
write their evidence into the repository, so `git_state()` saw the folder the
run had just created and reported `dirty: true` — which made `promote` refuse
every artefact and reduced the flag to noise. The dirty assessment now ignores
paths under `eval/results/`, and the state is captured at run start rather than
re-read at finish.

---

## Step 6 — Investigate, then verify against the code

Claims about the system were checked against the code and the data rather than
asserted. Two of those checks changed the result, and both are recorded below
under Step 7.

---

## Step 7 — Test whether a change is an improvement, and keep what failed

`eval/compare.py` reports the difference between two runs, and **refuses to
subtract** when their dataset versions or splits differ — those numbers would
look like a result without being one.

```bash
python -m eval.compare --list
python -m eval.compare <baseline-run> <candidate-run>
```

Unsuccessful runs are kept. All five runs from the session below are in
`eval/results/runs/`, including the two that produced a wrong answer.

### What was measured

Baselines, validation split, 9 profiles over 104 gigs:

| strategy | P@5 | P@10 | R@10 | MRR | NDCG@10 |
|---|---|---|---|---|---|
| random | 0.044 | 0.056 | 0.117 | 0.142 | 0.081 |
| tfidf only | 0.533 | 0.300 | 0.636 | 1.000 | 0.812 |
| semantic only | 0.556 | 0.456 | 0.904 | 1.000 | **0.891** |
| composite (shipped 0.45/0.25/0.15/0.15) | 0.578 | 0.367 | 0.727 | 1.000 | 0.854 |
| composite (current 0.60/0.20/0.05/0.15) | 0.578 | 0.411 | 0.811 | 1.000 | 0.878 |

Weight tuning: best on train was semantic 0.55 / tfidf 0.25 at NDCG@10
0.8132, against 0.8053 for the current weights. On validation that advantage
disappeared entirely — 0.8783 against 0.8784, a gain of −0.0000, well under
the 0.005 adoption margin. **The current weights stand.** Final test figure:
**0.8457**.

That is the split discipline doing its job: a +0.008 gain found on train did
not survive contact with profiles it was not chosen on.

### Three findings worth stating plainly

**1. The reputation weight cannot be tuned from ranking data, and a naive
search reported a confident value for it anyway.**

`score_gigs()` reads the *worker's own* reputation once
(`app/services/scoring.py:177`) and adds the same term to every candidate gig
(`:198`). A constant added to every candidate cannot reorder them. Verified
directly: two weight sets differing only in reputation (0.20/0.25/0.00/**0.55**
versus 0.40/0.50/0.00/**0.10**) produce **identical top-10 rankings for all 47
profiles**, and sweeping the reputation weight from 0.00 to 0.95 changes
NDCG@10 by exactly zero.

The first tuning run nonetheless reported "best weights: semantic 0.20, tfidf
0.25, location 0.00, reputation 0.55" — because the weights are constrained to
sum to 1, so reputation silently absorbed whatever was left over. Presented as
a finding, that would have read as "reputation is the most important signal",
which is the opposite of true. `tune_weights.rank_invariant_signals()` now
detects such signals and holds them fixed.

*To make this term do anything, it should be the **employer's** reputation,
which varies per gig, and which is what a worker choosing between gigs would
actually care about.*

**2. The corpus cannot measure the location signal at all.**

Relevance grades are derived from distance in the KeSCO occupational hierarchy
(`build_corpus.derived_grade()`), and `build_corpus.pick_location()` assigns
each gig a town independently at random. Location never enters a grade.
Measured over all 4,888 profile–gig pairs:

| signal | correlation with the grade |
|---|---|
| tfidf | +0.618 |
| semantic | +0.557 |
| reputation | +0.007 |
| **location** | **−0.003** |

The mean grade is 0.192 where location matches and 0.196 where it does not.

This is a trap, not merely a gap. Against labels that cannot reward location,
any weight on it only dilutes the signals that *can* be rewarded, so a grid
search drives it to zero and appears to have discovered that location is
useless to workers. The first two tuning runs did exactly that, and the
apparent **+0.027 validation / +0.030 test gain came almost entirely from
deleting the location term** — holding location at 0.05 erased it (0.879
against 0.907).

`tune_weights.label_uninformative_signals()` now detects signals the labels say
nothing about and holds them fixed. Measuring whether location actually helps
needs labels that vary with it.

**3. On this corpus, the embedding model alone ranks slightly better than the
composite** (0.891 against 0.878 on validation). Consistent with the two
findings above: of the composite's four signals, reputation cannot reorder
anything and location is unrewarded by the labels, so the composite is
effectively semantic + TF-IDF carrying two inert terms. The same pattern
appears in the retrieval experiment, where a semantic shortlist of 10 scores
*above* exhaustive composite scoring (0.8946 against 0.8784).

### Two-stage retrieval

| shortlist | NDCG@10 | vs exhaustive |
|---|---|---|
| 3 | 0.7547 | −0.1236 |
| 5 | 0.7931 | −0.0853 |
| 10 | 0.8946 | +0.0162 |
| 15 | 0.8803 | +0.0019 |
| 20 / 30 / exhaustive | 0.8784 | — |

A shortlist of 10 gives up nothing on this corpus. Shortlists of 3 and 5 cost
real quality.

---

## Known limitations

Stated because they bound what the numbers above support.

1. **A single annotator.** The 33 hand-authored grades were authored by one
   person — the project author. There is no inter-annotator agreement figure,
   so the labels have no measured reliability. This is the largest threat to
   validity.
2. **Most labels are derived, not judged.** 532 of 565 graded pairs come from
   the KeSCO hierarchy rule. That rule is defensible and transparent, but it
   measures occupational proximity, not what a worker wants — and it is why
   location and reputation are unmeasurable here.
3. **The splits are small.** 9 validation and 9 test profiles. Differences
   below roughly 0.005 NDCG should be read as noise, which is why
   `eval/compare.py` says so and why the adoption margin is set there.
4. **MRR is saturated.** Every non-random strategy scores 1.000, because the
   derived grades make many gigs relevant for each profile, so the first result
   is essentially always a hit. MRR does not discriminate between methods here
   and should not be quoted as if it did.
5. **The corpus is synthetic.** Generated from a real national occupational
   standard and real reported pay distributions, but not observed platform
   behaviour. No click or hiring data exists yet.

## Reproducing a run

```bash
cd apps/ai-engine
pip install -r requirements-eval.txt

python -m eval.corpus_sources.build_corpus   # corpus + splits
python -m eval.run_eval                      # baselines, validation split
python -m eval.tune_weights                  # weights: train -> validation -> test
python -m eval.retrieval_eval                # shortlist cost
python -m eval.compare --list                # recorded runs
python -m eval.promote --status              # what the service is serving
```

In Colab, `notebooks/ayira_experiment.ipynb` does the same against a pinned
commit, writing every run folder to Drive. It needs no credentials: the
evaluation reads the committed corpus, not the live database.
