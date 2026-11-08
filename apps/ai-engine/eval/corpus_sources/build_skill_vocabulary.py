"""
Builds the skills vocabulary the CV parser matches against.

    python -m eval.corpus_sources.build_skill_vocabulary [--out PATH]

Why a controlled vocabulary at all. The CV parser could extract free text, and
the semantic term would survive it -- MiniLM knows what "welding" means whether
or not the platform does. What does not survive is the noise: a CV carries
names, towns, dates, referees and "References available on request", and all of
it would land in profile_text, which is what gets embedded. Matching against a
fixed list is also explainable, which free extraction is not: the worker can be
shown exactly which term was recognised and why.

Three sources, in descending order of authority.

1. KeSCO-2022 occupational titles. The national standard already used for the
   evaluation corpus, so the vocabulary and the corpus share a provenance. Its
   titles are in inverted index form -- "Manager, Personnel", "Fitter, duct" --
   which nobody writes on a CV, so they are de-inverted.

2. Terms observed on Kenyan job platforms (eval/corpus_sources/scraped_skills.json).
   KeSCO is a 2022 classification of the whole economy; it is thorough but
   dated in places and says nothing about tools. Live listings supply what
   people actually write: "Social Media Marketing", "QuickBooks", "M-Pesa".
   Only robots.txt-permitted listing pages were read, at low volume.

3. Curated additions (CURATED). Informal and trade work that a digital job
   board under-represents but this platform explicitly serves, plus the
   original seeded skills so nothing already in use is dropped.

What is deliberately NOT a source: the platform's own gigs. Their
required_skills were generated from KeSCO task text by build_corpus.py, so
mining them would re-derive source 1 with the noise of a second pass -- the
observed values include "Records", "Procedures" and "Price Lists Discount".
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from eval.corpus_sources.category_map import CATEGORY_MAP

HERE = Path(__file__).parent
OCCUPATIONS = HERE / "kesco_occupations.json"
SCRAPED = HERE / "scraped_skills.json"
DEFAULT_OUT = HERE / "skills_vocabulary.json"

#: "7126-11 Fitter, aircraft pipe" -> the title between one code and the next.
TITLE_IN_NOTE = re.compile(r"\b\d{4}-\d{2}\s+([^\d]{2,60}?)(?=\s+\d{4}-\d{2}\b|$)")

#: Office machinery that has not existed for decades. KeSCO still lists these
#: and they would only ever be false positives.
ARCHAIC = {
    "adding", "addressing", "comptometer", "keypunch", "punch", "telex",
    "teleprinter", "telegraph", "duplicating", "mimeograph", "dictaphone",
    "stenotype", "varityper", "linotype", "monotype", "teletypist",
}

#: Sectors this platform does not serve. A general job board advertises all
#: formal employment, so reading one brings back clinical practice, aviation,
#: maritime and extractives. None of it is gig work that can be contracted
#: through a marketplace, and leaving it in would let a CV match on a skill
#: the platform can never offer work for. Same judgement, and same reason, as
#: CATEGORY_MAP excluding Vehicle Cleaners and Crop Farm Labourers.
OUT_OF_SCOPE = {
    "surgeon", "nurse", "nursing", "clinical", "clinician", "physician",
    "pharmaceutical", "pharmacist", "medical", "dental", "dentist",
    "radiographer", "anaesthetist", "orthopedic", "orthopaedic", "midwife",
    "paramedic", "veterinary", "aviation", "aerospace", "pilot", "aircraft",
    "maritime", "shipping", "seafarer", "petroleum", "mining", "drilling",
    "biomedical",
}

#: Single words that are a field, a faculty or an abstraction rather than a
#: skill. They slip through the generic test because they are not role nouns.
NOT_A_SKILL = {
    "science", "intelligence", "content", "languages", "education", "banking",
    "insurance", "agriculture", "construction", "manufacturing", "hospitality",
    "security", "administration", "training", "compliance", "consultancy",
    "telecommunications", "architecture", "accounting", "auditing", "reporting",
    "documentation", "advertising", "branding", "editorial", "journalism",
    "procurement", "logistics", "driving", "catering", "confectionery",
}

#: Whole phrases that are a position in a company rather than a skill anyone
#: could be hired for through a marketplace. A job board lists them because it
#: advertises employment; this platform contracts work.
EXCLUDED_PHRASES = {
    "chief executive officer", "chief financial officer", "chief operating officer",
    "chief technology officer", "chief of staff", "chief of party",
    "deputy chief of party", "executive director", "country director",
    "country manager", "general manager", "head of engineering",
    "head of operations", "head of finance", "head of marketing", "head of sales",
    "head of human resources", "head of internal audit", "head of business development",
    "head of aquatics", "head teacher", "head chef", "executive head chef",
}

#: Words that make a phrase a category rather than a skill.
TOO_GENERIC = {
    "other", "related", "elsewhere", "classified", "general", "various",
    "miscellaneous", "nec", "worker", "workers", "personnel", "staff",
    "occupations", "professional", "professionals", "associate", "assistant",
    "clerk", "clerks", "operator", "operators", "officer", "officers",
}

#: Skills the platform serves that a white-collar job board under-represents,
#: plus the five seeded categories' original entries.
CURATED: dict[str, list[str]] = {
    "Technology": [
        "Python", "JavaScript", "React", "Node.js", "TypeScript", "PHP", "Java",
        "SQL", "HTML", "CSS", "WordPress", "Django", "Flutter", "Android Development",
        "iOS Development", "Git", "Linux", "Docker", "REST APIs", "Firebase",
        "Data Analysis", "Power BI", "Tableau", "Machine Learning",
        "Network Administration", "Cybersecurity", "Technical Support",
        "Computer Repair", "Database Administration", "QA Testing", "Web Scraping",
        "M-Pesa Integration", "Daraja API", "USSD Development", "GIS Mapping",
    ],
    "Writing": [
        "Content Writing", "Copywriting", "Technical Writing", "Translation",
        "Swahili Translation", "Proofreading", "Editing", "Blog Writing",
        "Academic Writing", "Transcription", "Subtitling", "Grant Writing",
        "Report Writing", "Scriptwriting", "Ghostwriting", "SEO Writing",
    ],
    "Design": [
        "Graphic Design", "Logo Design", "Video Editing", "Photography",
        "Illustration", "Adobe Photoshop", "Adobe Illustrator", "Adobe Premiere",
        "Figma", "Canva", "UI Design", "UX Design", "Motion Graphics",
        "Animation", "3D Modelling", "AutoCAD", "Interior Design",
        "Branding", "Print Design", "Product Photography", "Videography",
    ],
    "Marketing": [
        "Social Media Marketing", "Digital Marketing", "SEO", "Google Ads",
        "Facebook Ads", "Email Marketing", "Content Marketing", "Brand Strategy",
        "Market Research", "Public Relations", "Influencer Marketing",
        "Community Management", "Sales", "Lead Generation", "Telemarketing",
        "Customer Service", "Customer Care", "Merchandising",
    ],
    "Business": [
        "Virtual Assistant", "Data Entry", "Bookkeeping", "Accounting",
        "QuickBooks", "Payroll", "Tax Preparation", "Auditing", "Procurement",
        "Logistics", "Supply Chain", "Project Management", "Human Resources",
        "Recruitment", "Training", "Office Administration", "Reception",
        "Event Planning", "Microsoft Office", "Microsoft Word", "Microsoft Excel",
        # Trades and informal-sector work. This platform is for Kenya's youth
        # workforce, most of which is informal; a vocabulary that recognised
        # only desk skills would be unable to read most CVs it is shown.
        "Plumbing", "Masonry", "Carpentry", "Welding", "Electrical Installation",
        "Painting", "Tiling", "Roofing", "Motor Vehicle Mechanics",
        "Motorcycle Repair", "Driving", "Delivery Riding", "Boda Boda",
        "Tailoring", "Dressmaking", "Hairdressing", "Barbering", "Beauty Therapy",
        "Nail Technology", "Catering", "Cooking", "Baking", "Bartending",
        "Waitering", "Housekeeping", "Cleaning", "Laundry", "Security Guarding",
        "Landscaping", "Gardening", "Farming", "Poultry Farming",
        "Solar Installation", "Phone Repair", "Refrigeration", "Air Conditioning",
        "Shop Attending", "Cashiering", "Stock Taking", "Mobile Money Agency",
    ],
}

#: Written form -> canonical vocabulary entry. CVs abbreviate, and a parser
#: that only matched the canonical form would miss most real mentions.
ALIASES: dict[str, str] = {
    "js": "JavaScript", "node": "Node.js", "nodejs": "Node.js",
    "ts": "TypeScript", "reactjs": "React", "react.js": "React",
    "py": "Python", "ms excel": "Microsoft Excel", "ms word": "Microsoft Word",
    "ms office": "Microsoft Office", "msoffice": "Microsoft Office",
    "excel": "Microsoft Excel", "word": "Microsoft Word",
    "photoshop": "Adobe Photoshop", "illustrator": "Adobe Illustrator",
    "premiere": "Adobe Premiere", "premiere pro": "Adobe Premiere",
    "after effects": "Motion Graphics", "indesign": "Print Design",
    "smm": "Social Media Marketing", "seo optimization": "SEO",
    "search engine optimization": "SEO", "search engine optimisation": "SEO",
    "google adwords": "Google Ads", "adwords": "Google Ads",
    "meta ads": "Facebook Ads", "fb ads": "Facebook Ads",
    "book keeping": "Bookkeeping", "book-keeping": "Bookkeeping",
    "quick books": "QuickBooks", "qb": "QuickBooks",
    "hr": "Human Resources", "human resource": "Human Resources",
    "pr": "Public Relations", "va": "Virtual Assistant",
    "customer support": "Customer Care", "client service": "Customer Care",
    "mpesa": "M-Pesa Integration", "m pesa": "M-Pesa Integration",
    "auto cad": "AutoCAD", "autocad 2d": "AutoCAD",
    "ui/ux": "UI Design", "uiux": "UI Design", "ux/ui": "UX Design",
    "mechanic": "Motor Vehicle Mechanics", "jua kali": "Masonry",
    "fundi": "Masonry", "mason": "Masonry", "carpenter": "Carpentry",
    "welder": "Welding", "plumber": "Plumbing", "electrician": "Electrical Installation",
    "tailor": "Tailoring", "barber": "Barbering", "hairdresser": "Hairdressing",
    "chef": "Cooking", "cook": "Cooking", "baker": "Baking",
    "driver": "Driving", "rider": "Delivery Riding", "boda": "Boda Boda",
    "watchman": "Security Guarding", "guard": "Security Guarding",
    "data capture": "Data Entry", "data clerk": "Data Entry",
    "typing": "Data Entry", "copy typing": "Data Entry",
}


def deinvert(raw: str) -> str:
    """
    Turns a KeSCO index entry into the phrase a person would write.

    "Manager, Personnel" -> "Personnel Manager". KeSCO inverts titles so they
    file alphabetically under the role noun, which makes them unrecognisable
    as written English.
    """
    text = re.sub(r"\s+", " ", raw).strip(" .,;-")
    if "," in text:
        head, _, tail = text.partition(",")
        text = f"{tail.strip()} {head.strip()}"
    # ALL-CAPS acronyms are left alone; everything else is title-cased, since
    # KeSCO's own casing is inconsistent.
    return " ".join(w if w.isupper() and len(w) > 1 else w.capitalize() for w in text.split())


def acceptable(phrase: str) -> bool:
    """Whether a candidate is specific enough, and modern enough, to be a skill."""
    if not 3 <= len(phrase) <= 40:
        return False
    # Punctuation here means KeSCO was qualifying the entry rather than naming
    # it: "(high Court) Registrar", "After School: Languages Tutor".
    if any(ch in phrase for ch in "():;/\\\"'"):
        return False

    words = phrase.lower().split()
    if not 1 <= len(words) <= 4:
        return False
    if not all(w.replace("-", "").replace(".", "").isalpha() for w in words):
        return False
    if any(w in ARCHAIC for w in words):
        return False
    if any(w in OUT_OF_SCOPE for w in words):
        return False
    if phrase.lower() in EXCLUDED_PHRASES:
        return False
    # Only rejected when the whole phrase is the bare abstraction: "Driving" is
    # out, "Delivery Riding" stays, and "Construction Site Supervisor" stays.
    if len(words) == 1 and words[0] in NOT_A_SKILL:
        return False
    # A phrase that is *only* generic words names a group, not a skill. One
    # generic word is fine -- "Procurement Officer" is still recognisable.
    if all(w in TOO_GENERIC for w in words):
        return False
    return True


def from_kesco() -> dict[str, set[str]]:
    occupations = json.loads(OCCUPATIONS.read_text(encoding="utf-8"))
    by_code = {o["code"]: o for o in occupations}

    out: dict[str, set[str]] = {}
    for code, category in CATEGORY_MAP.items():
        occupation = by_code.get(code)
        if not occupation:
            continue
        for raw in TITLE_IN_NOTE.findall(occupation.get("skills_note") or ""):
            phrase = deinvert(raw)
            if acceptable(phrase):
                out.setdefault(category, set()).add(phrase)
    return out


def from_scraped() -> dict[str, set[str]]:
    if not SCRAPED.exists():
        return {}
    data = json.loads(SCRAPED.read_text(encoding="utf-8"))
    out: dict[str, set[str]] = {}
    for category, terms in data.get("skills", {}).items():
        for term in terms:
            phrase = " ".join(
                w if w.isupper() and len(w) > 1 else w.capitalize() for w in term.split()
            )
            if acceptable(phrase):
                out.setdefault(category, set()).add(phrase)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    merged: dict[str, set[str]] = {}
    counts: dict[str, dict[str, int]] = {}

    for label, source in (
        ("kesco", from_kesco()),
        ("scraped", from_scraped()),
        # Curated terms skip acceptable(): the filters exist to clean up text
        # nobody chose, and these were chosen deliberately. That is why
        # "Accounting" and "Driving" survive here while the scraped source's
        # bare field names do not.
        ("curated", {k: set(v) for k, v in CURATED.items()}),
    ):
        added = {}
        for category, terms in source.items():
            before = len(merged.get(category, set()))
            merged.setdefault(category, set()).update(terms)
            added[category] = len(merged[category]) - before
        counts[label] = added
        print(f"{label}: contributed {sum(added.values())} new term(s)")
        for category in sorted(added):
            if added[category]:
                print(f"    {category}: +{added[category]}")

    # One term, one category. A term claimed by two categories is kept in the
    # one with fewer terms, so the smaller categories are not starved.
    seen: dict[str, str] = {}
    for category in sorted(merged, key=lambda c: len(merged[c])):
        for term in sorted(merged[category]):
            seen.setdefault(term, category)

    final: dict[str, list[str]] = {}
    for term, category in seen.items():
        final.setdefault(category, []).append(term)
    for category in final:
        final[category].sort()

    payload = {
        "_note": (
            "Generated by eval/corpus_sources/build_skill_vocabulary.py. "
            "Sources: KeSCO-2022 occupational titles, terms observed on "
            "robots.txt-permitted Kenyan job listing pages, and curated "
            "informal-sector additions. Do not hand-edit; change the builder."
        ),
        "aliases": ALIASES,
        "skills": final,
    }
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    total = sum(len(v) for v in final.values())
    print(f"\n{total} skills across {len(final)} categories -> {args.out}")
    for category in sorted(final):
        print(f"  {category}: {len(final[category])}")
    print(f"{len(ALIASES)} aliases")


if __name__ == "__main__":
    main()
