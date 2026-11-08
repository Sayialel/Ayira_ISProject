"""
Kenyan towns and the counties they sit in.

This is the whole of the geography the matching engine uses. It exists because
the alternative was worse in both directions: the engine previously compared
town names for exact equality, so Thika and Nairobi (about 40 km apart) scored
exactly the same as Mombasa and Nairobi (about 490 km apart), while a full
distance model would have needed coordinates the schema does not store and a
geocoding service the project does not have.
"""

from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_KM = 6371.0

# Town (lower case) -> county.
#
# Several counties intentionally appear more than once. A map where every town
# sat in its own county would make the "same county" tier unreachable, which
# is exactly the state this replaced.
TOWN_COUNTY: dict[str, str] = {
    # Nairobi
    "nairobi": "Nairobi",
    # Kiambu -- the commuter belt north of Nairobi
    "thika": "Kiambu",
    "ruiru": "Kiambu",
    "kikuyu": "Kiambu",
    "limuru": "Kiambu",
    "juja": "Kiambu",
    # Machakos
    "machakos": "Machakos",
    "athi river": "Machakos",
    # Nakuru
    "nakuru": "Nakuru",
    "naivasha": "Nakuru",
    # Mombasa and the coast
    "mombasa": "Mombasa",
    "malindi": "Kilifi",
    "kilifi": "Kilifi",
    # Nyanza
    "kisumu": "Kisumu",
    "ahero": "Kisumu",
    "kisii": "Kisii",
    "homa bay": "Homa Bay",
    # Western
    "kakamega": "Kakamega",
    "mumias": "Kakamega",
    "bungoma": "Bungoma",
    "vihiga": "Vihiga",
    # Rift Valley
    "eldoret": "Uasin Gishu",
    "kitale": "Trans Nzoia",
    "kericho": "Kericho",
    # Central
    "nyeri": "Nyeri",
    "karatina": "Nyeri",
    "murang'a": "Murang'a",
    "muranga": "Murang'a",
    "nyahururu": "Laikipia",
    "nanyuki": "Laikipia",
    # Eastern and North Eastern
    "meru": "Meru",
    "embu": "Embu",
    "kitui": "Kitui",
    "garissa": "Garissa",
}


# Counties that function as one labour market despite being separate counties.
#
# County tiering alone does not solve the case that motivated it: Thika sits in
# Kiambu and Nairobi is its own county, so a daily commute inside the Nairobi
# conurbation scored exactly the same as Mombasa to Nairobi. The metropolitan
# grouping is what fixes that.

METRO_AREAS: dict[str, frozenset[str]] = {
    "Nairobi Metropolitan": frozenset(
        {"Nairobi", "Kiambu", "Kajiado", "Machakos", "Murang'a"}
    ),
}


def metro_of(county: str | None) -> str | None:
    """The metropolitan area a county belongs to, if any."""
    if not county:
        return None
    for name, members in METRO_AREAS.items():
        if county in members:
            return name
    return None


def share_metro(county_a: str | None, county_b: str | None) -> bool:
    """Whether two different counties sit in the same commuter region."""
    metro = metro_of(county_a)
    return metro is not None and metro == metro_of(county_b)


def normalise(place: str | None) -> str:
    """Trims and lower-cases a place name for lookup."""
    return (place or "").strip().casefold()


def county_of(place: str | None) -> str | None:
    """
    The county a town sits in, or None if the town is not known.

    None means "not known", never "nowhere". Callers must keep that distinct
    from a mismatch: treating an unrecognised town as a failed match is how the
    previous implementation quietly punished every gig whose location was not
    filled in.
    """
    key = normalise(place)
    if not key:
        return None

    if key in TOWN_COUNTY:
        return TOWN_COUNTY[key]

    # Addresses are often written "Ruiru, Kiambu" or "Nairobi CBD". Try the
    # comma-separated parts, then a county name given directly.
    parts = [p.strip() for p in key.split(",") if p.strip()]
    for part in reversed(parts):
        if part in TOWN_COUNTY:
            return TOWN_COUNTY[part]

    counties = {c.casefold(): c for c in TOWN_COUNTY.values()}
    for part in parts or [key]:
        if part in counties:
            return counties[part]

    return None


def same_town(a: str | None, b: str | None) -> bool:
    left, right = normalise(a), normalise(b)
    return bool(left) and left == right


def counties() -> set[str]:
    return set(TOWN_COUNTY.values())

# ---------------------------------------------------------------------------
# Coordinates
# ---------------------------------------------------------------------------
#
# Town centroids, which the docstring above says the schema does not store --
# it still does not. These are not per-gig geocoding: they place a town, not
# an address, which is enough for "my town, the next one, or 490 km away" and
# is all the free-text location column can support anyway.
#
# Mirrors TOWN_POINTS in apps/web/src/lib/kenyaTowns.ts, and tests/test_scoring.py
# asserts the two agree -- the web map and the location score disagreeing about
# where a town is would be a silent, confusing fault.
TOWN_POINT: dict[str, tuple[float, float]] = {
    "ahero": (-0.1833, 34.9167),
    "athi river": (-1.4564, 36.9783),
    "bungoma": (0.5635, 34.5606),
    "eldoret": (0.5143, 35.2698),
    "embu": (-0.531, 37.4575),
    "garissa": (-0.4532, 39.6461),
    "homa bay": (-0.5273, 34.4571),
    "juja": (-1.1036, 37.0144),
    "kakamega": (0.2827, 34.7519),
    "karatina": (-0.4833, 37.1333),
    "kericho": (-0.3692, 35.2861),
    "kikuyu": (-1.246, 36.663),
    "kilifi": (-3.6305, 39.8499),
    "kisii": (-0.6817, 34.768),
    "kisumu": (-0.0917, 34.768),
    "kitale": (1.0157, 35.0062),
    "kitui": (-1.3667, 38.0167),
    "limuru": (-1.112, 36.642),
    "machakos": (-1.5177, 37.2634),
    "malindi": (-3.2175, 40.1191),
    "meru": (0.0463, 37.6559),
    "mombasa": (-4.0435, 39.6682),
    "mumias": (0.3339, 34.4869),
    "murang'a": (-0.7167, 37.15),
    "muranga": (-0.7167, 37.15),
    "nairobi": (-1.2864, 36.8172),
    "naivasha": (-0.7167, 36.4333),
    "nakuru": (-0.3031, 36.08),
    "nanyuki": (0.0167, 37.0725),
    "nyahururu": (0.0333, 36.3667),
    "nyeri": (-0.4169, 36.951),
    "ruiru": (-1.15, 36.9667),
    "thika": (-1.0333, 37.0693),
    "vihiga": (0.05, 34.7233),
}


def distance_km(a: str | None, b: str | None) -> float | None:
    """
    Great-circle distance between two place names, or None if either is
    unplaceable.

    None is not zero and must not be collapsed into it: an unknown town is
    missing information, and the caller decides what to do about that.
    """
    pa = TOWN_POINT.get(normalise(a))
    pb = TOWN_POINT.get(normalise(b))
    if pa is None or pb is None:
        return None

    lat1, lon1 = radians(pa[0]), radians(pa[1])
    lat2, lon2 = radians(pb[0]), radians(pb[1])
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_KM * asin(min(1.0, sqrt(h)))

