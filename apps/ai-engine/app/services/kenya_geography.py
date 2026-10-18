"""
Kenyan towns and the counties they sit in.

This is the whole of the geography the matching engine uses. It exists because
the alternative was worse in both directions: the engine previously compared
town names for exact equality, so Thika and Nairobi (about 40 km apart) scored
exactly the same as Mombasa and Nairobi (about 490 km apart), while a full
distance model would have needed coordinates the schema does not store and a
geocoding service the project does not have.

Counties are the right granularity for this. They are the administrative unit
Kenyan addresses are actually written in, there are only 47 of them, they are
small enough that two towns in one county are plausibly commutable, and the
mapping is a stable published fact rather than a model that can drift.

Source: the 47 counties established by the Constitution of Kenya 2010, First
Schedule, as used in KNBS reporting (https://www.knbs.or.ke/). Only towns the
corpus or the platform actually uses are listed; an unlisted town resolves to
an unknown county, which the scorer treats as unknown rather than as a
mismatch.

Deliberately *not* modelled here, because the data to support it does not
exist yet:

  * distance -- needs coordinates, and a county centroid table would be the
    cheapest way to add it later without any external service;
  * hybrid and travel-required arrangements -- gigs carry only a boolean
    `is_remote`, so there is nothing to distinguish them from on-site work.
    Supporting those needs a new column, not a cleverer function here.
"""

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
#
# Source: the Nairobi Metropolitan Area as used in Kenyan government planning
# and by the Nairobi Metropolitan Area Transport Authority (NaMATA), which
# covers Nairobi, Kiambu, Kajiado, Machakos and Murang'a.
#
# Only Nairobi is listed. Mombasa and Kisumu have real commuter hinterlands,
# but inventing their boundaries from memory would be guessing, and a wrong
# grouping is worse than none.
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
