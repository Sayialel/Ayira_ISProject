"""
Should TF-IDF be restricted to the 851-term skills vocabulary, or taught to
see multi-word skills, or left as it is?

    python -m eval.tune_tfidf

THE QUESTION BEHIND THE QUESTION. The vocabulary grew from 27 terms to 851,
and the obvious next thought is to point TF-IDF at it. That conflates two
things TF-IDF needs: a *vocabulary* (which terms are features) and a *corpus*
(which documents supply the document frequencies). The 851 skills are a
vocabulary. Supplying them restricts the feature space; it does not teach the
model anything new about the gigs.

Three arms, fitted on train and reported on test:

  current     free vocabulary, unigrams -- what ships today
  bigrams     free vocabulary, 1-2 grams
  restricted  the 851 skills as the vocabulary, 1-4 grams

`current` cannot represent a multi-word skill at all: with ngram_range=(1,1),
"graphic design" is never a feature, only "graphic" and "design"
independently. That is a real limitation and `bigrams` is the cheap test of
whether it costs anything.

`restricted` is the arm the request asked for, and the diagnostic printed
first is the reason to expect little from it: the corpus is KeSCO task prose
("planning, organizing and controlling the various..."), while the vocabulary
is largely occupational titles ("Personnel Manager"), which do not appear
verbatim in task prose. A vocabulary that matches half the documents gives
those documents a zero vector and so zero TF-IDF similarity to everything --
which removes the signal rather than sharpening it.

That connects to the other half of the request: the restricted arm is
expected to fail BECAUSE the gig corpus is synthetic. Real postings carry
requirement lists, which is exactly the text a skills vocabulary matches. So
the conclusion here is a statement about the corpus, not about the idea.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

from app.services.scoring import DEFAULT_WEIGHTS, Weights, gig_text, profile_text
from eval import experiment, splits
from eval.harness import Corpus, load_corpus
from eval.tune_weights import K, FeatureMatrix, candidate_weights, extract_features

VOCAB_PATH = Path(__file__).parent / "corpus_sources" / "skills_vocabulary.json"


def skills_vocabulary() -> list[str]:
    payload = json.loads(VOCAB_PATH.read_text(encoding="utf-8"))
    return sorted({s.lower() for terms in payload["skills"].values() for s in terms})


def build(arm: str, documents: list[str]) -> TfidfVectorizer:
    """Fits one arm's vectoriser. Fitted on training documents only."""
    if arm == "current":
        return TfidfVectorizer(stop_words="english", min_df=1, sublinear_tf=True).fit(documents)
    if arm == "bigrams":
        return TfidfVectorizer(
            stop_words="english", min_df=1, sublinear_tf=True, ngram_range=(1, 2)
        ).fit(documents)
    if arm == "restricted":
        vocab = skills_vocabulary()
        longest = max(len(s.split()) for s in vocab)
        return TfidfVectorizer(
            vocabulary=vocab, ngram_range=(1, longest), sublinear_tf=True
        ).fit(documents)
    raise ValueError(arm)


def coverage(vectorizer: TfidfVectorizer, texts: list[str]) -> tuple[float, float]:
    """Fraction of documents with any non-zero feature, and mean features each."""
    matrix = vectorizer.transform(texts)
    nnz = matrix.getnnz(axis=1)
    return float((nnz > 0).mean()), float(nnz.mean())


def tfidf_column(vectorizer: TfidfVectorizer, corpus: Corpus) -> np.ndarray:
    """Cosine similarity of each profile to each gig, under one vectoriser."""
    from app.services import tfidf_model

    gig_texts = [gig_text(g) for g in corpus.gigs]
    rows = [
        tfidf_model.similarities(vectorizer, profile_text(p), gig_texts)
        for p in corpus.profiles
    ]
    return np.asarray(rows, dtype=float)


def with_tfidf(features: FeatureMatrix, column: np.ndarray) -> FeatureMatrix:
    signals = features.signals.copy()
    signals[:, :, 1] = column
    return FeatureMatrix(
        profile_ids=features.profile_ids,
        gig_ids=features.gig_ids,
        signals=signals,
        grades=features.grades,
    )


