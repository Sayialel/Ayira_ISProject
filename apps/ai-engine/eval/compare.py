"""
Compares two runs.

    python -m eval.compare                        # the two most recent
    python -m eval.compare <baseline> <candidate>
    python -m eval.compare --list

Step 7 asks whether a change is actually an improvement, and for unsuccessful
runs to be kept rather than deleted. Both need runs to be comparable after the
fact, which is what the manifests make possible.

What this refuses to do
-----------------------
Two runs measured on different corpora, or on different splits, are not
comparable, and subtracting their numbers produces a difference that looks like
a result. This checks the dataset version and the split before reporting any
delta, and says so plainly when they disagree rather than printing the
subtraction anyway.
"""

import argparse
import json

from eval import experiment

METRIC_KEYS = [
    ("ndcg_at_10", "NDCG@10"),
    ("precision_at_5", "P@5"),
    ("precision_at_10", "P@10"),
    ("recall_at_10", "R@10"),
    ("mrr", "MRR"),
]

# Below this, a difference on a corpus this size is noise rather than signal.
MEANINGFUL_DELTA = 0.005


def strategy_metrics(metrics: dict | None) -> dict[str, dict]:
    """
    Pulls comparable rows out of a run, whatever shape it recorded.

    The three experiments report differently - baselines list strategies,
    tuning reports per-split figures, retrieval reports per-shortlist figures -
    so each is flattened to named rows carrying whichever metrics it has. Rows
    that exist in only one of the two runs are dropped by the caller, which is
    why a baselines run and a tuning run compare to nothing rather than to
    something misleading.
    """
    if not metrics:
        return {}

    # Baselines: a list of per-strategy results.
    results = metrics.get("results")
    if isinstance(results, list):
        return {
            row["name"]: row
            for row in results
            if isinstance(row, dict) and "name" in row
        }

    rows: dict[str, dict] = {}

    # Tuning: nested per-split figures.
    for split in ("train", "validation", "test"):
        section = metrics.get(split)
        if not isinstance(section, dict):
            continue
        for key, value in section.items():
            if isinstance(value, dict) and "ndcg_at_10" in value:
                rows[f"{split} {key}"] = {"ndcg_at_10": value["ndcg_at_10"]}
            elif key.endswith("ndcg_at_10") and isinstance(value, (int, float)):
                label = key.removesuffix("_ndcg_at_10") or "overall"
                rows[f"{split} {label}"] = {"ndcg_at_10": value}

    # Retrieval: one row per shortlist size.
    for row in metrics.get("rows", []) or []:
        if isinstance(row, dict) and "pool" in row:
            rows[f"shortlist {row['pool']}"] = row

    return rows


def comparable(baseline: dict, candidate: dict) -> list[str]:
    """Reasons the two runs cannot be compared. Empty means they can."""
    problems = []

    base_version = baseline["manifest"].get("dataset_version")
    cand_version = candidate["manifest"].get("dataset_version")
    if base_version != cand_version:
        problems.append(
            f"different dataset versions ({base_version} vs {cand_version}) - "
            "the corpora are not the same data"
        )

    base_split = (baseline.get("metrics") or {}).get("split")
    cand_split = (candidate.get("metrics") or {}).get("split")
    if base_split != cand_split:
        problems.append(
            f"different splits ({base_split} vs {cand_split}) - these measure "
            "different profiles"
        )

    return problems


def report(baseline: dict, candidate: dict) -> None:
    print()
    print(f"baseline  {baseline['manifest']['run_id']}")
    print(f"candidate {candidate['manifest']['run_id']}")
    print()

    for label, run in (("baseline", baseline), ("candidate", candidate)):
        git = run["manifest"].get("git", {})
        dirty = " + uncommitted changes" if git.get("dirty") else ""
        print(
            f"  {label:<10} commit {git.get('short_commit')}{dirty}, "
            f"dataset {run['manifest'].get('dataset_version')}"
        )
    print()

    problems = comparable(baseline, candidate)
    if problems:
        print("These runs are not comparable:")
        for problem in problems:
            print(f"  - {problem}")
        print(
            "\nReporting the difference anyway would produce a number that looks "
            "like a\nresult but is not one. Re-run both on the same corpus and "
            "split first.\n"
        )
        return

    base_rows = strategy_metrics(baseline.get("metrics"))
    cand_rows = strategy_metrics(candidate.get("metrics"))
    shared = [name for name in cand_rows if name in base_rows]

    if not shared:
        print("No strategies in common between these runs, so there is nothing to compare.\n")
        return

    width = max(len(name) for name in shared) + 2
    header = f"{'strategy':<{width}}" + "".join(f"{label:>12}" for _, label in METRIC_KEYS)
    print(header)
    print("-" * len(header))

    for name in shared:
        cells = []
        for key, _ in METRIC_KEYS:
            before = base_rows[name].get(key)
            after = cand_rows[name].get(key)
            if before is None or after is None:
                cells.append(f"{'-':>12}")
                continue
            delta = after - before
            marker = "" if abs(delta) < MEANINGFUL_DELTA else ("+" if delta > 0 else "")
            cells.append(f"{marker}{delta:>11.4f}")
        print(f"{name:<{width}}" + "".join(cells))

    print(
        f"\nDifferences below {MEANINGFUL_DELTA:.3f} are within what this corpus can "
        "resolve;\ntreat them as unchanged rather than as small gains."
    )

    headline_base = (baseline.get("metrics") or {}).get("headline", {})
    headline_cand = (candidate.get("metrics") or {}).get("headline", {})
    if "ndcg_at_10" in headline_base and "ndcg_at_10" in headline_cand:
        delta = headline_cand["ndcg_at_10"] - headline_base["ndcg_at_10"]
        verdict = (
            "an improvement"
            if delta > MEANINGFUL_DELTA
            else "a regression"
            if delta < -MEANINGFUL_DELTA
            else "unchanged"
        )
        print(f"\nHeadline NDCG@10: {delta:+.4f} - {verdict}.")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", nargs="?", help="the earlier run id")
    parser.add_argument("candidate", nargs="?", help="the later run id")
    parser.add_argument("--list", action="store_true", help="list recent runs")
    args = parser.parse_args()

    runs = experiment.list_runs(limit=40)

    if args.list:
        if not runs:
            raise SystemExit("No runs recorded yet.")
        print("\nRecorded runs, newest first:\n")
        for directory in runs:
            manifest_file = directory / "manifest.json"
            note = ""
            if manifest_file.exists():
                manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
                note = f"  {manifest.get('notes', '')}".rstrip()
            print(f"  {directory.name}{note}")
        print()
        return

    if args.baseline and args.candidate:
        report(experiment.load_run(args.baseline), experiment.load_run(args.candidate))
        return

    # No arguments: compare the two most recent runs of the same name, which is
    # the usual "did my change help?" question.
    if len(runs) < 2:
        raise SystemExit("Need at least two recorded runs to compare.")

    newest = experiment.load_run(runs[0])
    name = newest["manifest"].get("name")
    previous = next(
        (
            experiment.load_run(d)
            for d in runs[1:]
            if json.loads((d / "manifest.json").read_text(encoding="utf-8")).get("name") == name
        ),
        None,
    )

    if previous is None:
        raise SystemExit(
            f"Only one run named '{name}'. Name the two runs to compare explicitly, "
            "or see --list."
        )

    report(previous, newest)


if __name__ == "__main__":
    main()
