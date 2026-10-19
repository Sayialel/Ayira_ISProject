# Data dictionary

Every field the matching engine reads or produces: type, units,
normalisation, what happens when it is missing, and privacy classification.

Privacy classes:

| class | meaning |
|---|---|
| **public** | Shown to any signed-in user |
| **internal** | Used by the engine, not displayed |
| **personal** | Identifies a person; minimise, never export to an experiment |

---

## Worker profile

Database: `public.users`. Evaluation: `eval/corpus/profiles.json`.

| field | type | units / scale | normalisation | missing | privacy |
|---|---|---|---|---|---|
| `id` | UUID (corpus: `w-<kesco>`) | — | — | never | personal |
| `email`, `phone`, `full_name` | TEXT | — | — | phone nullable | **personal** — never read by the engine |
| `role` | TEXT enum | `worker` \| `employer` \| `admin` | — | defaults `worker` | public |
| `skills` | TEXT[] | — | joined with spaces into the embedding text; empty strings and nulls dropped | `{}` → contributes nothing | public |
| `bio` | TEXT | free text | trimmed; appended after skills | NULL → treated as `""` | public |
| `location` | TEXT | town name | case-folded; resolved to county via `kenya_geography` | NULL → `UNKNOWN_LOCATION` (0.3), **not** a mismatch | public |
| `reputation_score` | NUMERIC(3,2) | 0–5 review average | maintained by the `update_reputation` trigger | `0.00` = no reviews | public |
| `kesco_code` | TEXT (corpus only) | KeSCO unit group | — | authored profiles have none | internal |
| `category` | TEXT (corpus only) | one of 5 Ayira categories | — | `Unknown` | internal |

**`reputation_score` is no longer read for ranking.** It is identical across a
worker's candidate gigs and so cannot reorder them. It remains for display and
for employers assessing applicants.

---

## Gig

Database: `public.gigs`. Evaluation: `eval/corpus/gigs.json`.

| field | type | units / scale | normalisation | missing | privacy |
|---|---|---|---|---|---|
| `id` | UUID (corpus: `g-<kesco>-<n>`) | — | — | never | public |
| `employer_id` | UUID | FK → `users.id` | — | never (NOT NULL) | public |
| `title` | TEXT | — | first element of the embedding text | never | public |
| `description` | TEXT | — | third element of the embedding text | never | public |
| `required_skills` | TEXT[] | — | second element of the embedding text | `{}` | public |
| `category` | TEXT | one of 5 | optional retrieval filter | — | public |
| `location` | TEXT | town name | as for the worker | NULL → unknown; irrelevant when remote | public |
| `is_remote` | BOOLEAN | — | remote ⇒ affinity 1.0 | defaults FALSE | public |
| `budget_min`, `budget_max` | NUMERIC(10,2) | KES | retrieval filter only; **not** a ranking signal | nullable | public |
| `currency` | TEXT | ISO-ish | — | defaults `KES` | public |
| `deadline` | TIMESTAMPTZ | — | passed deadlines excluded from retrieval | NULL = no deadline | public |
| `status` | TEXT enum | `draft`/`open`/`in_progress`/`completed`/`cancelled` | only `open` is retrieved | defaults `draft` | public |
| `embedding` | vector(384) | — | `all-MiniLM-L6-v2`, cosine | NULL → semantic 0, ranked last not dropped | internal |
| `embedding_hash` | TEXT | content hash | triggers re-embedding when text changes | NULL → needs embedding | internal |

### Joined at retrieval time

Returned by `nearest_open_gigs` (migration 017), not stored on the gig:

| field | type | units | missing | privacy |
|---|---|---|---|---|
| `employer_reputation` | NUMERIC | 0–5 | NULL or 0 → neutral prior 3.0 | public |
| `employer_review_count` | BIGINT | count | 0 → unreviewed, so reputation is neutral | public |
| `distance` | REAL | cosine distance 0–2 | NULL when un-embedded → similarity 0 | internal |

`employer_review_count` exists only to disambiguate: `reputation_score` is
`0.00` both for "no reviews" and "all one star", and a 1–5 scale cannot produce
0. Without it, every new employer would rank last.

Both arrive as strings through some Postgres drivers; `employer_reputation()`
coerces, and a test covers it.

---

## Ranking signals

Computed per (worker, gig) pair. All normalised to 0–1 before weighting, so the
weights alone decide influence.

| signal | source | range | varies per gig? | r with grade |
|---|---|---|---|---|
| `semantic` | cosine of MiniLM embeddings | 0–1 | yes | **+0.557** |
| `tfidf` | cosine of TF-IDF vectors, fitted on train only | 0–1 | yes | **+0.618** |
| `location` | `location_affinity()` | 0–1, five tiers | yes | −0.024 |
| `reputation` | `employer_reputation()` ÷ 5 | 0–1 | yes | −0.007 |

Location tiers: same town 1.0 · same county 0.6 · same metro 0.45 · unknown 0.3
· different county 0.0.

Weights: `semantic 0.72 · tfidf 0.22 · location 0.03 · reputation 0.03`. The
first two are measured; the last two are a product prior, because the labels
carry no information about them — see
[EVALUATION_PROTOCOL.md](EVALUATION_PROTOCOL.md).

`semantic` and `tfidf` correlate at +0.70 with each other, so they are not
independent evidence.

---

## Relevance labels

`eval/corpus/relevance.csv`. Generated; edit `overrides.json` and regenerate.

| field | type | values |
|---|---|---|
| `worker_id` | TEXT | FK → profile id |
| `gig_id` | TEXT | FK → gig id |
| `grade` | INT | `3` ideal · `2` good · `1` marginal · `0` irrelevant |
| `layer` | TEXT | `derived` (KeSCO hierarchy rule) \| `authored` (hand-assigned, overrides derived) |
| `note` | TEXT | the reason, e.g. `KeSCO 1212 vs 1221` |

A pair absent from the file is grade 0 by implication. Current counts: 565
graded, of which **532 derived and 33 authored**; 4,323 implicit zeros.

`layer` is what makes it possible to report human-labelled and rule-derived
results separately. **Not yet surfaced by the harness** — an open item.

Derived rule (`build_corpus.derived_grade`): same unit group → 3; same minor
group → 2; same sub-major group → 1; otherwise 0.

---

## Split assignment

`eval/corpus/splits.json`.

| field | type | meaning |
|---|---|---|
| `dataset_version` | TEXT | SHA-256 of the corpus files, first 12 hex chars |
| `seed` | INT | `20261018`; changing it invalidates every reported figure |
| `counts` | object | train / validation / test profile counts |
| `train`/`validation`/`test` | TEXT[] | profile ids |

Assignment is **by profile, never by graded pair**, stratified by category.

---

## Run manifest

`eval/results/runs/<run-id>/manifest.json`.

| field | meaning |
|---|---|
| `run_id` | `<UTC timestamp>__<name>__<short commit>` |
| `git.commit`, `git.branch` | the code that produced the result |
| `git.dirty`, `git.uncommitted_paths` | whether it could be rebuilt from that commit; excludes `eval/results/` |
| `dataset_version` | the corpus it was measured on |
| `seeds` | every seed used |
| `parameters` | including which signals were held fixed and why |
| `dependencies` | resolved versions, not pinned ones |
| `environment` | Colab or local, Drive mounted, platform |

Runs contain **no personal data**: the evaluation reads the committed synthetic
corpus, never the live database, which is also why it needs no credentials.
