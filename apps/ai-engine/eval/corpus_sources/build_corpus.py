"""
Builds the evaluation corpus from the Kenyan occupational standard.

    python -m eval.corpus_sources.build_corpus

Writes eval/corpus/{profiles,gigs,relevance}.csv|json, replacing what was
previously written by hand.

How relevance is decided
------------------------
Grades come from two places, and keeping them separate is the point.

The **derived baseline** comes from KeSCO's own hierarchy. Its codes nest —
2512 Software Developers, 2513 Web and Multimedia Developers and 2514
Applications Programmers all sit inside minor group 251 — so the distance
between two codes is a published statement about how related two kinds of work
are. Using it means relevance is defined by the national classification rather
than asserted by the author.

The **hand-authored layer** then corrects it, because a hierarchy is a coarse
proxy for fit. Two occupations can be adjacent in KeSCO while a particular gig
suits only one of them, and a gig can be ideal for a worker while sharing none
of their vocabulary. Those cases are in overrides.json, each with a reason.

Every grade in the output records which layer produced it, so the two can be
analysed separately — and so an annotator can be asked the sharper question of
whether the *rule* holds, rather than grading hundreds of pairs from scratch.
"""

import csv
import json
import math
import random
from pathlib import Path

from eval.corpus_sources.category_map import (
    CATEGORY_MAP,
    LOCATIONS,
    PLAIN_TITLES,
    SKILL_LEVEL_MULTIPLIER,
)

HERE = Path(__file__).resolve().parent
CORPUS_DIR = HERE.parent / "corpus"
KESCO = HERE / "kesco_occupations.json"
OVERRIDES = HERE / "overrides.json"

# Fixed so the corpus is identical on every machine and every run. A corpus
# that changed between runs would make two evaluations incomparable.
SEED = 20261012

# WorkKE, Kenya Digital Employment & Hiring Report 2026: average completed job
# KES 4,664, median KES 2,000. A lognormal reproduces that pair exactly, and
# its right skew is the shape platform earnings actually take — many small
# jobs, a few large ones.
#   median = exp(mu)                  -> mu    = ln(2000)      = 7.601
#   mean   = exp(mu + sigma^2 / 2)    -> sigma = 1.301
PAY_MU = math.log(2000)
PAY_SIGMA = 1.301

# Floor and ceiling, so a draw from the distribution's tail cannot produce an
# absurd figure. The floor scales with skill level for the same reason the
# median does: KES 800 is a plausible data-entry task and an implausible
# software engagement, so one global floor cannot serve both.
PAY_FLOOR = 800
PAY_CEILING = 250_000


def load_occupations() -> list[dict]:
    if not KESCO.exists():
        raise SystemExit("Run: python -m eval.corpus_sources.parse_kesco first")

    everything = json.loads(KESCO.read_text(encoding="utf-8"))
    chosen = [o for o in everything if o["code"] in CATEGORY_MAP]

    missing = set(CATEGORY_MAP) - {o["code"] for o in chosen}
    if missing:
        raise SystemExit(
            f"category_map references codes the parser did not extract: {sorted(missing)}"
        )
    return sorted(chosen, key=lambda o: o["code"])


def display_title(occ: dict) -> str:
    """The name a person would use, falling back to KeSCO's own wording."""
    plain = PLAIN_TITLES.get(occ["code"])
    if plain:
        return plain
    # KeSCO titles are plural job families; singular reads better in a profile.
    title = occ["title"]
    return title[:-1] if title.endswith("s") and not title.endswith("ss") else title


STOPWORDS = {
    "and", "or", "the", "of", "in", "on", "to", "for", "with", "other", "related",
    "their", "they", "this", "that", "such", "from", "into", "by", "as", "at",
    "are", "is", "be", "which", "may", "where", "when", "including", "include",
}


# Where a noun phrase ends. A skill tag is what the work is done *to*, so the
# phrase stops before the clause explaining why.
BOUNDARY = {
    "to", "for", "of", "in", "on", "with", "by", "from", "at", "as", "that",
    "which", "and", "or", "into", "through", "using", "including", "so", "when",
    "where", "within", "under", "over", "about", "against", "per",
}


def _strip(word: str) -> str:
    # Includes the en- and em-dashes KeSCO uses to open bulleted task lists.
    return word.strip(".,;:'\"()’‘–—-")


