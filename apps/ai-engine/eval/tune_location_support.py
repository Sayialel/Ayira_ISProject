"""
Builds the location column for a corpus, either tiered or distance-based.

Separate from tune_location.py so the sweep does not have to monkey-patch the
module-level half-life in scoring.py. Calling distance_affinity with an
explicit half-life keeps the swept value out of global state, which matters
because the serving default is read from the environment once at import.
"""

from __future__ import annotations

import numpy as np

from app.services import kenya_geography
from app.services.scoring import (
    SAME_COUNTY,
    SAME_METRO,
    SAME_TOWN,
    UNKNOWN_LOCATION,
    DIFFERENT_COUNTY,
    distance_affinity,
)


def _tiered(worker_location: str, gig: dict) -> float:
    """The four-tier affinity, with distance deliberately not consulted."""
    if gig.get("is_remote"):
        return SAME_TOWN

    worker_place = (worker_location or "").strip()
    gig_place = (gig.get("location") or "").strip()
    if not worker_place or not gig_place:
        return UNKNOWN_LOCATION

    if kenya_geography.same_town(worker_place, gig_place):
        return SAME_TOWN

    worker_county = kenya_geography.county_of(worker_place)
    gig_county = kenya_geography.county_of(gig_place)
    if worker_county is None or gig_county is None:
        return UNKNOWN_LOCATION

    if worker_county == gig_county:
        return SAME_COUNTY
    if kenya_geography.share_metro(worker_county, gig_county):
        return SAME_METRO
    return DIFFERENT_COUNTY


def _by_distance(worker_location: str, gig: dict, halflife: float) -> float:
    """
    Measured distance where both towns are placeable, tiers where not.
    Mirrors scoring.location_affinity, which is what will serve this.
    """
    if gig.get("is_remote"):
        return SAME_TOWN

    worker_place = (worker_location or "").strip()
    gig_place = (gig.get("location") or "").strip()
    if not worker_place or not gig_place:
        return UNKNOWN_LOCATION

    km = kenya_geography.distance_km(worker_place, gig_place)
    if km is not None:
        return distance_affinity(km, halflife_km=halflife)

    return _tiered(worker_location, gig)


def LOCATION_COLUMN(corpus, halflife: float | None) -> np.ndarray:
    """
    One row per profile, one column per gig.

    halflife None selects the tiered baseline; a number selects distance with
    that half-life.
    """
    rows = []
    for profile in corpus.profiles:
        location = (profile.get("location") or "").strip()
        if halflife is None:
            rows.append([_tiered(location, g) for g in corpus.gigs])
        else:
            rows.append([_by_distance(location, g, halflife) for g in corpus.gigs])
    return np.asarray(rows, dtype=float)
