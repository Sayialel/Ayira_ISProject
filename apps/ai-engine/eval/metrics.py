"""
Ranking metrics.

Each takes a ranked list of gig ids and a mapping of gig id to relevance grade
(0-3), where any id absent from the mapping is graded 0.
"""

import math


def precision_at_k(ranked: list[str], grades: dict[str, int], k: int, threshold: int = 2) -> float:
    """
    Fraction of the top k that are genuinely relevant.

    The threshold is what makes this honest: grade 1 means "plausible but a
    stretch", and counting those as hits would flatter every ranking. Only
    grade 2 and above count.
    """
    if k <= 0:
        return 0.0
    top = ranked[:k]
    if not top:
        return 0.0
    hits = sum(1 for gig_id in top if grades.get(gig_id, 0) >= threshold)
    return hits / len(top)


def recall_at_k(ranked: list[str], grades: dict[str, int], k: int, threshold: int = 2) -> float:
    """Fraction of all the relevant gigs that made it into the top k."""
    relevant = {gid for gid, g in grades.items() if g >= threshold}
    if not relevant:
        return 0.0
    found = sum(1 for gig_id in ranked[:k] if gig_id in relevant)
    return found / len(relevant)


def reciprocal_rank(ranked: list[str], grades: dict[str, int], threshold: int = 2) -> float:
    """
    1/position of the first relevant result, or 0 if none appear.

    Answers "how far must someone scroll before the list earns its keep?"
    """
    for position, gig_id in enumerate(ranked, start=1):
        if grades.get(gig_id, 0) >= threshold:
            return 1.0 / position
    return 0.0


def dcg_at_k(ranked: list[str], grades: dict[str, int], k: int) -> float:
    """
    Discounted cumulative gain with the standard 2^grade - 1 gain.

    That exponent is why NDCG is the headline metric here: it rewards putting
    an ideal match above a merely good one, which plain precision cannot see.
    """
    return sum(
        (2 ** grades.get(gig_id, 0) - 1) / math.log2(position + 1)
        for position, gig_id in enumerate(ranked[:k], start=1)
    )


def ndcg_at_k(ranked: list[str], grades: dict[str, int], k: int) -> float:
    """DCG normalised against the best achievable ordering, so 1.0 is perfect."""
    ideal_order = sorted(grades.values(), reverse=True)[:k]
    ideal = sum(
        (2 ** grade - 1) / math.log2(position + 1)
        for position, grade in enumerate(ideal_order, start=1)
    )
    if ideal == 0:
        return 0.0
    return dcg_at_k(ranked, grades, k) / ideal


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0
