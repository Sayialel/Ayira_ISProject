"""
Extracts the Kenya Standard Classification of Occupations (KeSCO-2022) into
structured JSON.

    python -m eval.corpus_sources.parse_kesco

Downloads the official PDF if it is not already cached, parses its 438 unit
groups, and writes kesco_occupations.json next to this file.

Why this exists
---------------
The evaluation corpus used to be written from imagination, which made its
vocabulary impossible to justify. Grounding it in the national occupational
standard means the skills and the language describing work come from the
Ministry of Labour's own classification rather than from the author.

The source PDF is not committed — it is 6.6 MB and freely downloadable. This
script is the provenance record: anyone can re-run it and get the same JSON.

Licence
-------
KeSCO-2022, Ministry of Labour and Social Protection, ISBN 978-9914-49-401-3.
The document states: "Extract may be published if the source is duly
acknowledged." Any use of this data must cite it.
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PDF_URL = (
    "https://labourmarket.go.ke/media/resources/"
    "KENYA_STANDARD_CLASSIFICATION_OF_OCCUPATIONS_KeSCO-2022.pdf"
)
PDF_CACHE = HERE / "kesco-2022.pdf"
OUTPUT = HERE / "kesco_occupations.json"

# Running headers and footers repeat on all 544 pages and would otherwise land
# in the middle of extracted paragraphs.
NOISE = [
    re.compile(r"KENYA STANDARD CLASSIFICATION OF OCCUPATIONS\s*\d*", re.I),
    re.compile(r"\d+\s*\|\s*P\s*a\s*g\s*e", re.I),
    re.compile(r"===PAGE \d+===")
]

# The task list is introduced fourteen different ways across the document —
# "Tasks performed include", "The tasks usually include", "Tasks would
# include", and so on, including one that extraction broke into "Tasks perf
# ormed usually include". Rather than enumerate them, match "Tasks" followed
# by a short run of words and "include". Restricting the gap to word
# characters and spaces stops it leaping across sentence boundaries.
TASKS_MARKER = re.compile(r"\bTasks\b[\w\s]{0,45}?\binclude\b\s*:?\s*-?\s*", re.I)

# The paragraph after the tasks describes the training and skills required.
SKILLS_MARKER = re.compile(r"For effective and efficient performance of tasks", re.I)

UNIT_GROUP = re.compile(r"UNIT\s+GROUP\s+(\d{4})\s*:?\s*", re.I)


def fetch_pdf() -> Path:
    if PDF_CACHE.exists():
        return PDF_CACHE

    import httpx

    print(f"Downloading KeSCO-2022 from {PDF_URL}")
    response = httpx.get(PDF_URL, timeout=180, follow_redirects=True)
    response.raise_for_status()
    PDF_CACHE.write_bytes(response.content)
    print(f"  cached {len(response.content):,} bytes at {PDF_CACHE.name}")
    return PDF_CACHE


def extract_text(pdf: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        sys.exit("pypdf is required: pip install pypdf")

    reader = PdfReader(str(pdf))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def clean(text: str) -> str:
    """
    Repairs the artefacts this particular PDF's text layer produces.

    Extraction splits words at what were line-break hyphens and sometimes
    inserts a space mid-word ("i mprove", "biologic al", "t his"). Both would
    otherwise end up in generated gig descriptions, so they are repaired here
    rather than left for a reader to notice.
    """
    for pattern in NOISE:
        text = pattern.sub(" ", text)

    # "infra -red" and "records -keeping" — a hyphen that gained a space.
    text = re.sub(r"\s+-\s*(?=[a-z])", "-", text)

    # A word split by a stray space: join when one side is a short fragment and
    # the other continues in lower case. Deliberately conservative — it only
    # fires on fragments of three characters or fewer.
    text = re.sub(r"\b([a-z]{1,3}) ([a-z]{2,})\b", _rejoin, text)

    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\s*\n\s*", " ", text).strip()


# Short words that legitimately precede another word; never join these.
REAL_SHORT_WORDS = {
    "a", "an", "as", "at", "be", "by", "do", "for", "he", "if", "in", "is", "it",
    "its", "may", "no", "not", "of", "on", "or", "out", "set", "she", "so", "the",
    "to", "up", "use", "via", "was", "we", "who", "and", "are", "all", "any",
    "can", "has", "had", "her", "him", "his", "how", "its", "new", "non", "one",
    "our", "own", "per", "see", "two", "way", "you", "end", "job", "key", "low",
    "run", "top", "aid", "air", "art", "car", "day", "oil", "raw", "tax", "etc",
}


def _rejoin(match: re.Match) -> str:
    head, tail = match.group(1), match.group(2)
    if head in REAL_SHORT_WORDS:
        return match.group(0)
    return head + tail


# The source is entirely upper case, so titles must be recased to read
# naturally — but str.title() turns "CEO" into "Ceo" and "ICT" into "Ict".
ACRONYMS = {
    "CEO", "CFO", "COO", "ICT", "IT", "HR", "NGO", "TV", "GIS", "HIV", "AIDS",
    "PR", "QA", "QC", "RD", "SME", "UI", "UX", "AI", "ML", "CAD", "HVAC",
}
LOWER_WORDS = {"and", "or", "of", "the", "in", "on", "at", "to", "for", "with", "a", "an"}


def title_case(text: str) -> str:
    """Recases an upper-case heading, preserving acronyms and small words."""
    words = text.split()
    out = []
    for i, word in enumerate(words):
        # Handle compounds like "SECRETARY/CEO" a piece at a time.
        parts = re.split(r"([/&-])", word)
        recased = []
        for part in parts:
            if not part or part in "/&-":
                recased.append(part)
            elif part.upper() in ACRONYMS:
                recased.append(part.upper())
            elif part.lower() in LOWER_WORDS and i > 0:
                recased.append(part.lower())
            else:
                recased.append(part.capitalize())
        out.append("".join(recased))
    return " ".join(out)


def split_sentences(text: str) -> list[str]:
    """Task lists are semicolon-delimited in this document."""
    parts = re.split(r";|\.\s+", text)
    return [p.strip(" .;-") for p in parts if len(p.strip()) > 15]


def parse(text: str) -> list[dict]:
    occupations = []
    matches = list(UNIT_GROUP.finditer(text))

    for i, match in enumerate(matches):
        code = match.group(1)
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end]

        # The title runs from the code to the end of the capitalised heading,
        # which the definition follows in sentence case.
        title_match = re.match(r"\s*([A-Z][A-Z\s,/&'()-]{3,120}?)(?=\s+[A-Z][a-z])", body)
        if not title_match:
            continue
        title = re.sub(r"\s+", " ", title_match.group(1)).strip(" ,-")
        remainder = body[title_match.end():]

        tasks_match = TASKS_MARKER.search(remainder)
        skills_match = SKILLS_MARKER.search(remainder)

        definition = remainder[: tasks_match.start()] if tasks_match else remainder
        tasks_text = ""
        skills_text = ""

        if tasks_match:
            task_end = skills_match.start() if skills_match else len(remainder)
            tasks_text = remainder[tasks_match.end(): task_end]
        if skills_match:
            skills_text = remainder[skills_match.end():]

        tasks = split_sentences(tasks_text)
        if not title or not tasks:
            continue

        occupations.append(
            {
                "code": code,
                "title": title_case(title),
                "major_group": code[0],
                "definition": re.sub(r"\s+", " ", definition).strip(" .;-")[:1200],
                "tasks": tasks[:12],
                "skills_note": re.sub(r"\s+", " ", skills_text).strip(" .;-")[:600],
            }
        )

    return occupations


def main() -> None:
    pdf = fetch_pdf()
    print("Extracting text from 544 pages...")
    raw = extract_text(pdf)
    print(f"  {len(raw):,} characters")

    cleaned = clean(raw)
    occupations = parse(cleaned)

    OUTPUT.write_text(json.dumps(occupations, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    by_group: dict[str, int] = {}
    for occ in occupations:
        by_group[occ["major_group"]] = by_group.get(occ["major_group"], 0) + 1

    print(f"\nParsed {len(occupations)} unit groups -> {OUTPUT.name}")
    print("  by major group: " + ", ".join(f"{k}:{v}" for k, v in sorted(by_group.items())))
    total_tasks = sum(len(o["tasks"]) for o in occupations)
    print(f"  {total_tasks} task statements captured")


if __name__ == "__main__":
    main()
