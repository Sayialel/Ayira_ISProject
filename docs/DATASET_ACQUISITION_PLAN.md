# Dataset acquisition plan

Written after inspecting each candidate source and before acquiring from any of
them, so the plan reflects what the sources actually contain rather than what
their documentation implies.

Inspection carried out **2026-10-19**. Every count below was measured, not
estimated from a dataset card.

## Objective

Replace a 47-profile / 104-gig evaluation corpus with something large enough to
support claims about real-world matching. Targets, in priority order:

| | target | realistic outcome | why |
|---|---|---|---|
| Occupations and skills taxonomy | full coverage | **achievable now** | ESCO API is open and works |
| Kenya-verified gig listings | ≥ 1,000 | **~195 at best from inspected sources** | no inspected source has licensed row-level Kenyan listings at volume |
| Real worker profiles | 300–500 | **0 available** | no public source provides consented Kenyan worker profiles |
| Human-reviewed relevance pairs | ≥ 1,000 | **0 without annotators** | needs people, not data |

The honest conclusion from Phase 2 is that **one of four targets can be met
from public sources**. The rest are blocked on a licence, a partnership, or
annotator time. This plan says exactly which, so the gaps are decisions rather
than surprises.

---

## Source A — ESCO occupations and skills · **DEFERRED BY DECISION**

> **Decision, 2026-10-19 (project owner):** do not adopt ESCO. The engine
> already uses **KeSCO-2022**, the Kenyan national standard, as its
> occupational taxonomy. Adding ESCO would introduce a second, European
> taxonomy and a mapping layer between them, for a vocabulary gain that KeSCO
> plus Kenyan listing text can supply directly.
>
> The inspection below stands as the record of what was verified, and
> `scripts/esco_taxonomy.py` is kept and working (tested on a 12-occupation
> slice: 12 ISCO codes, 12 with synonyms, 273 distinct skills, 434
> occupation-skill pairs). It is not run in full and its output is not part of
> the dataset. Revisit only if KeSCO proves too coarse for skill matching.

| | |
|---|---|
| Publisher | European Commission |
| Page | https://esco.ec.europa.eu/en/use-esco/download |
| Current version | v1.2.1 (updated 2025-12-10) |
| Formats | RDF, TTL, ODS, CSV, XML, JSON-LD; 28 languages |
| Bulk download | **Email-gated** — select packages, accept the privacy statement, submit an email, receive a link |
| Licence | **Not stated on the download page.** Must be confirmed before redistribution |

**Access decision: use the public REST API, not the bulk download.**

The bulk download cannot be automated because the link is emailed, and
pretending otherwise would be fabrication. The documented REST API at
`https://ec.europa.eu/esco/api` needs no key and was verified working:

```
GET /search?text=electrician&language=en&type=occupation   -> 200, 16 results
GET /resource/occupation?uri=<uri>&language=en             -> 200
```

A single occupation returns everything the taxonomy needs:

- `preferredLabel`, `alternativeLabel` (e.g. *domestic electrician* also known
  as *electrician*, *residential electrician*)
- `description`
- **`code` — the ISCO code** (e.g. `7411.1.1.1`)
- `hasEssentialSkill` (19 skills) and `hasOptionalSkill` (20 skills)

**Why the ISCO code matters more than anything else here.** The existing Ayira
corpus is built on **KeSCO-2022**, which is derived from ISCO. So ESCO
occupations join to the existing corpus through ISCO rather than through fuzzy
title matching. That gives a defensible bridge between a European taxonomy and
a Kenyan classification without inventing a mapping.

**Intended use:** skills and occupation taxonomy only. ESCO is not a source of
Kenyan workers or Kenyan vacancies, and will not be presented as one.

**Risks:** rate limits are undocumented, so ingestion must throttle and cache;
the licence must be established before any ESCO text is redistributed, so
output is marked `requires_review` for redistribution until then.

---

## Source B — Hugging Face `scholarweave/Jobs-Dataset-v2` · **REJECT for Kenyan listings**

| | |
|---|---|
| Licence | **Apache-2.0** — permissive, redistribution allowed with attribution |
| Access | Public, not gated |
| Size | 1,727,446 active postings; 64 Parquet shards, ~1.2 GB |
| Last modified | 2026-10-18 |

Inspected by downloading **three shards (80,853 rows, 56 MB)** and measuring,
with SHA-256 checksums in `data/manifests/_hf_shards.json`.

The advertised schema is excellent — `title`, `description_plain`, `skills`,
`location_city`, `location_region`, `salary_min/max/currency/frequency`,
`employment_type`, `workplace_type`, `is_remote`, `posted_at`, `apply_url`,
`content_hash`. Measured against the data, most of it is empty:

