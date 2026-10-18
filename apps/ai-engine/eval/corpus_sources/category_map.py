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
    "2515": "Technology",   # Software Auditors
    "2522": "Technology",   # Systems Administrators
    "2531": "Technology",   # Database and Network Security Professionals
    "2543": "Technology",   # Cloud Computing Professionals
    "2120": "Technology",   # Mathematicians, Actuaries and Statisticians
    "2172": "Technology",   # Surveyors and Cartographers
    # --- Writing ----------------------------------------------------------
    "2641": "Writing",      # Authors and Related Writers
    "2642": "Writing",      # Journalists
    "2643": "Writing",      # Translators, Interpreters and Other Linguists
    "2353": "Writing",      # Other Language Teachers
    "4131": "Writing",      # Typists and Word Processing Operators
    "3342": "Writing",      # Legal Secretaries
    # --- Design -----------------------------------------------------------
    "2651": "Design",       # Visual Artists
    "2654": "Design",       # Film, Stage and Related Directors and Producers
    "3431": "Design",       # Photographers
    "3432": "Design",       # Interior Designers and Decorators
    "3521": "Design",       # Broadcasting and Audio-Visual Technicians
    "2652": "Design",       # Musicians, Singers and Composers
    "2655": "Design",       # Actors
    # --- Marketing --------------------------------------------------------
    "2431": "Marketing",    # Advertising and Marketing Professionals
    "2432": "Marketing",    # Public Relations Professionals
    "2434": "Marketing",    # ICT Sales Professionals
    "4227": "Marketing",    # Survey and Market Research Interviewers
    "1221": "Marketing",    # Sales and Marketing Managers
    "1222": "Marketing",    # Public Relations and Advertising Managers
    # --- Business ---------------------------------------------------------
    "2411": "Business",     # Accountants
    "2421": "Business",     # Management and Organization Analysts
    "4120": "Business",     # Office Secretaries
    "4132": "Business",     # Data Entry Clerks
    "4222": "Business",     # Contact Centre Information Clerks
    "4311": "Business",     # Accounting and Book Keeping Clerks
    "1212": "Business",     # Human Resource Managers
    "2412": "Business",     # Financial and Investment Advisers
    "2423": "Business",     # Human Resource and Careers Professionals
    "2424": "Business",     # Training and Staff Development Professionals
    "2356": "Business",     # Information Communication Technology Trainers
    "4225": "Business",     # Inquiry Clerks
    "4312": "Business",     # Statistical, Finance and Insurance Clerks
    "4313": "Business",     # Payroll Clerks
    "4416": "Business",     # Personnel Clerks
}

# Where a KeSCO title is a formal classification label rather than something a
# worker would write about themselves, a plainer name is used in generated
# text. The code still carries the provenance.
PLAIN_TITLES: dict[str, str] = {
    "2120": "Statistician",
    "2172": "Surveyor and Cartographer",
    "2353": "Language Teacher",
    "2356": "ICT Trainer",
    "2412": "Financial Adviser",
    "2423": "HR and Careers Professional",
    "2424": "Training and Development Professional",
    "2531": "Database and Network Security Professional",
    "2543": "Cloud Computing Professional",
    "2652": "Musician and Composer",
    "4131": "Typist and Word Processing Operator",
    "4312": "Statistical and Insurance Clerk",
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
#
# Several counties appear more than once on purpose. The earlier list of nine
# towns gave every town its own county, which left the "same county, different
# town" tier in app/services/scoring.location_affinity unreachable -- the tier
# existed but nothing in the corpus could exercise it. Weights are rough
# shares of where Kenyan online work concentrates, not measured figures.
LOCATIONS: list[tuple[str, float]] = [
    # Nairobi and its commuter belt, which is one labour market in practice
    ("Nairobi", 0.30),
    ("Thika", 0.05),        # Kiambu
    ("Ruiru", 0.04),        # Kiambu
    ("Kikuyu", 0.03),       # Kiambu
    ("Machakos", 0.03),
    ("Athi River", 0.02),   # Machakos
    # Coast
    ("Mombasa", 0.10),
    ("Malindi", 0.03),      # Kilifi
    ("Kilifi", 0.02),
    # Nyanza and Western
    ("Kisumu", 0.08),
    ("Kisii", 0.03),
    ("Kakamega", 0.03),
    ("Mumias", 0.02),       # Kakamega
    ("Bungoma", 0.02),
    # Rift Valley
    ("Nakuru", 0.07),
    ("Naivasha", 0.03),     # Nakuru
    ("Eldoret", 0.04),      # Uasin Gishu
    ("Kericho", 0.02),
    # Central and Eastern
    ("Nyeri", 0.02),
    ("Karatina", 0.01),     # Nyeri
    ("Meru", 0.01),
]
