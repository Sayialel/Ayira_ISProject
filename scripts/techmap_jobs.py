"""
Ingests real Kenyan job postings from the Techmap / JobDataFeeds API.

    python scripts/techmap_jobs.py --inspect          # dry run on the local sample, costs nothing
    python scripts/techmap_jobs.py --max-requests 90  # live fetch, hard-capped
    python scripts/techmap_jobs.py --normalise-only   # rebuild outputs from cached raw pages

Quota, and why there is a hard cap
----------------------------------
The API serves a fixed **10 postings per page** and the Basic plan includes
roughly 100 requests a month, so about 1,000 postings. The documentation also
says requests above the included quota are **billed as overage** rather than
refused, which means an unbounded loop here is a bill, not an error. Every run
is therefore capped, defaults well inside the free quota, and refuses to start
without an explicit key.

Trusting the country code would be a mistake
--------------------------------------------
The provider's own Luxembourg sample contains a posting with
`countryCode: "lu"` whose structured address says Switzerland, so the country
field alone does not establish where a job is. Worse, the previously inspected
Hugging Face dataset labelled 313 postings as Kenyan of which only 2.9% had any
corroborating evidence and 21.7% named a different country outright.

So `countryCode=ke` is treated as a *claim*, and each posting is classified by
how much independent evidence supports it:

  kenya_verified   the country code agrees with at least one of: a Kenyan
                   structured address, a recognised Kenyan town, or coordinates
                   inside Kenya
  kenya_probable   the code says Kenya and nothing contradicts it, but nothing
                   corroborates it either
  conflicting      something names another country -- held back for review
  location_unknown no usable location evidence at all

Only `kenya_verified` records are eligible for the Kenyan evaluation set.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "techmap"
PROCESSED = ROOT / "data" / "processed"
MANIFESTS = ROOT / "data" / "manifests"
SAMPLE = RAW / "sample.json"

# The engine's own Kenyan geography, reused rather than duplicated.
sys.path.insert(0, str(ROOT / "apps" / "ai-engine"))
from app.services import kenya_geography  # noqa: E402

HOST = "daily-international-job-postings.p.rapidapi.com"
ENDPOINT = f"https://{HOST}/api/v2/jobs/search"
KEY_ENV = "TECHMAP_RAPIDAPI_KEY"

PAGE_SIZE = 10          # fixed by the API; not a parameter
DEFAULT_MAX_REQUESTS = 90   # under the ~100 included in the Basic plan
MIN_INTERVAL_SECONDS = 1.1  # the docs cite ~1 request/second on Basic
MAX_RETRIES = 4

# Kenya's bounding box, used only to corroborate a country claim -- never to
# invent a location for a posting that has none.
KENYA_BBOX = {"lon_min": 33.9, "lon_max": 41.95, "lat_min": -4.72, "lat_max": 5.51}

# Countries that commonly appear in postings mislabelled as Kenyan.
OTHER_COUNTRY = re.compile(
    r"\b(united states|u\.?s\.?a?\b|canada|united kingdom|england|india|"
    r"philippines|germany|france|netherlands|australia|singapore|nigeria|"
    r"ghana|south africa|uganda|tanzania|rwanda|ethiopia|egypt|switzerland|"
    r"ireland|poland|spain|italy|brazil|mexico|japan|china)\b",
    re.I,
)
KENYA_MENTION = re.compile(r"\bkenya|kenyan\b", re.I)


# --------------------------------------------------------------------------
# fetching
# --------------------------------------------------------------------------


class Techmap:
    """A throttled, capped, caching client."""

    def __init__(self, key: str, max_requests: int) -> None:
        self.key = key
        self.max_requests = max_requests
        self.requests = 0
        self.last_call = 0.0
        self.client = httpx.Client(timeout=45, follow_redirects=True)
        RAW.mkdir(parents=True, exist_ok=True)

    def close(self) -> None:
        self.client.close()

    def _throttle(self) -> None:
        wait = MIN_INTERVAL_SECONDS - (time.monotonic() - self.last_call)
        if wait > 0:
            time.sleep(wait)
        self.last_call = time.monotonic()

    def page(self, params: dict) -> dict | None:
        """One page, or None when the cap is reached or the call keeps failing."""
        cached = RAW / f"page__{_params_key(params)}.json"
        if cached.exists():
            return json.loads(cached.read_text(encoding="utf-8"))["response"]

        if self.requests >= self.max_requests:
            print(f"  ! request cap reached ({self.max_requests}); stopping")
            return None

        for attempt in range(MAX_RETRIES):
            self._throttle()
            try:
                response = self.client.get(
                    ENDPOINT,
                    params=params,
                    headers={"X-RapidAPI-Key": self.key, "X-RapidAPI-Host": HOST},
                )
                self.requests += 1

                if response.status_code == 429:
                    delay = 2**attempt
                    print(f"  429 rate limited; backing off {delay}s")
                    time.sleep(delay)
                    continue
                if response.status_code in (401, 403):
                    raise SystemExit(
                        f"Authentication failed ({response.status_code}). Check that "
                        f"{KEY_ENV} is a valid RapidAPI key subscribed to {HOST}."
                    )
                response.raise_for_status()
                payload = response.json()

                cached.write_text(
                    json.dumps(
                        {
                            "params": {k: v for k, v in params.items()},
                            "retrieved_at": datetime.now(timezone.utc).isoformat(),
                            "response": payload,
                        },
                        indent=1,
                        ensure_ascii=False,
                    )
                    + "\n",
                    encoding="utf-8",
                )
                return payload

            except SystemExit:
                raise
            except Exception as error:
                print(f"  attempt {attempt + 1} failed: {error}")
                time.sleep(2**attempt)

        return None


def _params_key(params: dict) -> str:
    return hashlib.sha256(
        json.dumps(params, sort_keys=True).encode("utf-8")
    ).hexdigest()[:20]


# --------------------------------------------------------------------------
# geographic classification
# --------------------------------------------------------------------------


def classify_location(record: dict) -> tuple[str, list[str]]:
    """
    How much independent evidence supports the posting being in Kenya.

    Returns the confidence band and the reasons behind it, so a reviewer can
    see why a record was accepted or held back rather than taking it on trust.
    """
    reasons: list[str] = []
    json_ld = record.get("jsonLD") or {}
    address = ((json_ld.get("jobLocation") or {}).get("address")) or {}

    claims_kenya = (record.get("countryCode") or "").lower() == "ke"
    if claims_kenya:
        reasons.append("countryCode=ke")

    # 1. A structured address naming Kenya.
    address_country = str(address.get("addressCountry") or "")
    if KENYA_MENTION.search(address_country):
        reasons.append(f"address country '{address_country}'")
    elif address_country and OTHER_COUNTRY.search(address_country):
        reasons.append(f"CONFLICT: address country '{address_country}'")

    # 2. A town the engine recognises.
    city = record.get("city") or address.get("addressLocality") or ""
    county = kenya_geography.county_of(city)
    if county:
        reasons.append(f"city '{city}' -> {county} county")
    elif city:
        reasons.append(f"city '{city}' not in the Kenyan town table")

    # 3. Coordinates inside Kenya.
    point = record.get("geoPoint") or {}
    lat, lon = point.get("lat"), point.get("lon")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        inside = (
            KENYA_BBOX["lat_min"] <= lat <= KENYA_BBOX["lat_max"]
            and KENYA_BBOX["lon_min"] <= lon <= KENYA_BBOX["lon_max"]
        )
        reasons.append(
            f"coordinates {'inside' if inside else 'OUTSIDE'} Kenya ({lat:.2f}, {lon:.2f})"
        )
        if inside:
            reasons.append("corroborated_by_coordinates")

    conflicts = [r for r in reasons if r.startswith("CONFLICT") or "OUTSIDE" in r]
    corroborating = [
        r
        for r in reasons
        if r.startswith("address country") and "CONFLICT" not in r
        or "county" in r
        or r == "corroborated_by_coordinates"
    ]

    if conflicts and not corroborating:
        return "conflicting", reasons
    if claims_kenya and corroborating:
        return "kenya_verified", reasons
    if claims_kenya:
        return "kenya_probable", reasons
    if not city and not point:
        return "location_unknown", reasons
    return "conflicting" if conflicts else "location_unknown", reasons


# --------------------------------------------------------------------------
# normalisation
# --------------------------------------------------------------------------


def _clean_list(values) -> list[str]:
    """Techmap writes "N/A" rather than omitting a field."""
    if not isinstance(values, list):
        values = [values] if values else []
    return [str(v).strip() for v in values if v and str(v).strip().upper() != "N/A"]


def _clean(value) -> str | None:
    text = str(value or "").strip()
    return None if not text or text.upper() == "N/A" else text


def normalise(record: dict, source_dataset: str, retrieved_at: str) -> dict:
    json_ld = record.get("jsonLD") or {}
    address = ((json_ld.get("jobLocation") or {}).get("address")) or {}
    confidence, reasons = classify_location(record)

    city = _clean(record.get("city")) or _clean(address.get("addressLocality"))
    county = kenya_geography.county_of(city) if city else None
    point = record.get("geoPoint") or {}

    # Precision is stated, never implied. A county is not a coordinate.
    if isinstance(point.get("lat"), (int, float)):
        precision = "coordinates"
    elif county:
        precision = "county_from_town"
    elif city:
        precision = "town_text_only"
    else:
        precision = "unknown"

    description = _clean(json_ld.get("description"))
    title = _clean(record.get("title")) or ""
    work_place = _clean_list(record.get("workPlace"))

    return {
        "gig_id": f"tm-{json_ld.get('identifier') or _params_key(record)}",
        "original_listing_id": _clean(json_ld.get("identifier")),
        "title": title,
        "description": description,
        "occupation_label": _clean(record.get("occupation")),
        "required_skills_raw": _clean_list(record.get("skills")),
        # Normalisation against KeSCO happens in a later step; the raw list is
        # preserved either way so a mapping can be revisited.
        "required_skills_normalized": [],
        "location_raw": _clean(record.get("city")),
        "county": county,
        "subcounty": None,
        "latitude": point.get("lat") if isinstance(point.get("lat"), (int, float)) else None,
        "longitude": point.get("lon") if isinstance(point.get("lon"), (int, float)) else None,
        "location_precision": precision,
        "work_arrangement": work_place or None,
        "employment_type": _clean_list(record.get("workType")) or None,
        "contract_type": _clean_list(record.get("contractType")) or None,
        "career_level": _clean_list(record.get("careerLevel")) or None,
        "industry": _clean(record.get("industry")),
        # hasSalary is a flag, not an amount. No figure is invented, and no pay
        # period is inferred -- the API does not supply either.
        "has_salary": bool(record.get("hasSalary")),
        "pay_min": None,
        "pay_max": None,
        "pay_currency": _clean(json_ld.get("salaryCurrency")),
        "pay_period": None,
        "posting_date": _clean(record.get("dateCreated")) or _clean(json_ld.get("datePosted")),
        "expiry_date": _clean(record.get("dateExpired")) or _clean(json_ld.get("validThrough")),
        "employer_or_source": _clean(record.get("company")),
        "source_url": _clean(json_ld.get("url")) or _clean(json_ld.get("sameAs")),
        "source_record_id": _clean(json_ld.get("identifier")),
        "source_dataset": source_dataset,
        "source_portal": _clean(record.get("portal")),
        "retrieved_at": retrieved_at,
        "license_or_permission": "Techmap/JobDataFeeds API, Basic plan - terms require review",
        "geographic_confidence": confidence,
        "geographic_evidence": reasons,
        "provider_is_duplicate": bool(record.get("isDuplicate")),
        "provider_is_recruiter": bool(record.get("isRecruiter")),
        "deduplication_group_id": None,
        "record_quality_score": None,
        "is_synthetic": False,
    }


def quality_score(gig: dict) -> float:
    """
    A 0-1 completeness score over the fields matching actually uses.

    Deliberately not a judgement of the job, only of how much is known about
    it, so a reviewer can sort by how much the record supports.
    """
    checks = [
        bool(gig["title"]),
        bool(gig["description"]) and len(gig["description"]) >= 200,
        bool(gig["required_skills_raw"]),
        bool(gig["county"]),
        gig["location_precision"] in ("coordinates", "county_from_town"),
        bool(gig["occupation_label"]),
        bool(gig["employer_or_source"]),
        bool(gig["posting_date"]),
        bool(gig["employment_type"]),
    ]
    return round(sum(checks) / len(checks), 3)


def deduplicate(gigs: list[dict]) -> tuple[list[dict], int]:
    """
    Groups postings that are the same vacancy advertised more than once.

    Title alone is far too weak -- "Sales Representative" is a dozen different
    jobs -- so the key is the normalised title together with the employer and
    the town. The provider's own isDuplicate flag is honoured as well, but not
    relied upon.
    """
    groups: dict[str, list[dict]] = {}
    for gig in gigs:
        key_source = "|".join(
            [
                re.sub(r"[^a-z0-9]+", " ", (gig["title"] or "").lower()).strip(),
                (gig["employer_or_source"] or "").lower().strip(),
                (gig["county"] or gig["location_raw"] or "").lower().strip(),
            ]
        )
        key = hashlib.sha256(key_source.encode("utf-8")).hexdigest()[:16]
        groups.setdefault(key, []).append(gig)

    kept: list[dict] = []
    removed = 0
    for key, members in groups.items():
        # Keep the most complete record, so deduplication does not throw away
        # the only copy that had a description.
        members.sort(key=lambda g: (-(g["record_quality_score"] or 0), g["gig_id"]))
        primary = members[0]
        primary["deduplication_group_id"] = key
        primary["duplicate_of_count"] = len(members) - 1
        primary["duplicate_source_ids"] = [m["source_record_id"] for m in members[1:]]
        kept.append(primary)
        removed += len(members) - 1

    return kept, removed


# --------------------------------------------------------------------------
# run
# --------------------------------------------------------------------------


def load_cached_pages() -> list[dict]:
    records = []
    for path in sorted(RAW.glob("page__*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        records.extend(payload["response"].get("result", []) or [])
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--inspect", action="store_true",
        help="run the full pipeline on the local Luxembourg sample; no requests, no quota",
    )
    parser.add_argument(
        "--normalise-only", action="store_true",
        help="rebuild outputs from pages already cached in data/raw/techmap",
    )
    parser.add_argument("--country", default="ke", help="ISO country code (default ke)")
    parser.add_argument("--date-created", help="YYYY-MM-DD or YYYY-MM")
    parser.add_argument(
        "--max-requests", type=int, default=DEFAULT_MAX_REQUESTS,
        help=f"hard cap on API calls (default {DEFAULT_MAX_REQUESTS}; the plan includes ~100)",
    )
    args = parser.parse_args()

    started = datetime.now(timezone.utc)
    retrieved_at = started.isoformat()
    requests_made = 0
    reported_total = None

    if args.inspect:
        if not SAMPLE.exists():
            raise SystemExit(
                "No local sample. Fetch it once with:\n"
                "  curl -sL https://api.techmap.io/samples/techmap-jobs-sample.json "
                "-o data/raw/techmap/sample.json"
            )
        payload = json.loads(SAMPLE.read_text(encoding="utf-8"))
        raw_records = payload.get("result", [])
        source_dataset = "techmap_sample_luxembourg"
        print(
            f"INSPECT MODE: {len(raw_records)} records from the provider's Luxembourg\n"
            "sample. This exercises parsing, classification, scoring and dedup without\n"
            "spending any quota. Expect zero kenya_verified records -- that is the point.\n"
        )
    elif args.normalise_only:
        raw_records = load_cached_pages()
        source_dataset = f"techmap_{args.country}"
        print(f"Rebuilding from {len(raw_records)} cached records; no requests made.\n")
    else:
        key = os.environ.get(KEY_ENV, "").strip()
        if not key:
            raise SystemExit(
                f"{KEY_ENV} is not set.\n\n"
                "This script will not run without a key, because the API bills\n"
                "requests above the included quota as overage.\n\n"
                "  1. Create a RapidAPI account.\n"
                f"  2. Subscribe to '{HOST}' on the Basic (free) plan.\n"
                f"  3. Put the key in .env as {KEY_ENV}=...\n\n"
                "To see the pipeline work first, costing nothing:\n"
                "  python scripts/techmap_jobs.py --inspect"
            )

        client = Techmap(key, args.max_requests)
        source_dataset = f"techmap_{args.country}"
        raw_records = []
        page = 1
        try:
            while True:
                params = {"countryCode": args.country, "page": page}
                if args.date_created:
                    params["dateCreated"] = args.date_created

                payload = client.page(params)
                if payload is None:
                    break

                if reported_total is None:
                    reported_total = payload.get("totalCount")
                    print(f"provider reports totalCount={reported_total} for "
                          f"countryCode={args.country}")
                    if reported_total:
                        reachable = min(reported_total, args.max_requests * PAGE_SIZE)
                        print(f"reachable within the cap: ~{reachable} postings\n")

                batch = payload.get("result", []) or []
                raw_records.extend(batch)
                print(f"  page {page}: {len(batch)} records (total {len(raw_records)})")

                if len(batch) < PAGE_SIZE:
                    break
                page += 1
        finally:
            requests_made = client.requests
            client.close()

    if not raw_records:
        print("No records retrieved.")
        return

    # -- normalise, score, deduplicate ------------------------------------

    gigs = [normalise(r, source_dataset, retrieved_at) for r in raw_records]
    for gig in gigs:
        gig["record_quality_score"] = quality_score(gig)

    by_confidence: dict[str, int] = {}
    for gig in gigs:
        by_confidence[gig["geographic_confidence"]] = (
            by_confidence.get(gig["geographic_confidence"], 0) + 1
        )

    verified = [g for g in gigs if g["geographic_confidence"] == "kenya_verified"]
    probable = [g for g in gigs if g["geographic_confidence"] == "kenya_probable"]

    deduped, removed = deduplicate(verified)
    usable = [g for g in deduped if g["title"] and g["description"]]

    PROCESSED.mkdir(parents=True, exist_ok=True)
    _write(PROCESSED / "gigs_kenya_verified.jsonl", usable)
    _write(PROCESSED / "gigs_kenya_probable.jsonl", probable)
    _write(PROCESSED / "gigs_all_normalised.jsonl", gigs)

    report = {
        "source_name": "Techmap / JobDataFeeds Job Postings API",
        "publisher": "Techmap.io",
        "endpoint": ENDPOINT,
        "access_method": "RapidAPI, Basic plan, X-RapidAPI-Key header",
        "licence": "Terms of Service at jobdatafeeds.com",
        "licence_status": "requires_review",
        "redistribution": "not redistributed; derived counts only",
        "country_code_requested": None if args.inspect else args.country,
        "source_dataset": source_dataset,
        "retrieved_at": retrieved_at,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "page_size": PAGE_SIZE,
        "request_cap": args.max_requests,
        "http_requests": requests_made,
        "provider_reported_total": reported_total,
        "funnel": {
            "1_records_received": len(raw_records),
            "2_parsed": len(gigs),
            "3_by_geographic_confidence": by_confidence,
            "4_kenya_verified": len(verified),
            "5_duplicates_removed": removed,
            "6_after_deduplication": len(deduped),
            "7_usable_with_title_and_description": len(usable),
        },
        "field_coverage_within_usable": _coverage(usable),
        "known_limitations": [
            "countryCode is a claim, not evidence; only kenya_verified records are "
            "eligible for the evaluation set.",
            "The API exposes hasSalary but no amount or pay period, so no pay figure "
            "is recorded and none is inferred.",
            "Page size is fixed at 10, and requests beyond the plan quota are billed "
            "as overage, so coverage is bounded by the request cap.",
            "These are advertised formal vacancies; informal gig work is "
            "under-represented by construction.",
        ],
    }
    MANIFESTS.mkdir(parents=True, exist_ok=True)
    name = "techmap_sample_inspect.json" if args.inspect else f"techmap_{args.country}.json"
    (MANIFESTS / name).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    # -- report -----------------------------------------------------------

    print()
    print("funnel")
    print(f"  records received                {len(raw_records)}")
    for band, count in sorted(by_confidence.items(), key=lambda kv: -kv[1]):
        print(f"    {band:<28}{count}")
    print(f"  duplicates removed              {removed}")
    print(f"  usable (title + description)    {len(usable)}")
    if requests_made:
        print(f"  API requests used               {requests_made}/{args.max_requests}")

    if usable:
        print()
        print("field coverage within usable records")
        for field, pct in _coverage(usable).items():
            print(f"  {field:<30}{pct}")

    print()
    print(f"manifest: data/manifests/{name}")
    if args.inspect:
        print(
            "\nInspect mode used the Luxembourg sample, so these are not Kenyan\n"
            "records and must not be used as such."
        )


def _coverage(gigs: list[dict]) -> dict:
    if not gigs:
        return {}
    fields = [
        "description", "required_skills_raw", "county", "latitude",
        "occupation_label", "employer_or_source", "posting_date",
        "employment_type", "source_url",
    ]
    out = {}
    for field in fields:
        n = sum(1 for g in gigs if g.get(field) not in (None, "", [], {}))
        out[field] = f"{n}/{len(gigs)} ({100 * n / len(gigs):.0f}%)"
    return out


def _write(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