def best_weights(features: FeatureMatrix) -> tuple[Weights, float]:
    best: tuple[Weights, float] | None = None
    for weights in candidate_weights():
        score = features.ndcg(weights)
        if best is None or score > best[1]:
            best = (weights, score)
    assert best is not None
    return best


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adopt-margin", type=float, default=0.005)
    parser.add_argument("--note", default="")
    args = parser.parse_args()

    full = load_corpus()
    corpora = {name: full.for_split(name) for name in ("train", "validation", "test")}

    run = experiment.Run(
        name="tune-tfidf",
        params={
            "question": "restrict TF-IDF to the skills vocabulary, add bigrams, or neither",
            "arms": ["current", "bigrams", "restricted"],
            "search_split": "train",
            "selection_split": "validation",
            "reporting_split": "test",
            "adopt_margin": args.adopt_margin,
            "vocabulary_terms": len(skills_vocabulary()),
            "metric": f"ndcg_at_{K}",
        },
        seeds={"split": splits.SPLIT_SEED},
        dataset_version=full.dataset_version,
        notes=args.note,
    )

    run.log(f"dataset version {full.dataset_version}")
    run.log("Extracting features once...")
    features = {name: extract_features(c) for name, c in corpora.items()}

    # Document frequencies come from training gigs only, never validation or
    # test -- the same discipline the shipped artefact follows.
    fit_gigs = splits.fit_scope(full.gigs, full.assignment, full.grades)
    fit_texts = [gig_text(g) for g in fit_gigs]
    run.log(f"fitting on {len(fit_texts)} training-scope gigs")

    all_gig_texts = [gig_text(g) for g in full.gigs]
    all_profile_texts = [profile_text(p) for p in full.profiles]

    run.log("")
    run.log("DIAGNOSTIC: can each arm even represent these documents?")
    run.log("arm          features   gigs w/ signal   terms/gig   profiles w/ signal")
    diagnostics = {}
    vectorizers = {}
    for arm in ("current", "bigrams", "restricted"):
        v = build(arm, fit_texts)
        vectorizers[arm] = v
        g_frac, g_mean = coverage(v, all_gig_texts)
        p_frac, _ = coverage(v, all_profile_texts)
        n_features = len(v.vocabulary_)
        diagnostics[arm] = {
            "features": n_features,
            "gigs_with_signal": g_frac,
            "mean_terms_per_gig": g_mean,
            "profiles_with_signal": p_frac,
        }
        run.log(
            f"{arm:11}  {n_features:8}   {g_frac:13.0%}   {g_mean:9.1f}   {p_frac:17.0%}"
        )

    run.log("")
    run.log("arm          train    validation   weights")
    results = {}
    for arm in ("current", "bigrams", "restricted"):
        feats = {
            name: with_tfidf(features[name], tfidf_column(vectorizers[arm], corpora[name]))
            for name in corpora
        }
        weights, train_score = best_weights(feats["train"])
        val_score = feats["validation"].ndcg(weights)
        deployed_val = feats["validation"].ndcg(DEFAULT_WEIGHTS)
        results[arm] = {
            "weights": weights.__dict__,
            "train_ndcg": train_score,
            "validation_ndcg": val_score,
            "validation_ndcg_deployed_weights": deployed_val,
            "_feats": feats,
        }
        run.log(
            f"{arm:11}  {train_score:.4f}   {val_score:.4f}      "
            f"sem {weights.semantic:.2f} tf {weights.tfidf:.2f} "
            f"loc {weights.location:.2f} rep {weights.reputation:.2f}"
        )

    baseline = results["current"]["validation_ndcg"]
    winner = max(results, key=lambda a: results[a]["validation_ndcg"])
    gain = results[winner]["validation_ndcg"] - baseline
    adopt = winner != "current" and gain >= args.adopt_margin

    run.log("")
    run.log(f"best on validation: {winner} ({results[winner]['validation_ndcg']:.4f}), "
            f"gain over current {gain:+.4f}, margin {args.adopt_margin:.4f}")
    run.log(f"VERDICT: {'ADOPT ' + winner if adopt else 'KEEP the current vectoriser'}")

    run.log("")
    run.log("REPORTED ON TEST (once):")
    for arm in ("current", "bigrams", "restricted"):
        w = Weights(**results[arm]["weights"])
        test_score = results[arm]["_feats"]["test"].ndcg(w)
        results[arm]["test_ndcg"] = test_score
        run.log(f"  {arm:11} {test_score:.4f}")

    run.finish(
        {
            "diagnostics": diagnostics,
            "arms": {
                a: {k: v for k, v in r.items() if not k.startswith("_")}
                for a, r in results.items()
            },
            "winner_on_validation": winner,
            "validation_gain_over_current": gain,
            "adopted": adopt,
        }
    )
    print(f"\nrun written to {run.directory}")


if __name__ == "__main__":
    main()