| field | populated |
|---|---|
| `title`, `apply_url`, `content_hash` | 100% |
| `description_plain` | 92% |
| **`skills`** | **0 of 80,853** — present as an empty `[]` in every row |
| **`location_city`, `location_region`** | **0%** |
| **`salary_min/max/currency/frequency`** | **0%** |
| `location_country_code` | 0% — entirely NULL, which is why a `='KE'` filter returns nothing |
| `posted_at` | 9% |

### The country label does not survive checking

313 rows across the three shards carry `country='Kenya'`. Comparing each
record's own title and description against Kenyan and foreign location
evidence:

| | rows | share |
|---|---|---|
| Own text corroborates Kenya | 9 | **2.9%** |
| Own text contradicts it (names another country) | 68 | **21.7%** |
| No location evidence either way | 234 | 74.8% |
| Both mentioned | 2 | 0.6% |

Contradicted examples labelled `country='Kenya'`:

- *Junior Salesforce Developer* — description reads "Location: US Based Remote ONLY"
- *Senior Full Stack Developer* — "Location: Remote, Canada · Compensation: CAD $52–55/hour"

Scaling 2.9% across the 6,728 Kenya-labelled rows projects **~195 listings with
any Kenyan evidence** — before human verification, and with no skills, no city,
and no salary on any of them.

### Decision

- **Rejected** as a source of `kenya_verified` listings. It fails the project's
  own rule: a record is not Kenyan because a field says so.
- Permitted secondary use, recorded so it is not silently relied on: the
  non-Kenyan bulk (1.7M titles and descriptions, Apache-2.0) is a legitimate
  corpus for **pipeline load-testing** and for **skill-extraction development**,
  where country is irrelevant. It must never enter the Kenyan evaluation set.
- The three downloaded shards are kept as an immutable snapshot so this finding
  is reproducible.

---

## Source C — KLMIS (Kenya Labour Market Information System) · **CONTEXT ONLY**

https://www.labourmarket.go.ke/vacancies_intelligence/

Verified: **aggregate only.** No row-level vacancies, no API, no CSV or Excel
export; charts offer PNG. Published as "Free Open Access"; the linked Terms &
Conditions have not been read in full and must be before any automated
collection.

**It cannot supply listings.** But it classifies real Kenyan vacancies by
**KeSCO** — the same standard the existing corpus uses — and publishes
vacancies by county, most-advertised titles, most sought-after skills,
employment type and qualifications.

**Planned use: calibration targets.** Those marginals are exactly what a
generator should match. Reweighting the corpus to KLMIS county and occupation
shares turns "plausibly invented" into "matching the published national
distribution", using only aggregates and needing no credential. This is the
highest-value action still available without external permission.

---

## Source D — Commercial and job-board listings · **BLOCKED, needs a decision**

> **Decision, 2026-10-19 (project owner):** take the Techmap free route. This
> is now **the primary source** for Kenyan listings.

| source | status |
|---|---|
| **Techmap / JobDataFeeds** | **CHOSEN.** See the dedicated section below. |
| **BrighterMonday Kenya** | Needs investigation of authorised export or API. No public API found. Bulk copying of viewable listings is not permitted by default. |
| **MyJobMag Kenya** | Same — requires written permission or a documented API. |
| **Fuzu Kenya** | Same. |

None of these will be scraped. Public visibility is not permission, and the
project's rules forbid bypassing terms, logins or anti-bot controls.

**Required from the project owner:** either accept the Techmap terms and
provide a credential, or obtain written permission from one Kenyan board. Until
then the Kenya-verified listing count stays near zero and the ≥1,000 target
cannot honestly be reported as met.

---

## Source D2 — Techmap Job Postings API · **PRIMARY SOURCE, awaiting a key**

Verified by inspecting the provider's own documentation and its downloadable
sample, which needs no key.

| | |
|---|---|
| Endpoint | `GET https://daily-international-job-postings.p.rapidapi.com/api/v2/jobs/search` |
| Auth | `X-RapidAPI-Key` header; RapidAPI subscription required; calling the backend directly returns 401 |
| Country filter | `countryCode` (ISO alpha-2, so `ke`) |
| Date filter | `dateCreated` (`YYYY-MM-DD` or `YYYY-MM`), or `dateCreatedMin`/`dateCreatedMax` |
| Paging | `page` from 1, or `cursor`; **page size is fixed at 10 and cannot be changed** |
| Rate limit | ~1 request/second on Basic; 429 on burst, retry with backoff |
| Quota | Basic includes roughly 100 requests/month ≈ **1,000 postings**. The docs state requests above the quota are **billed as overage rather than refused** |
| Licence | Terms of Service at jobdatafeeds.com — **`requires_review`**; no redistribution of source records |

### The schema is genuinely populated

From the 10-record sample (`data/raw/techmap/sample.json`), 28 fields per
record, with coverage measured rather than assumed:

