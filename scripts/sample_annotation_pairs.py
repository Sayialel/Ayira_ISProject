"""
Builds a blind annotation sheet of worker-gig pairs.

    python scripts/sample_annotation_pairs.py --count 100

Produces two files:

    data/annotation/sheet_<version>.json    what the annotator reads
    data/annotation/key_<version>.json      what they must not read

The split is the point. The sheet carries the worker profile and the advert and
nothing else -- no derived grade, no model score, no rank. The key holds those,
and is only opened after the labels are in. An annotator who has seen the
model's opinion cannot give an independent one.

Sampling
--------
Annotating whatever the model ranks first would measure how well the model
agrees with itself. Pairs are therefore drawn across four rank bands, so the
sheet includes gigs the engine buried as well as gigs it loved, and across the
derived grades and categories so no part of the corpus is invisible.

The bands are computed here and withheld; they exist to shape the sample, not
to inform the judgement.
"""

import argparse
import json
import random
from datetime import datetime, timezone
from pathlib import Path

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "ai-engine"))

from app.services.scoring import DEFAULT_WEIGHTS, gig_text, profile_text  # noqa: E402
from eval.harness import load_corpus  # noqa: E402
from eval.tune_weights import extract_features  # noqa: E402

OUT = ROOT / "data" / "annotation"
SEED = 20261019

# Where in the engine's own ranking each sampled pair came from. Deliberately
# includes the tail: a ranker is judged as much by what it buries as by what it
# promotes.
BANDS = [
    ("top_5", 0, 5, 0.30),
    ("6_to_20", 5, 20, 0.30),
    ("21_to_50", 20, 50, 0.25),
    ("below_50", 50, 10**6, 0.15),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=100)
    parser.add_argument("--version", default="v1")
    args = parser.parse_args()

    corpus = load_corpus()
    features = extract_features(corpus)
    gigs = {g["id"]: g for g in corpus.gigs}
    profiles = {p["id"]: p for p in corpus.profiles}

    rng = random.Random(SEED)

    # The engine's ranking per profile, used only for stratification.
    ranked = features.ranked_ids(DEFAULT_WEIGHTS)
    full_rank: dict[str, list[str]] = {}
    for index, pid in enumerate(features.profile_ids):
        scores = features.scores(DEFAULT_WEIGHTS)[index]
        order = sorted(range(len(features.gig_ids)), key=lambda j: -scores[j])
        full_rank[pid] = [features.gig_ids[j] for j in order]

    candidates: list[dict] = []
    for pid, order in full_rank.items():
        grades = corpus.grades.get(pid, {})
        for position, gid in enumerate(order):
            candidates.append(
                {
                    "worker_id": pid,
                    "gig_id": gid,
                    "rank": position,
                    "derived_grade": grades.get(gid, 0),
                    "category": profiles[pid].get("category", "Unknown"),
                }
            )

    # Draw per band, then balance across categories inside each band.
    chosen: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for name, low, high, share in BANDS:
        want = max(1, round(args.count * share))
        pool = [c for c in candidates if low <= c["rank"] < high]
        rng.shuffle(pool)

        by_category: dict[str, list[dict]] = {}
        for item in pool:
            by_category.setdefault(item["category"], []).append(item)

        # Round-robin across categories so one large category cannot dominate.
        picked = 0
        while picked < want and any(by_category.values()):
            for category in sorted(by_category):
                if picked >= want:
                    break
                bucket = by_category[category]
                while bucket:
                    item = bucket.pop()
                    key = (item["worker_id"], item["gig_id"])
                    if key in seen:
                        continue
                    seen.add(key)
                    item["band"] = name
                    chosen.append(item)
                    picked += 1
                    break

    rng.shuffle(chosen)

    stamp = datetime.now(timezone.utc).isoformat()
    OUT.mkdir(parents=True, exist_ok=True)

    sheet = []
    key = []
    for index, item in enumerate(chosen, start=1):
        worker = profiles[item["worker_id"]]
        gig = gigs[item["gig_id"]]

        sheet.append(
            {
                "pair_id": f"{args.version}-{index:04d}",
                "worker": {
                    "label": worker.get("label"),
                    "bio": worker.get("bio"),
                    "skills": worker.get("skills"),
                    "location": worker.get("location"),
                },
                "gig": {
                    "title": gig.get("title"),
                    "description": gig.get("description"),
                    "required_skills": gig.get("required_skills"),
                    "location": gig.get("location"),
                    "is_remote": gig.get("is_remote"),
                    "budget_min": gig.get("budget_min"),
                    "budget_max": gig.get("budget_max"),
                    "currency": "KES",
                    "employer_reputation": gig.get("employer_reputation"),
                    "employer_review_count": gig.get("employer_review_count"),
                },
            }
        )
        key.append(
            {
                "pair_id": f"{args.version}-{index:04d}",
                "worker_id": item["worker_id"],
                "gig_id": item["gig_id"],
                "engine_rank": item["rank"],
                "band": item["band"],
                "derived_grade": item["derived_grade"],
                "category": item["category"],
            }
        )

    (OUT / f"sheet_{args.version}.json").write_text(
        json.dumps(
            {
                "guideline_version": "1.0",
                "generated_at": stamp,
                "seed": SEED,
                "dataset_version": corpus.dataset_version,
                "instructions": "See docs/ANNOTATION_GUIDE.md. Do not open the key file.",
                "pairs": sheet,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    (OUT / f"key_{args.version}.json").write_text(
        json.dumps(
            {"generated_at": stamp, "dataset_version": corpus.dataset_version, "key": key},
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    bands: dict[str, int] = {}
    cats: dict[str, int] = {}
    grades: dict[int, int] = {}
    for item in chosen:
        bands[item["band"]] = bands.get(item["band"], 0) + 1
        cats[item["category"]] = cats.get(item["category"], 0) + 1
        grades[item["derived_grade"]] = grades.get(item["derived_grade"], 0) + 1

    print(f"sampled {len(chosen)} pairs across {len({c['worker_id'] for c in chosen})} profiles")
    print(f"  by engine rank band : {bands}")
    print(f"  by category         : {cats}")
    print(f"  by derived grade    : {dict(sorted(grades.items()))}  (withheld from the sheet)")
    print(f"\nsheet: data/annotation/sheet_{args.version}.json")
    print(f"key  : data/annotation/key_{args.version}.json  (do not open before labelling)")


if __name__ == "__main__":
    main()
