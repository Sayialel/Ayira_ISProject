"""
Turns the composite score into a probability that means something.

    python -m eval.calibrate            # fit on train, report on test
    python -m eval.calibrate --promote  # also write the serving artefact

THE PROBLEM. The composite is a weighted sum of a cosine similarity, a TF-IDF
cosine, a location tier and a reputation fraction. It ranks well -- NDCG@10
0.780 on the held-out split -- and it means nothing as a number. Semantic
carries 0.72 of the weight and MiniLM cosine between two short related texts
tops out around 0.6-0.75, so the composite is structurally capped near 0.7: a
genuinely good match reads "59%". Workers read that as a poor match and ask
why the matcher is so unsure, which is the right question about the wrong
quantity.

Multiplying by a constant to make the number look better would be dishonest,
and a sigmoid tuned by eye no better. What makes a percentage defensible is
having something to be a percentage *of*.

THE FIX. Platt scaling: a one-feature logistic regression from composite score
to P(grade >= 2), fitted on the annotated pairs. "87% match" then states a
measurable claim -- of the pairs scoring like this one, 87% were judged good
or ideal -- and the claim can be checked, which is what the reliability table
below does.

WHAT IT DOES NOT CHANGE. A logistic transform is strictly monotonic, so it
cannot reorder anything. Every rank-based figure already reported -- NDCG,
P@k, R@10, MRR -- is identical before and after. This is a change to what the
number says, not to which gigs are shown, and it is the honest version of
"make the scores higher": the strong matches do land in the 80s and 90s, and
they land there because they really are strong.

Fitted on the TRAIN split only, and reported on TEST, for the same reason the
TF-IDF vectorizer is: a calibration fitted on the pairs it is scored against
would report its own training error.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, asdict
from pathlib import Path

from app.services.scoring import DEFAULT_WEIGHTS, score_gigs
from eval import harness

ARTIFACT_PATH = Path(__file__).parent.parent / "artifacts" / "calibration.json"

#: A pair counts as relevant at grade 2 (good) or 3 (ideal). Grade 1 is
#: "marginal", which the metrics already treat as not relevant, and using a
#: different threshold here than the metrics use would calibrate against a
#: different question than the one being evaluated.
RELEVANT_AT = 2

#: Bins for the reliability table. Ten would leave single-digit counts in the
#: tails on 1,482 pairs and the table would read as noise.
RELIABILITY_BINS = 5


@dataclass(frozen=True)
class Calibration:
    """y = 1 / (1 + exp(-(a*x + b))), with x the raw composite."""

    a: float
    b: float
    fitted_on: str
    n_pairs: int
    n_relevant: int
    relevant_at: int

    def apply(self, score: float) -> float:
        # Clamped before exp so a wild score cannot overflow it.
        z = max(-30.0, min(30.0, self.a * score + self.b))
        return 1.0 / (1.0 + math.exp(-z))


def _pairs(corpus: harness.Corpus) -> list[tuple[float, int]]:
    """
    Every graded pair in this corpus, as (composite score, relevant 0/1).

    Scored through score_gigs rather than a reimplementation, so the number
    being calibrated is the number the engine serves.
    """
    gigs_by_id = {g["id"]: g for g in corpus.gigs}
    out: list[tuple[float, int]] = []

    for profile in corpus.profiles:
        graded = corpus.grades.get(profile["id"], {})
        if not graded:
            continue

        # Only the judged gigs: an unjudged pair has no label, and treating
        # the unjudged majority as irrelevant would train the model to say
        # "no" to almost everything.
        judged = [gigs_by_id[gid] for gid in graded if gid in gigs_by_id]
        if not judged:
            continue

        scored = score_gigs(profile, judged, DEFAULT_WEIGHTS, vectorizer=corpus.vectorizer)
        for item in scored:
            grade = graded.get(item.gig_id)
            if grade is None:
                continue
            out.append((item.score, 1 if grade >= RELEVANT_AT else 0))

    return out


def fit(pairs: list[tuple[float, int]], split_name: str) -> Calibration:
    """
    Fits the logistic by gradient descent on the log loss.

    Hand-rolled rather than sklearn's LogisticRegression because this is one
    feature and two parameters, and it keeps the serving path free of a
    sklearn import -- the engine runs in 512 MB and loads sklearn lazily as it
    is. Two parameters from a convex objective do not need a solver.
    """
    xs = [p[0] for p in pairs]
    ys = [float(p[1]) for p in pairs]
    n = len(pairs)
    if n == 0:
        raise SystemExit("No graded pairs to calibrate on.")

    a, b = 1.0, 0.0
    learning_rate = 0.5

    for step in range(20_000):
        grad_a = grad_b = 0.0
        for x, y in zip(xs, ys):
            z = max(-30.0, min(30.0, a * x + b))
            p = 1.0 / (1.0 + math.exp(-z))
            error = p - y
            grad_a += error * x
            grad_b += error
        a -= learning_rate * grad_a / n
        b -= learning_rate * grad_b / n

        if step % 5_000 == 0 and abs(grad_a / n) < 1e-7 and abs(grad_b / n) < 1e-7:
            break

    return Calibration(
        a=a,
        b=b,
        fitted_on=split_name,
        n_pairs=n,
        n_relevant=int(sum(ys)),
        relevant_at=RELEVANT_AT,
    )


def brier(calibration: Calibration, pairs: list[tuple[float, int]]) -> float:
    """Mean squared error of the probabilities. Lower is better; 0.25 is a coin flip."""
    return sum((calibration.apply(x) - y) ** 2 for x, y in pairs) / len(pairs)


def base_rate_brier(pairs: list[tuple[float, int]]) -> float:
    """What Brier a model that ignores the score and always predicts the base rate gets."""
    rate = sum(y for _, y in pairs) / len(pairs)
    return sum((rate - y) ** 2 for _, y in pairs) / len(pairs)


def reliability(calibration: Calibration, pairs: list[tuple[float, int]]) -> list[dict]:
    """
    Predicted probability against observed frequency, in bins.

    This is the table that decides whether the percentage may be shown to a
    worker. If the pairs predicted at 0.8 were judged relevant about 80% of
    the time, the number on the screen is a claim that holds.
    """
    bins: list[dict] = []
    for i in range(RELIABILITY_BINS):
        low = i / RELIABILITY_BINS
        high = (i + 1) / RELIABILITY_BINS
        members = [
            (calibration.apply(x), y)
            for x, y in pairs
            if low <= calibration.apply(x) < high or (i == RELIABILITY_BINS - 1 and calibration.apply(x) == 1.0)
        ]
        if not members:
            bins.append({"range": f"{low:.0%}-{high:.0%}", "n": 0})
            continue
        bins.append(
            {
                "range": f"{low:.0%}-{high:.0%}",
                "n": len(members),
                "mean_predicted": sum(p for p, _ in members) / len(members),
                "observed": sum(y for _, y in members) / len(members),
            }
        )
    return bins


def expected_calibration_error(bins: list[dict], total: int) -> float:
    """Weighted mean gap between predicted and observed across the bins."""
    return sum(
        (b["n"] / total) * abs(b["mean_predicted"] - b["observed"])
        for b in bins
        if b["n"] > 0
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--promote",
        action="store_true",
        help="write artifacts/calibration.json so the engine serves calibrated scores",
    )
    args = parser.parse_args()

    corpus = harness.load_corpus()
    train = corpus.for_split("train")
    test = corpus.for_split("test")

    print(f"train -> {train.describe()}")
    print(f"test  -> {test.describe()}\n")

    train_pairs = _pairs(train)
    test_pairs = _pairs(test)

    calibration = fit(train_pairs, "train")

    print(f"fitted a={calibration.a:.4f} b={calibration.b:.4f} "
          f"on {calibration.n_pairs} pairs ({calibration.n_relevant} relevant)\n")

    for label, pairs in (("train", train_pairs), ("test", test_pairs)):
        if not pairs:
            print(f"{label}: no graded pairs")
            continue
        b = brier(calibration, pairs)
        baseline = base_rate_brier(pairs)
        bins = reliability(calibration, pairs)
        ece = expected_calibration_error(bins, len(pairs))

        print(f"{label}: {len(pairs)} pairs")
        print(f"  Brier {b:.4f}  (base rate alone: {baseline:.4f})")
        print(f"  ECE   {ece:.4f}")
        print("  predicted -> observed")
        for row in bins:
            if row["n"] == 0:
                print(f"    {row['range']:>9}  (empty)")
            else:
                print(
                    f"    {row['range']:>9}  n={row['n']:<5} "
                    f"predicted {row['mean_predicted']:.3f}  observed {row['observed']:.3f}"
                )
        print()

    # What the change looks like on the screen, which is the point.
    print("raw composite -> calibrated")
    for raw in (0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80):
        print(f"  {raw:.2f} -> {calibration.apply(raw):.0%}")

    if args.promote:
        ARTIFACT_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = asdict(calibration)
        payload["_note"] = (
            "Platt scaling from composite score to P(grade >= 2). Fitted by "
            "eval/calibrate.py on the train split. Strictly monotonic, so it "
            "cannot change any ranking or any rank-based metric."
        )
        payload["dataset_version"] = corpus.dataset_version
        ARTIFACT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"\nwrote {ARTIFACT_PATH}")
    else:
        print("\n(--promote not given; nothing written)")


if __name__ == "__main__":
    main()
