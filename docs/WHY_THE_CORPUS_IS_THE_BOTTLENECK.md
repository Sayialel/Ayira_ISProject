# Two improvements that did not work, and the one reason both failed

Written 8 November 2026. Two changes were proposed, both plausible, both
measured, both rejected. They failed for the same underlying reason, and that
reason is the most useful result in this document: **the limiting factor is no
longer the model, it is the evaluation corpus.**

Runs: `eval/results/runs/20261108T165204Z__tune-location__9a266dd` and
`20261108T165530Z__tune-tfidf__9a266dd`.

---

## 1. Replace the four-tier location affinity with measured distance

### The proposal

The location signal is a four-valued approximation of a continuous quantity:

| Tier | Value |
|---|---|
| Same town | 1.00 |
| Same county | 0.60 |
| Same metro | 0.45 |
| Unknown | 0.30 |
| Different county | 0.00 |

It cannot separate pairs inside one bucket. Nakuru to Nairobi is about 160 km,
an awkward but real trip; Mombasa to Nairobi is about 440 km, an overnight
journey. Both score **0.00**. The weight had separately been tuned *down* from
0.15 to 0.03, which is evidence the tiered signal was not earning its place —
so the fair question was whether a sharper signal would earn more.

### What was built

Coordinates for all 34 towns the matcher knows, a haversine distance, and an
exponential decay `0.5 ** (km / halflife)`. The half-life was swept across
eight values from 10 km to 200 km. Weights were searched on **train**, the
pair selected on **validation**, and the winner reported once on **test** —
the same protocol `tune_weights.py` uses.

### The result

```
BASELINE  tiers + deployed weights: validation 0.7701   test 0.7802
BASELINE  tiers + searched weights: validation 0.7692

halflife   train    validation   weights
     10   0.7918   0.7692      sem 0.55 tf 0.45 loc 0.00 rep 0.00
     20   0.7918   0.7692      sem 0.55 tf 0.45 loc 0.00 rep 0.00
     30   0.7918   0.7692      sem 0.55 tf 0.45 loc 0.00 rep 0.00
     50   0.7918   0.7692      sem 0.55 tf 0.45 loc 0.00 rep 0.00
     75   0.7918   0.7692      sem 0.55 tf 0.45 loc 0.00 rep 0.00
    100   0.7918   0.7692      sem 0.55 tf 0.45 loc 0.00 rep 0.00
    150   0.7918   0.7692      sem 0.55 tf 0.45 loc 0.00 rep 0.00
    200   0.7918   0.7700      sem 0.55 tf 0.40 loc 0.05 rep 0.00

validation gain -0.0002, margin required 0.0050
VERDICT: KEEP the tiers
```

Two things in that table matter more than the verdict.

**The weight search put location at 0.00 at every half-life below 200 km.**
Not "a small weight" — zero. The search is saying the location signal carries
no information that helps ranking, at any granularity.

**The only half-life that got a non-zero weight was 200 km**, which is the
setting where distance barely varies across Kenya — effectively a constant.
That is the search finding noise, not signal, and it bought -0.0002.

### Why it failed

**The relevance grades are independent of location by construction.** They
were derived from KeSCO occupational-code agreement — the `note` column in
`relevance.csv` literally reads `KeSCO 1212 vs 1212`. Location played no part
in deciding whether a pair was graded 0, 1, 2 or 3.

No location signal, however sharp, can predict a label that location never
influenced. The experiment was not testing whether distance is better than
tiers; it was testing whether a better location signal helps predict labels
that ignore location. The answer to that is necessarily no.

### What shipped

Nothing, in the scoring path. `location_affinity` still uses the tiers,
because that is the configuration the reported NDCG@10 of 0.780 describes, and
shipping an unearned change would mean deploying something the evaluation does
not cover. A test pins this so it cannot drift back without re-running the
sweep.

`distance_km`, `distance_affinity` and the coordinates **are** shipped, tested,
and in use — for the **map and the distance badges**, which are a display
feature and need no evaluation to justify. The measurement path is ready for
the day the corpus can answer the question.

---

## 2. Restrict TF-IDF to the 851-term skills vocabulary

### The proposal

The vocabulary grew from 27 terms to 851. Point TF-IDF at it.

### The confusion worth naming

