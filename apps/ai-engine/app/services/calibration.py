"""
Serves the calibrated match probability.

The composite score ranks well and reads badly: semantic carries 0.72 of the
weight, MiniLM cosine between two short related texts tops out near 0.7, so a
genuinely good match scores about 0.59 and a worker is shown "59%". The number
is not wrong, it is just not a percentage of anything.

eval/calibrate.py fits a one-feature logistic from that score to
P(grade >= 2) on the training split and writes artifacts/calibration.json.
This applies it, so the figure on the screen states something checkable: of
the pairs that scored like this one, about this fraction were judged good or
ideal. Measured on the held-out split: Brier 0.1544 against a 0.2456 base
rate, expected calibration error 0.0317.

The transform is strictly monotonic, so it cannot reorder a result list. Every
rank-based metric -- NDCG, P@k, R@10, MRR -- is unchanged by it, which is why
the reported NDCG@10 of 0.780 still describes the deployed system.

Absent artefact is not an error. The engine then serves the raw score, which
is what it did before this existed.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

ARTIFACT_PATH = Path(__file__).parent.parent.parent / "artifacts" / "calibration.json"


@dataclass(frozen=True)
class Calibration:
    a: float
    b: float
    dataset_version: str | None = None

    def apply(self, score: float) -> float:
        # Clamped before exp so an out-of-range score cannot overflow it.
        z = max(-30.0, min(30.0, self.a * score + self.b))
        return 1.0 / (1.0 + math.exp(-z))


_loaded = False
_calibration: Calibration | None = None


def load() -> Calibration | None:
    """
    Reads the artefact once per process.

    Cached on first call rather than at import, so a missing or malformed
    artefact cannot stop the engine from starting -- the reason the whole
    startup path was made lazy in the first place.
    """
    global _loaded, _calibration
    if _loaded:
        return _calibration

    _loaded = True
    if not ARTIFACT_PATH.exists():
        logger.info(
            "No calibration artefact at %s; serving raw composite scores. "
            "Run `python -m eval.calibrate --promote` to fit one.",
            ARTIFACT_PATH,
        )
        return None

    try:
        payload = json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))
        _calibration = Calibration(
            a=float(payload["a"]),
            b=float(payload["b"]),
            dataset_version=payload.get("dataset_version"),
        )
        logger.info(
            "Calibration loaded (a=%.4f b=%.4f, dataset %s)",
            _calibration.a,
            _calibration.b,
            _calibration.dataset_version,
        )
    except (ValueError, KeyError, OSError) as exc:
        # A broken artefact must not take matching down with it.
        logger.error("Calibration artefact at %s is unusable: %s", ARTIFACT_PATH, exc)
        _calibration = None

    return _calibration


def confidence(score: float) -> float | None:
    """
    P(this gig is relevant) for a composite score, or None with no artefact.

    None rather than the raw score, so the caller can tell "uncalibrated" from
    "calibrated and low" instead of presenting one as the other.
    """
    calibration = load()
    return None if calibration is None else calibration.apply(score)


def reset_cache() -> None:
    """Only for tests: forgets the loaded artefact."""
    global _loaded, _calibration
    _loaded = False
    _calibration = None
