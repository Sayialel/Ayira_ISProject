"""
Figures saved into a run folder.

Step 4 of the workflow asks for plots alongside the metrics. The numbers are
the evidence; a figure is what makes a difference between two runs visible at a
glance, and what goes into the write-up.

matplotlib is imported with the Agg backend because these run headless — in
Colab, and in a terminal with no display attached.
"""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402  (must follow the backend choice)

# Enough contrast to survive being printed in greyscale.
PALETTE = ["#94a3b8", "#60a5fa", "#2563eb", "#f59e0b", "#047857"]


def baseline_comparison(results: list, path: Path, title: str) -> Path:
    """
    One grouped bar per strategy across the reported metrics.

    The baselines sit beside the composite deliberately: the question the
    evaluation answers is not "what score does the system get" but "does it
    beat keyword matching and the embedding model alone, and by how much".
    """
    metric_names = ["P@5", "P@10", "R@10", "MRR", "NDCG@10"]
    metric_keys = [
        "precision_at_5",
        "precision_at_10",
        "recall_at_10",
        "mrr",
        "ndcg_at_10",
    ]

    fig, ax = plt.subplots(figsize=(10, 5))
    width = 0.8 / max(len(results), 1)
    positions = range(len(metric_names))

    for index, result in enumerate(results):
        values = [getattr(result, key) for key in metric_keys]
        offsets = [p + index * width for p in positions]
        ax.bar(
            offsets,
            values,
            width=width,
            label=result.name,
            color=PALETTE[index % len(PALETTE)],
        )

    centre = (len(results) - 1) * width / 2
    ax.set_xticks([p + centre for p in positions])
    ax.set_xticklabels(metric_names)
    ax.set_ylim(0, 1.0)
    ax.set_ylabel("score")
    ax.set_title(title)
    ax.legend(loc="upper left", fontsize=9, framealpha=0.9)
    ax.grid(axis="y", alpha=0.25, linestyle=":")
    ax.set_axisbelow(True)

    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return path


def shortlist_curve(rows: list[dict], path: Path, total_gigs: int) -> Path:
    """
    Ranking quality against shortlist size, for the two-stage retrieval check.

    The horizontal line is exhaustive scoring. Where the curve meets it is the
    smallest shortlist that costs nothing, which is the number the engine
    should actually use.
    """
    finite = [r for r in rows if r["pool"] != "exhaustive"]
    exhaustive = next((r for r in rows if r["pool"] == "exhaustive"), None)

    xs = [int(r["pool"]) for r in finite]
    ys = [r["ndcg_at_10"] for r in finite]

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(xs, ys, marker="o", color="#2563eb", label="shortlist then re-rank")

    if exhaustive:
        ax.axhline(
            exhaustive["ndcg_at_10"],
            color="#047857",
            linestyle="--",
            label=f"exhaustive ({exhaustive['ndcg_at_10']:.4f})",
        )

    ax.set_xlabel(f"shortlist size (catalogue is {total_gigs} gigs)")
    ax.set_ylabel("NDCG@10")
    ax.set_title("Cost of two-stage retrieval")
    ax.legend(fontsize=9)
    ax.grid(alpha=0.25, linestyle=":")
    ax.set_axisbelow(True)

    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return path


def weight_sensitivity(scored: list[tuple[float, object]], path: Path, current: float) -> Path:
    """
    How much the composite weights actually matter.

    A flat distribution would mean the weighting is nearly irrelevant and the
    tuning is noise; a sharp one means the choice is doing work. Worth knowing
    before claiming a tuned gain.
    """
    values = sorted((score for score, _ in scored), reverse=True)

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(range(len(values)), values, color="#2563eb", linewidth=1.2)
    ax.axhline(
        current, color="#f59e0b", linestyle="--", label=f"shipped weights ({current:.4f})"
    )
    ax.set_xlabel("weight combinations, best first")
    ax.set_ylabel("NDCG@10")
    ax.set_title("Sensitivity to the composite weights")
    ax.legend(fontsize=9)
    ax.grid(alpha=0.25, linestyle=":")
    ax.set_axisbelow(True)

    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return path
