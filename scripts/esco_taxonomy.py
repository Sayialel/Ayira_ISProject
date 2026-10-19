"""
Builds a skills and occupation taxonomy from ESCO.

    python scripts/esco_taxonomy.py --inspect        # counts only, no writes
    python scripts/esco_taxonomy.py                  # full ingest
    python scripts/esco_taxonomy.py --limit 50       # a slice, for development

Why the API and not the bulk download
-------------------------------------
ESCO's bulk files are behind an email gate: you pick packages, accept a privacy
statement, submit an address and are sent a link. That cannot be automated, and
claiming otherwise would be inventing an acquisition. The documented REST API at
ec.europa.eu/esco/api needs no key and returns the same concepts, so it is the
honest reproducible path.

What this is for
----------------
ESCO is used strictly as a **taxonomy of occupations and skills**. It is not a
source of Kenyan workers or Kenyan vacancies and is never presented as one.

The reason it is worth having is the ISCO code on every occupation. Ayira's
existing corpus is built on KeSCO-2022, which derives from ISCO, so ESCO
occupations join to it on a shared code rather than on fuzzy title matching --
a defensible bridge between a European taxonomy and a Kenyan classification.
It also brings alternative labels ("domestic electrician" is also "electrician",
"residential electrician"), which is exactly the vocabulary a Kenyan worker
would actually type.

Politeness and idempotence
--------------------------
Rate limits are undocumented, so requests are throttled and every response is
cached under data/raw/esco/. A second run re-reads the cache and issues no
traffic, which also makes the raw layer the immutable snapshot the pipeline
requires.
"""

import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

API = "https://ec.europa.eu/esco/api"
OCCUPATION_SCHEME = "http://data.europa.eu/esco/concept-scheme/occupations"

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "esco"
PROCESSED = ROOT / "data" / "processed"
MANIFESTS = ROOT / "data" / "manifests"

# Undocumented limits, so stay well clear of anything that looks like abuse.
DELAY_SECONDS = 0.12
TIMEOUT_SECONDS = 30
MAX_RETRIES = 3

LANGUAGE = "en"


class Esco:
    """A cached, throttled client for the ESCO API."""

    def __init__(self, offline: bool = False) -> None:
        self.offline = offline
        self.client = httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=True)
        self.requests = 0
        self.cache_hits = 0
        RAW.mkdir(parents=True, exist_ok=True)

    def close(self) -> None:
        self.client.close()

    def _cache_path(self, endpoint: str, params: dict) -> Path:
        # The URI is too long and too full of punctuation to be a filename, so
        # the key is a hash of the request. The request itself is stored inside
        # the file, which keeps the cache self-describing.
        key = hashlib.sha256(
            json.dumps([endpoint, params], sort_keys=True).encode("utf-8")
        ).hexdigest()[:24]
        return RAW / f"{endpoint.replace('/', '_')}__{key}.json"

    def get(self, endpoint: str, params: dict) -> dict | None:
        path = self._cache_path(endpoint, params)
        if path.exists():
            self.cache_hits += 1
            return json.loads(path.read_text(encoding="utf-8"))["response"]

        if self.offline:
            return None

        last_error: Exception | None = None
        for attempt in range(MAX_RETRIES):
            try:
                time.sleep(DELAY_SECONDS)
                response = self.client.get(f"{API}/{endpoint}", params=params)
                self.requests += 1
                if response.status_code == 404:
                    return None
                response.raise_for_status()
                payload = response.json()
                path.write_text(
                    json.dumps(
                        {
                            "endpoint": endpoint,
                            "params": params,
                            "retrieved_at": datetime.now(timezone.utc).isoformat(),
                            "response": payload,
                        },
                        indent=1,
                    )
                    + "\n",
                    encoding="utf-8",
                )
                return payload
            except Exception as error:  # network, JSON, 5xx
                last_error = error
                # Linear backoff; the API is a public service, not a CDN.
                time.sleep(1.5 * (attempt + 1))

        print(f"  ! giving up on {endpoint} {params}: {last_error}", file=sys.stderr)
        return None


