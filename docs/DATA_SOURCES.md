# Data sources

Where Ayira's evaluation data comes from, what was investigated and rejected,
and what each source may lawfully be used for.

Corpus provenance in depth is in
[`apps/ai-engine/eval/corpus_sources/README.md`](../apps/ai-engine/eval/corpus_sources/README.md);
this is the register of sources and their terms.

---

## In use

### KeSCO-2022 — Kenya Standard Classification of Occupations

| | |
|---|---|
| **Publisher** | Government of Kenya / Kenya National Bureau of Statistics |
| **ISBN** | 978-9914-49-401-3 |
| **Access** | Published document, held locally and parsed by `eval/corpus_sources/parse_kesco.py` |
| **Terms** | "Extract may be published if the source is duly acknowledged" |
| **Used for** | Occupation titles, definitions, task statements, skill vocabulary, and the hierarchy the derived relevance grades come from |
| **Coverage** | 47 of its unit groups, selected in `category_map.py` as the ones plausibly done through a digital marketplace |
| **Refresh** | Static; a new edition would require re-parsing and a new dataset version |

Why this and not a job board: it is the national standard, so the occupational
vocabulary is defensible rather than invented, and the four-level code
hierarchy gives a transparent, reviewable rule for deriving relevance.

**Independently corroborated:** KLMIS (below) classifies real Kenyan vacancies
by KeSCO, so the corpus uses the same occupational taxonomy the Kenyan
government uses to report its own labour market.

### WorkKE pay distribution

| | |
|---|---|
| **Used for** | Calibrating generated gig budgets — lognormal, median KES 2,000, mean KES 4,664 |
| **Terms** | Published aggregate statistics, cited not redistributed |
| **Limitation** | Aggregate only. Pay is plausible in distribution, not observed per gig |

### County list

| | |
|---|---|
| **Source** | The 47 counties established by the Constitution of Kenya 2010, First Schedule, as used in KNBS reporting |
| **Used for** | `app/services/kenya_geography.py` — town-to-county mapping for location tiering |
| **Terms** | Published administrative fact |

### Nairobi Metropolitan Area

| | |
|---|---|
| **Source** | Kenyan government planning usage, as covered by the Nairobi Metropolitan Area Transport Authority (NaMATA): Nairobi, Kiambu, Kajiado, Machakos, Murang'a |
| **Used for** | The same-metro location tier |
| **Limitation** | Only Nairobi is grouped. Mombasa and Kisumu have real commuter hinterlands, but their boundaries were not confidently sourced, and a wrong grouping is worse than none |

---

## Investigated and not used

Each was checked before being built around, because the cost of discovering a
source is aggregate-only *after* writing an adapter for it is wasted work and a
misleading write-up.

### KLMIS — Kenya Labour Market Information System

- https://www.labourmarket.go.ke/vacancies_intelligence/
- https://www.labourmarket.go.ke/job-analysis/

**Verified 2026-10-19: aggregate only. No row-level vacancies, no API, no CSV
or Excel export** — charts offer PNG download. It publishes most-advertised job
titles with counts, vacancies by county, most sought-after skills, vacancy
trend, KeSCO and KESIC breakdowns, hard-to-fill occupations, time-to-fill,
employment type, qualifications and top employers. Filterable by county,
sector, occupation and advert date. Described on the page as "Free Open
Access"; the linked Terms & Conditions and Disclaimer were not read in full and
must be before any automated collection.

**Cannot** supply individual job records, so it cannot expand the corpus
directly.

**Can, and should,** serve as *calibration targets*. Its county shares,
occupation mix and skill frequencies are exactly the marginals a synthetic
generator should match. Reweighting `LOCATIONS` and the occupation selection to
KLMIS distributions would make the corpus defensibly representative instead of
plausibly invented, using only published aggregates. **Not yet done** — this is
the most valuable unexploited source available.

### Techmap / JobDataFeeds — Kenyan job listings

- https://jobdatafeeds.com/data/countries/ke · https://api.techmap.io/jobs-api

**Verified 2026-10-19.** Row-level records *are* available, as daily JSON Lines
files on S3 (last 3 months) or a historical dataset back to January 2020.
Fields include job title, description, company, location, employment type,
skills and source portal.

| | |
|---|---|
| **Kenyan volume** | ~5,400 postings/month; 5,375 in 2026-08 from 19 sources; peak 12,394 in 2026-01 |
| **Price** | Jobs API $1 per 1,000 jobs, pay-per-use via AWS. Free tier via RapidAPI: 100 requests / 1,000 postings per month, all countries |
| **Kenya feed** | No ready-made AWS Data Exchange listing for Kenya; by request only. The free feed and historical dataset are offered for Luxembourg only |
| **Licence** | **Not stated** on the country page. Terms of Service and Privacy Policy are linked but were not retrieved |

**Blocker, not a rejection.** The free tier is large enough for a pilot, but
the licence terms must be read and accepted before any collection, and
redistribution inside a university submission is a licensing question, not a
technical one. These are formal-job postings from job boards, so their
relevance to informal gig work also needs checking against a sample.

**Requires a decision and, for volume, a credential.** No collection has been
attempted.

### OpenStreetMap / Geofabrik Kenya extract

- https://download.geofabrik.de/africa/kenya.html

Geographic reference data, not job listings. Licensed ODbL, which carries
attribution and share-alike obligations.

**Not needed.** County tiering resolves towns through a 35-entry table in
`kenya_geography.py`, so the engine needs no geocoding, no OSM extract and no
Nominatim calls — and therefore cannot breach the
[Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/),
which prohibits bulk geocoding through the public endpoint. If real distances
are ever wanted, a static county-centroid table is the cheap route and still
needs no live service.

### KNBS data portals

- https://www.knbs.or.ke/data-portals/ · https://repository.knbs.or.ke/
- https://www.knbs.or.ke/reports/kenya-census-2019/

Census and survey statistics. Used for context and for the county list, not as
job records. Aggregate by nature.

### Kaggle fake job postings dataset

- https://www.kaggle.com/competitions/fake-job-posting/data

Not Kenya-specific and aimed at fraud detection. Of no use for relevance
ranking here. Would only serve as throwaway pipeline-shape testing, which the
existing corpus already covers.

---

## What this means for the claims the project can make

The corpus is **synthetic, generated from a real national occupational standard
and real reported pay distributions**. It is not observed platform behaviour.
There are no clicks, applications or hiring outcomes, because the platform has
no users yet.

So:

- Ranking quality figures describe **agreement with a KeSCO-derived relevance
  rule**, not real-world performance.
- No claim about production quality is supported by this data alone. See the
  limitations in [EVALUATION_PROTOCOL.md](EVALUATION_PROTOCOL.md).
- The honest upgrade path, in order of value per effort:
  1. Calibrate the generator to KLMIS county and occupation marginals — uses
     published aggregates, needs no credential or licence negotiation.
  2. Human-label validation and test, with a second annotator.
  3. Resolve the Techmap licence question, then pilot real listings.

## Rules for any future adapter

Carried forward so the register stays meaningful:

- Keep the raw snapshot immutable and separate from normalised output.
- Record source URL, collection timestamp, and the licence under which it was
  collected, per record.
- Preserve original text alongside normalised text.
- Validate schema on ingest and deduplicate explicitly.
- Never bypass access controls, rate limits or terms. If no lawful source
  gives usable records, report the gap and request an authorised export — do
  not invent a feed.
