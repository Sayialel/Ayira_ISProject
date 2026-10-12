"""
Which KeSCO occupations belong on a digital gig platform, and under which
Ayira category.

KeSCO classifies the whole Kenyan economy, including work that cannot be done
through a marketplace like this one — Vehicle Cleaners, Building Construction
Labourers, Crop Farm Labourers. This file is the explicit, reviewable decision
about which occupations are in scope.

It is a judgement, and it is recorded here rather than buried in a generator so
it can be argued with. The occupations chosen align with the four categories
WorkKE reports as dominant on a real Kenyan platform — administrative/business
support, design/media, web/technology, writing/content — split across Ayira's
five seeded categories.
"""

# KeSCO unit-group code -> Ayira category.
#
# Codes are stable national identifiers, so the mapping stays valid as the
# parser or the corpus changes.
CATEGORY_MAP: dict[str, str] = {
    # --- Technology -------------------------------------------------------
    "2511": "Technology",   # Systems Analysts
    "2512": "Technology",   # Software Developers
    "2513": "Technology",   # Web and Multimedia Developers
    "2514": "Technology",   # Applications Programmers
    "2521": "Technology",   # Database Designers and Administrators
    "2523": "Technology",   # Computer Network Professionals
    "3514": "Technology",   # Web Technicians
    # --- Writing ----------------------------------------------------------
    "2641": "Writing",      # Authors and Related Writers
    "2642": "Writing",      # Journalists
    "2643": "Writing",      # Translators, Interpreters and Other Linguists
    # --- Design -----------------------------------------------------------
    "2651": "Design",       # Visual Artists
    "2654": "Design",       # Film, Stage and Related Directors and Producers
    "3431": "Design",       # Photographers
    "3432": "Design",       # Interior Designers and Decorators
    "3521": "Design",       # Broadcasting and Audio-Visual Technicians
    # --- Marketing --------------------------------------------------------
    "2431": "Marketing",    # Advertising and Marketing Professionals
    "2432": "Marketing",    # Public Relations Professionals
    "2434": "Marketing",    # ICT Sales Professionals
    "4227": "Marketing",    # Survey and Market Research Interviewers
    # --- Business ---------------------------------------------------------
    "2411": "Business",     # Accountants
    "2421": "Business",     # Management and Organization Analysts
    "4120": "Business",     # Office Secretaries
    "4132": "Business",     # Data Entry Clerks
    "4222": "Business",     # Contact Centre Information Clerks
    "4311": "Business",     # Accounting and Book Keeping Clerks
}

# Where a KeSCO title is a formal classification label rather than something a
# worker would write about themselves, a plainer name is used in generated
# text. The code still carries the provenance.
PLAIN_TITLES: dict[str, str] = {
    "2513": "Web and Multimedia Developer",
    "2514": "Applications Programmer",
    "2521": "Database Administrator",
    "2523": "Computer Network Professional",
    "3514": "Web Technician",
    "2641": "Writer",
    "2643": "Translator and Interpreter",
    "2651": "Visual Artist",
    "2654": "Film and Video Producer",
    "3432": "Interior Designer",
    "3521": "Audio-Visual Technician",
    "2431": "Advertising and Marketing Professional",
    "2434": "ICT Sales Professional",
    "4227": "Market Research Interviewer",
    "2421": "Management Analyst",
    "4222": "Contact Centre Agent",
    "4311": "Book-keeping Clerk",
}

# KeSCO's first digit is a skill-level proxy, following the ISCO convention it
# is built on: 1 managers, 2 professionals, 3 technicians, 4 clerical support,
# 9 elementary occupations. Pay is scaled by it, so a professional engagement
# and a data-entry task do not draw from the same distribution.
SKILL_LEVEL_MULTIPLIER: dict[str, float] = {
    "1": 3.0,   # managers
    "2": 2.6,   # professionals
    "3": 1.8,   # technicians and associate professionals
    "4": 1.0,   # clerical support
    "5": 0.9,   # service and sales
    "6": 0.9,   # skilled agricultural
    "7": 1.1,   # craft and related trades
    "8": 1.0,   # plant and machine operators
    "9": 0.7,   # elementary occupations
}

# Kenyan towns, weighted toward where platform work concentrates. Used so the
# location signal has something to distinguish; a corpus set entirely in
# Nairobi cannot measure it.
LOCATIONS: list[tuple[str, float]] = [
    ("Nairobi", 0.45),
    ("Mombasa", 0.13),
    ("Kisumu", 0.10),
    ("Nakuru", 0.09),
    ("Eldoret", 0.07),
    ("Thika", 0.05),
    ("Nyeri", 0.04),
    ("Machakos", 0.04),
    ("Kakamega", 0.03),
]