def _literal(value) -> str:
    """ESCO wraps descriptions as {"en": {"literal": "..."}}."""
    if not isinstance(value, dict):
        return ""
    entry = value.get(LANGUAGE)
    if isinstance(entry, dict):
        return (entry.get("literal") or "").strip()
    if isinstance(entry, str):
        return entry.strip()
    return ""


def _label(value) -> str:
    if isinstance(value, dict):
        label = value.get(LANGUAGE)
        if isinstance(label, list):
            return (label[0] if label else "").strip()
        return (label or "").strip()
    return (value or "").strip()


def _alt_labels(concept: dict) -> list[str]:
    alt = concept.get("alternativeLabel") or {}
    values = alt.get(LANGUAGE) if isinstance(alt, dict) else None
    if isinstance(values, str):
        values = [values]
    return [v.strip() for v in (values or []) if v and v.strip()]


def collect_occupation_uris(esco: Esco, limit: int | None = None) -> list[str]:
    """
    Walks the ISCO hierarchy and returns every occupation URI beneath it.

    ESCO nests occupations under ISCO groups C0-C9, which is the same structure
    KeSCO uses, so the walk also tells us where each occupation sits in that
    classification.
    """
    scheme = esco.get("resource/taxonomy", {"uri": OCCUPATION_SCHEME, "language": LANGUAGE})
    if not scheme:
        raise SystemExit("Could not reach the ESCO occupation scheme.")

    groups = [g["uri"] for g in scheme.get("_links", {}).get("hasTopConcept", [])]
    print(f"ISCO top-level groups: {len(groups)}")

    occupations: list[str] = []
    seen: set[str] = set()
    frontier = list(groups)

    while frontier:
        uri = frontier.pop(0)
        if uri in seen:
            continue
        seen.add(uri)

        concept = esco.get(
            "resource/concept", {"uri": uri, "language": LANGUAGE}
        )
        if not concept:
            continue

        links = concept.get("_links", {})
        # An ISCO group leads to narrower groups and eventually to occupations.
        for key in ("narrowerConcept", "narrowerOccupation", "hasChildren"):
            for child in links.get(key, []) or []:
                child_uri = child.get("uri", "")
                if not child_uri or child_uri in seen:
                    continue
                if "/occupation/" in child_uri:
                    if child_uri not in occupations:
                        occupations.append(child_uri)
                        if limit and len(occupations) >= limit:
                            return occupations
                else:
                    frontier.append(child_uri)

        if len(seen) % 50 == 0:
            print(f"  walked {len(seen)} groups, found {len(occupations)} occupations")

    return occupations


