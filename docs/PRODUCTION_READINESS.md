# Production readiness

What is in place, what is not, and what must be true before the matching engine
is promoted.

Status at commit `35f057d`. **Verdict: not production-ready.** The engineering
gates pass; the evidence gates do not, because the evaluation data is synthetic
and the labels are effectively unreviewed. The engine is fit for demonstration
and assessment, not for ranking real workers' livelihoods.

---

## Tests

103 tests, `apps/ai-engine/tests/`. Run with `python -m pytest` (~2.5 min).

| file | tests | covers |
|---|---|---|
| `test_splits.py` | 13 | disjointness, full coverage, determinism, stratification, bounded churn, dataset hashing, train-only fit scope |
| `test_scoring.py` | 31 | weight totals, score bounds, employer-vs-worker reputation, unreviewed employers, location tiers and their ordering, null and empty inputs, determinism, sort order, breakdown consistency |
| `test_tfidf_model.py` | 13 | fit/save/load round trip, stale artefact version, corrupt file, never refitting at scoring time, out-of-vocabulary queries, and the real vocabulary containing no non-training term |
| `test_promote.py` | 13 | dirty-tree refusal, corrupt-artefact refusal, provenance record, previous-artefact retention, rollback and its undo, staleness warning |
| `test_experiment.py` | 10 | manifest completeness, git capture at start, porcelain parsing, dependency capture, failed runs still leaving evidence |
| `test_parity.py` | 7 | distance→similarity conversion, offline/live ranking equality, deployed artefact matching the training fit, missing-artefact fallback, SQL-typed rows |
| `test_metrics.py` | 16 | every metric against hand-computed values, and the fast NDCG equalling the reference to 1e-9 |

Each guards a defect this project has actually shipped or nearly shipped.

### Not covered

- The live Supabase path end to end. `eval/live_eval.py` exercises it but needs
  a running service and a seeded database, so it is manual.
- `eval/seed_db.py` now creates one account per corpus employer and seeds the
  individual ratings, letting the `update_reputation` trigger derive the same
  score the corpus holds. **Not yet executed against a database**, so the live
  path remains unverified since the reputation redesign.
- The API and web layers have no tests; they typecheck only.

## Artefacts

| | |
|---|---|
| Deployed | `apps/ai-engine/artifacts/tfidf_vectorizer.joblib`, 1,160 terms |
| Provenance | `artifacts/deployed.json` — run id, commit, dataset version, fitted-on split, timestamp |
| Rollback | `artifacts/tfidf_vectorizer.joblib.previous` plus its record |
| Versioned | `ARTEFACT_VERSION`; a mismatch is refused rather than silently reused |

Every experiment also writes its own copy into its run folder, so the artefact
behind any reported figure can be recovered.

## Offline / live parity

Verified and automated, without needing a database:

- The deployed artefact's vocabulary equals the one the evaluation fitted, and
  produces identical rankings.
- Semantic similarity round-tripped through pgvector's cosine distance
  reproduces the harness ranking exactly.
- Rows typed as Postgres `NUMERIC`/`BIGINT` (which some drivers return as
  strings) score identically to corpus rows.

**Not verified:** a real request against the deployed service. The seeder is
now correct but has not been run, so no live figure exists for the current
engine.

## Fallbacks, and whether they are observable

| condition | behaviour | observable |
|---|---|---|
| No artefact promoted | refits TF-IDF per request | **yes** — warning naming the path and the fix |
| Artefact version mismatch or corrupt | treated as absent, falls back | **yes** — warning |
| Gig has no embedding | semantic 0, ranked last, not dropped | partially — no metric yet |
| Employer unreviewed | neutral prior 3.0 | no — silent by design |
| Worker or gig location unknown | affinity 0.3, not a mismatch | no — silent by design |

The first two are documented, approved fallbacks. A deployment that logs them
is misconfigured, not broken, but the figures measured offline will not
describe it.

## Promotion gates

`eval/promote.py` enforces:

- [x] Source tree clean — a run from a modified tree cannot be rebuilt from its
      commit, so what serves could not be reproduced. `--allow-dirty` is an
      explicit override.
- [x] Artefact loads and matches the expected version, checked **before**
      overwriting what is serving.
