# Annotation guide

How to judge whether a gig suits a worker, for the Ayira evaluation set.

**Guideline version: 1.1** — record this with every label, so judgements made
under a later revision stay distinguishable.

---

## Read this first: who may use this guide, and what their labels mean

Labels carry a `label_source`, and the three are **not interchangeable**:

| `label_source` | who | what it can support |
|---|---|---|
| `human` | a person independent of the system's design | the primary evaluation set; inter-annotator agreement |
| `ai_assisted` | the model that helped build the system | a second *method*, never a second *opinion* |
| `derived` | the KeSCO hierarchy rule in `build_corpus.derived_grade` | development only |

### Why `ai_assisted` is not independent

The assistant that built this matching engine also designed the KeSCO grading
rule. Its judgements cannot be an independent check on either, because
agreement would only show that the same author agrees with itself. Those labels
are recorded separately and **must not be reported as human annotation, nor
used to compute inter-annotator agreement.**

They are still worth having for one specific reason. The derived rule grades by
distance between occupation codes, so it is blind to location, pay, work
arrangement and employer quality — which is exactly why those signals correlate
near zero with the current labels and why their weights cannot be tuned. A
rubric that judges *suitability* instead of *taxonomy distance* produces labels
that can speak to them.

**The project still needs a genuinely independent annotator.** Nothing below
removes that.

---

## What you are judging

> Given everything you know about this worker, and everything the advert says,
> **would this worker be well served by seeing this gig near the top of their
> list?**

Not "is it the same occupation". A perfectly matched job in a city the worker
cannot reach is a bad result for them.

You are judging the *pairing*, not the quality of the gig or the worker.

## The scale

| grade | meaning |
|---|---|
| **3** | Strong match. The worker can plainly do this work, and nothing known about location, arrangement, pay or experience stands in the way. You would be pleased to see this first. |
| **2** | Relevant. The worker could do most of this, or could do it all with a modest stretch. Any practical obstacle is minor or unknown. Reasonable to show on the first page. |
| **1** | Weak. Some genuine overlap — a transferable skill, an adjacent trade — but an important requirement is unmet, or a practical obstacle is real. Showing it is not absurd; ranking it highly would be. |
| **0** | Not suitable. Different kind of work, or an obstacle that makes it impractical regardless of skill fit. |
| **unknown** | You cannot tell. The advert is too vague, or the profile too thin. **Use this.** It is a finding, not a failure. |

Never guess to avoid `unknown`. A guessed label is worse than a missing one,
because it looks like evidence.

## What to weigh, and in what order

**1. Can they do the work?** The dominant factor. Compare the worker's skills
and stated experience against what the advert actually requires. Credit genuine
transferable skill — a bookkeeper can often do data entry — but do not invent
ability the profile does not show.

**2. Can they physically do it?**
- Remote work: location is irrelevant. Do not penalise it.
- Same town: no obstacle.
- Same county, or within the same metropolitan area (Nairobi, Kiambu, Kajiado,
  Machakos, Murang'a): a commute, but a normal one.
- Different county: a real obstacle for on-site work. Usually caps the grade
  at 1 unless the role is senior enough to justify relocating.
- Unknown on either side: do **not** treat as a mismatch. Judge on the rest and
  lower your confidence.

**3. Does the arrangement fit?** Full-time against someone seeking casual work
is a genuine mismatch, even with perfect skills.

**4. Is the pay plausible?** Only when both the offer and the expectation are
known. An offer far below what the worker expects is a weak match however well
the skills line up. **Never infer a pay period that is not stated.**

**5. Employer reputation.** Where the advert shows a review score and a
review count, weigh it. A well-reviewed employer is a better prospect than an
unreviewed one, all else equal, and a poorly-reviewed one is worse. Treat an
employer with **no reviews as neutral, not as bad** — every employer starts
somewhere. Never let reputation alone carry a pairing whose skills do not fit.

*Added in v1.1 after the first annotation round. The v1.0 rubric omitted this
entirely, and the resulting labels correlated with employer reputation at
+0.081 — no better than the derived rule they were meant to improve on. An
annotator judges what the rubric asks about; if a factor is not listed, the
labels cannot speak to it.*

**6. Experience and qualifications.** A hard requirement the worker clearly
lacks — a licence, a registration — caps the grade at 1. Treat "preferred" as
preferred, not required.

## Rules that keep the labels honest

- **Do not look at the system's scores or rankings before judging.** If you
  know the engine ranked something first, you cannot un-know it, and your label
  stops being independent evidence.
- **Do not grade by occupation title alone.** "Manager" against "Manager" is
  not a match if one runs a farm and the other a payroll.
- **Do not reward shared wording.** Both texts may come from the same source
  vocabulary; that is an artefact of how the corpus was built, not evidence
  that the pairing is good.
- **Judge the pair in isolation.** Not "is this the best available gig", but
  "is this one suitable". The ranking is the system's job.
- **Record genuine uncertainty** in the `confidence` field: `high`, `medium`,
  `low`.

## Worked examples

**Grade 3** — Worker: data entry clerk, Nairobi, lists spreadsheet and
record-keeping skills. Gig: data capture for a Nairobi clinic, on-site,
spreadsheets. *Skills align, same town, no obstacle.*

**Grade 2** — Same worker. Gig: administrative assistant, Nairobi, includes
diary management and correspondence as well as data entry. *Most of the work is
within reach; some duties are a stretch.*

**Grade 2, not 3** — Same worker. Gig: data capture, Thika, on-site. *Skills
align exactly, but it is a daily commute from Nairobi. A real cost, not a
blocker.*

**Grade 1** — Same worker. Gig: bookkeeping assistant, remote, requires
familiarity with accounting software. *Adjacent and transferable, but a stated
requirement is unmet.*

**Grade 0** — Same worker. Gig: welder, Mombasa, on-site. *Different trade, and
the other side of the country.*

**Unknown** — Same worker. Gig: "Exciting opportunity — join our growing team!
Competitive package." *The advert says nothing about the work.*

## Adjudication

Where two independent annotators disagree:

1. Differences of one grade (2 against 3) are expected and may stand; report
   them in the agreement figure rather than resolving them away.
2. Differences of two or more grades are discussed, and the rubric clause that
   caused the split is identified.
3. If the rubric was ambiguous, **amend this guide and bump its version**
   rather than settling the single case. Record the outcome in
   `adjudication_status`.
4. Pairs either annotator marked `unknown` are excluded from agreement, and
   counted separately.

## What to record per label

`worker_id`, `gig_id`, `relevance_grade`, `label_source`,
`labeler_id_pseudonym`, `labeling_guideline_version`, `label_timestamp`,
`confidence`, `adjudication_status`, `rationale`, `is_synthetic`.

The `rationale` is one sentence naming the deciding factor. It is what makes a
label reviewable instead of merely present.
