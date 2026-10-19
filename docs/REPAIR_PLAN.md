# Repair plan and audit record

What was wrong with the matching engine, what the evidence was, what was done,
and what is still open.

Audit run at commit `48629e0`; fixes land in `8184fc4` (reputation, tests) and
`35f057d` (location). Figures below are from the runs in
`apps/ai-engine/eval/results/runs/`, on corpus `6ac4675ae766` unless stated.

Severity is about consequence, not effort:

| | meaning |
|---|---|
| **S1** | produces a wrong or unjustifiable result, silently |
| **S2** | makes results untrustworthy or unreproducible |
| **S3** | correctness or clarity problem with bounded impact |

---

## Confirmed and fixed

### S1 — The reputation weight could not affect any ranking

**Evidence.** `score_gigs()` read the *worker's* own `reputation_score` once and
added the same term to every candidate gig. Two weight sets differing only in
the reputation coefficient (`0.20/0.25/0.00/0.55` and `0.40/0.50/0.00/0.10`)
produced **identical top-10 rankings for all 47 profiles**; sweeping the weight
from 0.00 to 0.95 changed NDCG@10 by exactly zero; the feature column had zero
within-profile variance.

Worse, the first tuning run reported `reputation 0.55` as the best weight.
Because the weights are constrained to sum to 1, reputation silently absorbed
whatever was left over, so an unidentifiable parameter was reported as the
dominant signal.

**Decision.** Redesign as the *employer's* reputation, which varies per gig —
the user's call, and the signal a worker choosing between gigs would use.

**Fix.** Migration `017_employer_reputation.sql` returns the posting employer's
`reputation_score` and a review count from `nearest_open_gigs`.
`scoring.employer_reputation()` resolves it. No new storage was needed: reviews
are symmetric and `update_reputation()` keys on `reviewee_id`, so employers
already accrue scores.

The review count matters: `reputation_score` is `0.00` both for "nobody has
reviewed them" and "every review was one star", and a 1–5 scale cannot produce
0. Without the count, every new employer would have ranked at the bottom.
Unreviewed now resolves to a neutral prior.

**Result.** Within-profile variance 0.1315 — the signal can now reorder
candidates. `tune_weights.rank_invariant_signals()` detects this class of
defect so it cannot recur silently.

### S1 — Location scored a 40 km commute the same as a 490 km journey

**Evidence.** `is_location_match()` compared town names for equality, so
Thika↔Nairobi scored identically to Mombasa↔Nairobi. A missing location
returned `False`, indistinguishable from a genuine mismatch. 84% of all
"matches" came from the gig being remote; only 508 of 2,162 non-remote pairs
were same-town.

**Fix.** `location_affinity()` resolves towns to counties and scores five
tiers: same town 1.0, same county 0.6, same metropolitan area 0.45, unknown
0.3, different county 0.0. Counties are the granularity the data supports —
`app/services/kenya_geography.py` explains why, and what is deliberately not
modelled.

Two things were needed to make this real rather than cosmetic:

- The **metropolitan tier**, because county tiering alone did *not* fix the
  motivating case: Thika is in Kiambu and Nairobi is its own county, so the
  commute still scored zero. The grouping follows the Nairobi Metropolitan
  Area as used by NaMATA.
- **More towns.** All nine original towns sat in distinct counties, so the
  same-county tier was unreachable — it would have existed with nothing able
  to exercise it. The corpus now has 21 towns, six counties hold more than
  one, and the tier fires on 49 profile–gig pairs.

**Ordering.** Unknown sits below every confirmed-reachable tier and above a
confirmed mismatch. That is the only ordering that treats missing data as
missing: it must not outrank a commute we verified, nor be grouped with one we
ruled out.

### S2 — TF-IDF was fitted per request

**Evidence.** Inverse document frequency was learned from the whole candidate
pool at scoring time, which (a) let validation and test documents influence the
weighting and (b) made the same worker and gig score differently as the
catalogue changed, so two runs could not be compared.

**Fix.** `app/services/tfidf_model.py` makes it a fitted, persisted artefact.
`harness.fit_training_vectorizer()` fits on the training split only — the gigs
reachable from training profiles plus the hand-authored probes
(`splits.fit_scope()`). `tests/test_tfidf_model.py` checks the real vocabulary
contains no term absent from training data.

### S2 — No split discipline

**Fix.** `eval/splits.py` is the single place that decides which profile is in
which split: 29 train / 9 validation / 9 test, **by profile, not by graded
pair**, stratified by category. Splitting by pair would have put some of a
worker's judged gigs in train and others in test, so weights fitted on the
first would already know that worker's preferences.

### S2 — Runs recorded no provenance, then recorded it wrongly

**Fix.** `eval/experiment.py` records the commit, dirty state, a content hash
of the corpus, resolved dependency versions, seeds, parameters and a run id,
and writes metrics, predictions, artefacts, plots and the log to one folder per
run.

Two defects in the capture itself, both found by using it:

- Runs write evidence into the repository, so `git_state()` saw the folder the
  run had just created and marked every run dirty — which made `promote` refuse
  every artefact and reduced the flag to noise. The dirty assessment now
  ignores `eval/results/`, and state is captured at run start.
- Git's output is stripped before parsing, removing the leading space of the
  first porcelain line, so a fixed column offset lost the first character of
  that path (`pps/ai-engine/...`). Now split on whitespace, with renames
  resolved to the new path.

**Also caught by this mechanism:** installing matplotlib silently upgraded
numpy past its pin (1.26.4 → 2.5.4) via `contourpy`. The manifest recorded it;
the pin was restored and `contourpy==1.2.1` pinned explicitly.