- [x] Provenance recorded beside the artefact.
- [x] Previous artefact preserved; `--rollback` available and itself undoable.
- [x] Staleness warning when the deployed dataset version no longer matches the
      corpus.

Enforced by process, not code:

- [x] Full test suite passes.
- [x] Baseline and candidate both reproducible, with recorded run ids.
- [x] Validation evidence meets the adoption criteria in
      [EVALUATION_PROTOCOL.md](EVALUATION_PROTOCOL.md).
- [x] Test split read once.
- [x] Data sources and licences documented —
      [DATA_SOURCES.md](DATA_SOURCES.md).
- [ ] **Human-labelled validation evidence.** Validation is 95.5% rule-derived
      (4 of 88 labels authored). Blocking.
- [ ] **Inter-annotator agreement.** One annotator; no κ. Blocking.
- [ ] **Live parity on a seeded database.** No longer blocked; needs a
      Supabase instance and one seed-and-measure run.
- [ ] **Monitoring in place.** Planned only, below.

## Monitoring plan

None of this is implemented. Listed so it is a plan rather than an intention.

| signal | why | threshold |
|---|---|---|
| Missing-artefact warnings | means the service is refitting per request and offline figures do not apply | any occurrence pages |
| Un-embedded gig rate | those gigs get semantic 0 and rank last | > 5% of retrieved candidates |
| Unknown-location rate | the location tier degrades to a prior | > 30% of candidates |
| Unreviewed-employer rate | the reputation term degrades to a prior | track, no threshold |
| Candidate pool exhaustion | `CANDIDATE_POOL = 200` hit means the shortlist is now lossy, and that setting has never been evaluated | any occurrence |
| Ranking latency p95 | currently 0.42–0.50 s over 42 gigs | > 1.5 s |
| Empty result rate | filters may be over-restrictive | > 2% of requests |
| Data drift | corpus text distribution vs live gigs | reviewed per release |

Eventually, real outcomes — applications and hires per ranked position — if
they can be collected lawfully and with consent. Those are the only signals
that would establish production quality, and none exist yet.

## Rollback

```bash
python -m eval.promote --rollback     # restore the previous artefact
python -m eval.promote --status       # confirm what is now serving
```

The engine must be restarted to pick it up; the artefact is cached per process.
Rollback swaps rather than overwrites, so discovering the previous artefact was
the broken one does not leave the only good copy unreachable.

Weights can be changed without a deploy through `MATCH_WEIGHT_SEMANTIC`,
`_TFIDF`, `_LOCATION`, `_REPUTATION`, read at import. Every run records the
weights it used, so an override cannot silently misattribute a result — but it
does mean an environment variable can change ranking behaviour, which belongs
in a deployment checklist.

## Compatibility

Migration `017_employer_reputation.sql` drops and recreates
`nearest_open_gigs`, since its return type changed. Callers updated in the same
change:

- `app/services/matcher.py` — passes the serving artefact and reads the joined
  employer fields.
- `apps/api/src/routes/matching.ts` — breakdown key `reputation` →
  `employer_reputation`.
- `apps/web/src/types.ts`, `apps/web/src/pages/AIMatches.tsx` — same rename,
  plus the displayed weights, which had drifted to the values the project first
  shipped and were describing the ranking with numbers it no longer used.

No table schema changed, so no data migration is required. Both TypeScript
projects typecheck clean.

## Unresolved risks

1. **Synthetic evaluation data.** Cannot establish real-world quality. The
   figures establish agreement with a KeSCO-derived rule.
2. **One annotator, almost no human labels in validation or test.**
3. **Two of four ranking signals have weights that no data justifies.** Held at
   a small explicit prior, detected and held fixed by the tuner rather than
   tuned to a number the labels cannot support.
4. **The production shortlist size has never been evaluated** — the corpus is
   smaller than the pool.
5. **No live end-to-end verification** since the reputation redesign. The
   seeder is fixed but unrun.
6. **No recency signal**, so stale gigs rank equal to fresh ones.
7. **M-Pesa escrow is unvalidated** against real Daraja credentials.
8. **Small splits** — differences under 0.005 NDCG are noise.
