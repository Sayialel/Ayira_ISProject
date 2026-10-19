# Evaluation protocol

The rules the matching engine is measured by, fixed in advance so a result is
a measurement rather than a choice made after seeing the numbers.

Authoritative for splits, labels, metrics, baselines, tuning boundaries and
adoption criteria. How this maps onto the institutional workflow steps is in
[`apps/ai-engine/eval/WORKFLOW.md`](../apps/ai-engine/eval/WORKFLOW.md); the
day-to-day loop is in [SPRINT_II_WORKFLOW.md](SPRINT_II_WORKFLOW.md).

---

## The question

Given a worker's profile, does the engine rank the gigs a Kenyan youth worker
would actually want above the ones they would not?

**Nothing is trained.** `all-MiniLM-L6-v2` is used zero-shot, exactly as in
production. What is *fitted* is the TF-IDF vocabulary and document frequencies,
and four composite weights. The discipline below exists for those.

## Splits

| split | profiles | the only thing it may be used for |
|---|---|---|
| train | 29 | fitting the TF-IDF vocabulary; searching the weight grid |
| validation | 9 | every development decision |
| test | 9 | the final reported figure, read once |

**By profile, never by graded pair.** A profile is the query; the gigs are the
collection being searched. Splitting by pair would put some of a worker's
judged gigs in train and others in test, so weights fitted on the first would
already know that worker's preferences.

Stratified by category, so each split has a similar occupational mix — a plain
random split of 47 profiles can easily put every Writing profile in train.
Ordering within a category is by a hash of the profile id, so it is stable
across machines and does not depend on file order.

The gig collection is deliberately **shared** across splits: it is the thing
being searched, and a held-out worker searches the whole catalogue in
production. What is held out is the query and its judgements.

Decided in one place, `eval/splits.py`, so the rule cannot drift between
scripts. Seed `20261018`. Changing it invalidates every previously reported
figure.

**Known limitation.** Adding profiles moves the cut points, so a profile on a
boundary can change split. Churn is bounded and asserted in tests; the dataset
version makes it visible.

## Preprocessing

Fitted on **training data only**. For the shared gig collection that means the
gigs reachable from a training profile, plus the hand-authored probes which
belong to no split (`splits.fit_scope()`).

This is enforced, not merely intended: `tests/test_tfidf_model.py` checks the
fitted vocabulary contains no term absent from training documents.

The fitted vectoriser is persisted as an artefact and loaded by the service.
Fitting at request time would both leak held-out documents into the weighting
and make the same worker and gig score differently as the catalogue changed.

## Labels

Grades 0–3, per (worker, gig) pair:

| grade | meaning |
|---|---|
| 3 | ideal — the same occupation |
| 2 | good — closely related work |
| 1 | marginal — adjacent field, plausible but a stretch |
| 0 | irrelevant (omitted from the file) |

Two layers, recorded per row in a `layer` column:

- **derived** — implied by distance in the KeSCO hierarchy: same unit group 3,
  same minor group 2, same sub-major group 1, else 0. Transparent and
  reviewable, and it uses occupational *codes*, not the text the ranker scores,
  so it is not circular.
- **authored** — hand-assigned, overriding the derived value where the
  hierarchy implies something wrong. Each carries its reason.

Current: **532 derived, 33 authored.**

### Rules for labelling

- A gig is never graded relevant because the current ranker scores it highly.
- Location and employer reputation must not be labelled using the same formula
  the engine scores them with. This is why both are currently unlabelled
  rather than labelled circularly.
- Every label records whether it is human-authored or rule-derived.

### The binding constraint

Authored labels barely reach the splits that matter: **4 of 88 validation
labels, 5 of 121 test labels.** So no human-labelled figure can presently be
reported, and there is no inter-annotator agreement, so the labels have no
measured reliability. One annotator, the project author.

A second annotator independently grading 50–80 of the same pairs would give a
Cohen's κ and expose where the rubric is vague. This is the single largest
threat to validity.

## Metrics

| metric | k | notes |
|---|---|---|
| **NDCG@10** | 10 | **headline.** `2^grade − 1` gain rewards ranking an ideal match above an adequate one, which precision cannot see |
| NDCG@5 | 5 | reported by `eval.ablation` |
| Precision@5, @10 | 5, 10 | **relevance threshold: grade ≥ 2.** Grade 1 means "plausible but a stretch"; counting it would flatter every ranking |
| Recall@10 | 10 | over all items graded ≥ 2 |
| MRR | — | **saturated: 1.000 for every non-random strategy**, because the derived grades make many gigs relevant per profile. Reported for completeness; it does not discriminate and must not be quoted as if it did |

Averaged across profiles (macro). Defined in `eval/metrics.py`; the tuner's
vectorised NDCG is asserted equal to these to 1e-9, so the system cannot be
tuned for one metric and judged by another.

**Noise floor.** With 9 validation and 9 test profiles, differences below
**0.005 NDCG** are not resolvable and must be read as unchanged.
`eval.compare` enforces this in its output.

## Baselines

A score alone says nothing. Every run reports:

| baseline | the question it answers |
|---|---|
| random | does the method do anything at all |
| TF-IDF only | does the embedding model earn its cost over keyword overlap |
| semantic only | does the composite earn its complexity over the model alone |
| composite, as first shipped | has the project actually improved anything |

`eval.ablation` additionally reports each signal alone and the full composite
minus each signal, so a signal that costs quality is visible rather than
assumed useful.

## Tuning boundaries

- Grid of 0.05 steps, weights constrained to sum to 1.
- **Searched on train. Selected on validation. Reported on test, once.**
- A signal is **not searched** when the data cannot determine its weight:
  - *rank-invariant* — no variation across the candidates being ranked, so it
    cannot reorder them;
  - *label-uninformative* — |r| < 0.05 against the grades, so the labels carry
    no information about it.

  Both are detected, not hardcoded, and held at their current value.

  This exists because searching such a weight does not leave it undetermined —
  it returns a confident number for the wrong reason. A reputation weight of
  0.55 was once reported as the best found, purely because the sum-to-1
  constraint let an inert term absorb the remainder.

- Currently held fixed: **location** (r = −0.024) and **reputation**
  (r = −0.039). Their weights are an explicit product prior of 0.03 each, not
  a measurement.

## Adoption criteria

A change is adopted only if **all** hold:

1. Validation NDCG@10 improves by **more than 0.005** over the incumbent.
2. The improvement does not come from removing a signal the labels cannot
   judge. Such a gain is an artefact: against labels blind to a signal, any
   weight on it dilutes the ones they reward, so a search drives it to zero and
   appears to prove the signal useless.
3. The full test suite passes.
4. The run is reproducible — committed tree, recorded dataset version,
   artefacts preserved.
5. Where gains are within noise, the **simpler or incumbent** model is kept.

Promotion to the live service has further gates — see
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

Criterion 2 is not hypothetical. An early run showed +0.027 validation and
+0.030 test, and almost all of it came from deleting the location term.

## Current results

Validation, 9 profiles over 104 gigs, corpus `6ac4675ae766`:

| strategy | P@5 | P@10 | R@10 | MRR | NDCG@10 |
|---|---|---|---|---|---|
| random | 0.044 | 0.056 | 0.117 | 0.142 | 0.081 |
| tfidf only | 0.533 | 0.300 | 0.636 | 1.000 | 0.812 |
| semantic only | 0.556 | 0.456 | 0.904 | 1.000 | 0.891 |
| composite, as first shipped | 0.556 | 0.356 | 0.717 | 1.000 | 0.846 |
| **composite, current** | 0.600 | 0.433 | 0.867 | 1.000 | **0.897** |

Ablation (validation, weights renormalised within each subset):

| subset | NDCG@10 | vs full |
|---|---|---|
| full | 0.8977 | — |
| text only (semantic + tfidf) | 0.9079 | +0.0101 |
| semantic alone | 0.8914 | −0.0063 |
| without semantic | 0.7753 | −0.1224 |
| without tfidf | 0.8817 | −0.0160 |
| without location | 0.9046 | +0.0069 |
| without reputation | 0.8945 | −0.0032 |

Reading: semantic carries the result. TF-IDF adds ~0.011 on top of it. The two
unjudgeable signals cost 0.016 together — the price of not overfitting to a
blind spot in the labels, down from 0.035 before the weights were reduced.

Weight tuning: train best 0.8154 against 0.8081 for the incumbent, but
validation gain **−0.0001**, so the incumbent stands.

**Final test figure, read once: NDCG@10 0.8499.**

Two-stage retrieval (validation): shortlists of 15 and above are exact on this
corpus; 10 scores marginally higher; 3 and 5 cost 0.137 and 0.098.
**The production setting `CANDIDATE_POOL = 200` has never been evaluated**,
because the corpus holds 104 gigs — "exhaustive" here *is* production.

## Limitations

Stated because they bound what the figures above support.

1. **One annotator**, and validation/test are ~95% rule-derived. No measured
   label reliability.
2. **Most labels measure occupational proximity**, not what a worker wants —
   and that is why location and reputation are unmeasurable here.
3. **Small splits.** 9 and 9. Treat sub-0.005 differences as noise.
4. **MRR is saturated** and uninformative.
5. **The corpus is synthetic**, generated from KeSCO and reported pay
   distributions, not observed behaviour. No clicks, applications or hiring
   outcomes exist.
6. **The production shortlist size is untested** at its real value.
7. **semantic and tfidf correlate at +0.70**, so they are not independent
   evidence.

Synthetic evaluation cannot establish production quality. These figures
establish that the ranking agrees with a transparent, nationally-grounded
relevance rule, and that it beats keyword matching, random ordering and its own
earlier configuration.

## Reproducing

```bash
cd apps/ai-engine
pip install -r requirements-eval.txt

python -m eval.corpus_sources.build_corpus   # corpus + splits
python -m pytest                             # 103 tests
python -m eval.run_eval                      # baselines, validation
python -m eval.ablation                      # signal contribution
python -m eval.tune_weights                  # train -> validation -> test
python -m eval.retrieval_eval                # shortlist cost
python -m eval.compare --list                # recorded runs
```