def skill_phrase(task: str) -> str | None:
    """
    Pulls a short noun tag out of a KeSCO task statement.

    Task statements are verb-led — "developing and testing software to meet
    client needs" — but a worker tags themselves with the noun, not the verb.
    This drops the leading verbs and keeps what they act on, giving "Software"
    rather than "Developing Testing Software".
    """
    words = [_strip(w) for w in task.split()]
    words = [w for w in words if w]

    index = 0
    # Skip the verb cluster: gerunds and the conjunctions between them.
    while index < len(words):
        lowered = words[index].lower()
        if lowered.endswith("ing") or lowered in {"and", "or", "the", "a", "an"}:
            index += 1
            continue
        break

    phrase: list[str] = []
    for word in words[index: index + 4]:
        if word.lower() in BOUNDARY:
            break
        phrase.append(word)
        if len(phrase) == 3:
            break

    if not phrase:
        return None

    tag = " ".join(phrase).title()
    return tag if 3 < len(tag) < 34 else None


def profile_tasks(occ: dict) -> list[str]:
    """
    The half of the task list reserved for describing workers.

    Profiles and gigs must not be built from the same sentences. Drawing both
    from the whole list would make a worker and their matching gig share
    wording that no real pair would share, which flatters keyword matching and
    makes the benchmark measure the construction rather than the method.

    Splitting the list is also the more faithful model: a worker's own account
    of their work and an employer's posting are different texts about the same
    occupation, written by different people.
    """
    tasks = occ["tasks"]
    return tasks[len(tasks) // 2:] or tasks


def gig_tasks(occ: dict) -> list[str]:
    """The half reserved for gig postings. See profile_tasks()."""
    tasks = occ["tasks"]
    return tasks[: len(tasks) // 2] or tasks


def skills_from(occ: dict, source: list[str], limit: int = 5) -> list[str]:
    """
    Derives skill tags from the occupation's title and a slice of its tasks.

    Every tag traces to KeSCO's wording rather than to a vocabulary the author
    invented — that is the point of grounding the corpus in it.
    """
    tags: list[str] = []

    # The occupation itself is how most people label their first skill.
    title_words = [w for w in occ["title"].replace(",", " ").split() if w.lower() not in STOPWORDS]
    if title_words:
        head = " ".join(title_words[:3])
        # KeSCO titles are plural job families; a tag reads as singular.
        if head.endswith("s") and not head.endswith("ss"):
            head = head[:-1]
        tags.append(head.title())

    for task in source:
        tag = skill_phrase(task)
        if tag and tag not in tags:
            tags.append(tag)
        if len(tags) >= limit:
            break

    return tags[:limit]


def trim_title(task: str, width: int = 54) -> str:
    """
    Shortens a task statement for a headline without cutting a word in half.

    Trailing punctuation matters here: truncating mid-phrase otherwise leaves a
    dangling apostrophe where the source said "customers' needs", which reads
    as a bug rather than a style.
    """
    text = task.lstrip(" –—-")
    text = text[0].lower() + text[1:] if text else text
    if len(text) <= width:
        return text.rstrip(" ,;:.’‘'\"")
    cut = text[:width].rsplit(" ", 1)[0]
    return cut.rstrip(" ,;:.’‘'\"")


def pick_location(rng: random.Random) -> str:
    names = [name for name, _ in LOCATIONS]
    weights = [weight for _, weight in LOCATIONS]
    return rng.choices(names, weights=weights, k=1)[0]


def draw_budget(rng: random.Random, major_group: str) -> tuple[int, int]:
    """A pay range for one gig, scaled by the occupation's skill level."""
    multiplier = SKILL_LEVEL_MULTIPLIER.get(major_group, 1.0)
    floor = PAY_FLOOR * multiplier

    base = rng.lognormvariate(PAY_MU, PAY_SIGMA)
    midpoint = max(floor, min(PAY_CEILING, base * multiplier))

    low = int(round(midpoint * 0.75, -2))
    high = int(round(midpoint * 1.45, -2))
    return max(int(floor), low), max(low + 500, high)


def build_profile(occ: dict, rng: random.Random) -> dict:
    title = display_title(occ)
    definition = occ["definition"]
    # The first clause of a KeSCO definition reads as a self-description once
    # the formal subject is dropped.
    summary = definition.split(";")[0].strip()
    if len(summary) > 240:
        summary = summary[:240].rsplit(" ", 1)[0]

    return {
        "id": f"w-{occ['code']}",
        "kesco_code": occ["code"],
        "label": title,
        "skills": skills_from(occ, profile_tasks(occ)),
        "bio": summary,
        "location": pick_location(rng),
        "reputation_score": round(rng.uniform(3.2, 4.9), 1),
    }


def build_gigs(occ: dict, rng: random.Random, count: int = 2) -> list[dict]:
    """
    Builds gigs from the occupation's task statements.

    Each gig takes a different slice of the task list, so two gigs from the
    same occupation are genuinely different pieces of work rather than
    rewordings of each other.
    """
    title = display_title(occ)
    category = CATEGORY_MAP[occ["code"]]
    tasks = gig_tasks(occ)
    gigs = []

    for index in range(count):
        slice_start = (index * 2) % max(1, len(tasks))
        chosen = tasks[slice_start: slice_start + 3] or tasks[:3]
        if not chosen:
            continue

        lead = chosen[0]

        def sentence(text: str) -> str:
            text = text.lstrip(" –—-")
            return text[0].lower() + text[1:] if text else text

        description = (
            f"We are looking for someone to take on {sentence(lead)}. "
            + " ".join(f"The work also covers {sentence(t)}." for t in chosen[1:3])
        ).strip()

        remote = rng.random() < 0.55
        low, high = draw_budget(rng, occ["major_group"])

        gigs.append(
            {
                "id": f"g-{occ['code']}-{index + 1}",
                "kesco_code": occ["code"],
                "title": f"{title} needed — {trim_title(lead)}",
                "description": description,
                "category": category,
                "required_skills": skills_from(occ, gig_tasks(occ), limit=3),
                "location": None if remote else pick_location(rng),
                "is_remote": remote,
                "budget_min": low,
                "budget_max": high,
            }
        )

    return gigs


def derived_grade(worker_code: str, gig_code: str) -> int:
    """
    Relevance implied by distance in the KeSCO hierarchy.

    The codes nest four deep: digit 1 is the major group, digits 1-2 the
    sub-major, digits 1-3 the minor group, all four the unit group.
    """
    if worker_code == gig_code:
        return 3          # the same occupation
    if worker_code[:3] == gig_code[:3]:
        return 2          # same minor group — closely related work
    if worker_code[:2] == gig_code[:2]:
        return 1          # same sub-major group — adjacent field
    return 0              # unrelated


def main() -> None:
    rng = random.Random(SEED)
    occupations = load_occupations()

    profiles = [build_profile(o, rng) for o in occupations]
    gigs: list[dict] = []
    for occ in occupations:
        gigs.extend(build_gigs(occ, rng))

    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.exists() else {}
    extra_gigs = overrides.get("gigs", [])
    gigs.extend(extra_gigs)

    # Derived baseline over every real pair.
    graded: dict[tuple[str, str], tuple[int, str, str]] = {}
    for profile in profiles:
        for gig in gigs:
            gig_code = gig.get("kesco_code")
            if not gig_code:
                continue      # hand-authored gigs are graded only by override
            grade = derived_grade(profile["kesco_code"], gig_code)
            if grade > 0:
                graded[(profile["id"], gig["id"])] = (
                    grade,
                    "derived",
                    f"KeSCO {profile['kesco_code']} vs {gig_code}",
                )

    # Hand-authored layer, applied last so it wins.
    for row in overrides.get("relevance", []):
        graded[(row["worker_id"], row["gig_id"])] = (
            int(row["grade"]),
            row.get("layer", "authored"),
            row.get("note", ""),
        )

    CORPUS_DIR.mkdir(exist_ok=True)
    (CORPUS_DIR / "profiles.json").write_text(
        json.dumps(profiles, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (CORPUS_DIR / "gigs.json").write_text(
        json.dumps(gigs, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    with (CORPUS_DIR / "relevance.csv").open("w", encoding="utf-8", newline="") as fh:
        fh.write(
            "# Generated by eval/corpus_sources/build_corpus.py — do not edit by hand.\n"
            "# Edit overrides.json and regenerate.\n"
            "#\n"
            "# grade  3 ideal | 2 good | 1 marginal | 0 irrelevant (omitted)\n"
            "# layer  derived  = implied by distance in the KeSCO hierarchy\n"
            "#        authored = hand-assigned, overriding the derived value\n"
        )
        writer = csv.writer(fh)
        writer.writerow(["worker_id", "gig_id", "grade", "layer", "note"])
        for (worker_id, gig_id), (grade, layer, note) in sorted(graded.items()):
            writer.writerow([worker_id, gig_id, grade, layer, note])

    by_layer: dict[str, int] = {}
    for _, (_, layer, _) in graded.items():
        by_layer[layer] = by_layer.get(layer, 0) + 1

    budgets = sorted(g["budget_min"] for g in gigs if g.get("budget_min"))
    median = budgets[len(budgets) // 2] if budgets else 0

    print(f"\nprofiles  {len(profiles)}")
    print(f"gigs      {len(gigs)}  ({len(extra_gigs)} hand-authored)")
    print(f"graded    {len(graded)} pairs  " + ", ".join(f"{k}:{v}" for k, v in sorted(by_layer.items())))
    print(f"          {len(profiles) * len(gigs) - len(graded)} pairs implicitly grade 0")
    print(f"budgets   median floor KES {median:,}  range {budgets[0]:,}-{budgets[-1]:,}")
    print(f"\nwritten to {CORPUS_DIR}\n")


if __name__ == "__main__":
    main()
