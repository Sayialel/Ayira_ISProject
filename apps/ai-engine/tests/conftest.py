"""
Shared fixtures.

The corpus is loaded once per session. Loading it fits the TF-IDF vectoriser,
which is the slowest thing in the suite, and every test that needs real data
needs the same data.
"""

import sys
from pathlib import Path

import pytest

ENGINE_ROOT = Path(__file__).resolve().parents[1]
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))


@pytest.fixture(scope="session")
def corpus():
    from eval.harness import load_corpus

    return load_corpus()


@pytest.fixture(scope="session")
def features(corpus):
    from eval.tune_weights import extract_features

    return extract_features(corpus)


@pytest.fixture
def worker():
    return {
        "id": "w-test",
        "skills": ["Python", "Data Entry"],
        "bio": "Experienced data entry clerk and Python developer.",
        "location": "Nairobi",
        "reputation_score": 4.5,
    }


@pytest.fixture
def gigs():
    """Three gigs differing in the things the scorer is supposed to notice."""
    return [
        {
            "id": "g-1",
            "title": "Python developer needed",
            "description": "Build data pipelines in Python.",
            "required_skills": ["Python"],
            "location": "Nairobi",
            "is_remote": False,
            "employer_reputation": 4.8,
            "employer_review_count": 20,
        },
        {
            "id": "g-2",
            "title": "Data entry clerk",
            "description": "Enter records into a spreadsheet.",
            "required_skills": ["Data Entry"],
            "location": "Mombasa",
            "is_remote": False,
            "employer_reputation": 0.0,
            "employer_review_count": 0,
        },
        {
            "id": "g-3",
            "title": "Livestock herder",
            "description": "Graze cattle on open rangeland.",
            "required_skills": ["Herding"],
            "location": None,
            "is_remote": True,
            "employer_reputation": 3.9,
            "employer_review_count": 4,
        },
    ]