TF-IDF needs two different things: a **vocabulary** (which terms are features)
and a **corpus** (which documents supply the document frequencies). The 851
skills are a vocabulary. Supplying them restricts the feature space; it
teaches the model nothing new about the gigs.

Three arms were measured, fitted on training-scope gigs only:

- `current` — free vocabulary, unigrams. What ships.
- `bigrams` — free vocabulary, 1–2 grams. Tests whether the current setup's
  inability to represent "graphic design" as a single feature costs anything.
- `restricted` — the 851 skills as the vocabulary, 1–4 grams.

### The result

The diagnostic settled it before the metric did:

```
arm          features   gigs w/ signal   terms/gig   profiles w/ signal
current          1444            100%        21.2                100%
bigrams          4906            100%        45.6                100%
restricted        849             51%         0.7                 45%
```

**Half the gigs and more than half the profiles get a completely zero vector
under the restricted vocabulary.** A zero vector has zero cosine similarity to
everything, so for those documents the TF-IDF term — 22% of the composite —
contributes nothing at all. The restriction removes the signal rather than
sharpening it.

```
arm          train    validation   weights
current      0.7906   0.7664      sem 0.60 tf 0.40 loc 0.00 rep 0.00
bigrams      0.7932   0.7670      sem 0.50 tf 0.50 loc 0.00 rep 0.00
restricted   0.7872   0.7578      sem 0.80 tf 0.20 loc 0.00 rep 0.00

best on validation: bigrams, gain over current +0.0006, margin 0.0050
VERDICT: KEEP the current vectoriser
```

`restricted` is the worst arm on validation, as the diagnostic predicted.
`bigrams` gains +0.0006, which is noise against a 0.005 margin.

**One honest note on the test figures.** They came out `current` 0.7658,
`bigrams` 0.7776, `restricted` 0.7481 — so bigrams looks better on test than
the arm that was kept. That is exactly why the decision is made on validation.
Choosing bigrams *because* its test number is higher would be selecting on the
held-out split, which is the one thing the protocol exists to prevent. The
figure is recorded; it is not a result.

### Why it failed

**The gig text is KeSCO task prose, not requirement lists.** A gig
description reads "planning, organizing and controlling the various..." while
the vocabulary is largely occupational titles — "Personnel Manager" — which
do not appear verbatim in task prose. The vocabulary and the corpus describe
the same occupations in incompatible registers.

---

## The common cause, and what follows from it

Both experiments failed because of a property of the corpus, not of the idea:

| Experiment | Why it failed | Corpus property |
|---|---|---|
| Distance for location | Labels ignore location | Grades derived from KeSCO code agreement |
| Skills vocabulary for TF-IDF | Vocabulary cannot match the text | Gig text is generated task prose |

The same cause also explains something already recorded: the platform's own
106 gigs could not be mined for vocabulary, because their `required_skills`
were generated from the same KeSCO task text — the observed values include
`Records`, `Procedures` and `Price Lists Discount`.

Three signals are now pointing at one thing. **Further weight tuning and
feature sharpening have run out of room on this corpus.** Both searches put
location *and* reputation at 0.00, meaning the measurable task has collapsed to
"semantic plus TF-IDF", and the deployed weights (0.72 / 0.22 / 0.03 / 0.03)
already score at least as well on validation as a fresh search does.

### So: make the corpus real — but understand what that costs

This was the right instinct. It is also the prerequisite for both experiments
above, not a parallel task. The blocker is not the gigs, it is the **labels**.

What is cheap: real gig postings. MyJobMag's listing pages are
robots.txt-permitted and were already read for the vocabulary.

What is not cheap, and is the whole job: **relevance judgements.** The current
1,482 grades were derived mechanically. Real postings arrive with none, and
deriving them the same way would reproduce the same defect. They have to be
annotated by a person against a written rubric — which is already the largest
open methodological item in `REMAINING_WORK.md` §2.1, where a second annotator
and an inter-annotator agreement figure are listed as the biggest weakness.

A realistic scope, if it is attempted: 20–30 real postings, annotated against
the existing profiles by two people, reported with Cohen's κ, used as a
**second held-out test set** rather than a replacement. That would let both
experiments above be re-run on labels that are not blind to location, and
would turn the project's biggest methodological gap into a reported figure.

Until then, the honest position for the defence is the one this document
records: the two improvements were proposed, built, measured against a
pre-registered margin on a held-out split, and rejected on the evidence — and
the measurement identified the real constraint.