def fetch_occupation(esco: Esco, uri: str) -> dict | None:
    concept = esco.get("resource/occupation", {"uri": uri, "language": LANGUAGE})
    if not concept:
        return None

    links = concept.get("_links", {})

    def skills(relation: str) -> list[dict]:
        out = []
        for item in links.get(relation, []) or []:
            if not item.get("uri"):
                continue
            out.append({"skill_id": item["uri"], "preferred_label": item.get("title", "")})
        return out

    return {
        "occupation_id": uri,
        "preferred_label": _label(concept.get("preferredLabel")),
        "alternative_labels": _alt_labels(concept),
        "description": _literal(concept.get("description")),
        # The bridge to KeSCO. ESCO extends ISCO with dotted suffixes
        # (7411.1.1.1), so the leading digits are the ISCO group.
        "isco_code": concept.get("code") or "",
        "broader_occupations": [
            b.get("uri") for b in links.get("broaderOccupation", []) or [] if b.get("uri")
        ],
        "essential_skills": skills("hasEssentialSkill"),
        "optional_skills": skills("hasOptionalSkill"),
        "source": "ESCO",
        "source_identifier": uri,
        "language": LANGUAGE,
        "is_kenya_specific": False,
        "mapping_method": "esco_api_direct",
        "mapping_confidence": 1.0,
    }


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--inspect", action="store_true",
        help="report what would be fetched, write nothing",
    )
    parser.add_argument("--limit", type=int, help="stop after this many occupations")
    parser.add_argument(
        "--offline", action="store_true",
        help="use only the cache in data/raw/esco; make no requests",
    )
    args = parser.parse_args()

    esco = Esco(offline=args.offline)
    started = datetime.now(timezone.utc)

    try:
        uris = collect_occupation_uris(esco, limit=args.limit)
        print(f"\noccupations discovered: {len(uris)}")

        if args.inspect:
            print("inspect mode: nothing written")
            return

        occupations: list[dict] = []
        for index, uri in enumerate(uris, start=1):
            record = fetch_occupation(esco, uri)
            if record:
                occupations.append(record)
            if index % 100 == 0:
                print(f"  fetched {index}/{len(uris)}")

        # Skills are deduplicated across occupations: the same ESCO skill is
        # essential to one occupation and optional to another, and it must be
        # one row either way.
        skills: dict[str, dict] = {}
        pairs: list[dict] = []
        for occupation in occupations:
            for relation, items in (
                ("essential", occupation["essential_skills"]),
                ("optional", occupation["optional_skills"]),
            ):
                for skill in items:
                    skills.setdefault(
                        skill["skill_id"],
                        {
                            "skill_id": skill["skill_id"],
                            "preferred_label": skill["preferred_label"],
                            "alternative_labels": [],
                            "description": "",
                            "source": "ESCO",
                            "source_identifier": skill["skill_id"],
                            "language": LANGUAGE,
                            "is_kenya_specific": False,
                            "mapping_method": "esco_api_direct",
                            "mapping_confidence": 1.0,
                        },
                    )
                    pairs.append(
                        {
                            "occupation_id": occupation["occupation_id"],
                            "occupation_label": occupation["preferred_label"],
                            "isco_code": occupation["isco_code"],
                            "skill_id": skill["skill_id"],
                            "skill_label": skill["preferred_label"],
                            "relation": relation,
                        }
                    )

        write_jsonl(PROCESSED / "esco_occupations.jsonl", occupations)
        write_jsonl(PROCESSED / "esco_skills.jsonl", list(skills.values()))
        write_jsonl(PROCESSED / "esco_occupation_skills.jsonl", pairs)

        with_isco = sum(1 for o in occupations if o["isco_code"])
        with_alt = sum(1 for o in occupations if o["alternative_labels"])

        manifest = {
            "source_name": "ESCO (European Skills, Competences, Qualifications and Occupations)",
            "publisher": "European Commission",
            "access_method": "public REST API, no authentication",
            "api_base": API,
            "download_page": "https://esco.ec.europa.eu/en/use-esco/download",
            "bulk_download_note": (
                "The bulk files are email-gated, so the API was used instead. "
                "Version therefore reflects whatever the API currently serves."
            ),
            "licence": "not stated on the ESCO download page",
            "licence_status": "requires_review",
            "redistribution": (
                "Derived files are kept local and marked requires_review until the "
                "licence is confirmed."
            ),
            "language": LANGUAGE,
            "retrieved_at": started.isoformat(),
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "http_requests": esco.requests,
            "cache_hits": esco.cache_hits,
            "counts": {
                "occupations_discovered": len(uris),
                "occupations_retained": len(occupations),
                "occupations_with_isco_code": with_isco,
                "occupations_with_alternative_labels": with_alt,
                "distinct_skills": len(skills),
                "occupation_skill_pairs": len(pairs),
            },
            "outputs": [
                "data/processed/esco_occupations.jsonl",
                "data/processed/esco_skills.jsonl",
                "data/processed/esco_occupation_skills.jsonl",
            ],
            "known_limitations": [
                "A taxonomy, not Kenyan vacancies or Kenyan worker profiles.",
                "European in origin; Kenyan informal-sector terms are absent and "
                "must be added separately with their own provenance.",
                "Skill descriptions are not fetched; only identifiers and labels, "
                "which is what matching needs and avoids thousands of extra calls.",
            ],
        }
        MANIFESTS.mkdir(parents=True, exist_ok=True)
        (MANIFESTS / "esco.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )

        print()
        print(f"occupations      {len(occupations)}")
        print(f"  with ISCO code {with_isco}")
        print(f"  with synonyms  {with_alt}")
        print(f"distinct skills  {len(skills)}")
        print(f"occupation-skill {len(pairs)}")
        print(f"requests {esco.requests}, cache hits {esco.cache_hits}")
        print(f"\nmanifest: data/manifests/esco.json")
    finally:
        esco.close()


if __name__ == "__main__":
    main()