### S2 — The service and the evaluation measured different systems

**Evidence.** The evaluation used the fitted artefact; `matcher.py` passed no
vectoriser, so production refitted per request.

**Fix.** `tfidf_model.load_serving()` plus `eval/promote.py`, which deploys an
artefact only from a committed tree, verifies it loads before overwriting what
is serving, and records the run, commit and dataset version behind the deployed
file. Verified: the deployed artefact produces rankings identical to the
offline harness.

### S2 — No tests at all

**Evidence.** No test files anywhere; pytest was not a dependency.

**Fix.** 103 tests. See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

### S3 — The UI explained rankings with weights the engine had stopped using

**Evidence.** `apps/web/src/pages/AIMatches.tsx` still listed
`0.45/0.25/0.15/0.15`, the weights the project first shipped.

**Fix.** Corrected to the live weights, with a comment tying them to
`scoring.py`. API and engine breakdown contracts updated together.

### S3 — No rollback

**Fix.** `promote` keeps the previous artefact and its record; `--rollback`
swaps them, so a rollback can itself be undone. `--status` warns when the
deployed artefact was fitted on a corpus that no longer exists.

---

## Confirmed, not fixed — these are properties of the ground truth

### S1 — The labels cannot judge location or employer reputation

Both signals now vary and can reorder candidates. Neither correlates with the
relevance grades:

| signal | r with grade |
|---|---|
| tfidf | **+0.618** |
| semantic | **+0.557** |
| location | −0.024 |
| reputation | −0.039 |

Grades are derived from distance in the KeSCO occupational hierarchy, and towns
and employers are assigned independently of them. So no weighting for either
signal can be learned from this corpus.

This is a trap, not merely a gap: against labels that cannot reward a signal,
any weight on it dilutes the ones they do reward, so a grid search drives it to
zero and *appears* to have discovered the signal is useless to workers. Two
early tuning runs did exactly that, and the apparent +0.027 validation / +0.030
test gain came almost entirely from deleting the location term.

**Mitigation, not a fix.** `tune_weights` detects both classes of signal and
holds them fixed rather than searching them. Their weights are an explicit
product prior — 0.03 each, down from 0.20 combined, which measurably cost 0.035
NDCG@10. Zero would overfit to a known blind spot in the labels.

**What would fix it:** labels that vary with location and employer. That needs
human annotation, which is the open item below.

### S2 — One annotator, and validation/test are almost entirely rule-derived

533 of 565 labels are rule-derived. Worse, the 33 hand-authored labels barely
reach the splits that matter: **4 of 88 validation labels (4.5%) and 5 of 121
test labels (4.1%)**. No human-labelled result can currently be reported, and
there is no inter-annotator agreement figure, so the labels have no measured
reliability.

### S3 — The production shortlist size has never been evaluated

`matcher.CANDIDATE_POOL = 200`, but the corpus holds 104 gigs, so "exhaustive"
in the retrieval experiment *is* the production setting. Shortlists of 15 and
above are exact on this corpus; 3 and 5 cost real quality (−0.137, −0.098).
Testing 200 needs a corpus larger than 200 gigs.

---

## Confirmed, accepted

- **semantic and tfidf are 70% correlated** (within-profile r = +0.70). The
  ablation shows TF-IDF adds only 0.011 NDCG@10 on top of semantic. Kept
  because it is cheap and non-negative, but it is not carrying much.
- **MRR is saturated** at 1.000 for every non-random strategy, because the
  derived grades make many gigs relevant per profile. It does not discriminate
  and must not be quoted as if it did.
- **Splits are small** — 9 validation and 9 test profiles. Differences below
  ~0.005 NDCG are noise, which is why the adoption margin is set there and
  `eval/compare.py` says so.
- **Adding a profile can move another between splits.** Hash ordering is
  stable but the cut points move with the count. Churn is bounded (asserted in
  tests) and the dataset version makes it visible.

---

## Not present

- **Recency / freshness** is not a ranking signal at all. Stale gigs rank
  equal to fresh ones. A gap rather than a defect; adding it needs a decision
  about how fast relevance should decay.
- **Hybrid and travel-required arrangements.** Gigs carry only a boolean
  `is_remote`, so nothing distinguishes hybrid from on-site. Needs a column,
  not a cleverer function.
- **Real distance.** No coordinates in the schema. A county-centroid table is
  the cheapest way to add it later, with no external service.

---

## Where the engine stands

Validation, 9 profiles over 104 gigs:

| strategy | NDCG@10 |
|---|---|
| random | 0.081 |
| tfidf only | 0.812 |
| semantic only | 0.891 |
| composite, as first shipped | 0.846 |
| **composite, current weights** | **0.897** |

Final test figure, read once: **0.8499**.

The composite now **beats** semantic-only (0.8977 against 0.8914 in the
ablation), where before these fixes it trailed it (0.878 against 0.891).
Removing the employer-reputation term now costs 0.0032 rather than gaining
0.0053, so that signal has gone from inert to mildly useful. The remaining gap
to "text only" (0.9079) is the cost of location, the one signal still carrying
weight the labels cannot judge, and is the price of not overfitting to that
blind spot.

## Next

1. **Human labels for validation and test.** The single largest constraint.
   Needs a second annotator for an agreement figure.
2. **Location- and employer-aware labels**, without which neither weight can
   move off its prior.
3. **A larger corpus**, to evaluate the production shortlist size and narrow
   the noise floor.