| field | coverage | note |
|---|---|---|
| `title`, `company`, `occupation`, `city` | 10/10 | `occupation` is already normalised |
| `jsonLD.description` | 10/10 | full advert text |
| **`skills`** | **8/10** | genuinely populated, unlike the rejected HF dataset |
| `geoPoint` {lat, lon} | 7/10 | real coordinates |
| `isDuplicate`, `isRecruiter`, `isDirect` | 10/10 | provider's own dedup and agency flags |
| `workType`, `industry`, `dateCreated` | 10/10 | |
| `careerLevel`, `state` | 6–7/10 | |
| `hasSalary` | 10/10 | **a flag only — no amount and no pay period** |

Two limitations worth stating before any claim rests on this source:

1. **`countryCode` is not evidence.** The provider's own Luxembourg sample
   contains a posting with `countryCode: "lu"` whose structured address says
   *Switzerland* and whose coordinates are in Switzerland. The ingestion
   therefore treats the country code as a claim and classifies each record by
   corroborating evidence — Kenyan structured address, a recognised Kenyan
   town, or coordinates inside Kenya's bounding box. Only `kenya_verified`
   records are eligible for evaluation.
2. **Extracted skills are noisy.** The sample yields entries such as
   `MS-DOS`, `Tango` and `monthsOfExperience: 36` for professional roles, so
   raw skills are preserved but must be normalised and reviewed before use.

### Status

`scripts/techmap_jobs.py` is written, tested end-to-end on the sample, and
**will not run without a key** — because overage is billed, an unbounded loop
is a bill rather than an error. It is hard-capped at 90 requests by default.

Verified on the sample: 10 records in, **0 classified `kenya_verified`**, 7
`conflicting` (Swiss address, Luxembourg coordinates), 3 `location_unknown`.
That is the correct result, and it demonstrates the classifier refuses to call
non-Kenyan records Kenyan.

**Blocked on:** a RapidAPI key in `.env` as `TECHMAP_RAPIDAPI_KEY`.

---

## Source E — Worker profiles · **NOT AVAILABLE FROM ANY PUBLIC SOURCE**

This is the gap that matters most, and no amount of job-listing data closes it.

Checked in the repository first: the 47 existing "profiles" are **generated from
KeSCO occupation definitions**, not real people. They are development fixtures
and are already marked as such.

KNBS and KeNADA (https://statistics.knbs.or.ke/nada/index.php/catalog) hold
labour-force survey microdata, which may give occupation and employment-status
distributions under an access request — but household survey records are not
gig-worker profiles. They carry no current skills list, no availability, no pay
expectation and no matching preferences.

**Plan:** build the schema and a consent-based import path now, so real
profiles can be loaded the day they exist, and keep synthetic development
profiles in `data/synthetic/` where they cannot be mistaken for observations.
The 300–500 target will **not** be reported as met on synthetic records.

Fields to collect, and no more than these: pseudonymous `worker_id`, skills
(raw and normalised), occupation preferences, experience level, county,
optional subcounty, location precision, preferred work arrangement,
availability, expected pay range and period, languages, data source, consent
status, collection timestamp, completeness, `is_synthetic`.

Explicitly **not** collected: national ID, passwords, precise residential
address, or anything else not needed to rank a gig.

---

## Source F — Geofabrik OpenStreetMap Kenya extract · **NOT NEEDED**

https://download.geofabrik.de/africa/kenya.html · ODbL, attribution and
share-alike.

The engine resolves towns to counties through a 35-entry table in
`app/services/kenya_geography.py`, so it makes no geocoding calls and cannot
breach the Nominatim policy. A county-centroid table would be the cheap way to
add real distances later, and still needs no live service. Not acquired.

---

## Execution order

1. **Techmap Kenyan listings** — the chosen route and the one target now
   reachable. Pipeline written and tested; **blocked only on a RapidAPI key**.
   At 10 postings per page and ~100 included requests, one month's free quota
   yields ~1,000 postings, which meets the listing target if enough of them
   classify as `kenya_verified`.
2. **Normalise skills against KeSCO**, not ESCO, per the decision above. The
   raw Techmap skill strings are preserved; mapping confidence is recorded,
   and anything unmappable is flagged for review rather than forced.
3. **KLMIS calibration** — reweight the synthetic generator to published county
   and occupation marginals, so the development corpus matches the national
   distribution. Needs no credential.
4. **Worker profile schema and consent-based import path**, with synthetic
   development records segregated in `data/synthetic/`.
5. **Annotation workflow** — guide, sampling design, and a pair-labelling
   format, so human labels can begin the moment an annotator is available.
   This, not data volume, is the binding constraint on evaluation quality.

**ESCO is deferred** by decision; `scripts/esco_taxonomy.py` remains available
but unused.

## What will not be done

- No scraping of any job board.
- No promotion of `kenya_probable` records to `kenya_verified`.
- No presentation of synthetic profiles as real, or of rule-derived labels as
  human judgements.
- No overwriting of the existing corpus or prior evaluation runs. The current
  baseline (corpus `6ac4675ae766`, test NDCG@10 0.8499) stays reproducible.
