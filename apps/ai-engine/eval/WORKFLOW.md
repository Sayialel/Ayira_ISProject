# The experiment workflow

How the matching engine's machine-learning work satisfies each step of the
required institutional workflow, and where each step is implemented.

This document is the **mapping**. The substance lives in four documents, so
nothing is stated twice and there is one place to correct:

| | |
|---|---|
| [`docs/EVALUATION_PROTOCOL.md`](../../../docs/EVALUATION_PROTOCOL.md) | splits, labels, metrics, baselines, tuning boundaries, adoption criteria, **current results and limitations** |
| [`docs/SPRINT_II_WORKFLOW.md`](../../../docs/SPRINT_II_WORKFLOW.md) | the Local → GitHub → Colab → Drive → Local loop, with commands and paths |
| [`docs/REPAIR_PLAN.md`](../../../docs/REPAIR_PLAN.md) | what was wrong, the evidence, what was fixed, what is open |
| [`docs/PRODUCTION_READINESS.md`](../../../docs/PRODUCTION_READINESS.md) | tests, artefacts, parity, monitoring, rollback, promotion gates |

> **Terminology.** Nothing here is trained. `all-MiniLM-L6-v2` is used
> zero-shot, exactly as in production. What is *fitted* is the TF-IDF
> vocabulary and document frequencies, and four composite weights. The split
> discipline exists for those.

---

## 1 — Define the question, the baseline, the metrics and the splits

**Where:** `eval/splits.py`, `eval/metrics.py`, `eval/harness.py`.
**Specified in:** [EVALUATION_PROTOCOL.md](../../../docs/EVALUATION_PROTOCOL.md).

The question, three baselines (random, TF-IDF-only, semantic-only), five
metrics with NDCG@10 as the headline, and three splits of 29 / 9 / 9 profiles
— **split by profile, never by graded pair**, stratified by category.

```bash
python -m eval.corpus_sources.build_corpus   # writes corpus/ and splits.json
```

## 2 — Develop locally and version the work

**Where:** the whole repository; stage A of
[SPRINT_II_WORKFLOW.md](../../../docs/SPRINT_II_WORKFLOW.md).

The evaluation calls the same `score_gigs()` that serves live requests
(`app/services/scoring.py`), so the harness cannot drift from the system it
describes. `eval/corpus/` is regenerated, never hand-edited.

| file | role |
|---|---|
| `eval/splits.py` | the only place that decides which profile is in which split |
| `eval/harness.py` | loads the corpus, fits preprocessing on train, runs a strategy over a split |
| `eval/metrics.py` | the metric definitions |
| `eval/experiment.py` | run identity and the evidence folder |
| `eval/ablation.py` | what each signal contributes |
| `eval/plots.py` | the figures |
| `app/services/tfidf_model.py` | TF-IDF as a persisted artefact |
| `app/services/kenya_geography.py` | towns, counties and the location tiers |
| `tests/` | 103 tests guarding all of the above |

## 3 — Make the experiment reproducible

**Where:** `eval/experiment.py`.

Every run records the **Git commit** and whether the tree was **dirty**, a
**dataset version** (SHA-256 of the corpus files), the **dependency versions
actually resolved**, the **random seeds**, the **parameters**, and a **run
identifier** `<UTC timestamp>__<name>__<commit>`.

Nothing else writes results, so a result cannot exist without its provenance.

- **Preprocessing is fitted on training data only** —
  `harness.fit_training_vectorizer()` over `splits.fit_scope()`, enforced by a
  test that checks the real vocabulary contains no non-training term.
- **Validation for decisions, test reserved.** `eval/run_eval.py` defaults to
  validation and warns when asked for test; `eval/tune_weights.py` searches on
  train, decides on validation, reads test once.

Three defects this step exposed — a dependency silently upgraded past its pin,
runs marking themselves unreproducible, and a path-parsing bug — are recorded
in [REPAIR_PLAN.md](../../../docs/REPAIR_PLAN.md).

## 4 — Preserve the evidence

**Where:** `eval/experiment.py`; layout documented in
[SPRINT_II_WORKFLOW.md](../../../docs/SPRINT_II_WORKFLOW.md) stage D.

One folder per run, holding the manifest, metrics, predictions, preprocessing
artefact, split assignment, plots and log. Written to
`MyDrive/ayira/runs/` in Colab and `eval/results/runs/` locally.

A run **refuses to start** in Colab without Drive mounted: a run saved only to
the Colab runtime vanishes with the session, which is the one failure that
leaves a number with no evidence behind it.

## 5 — Bring the results back

**Where:** `eval/promote.py`.

```bash
python -m eval.promote              # runs with a promotable artefact
python -m eval.promote <run-id>     # deploy it
python -m eval.promote --status     # what is deployed, and from where
python -m eval.promote --rollback   # undo the last promotion
```

Promotion is a separate command from evaluation, because an experiment that
redeployed the service as a side effect would turn every exploratory run into a
production change. Gates and rollback in
[PRODUCTION_READINESS.md](../../../docs/PRODUCTION_READINESS.md).

## 6 — Investigate, then verify against the code

Every claim in [REPAIR_PLAN.md](../../../docs/REPAIR_PLAN.md) carries the file
and the measurement it rests on. Two investigations changed the result rather
than confirming it:

- the reputation weight could not affect any ranking — verified by identical
  top-10 rankings across all 47 profiles while sweeping it;
- the corpus cannot judge location or employer reputation — verified by
  correlating each signal against the grades.

Both are now detected automatically, by
`tune_weights.rank_invariant_signals()` and
`tune_weights.label_uninformative_signals()`, so neither can recur silently.

## 7 — Test whether a change is an improvement, and keep what failed

**Where:** `eval/compare.py`, `eval/ablation.py`.

```bash
python -m eval.compare --list
python -m eval.compare <baseline-run> <candidate-run>
```

`compare` **refuses to subtract** runs whose dataset versions or splits differ,
because that difference would look like a result without being one.

Unsuccessful runs are kept. `eval/results/runs/` includes the two early tuning
runs that produced a confident but wrong answer; they are the evidence for the
corrections in [REPAIR_PLAN.md](../../../docs/REPAIR_PLAN.md).

Results, the ablation, and the limitations that bound them are in
[EVALUATION_PROTOCOL.md](../../../docs/EVALUATION_PROTOCOL.md).

---

## Reproducing everything

```bash
cd apps/ai-engine
pip install -r requirements-eval.txt

python -m eval.corpus_sources.build_corpus
python -m pytest
python -m eval.run_eval
python -m eval.ablation
python -m eval.tune_weights
python -m eval.retrieval_eval
```

In Colab, `notebooks/ayira_experiment.ipynb` does the same against a pinned
commit, writing every run folder to Drive. It needs no credentials: the
evaluation reads the committed corpus, not the live database.
