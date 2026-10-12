# Corpus sources

Where the evaluation corpus's content comes from, and how to regenerate it.

The corpus used to be written from imagination, which made its vocabulary and
its pay figures impossible to justify. This directory replaces that with
published Kenyan sources, so every part of the corpus can be traced to
something citable.

---

## 1. Occupations and skills — KeSCO-2022

**Kenya Standard Classification of Occupations**, Ministry of Labour and Social
Protection, 2022. ISBN 978-9914-49-401-3.

- Source: <https://labourmarket.go.ke/media/resources/KENYA_STANDARD_CLASSIFICATION_OF_OCCUPATIONS_KeSCO-2022.pdf>
- Licence: the document states *"Extract may be published if the source is duly
  acknowledged."* Any use must cite it.

### Why this rather than ESCO or O*NET

ESCO (European) and O*NET (United States) are larger and easier to parse, but
they classify different labour markets. KeSCO is the classification the Kenyan
government actually uses, which is the right grounding for a platform built for
Kenyan workers — and it is the standard a Kenyan examiner will recognise.

### What is extracted

Each of KeSCO's unit groups carries a four-digit code, a title, a definition, a
list of tasks performed, and a paragraph on the training and skills required.
`parse_kesco.py` pulls all five fields:

```json
{
  "code": "2512",
  "title": "Software Developers",
  "major_group": "2",
  "definition": "Software Developers research, analyse and evaluate ...",
  "tasks": [
    "developing and testing software to meet customers' and client's needs",
    "recommend and develop upgrades for existing applications",
    "create models and diagrams to show programmers the code needed ..."
  ],
  "skills_note": "in this unit group, one requires tertiary level training ..."
}
```

### Regenerating it

```bash
cd apps/ai-engine
python -m eval.corpus_sources.parse_kesco
```

The script downloads and caches the PDF, then writes
`kesco_occupations.json`. The PDF itself is not committed — it is 6.6 MB and
freely available at the URL above.

### Coverage, honestly

The document contains **442** unit-group markers; the parser extracts **337**
with usable task lists, across all nine major groups (1:33, 2:90, 3:37, 4:27,
5:33, 6:17, 7:54, 8:15, 9:31).

The shortfall is not a sampling bias. Most unparsed markers are cross-reference
notes rather than definitions — entries that say an occupation was reclassified
and point elsewhere, carrying no task list of their own. Since the corpus needs
a few dozen occupations and 337 are available with even coverage across every
major group, the gap does not constrain it.

### Known text-layer artefacts

The PDF's text layer inserts stray spaces inside words (`i mprove`,
`biologic al`) and breaks hyphenated words across lines (`infra -red`).
`clean()` repairs the common cases conservatively — it only rejoins fragments
of three characters or fewer, and never joins a fragment that is itself a real
word. Some artefacts survive, mostly in `skills_note`. Generated corpus text is
therefore composed from `title` and `tasks`, which are much cleaner than the
prose fields.

---

## 2. Market realism — WorkKE and KNBS

Used to set the corpus's category mix and pay distribution, so budgets are
observed rather than invented.

**WorkKE, *Kenya Digital Employment & Hiring Report 2026*** —
<https://www.workke.co.ke/insights/reports/kenya-digital-employment-hiring-report-2026>

Platform figures from its first year (7,435 users, 294 employers, 326 jobs,
Sept 2025 – Aug 2026):

| Measure | Value |
| --- | --- |
| Average completed job | KES 4,664 |
| Median completed job | KES 2,000 |
| Verified freelancer average | KES 6,146 |
| Unverified freelancer average | KES 4,575 |
| Dominant categories | admin/business support, design/media, web/technology, writing/content |
| Most requested skills | website development, data handling, office productivity, branding/design, virtual assistance |

**Kenya National Bureau of Statistics** — Quarterly Labour Force Reports and
Economic Survey: <https://www.knbs.or.ke/quarterly-labour-force-reports/>
782,300 jobs created in 2024, 90% of them informal.

### What this changed

The first corpus used budgets of KES 12,000–160,000, chosen by the author with
no reference point. Against a median completed job of KES 2,000 that was an
order of magnitude high.

Some of the gap is real: WorkKE's mix leans toward micro-tasks, while Ayira
targets more substantial engagements. The point is not that the old figures
were necessarily wrong but that they were **unjustified**, and the replacement
distribution can be traced to a published source.

---

## 3. What these sources cannot provide

No public dataset pairs Kenyan gigs with relevance judgements. None of the
sources above contains ground truth about which worker suits which gig — they
give occupations, tasks, categories and pay, not matches.

The labelled resume–job datasets that do exist are not Kenyan and are mostly
inaccessible: ConFit's AliYun set was withdrawn in 2023 and its Intellipro set
is proprietary, released only to researchers under individual licence
agreements. CareerCorpus and PJB are published but cover US and Chinese
recruitment rather than African gig work.

Relevance grading therefore remains the part of this corpus that comes from
the project rather than from a source, and it is where independent annotation
matters most.

---

## Citing these in the dissertation

> Republic of Kenya, Ministry of Labour and Social Protection (2022).
> *Kenya Standard Classification of Occupations (KeSCO-2022)*.
> ISBN 978-9914-49-401-3.

> WorkKE (2026). *Kenya Digital Employment & Hiring Report 2026*.

> Kenya National Bureau of Statistics (2025). *Economic Survey 2025* and
> *Quarterly Labour Force Reports*.
