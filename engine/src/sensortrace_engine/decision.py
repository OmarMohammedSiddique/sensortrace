"""Decision policy: turning measurements into a transparent, conservative outcome.

Four outcomes are possible for each (questioned image, candidate sensor) pair:

``match_supported``            the statistic is at or above the match threshold
``non_match_supported``        the statistic is at or below the non-match
                               threshold **and** the conditions under which a
                               true match would be expected to show are met
``inconclusive``               anything in between, or a low statistic obtained
                               under conditions that could hide a true match
``insufficient_or_unsupported`` the analysis could not validly be performed

Design rules
------------
* A threshold is always labelled with where it came from. Thresholds taken
  from the literature are marked **uncalibrated**; calibrated thresholds carry
  the dataset, sample sizes and target error rate they were selected for.
* No probability of common origin is ever produced. The Gaussian tail figures
  in the measurement are model-based reference values only.
* Poor quality can hide a match but cannot create one, so quality gates block
  *non-match* conclusions, not match conclusions.
* Each candidate is judged independently: nothing forces one of the enrolled
  sensors to be selected (open-set behaviour).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any

import numpy as np
from scipy.special import log_ndtr
from scipy.stats import norm

from .matching import ComparisonMeasurement
from .quality import QualityReport
from .version import DECISION_POLICY_VERSION


class Verdict(StrEnum):
    MATCH = "match_supported"
    NON_MATCH = "non_match_supported"
    INCONCLUSIVE = "inconclusive"
    UNSUITABLE = "insufficient_or_unsupported"


VERDICT_LABELS: dict[Verdict, str] = {
    Verdict.MATCH: "Evidence supports a match",
    Verdict.NON_MATCH: "Evidence supports a non-match",
    Verdict.INCONCLUSIVE: "Inconclusive",
    Verdict.UNSUITABLE: "Insufficient quality or unsupported analysis",
}

#: Quality flags that mean a low statistic cannot be read as evidence of a different source.
_BLOCK_NON_MATCH = {
    "digital_zoom", "dimension_mismatch", "editing_software", "png_container",
    "custom_rendering", "composite_image", "jpeg_compression", "strong_jpeg_compression",
    "saturation", "heavy_saturation", "very_dark", "low_resolution", "very_low_resolution",
    "no_camera_metadata",
}  # fmt: skip


def effective_pce(pce: float, search_size: int) -> float:
    """Signed PCE adjusted for the number of hypotheses searched.

    Maps the search-adjusted Gaussian tail back to an equivalent single-test
    PCE, so one threshold can be applied whatever the search size. For a single
    test this is the identity. Computed in the log domain so very large values
    do not underflow.
    """
    n = max(int(search_size), 1)
    if n == 1:
        return float(pce)
    z = float(np.sign(pce) * np.sqrt(abs(pce)))
    log_p = float(log_ndtr(-z))  # log of single-test upper tail
    # log(1 - (1 - p)^n), stable for small and large p
    if log_p < -30:
        log_ps = np.log(n) + log_p
    else:
        p = np.exp(log_p)
        log_ps = float(np.log(-np.expm1(n * np.log1p(-min(p, 1 - 1e-16)))))
    if log_ps >= 0:
        return -1e9 if log_ps > 0 else float(-(norm.isf(1 - 1e-16) ** 2))
    if log_ps > -700:
        ze = float(norm.isf(np.exp(log_ps)))
    else:
        ze = float(np.sqrt(max(-2.0 * log_ps, 0.0)))
        for _ in range(20):  # Newton refinement of log_ndtr(-z) = log_ps
            f = float(log_ndtr(-ze)) - log_ps
            hazard = float(np.exp(norm.logpdf(ze) - log_ndtr(-ze)))
            ze += f / hazard
    return float(np.sign(ze) * ze * ze)


@dataclass(frozen=True)
class DecisionPolicy:
    """Thresholds and preconditions, with their provenance."""

    policy_id: str
    match_threshold: float
    non_match_threshold: float
    calibrated: bool
    basis: str
    calibration: dict[str, Any] | None = None
    #: Minimum unsaturated pixels for any conclusion.
    min_valid_pixels: int = 250_000
    #: Minimum reference images behind a fingerprint for a non-match conclusion.
    min_reference_images_for_non_match: int = 20
    #: Minimum split-half PCE of the fingerprint for a non-match conclusion.
    min_split_half_pce_for_non_match: float = 100.0
    version: str = DECISION_POLICY_VERSION

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> DecisionPolicy:
        return cls(**d)


#: Default policy. Thresholds are literature conventions, NOT calibrated for the user's
#: devices or conditions; see SCIENTIFIC_METHODOLOGY.md for the sources and caveats.
LITERATURE_DEFAULT_POLICY = DecisionPolicy(
    policy_id="literature-default-uncalibrated",
    match_threshold=60.0,
    non_match_threshold=10.0,
    calibrated=False,
    basis=(
        "Match threshold PCE = 60 follows the convention of Goljan, Fridrich and Filler (2009), "
        "who reported it for full-resolution images on a large-scale test. It has not been "
        "calibrated for the devices, processing pipelines or image conditions in this case. "
        "The non-match threshold of 10 is a conservative engineering choice within the range "
        "expected for unrelated sensors under the idealised model; it is not a published or "
        "validated figure."
    ),
)


@dataclass
class Decision:
    verdict: Verdict
    label: str
    effective_pce: float | None
    reasons: list[str] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)
    policy: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict.value,
            "label": self.label,
            "effective_pce": self.effective_pce,
            "reasons": self.reasons,
            "caveats": self.caveats,
            "policy": self.policy,
        }


STANDARD_CAVEATS = [
    "This result is a statistical indication, not proof of origin. It is not a probability "
    "that the image came from the sensor.",
    "The method links an image to an enrolled sensor fingerprint. It cannot identify an "
    "unknown camera from a single image.",
]

SMARTPHONE_CAVEAT = (
    "Modern smartphones apply computational processing (multi-frame fusion, HDR, lens "
    "correction, stabilisation) that can weaken the sensor pattern or introduce artefacts "
    "shared by different phones of the same model. Published studies report elevated false "
    "matches between same-model devices for some recent phones; a match to a smartphone "
    "sensor should be corroborated against other devices of the same model where possible."
)


def decide(
    measurement: ComparisonMeasurement,
    *,
    policy: DecisionPolicy = LITERATURE_DEFAULT_POLICY,
    quality: QualityReport | None = None,
    fingerprint_diagnostics: dict[str, Any] | None = None,
    smartphone: bool | None = None,
) -> Decision:
    """Apply ``policy`` to one measurement."""
    pol = policy.to_dict()
    caveats = list(STANDARD_CAVEATS)
    if not policy.calibrated:
        caveats.append(
            "Thresholds are literature conventions and have not been calibrated on validation "
            "data representative of this device and these image conditions."
        )
    if smartphone is None or smartphone:
        caveats.append(SMARTPHONE_CAVEAT)

    def out(verdict: Verdict, eff: float | None, reasons: list[str]) -> Decision:
        return Decision(verdict, VERDICT_LABELS[verdict], eff, reasons, caveats, pol)

    if measurement.geometry == "unsupported" or measurement.pce is None:
        return out(Verdict.UNSUITABLE, None, list(measurement.notes) or ["No valid test could be performed."])

    eff = effective_pce(measurement.pce, measurement.search_size)
    reasons: list[str] = []
    if measurement.search_size > 1:
        reasons.append(
            f"{measurement.search_size:,} alignments were tested; the statistic was adjusted from "
            f"PCE {measurement.pce:.1f} to an equivalent single-test value of {eff:.1f}."
        )
    if measurement.geometry == "cropped":
        caveats.append(
            "Cropped-image analysis is experimental: the search adjustment relies on an idealised "
            "noise model and has not been empirically validated."
        )

    if eff >= policy.match_threshold:
        reasons.append(
            f"Statistic {eff:.1f} is at or above the match threshold of {policy.match_threshold:g}."
        )
        return out(Verdict.MATCH, eff, reasons)

    severe = [f for f in (quality.flags if quality else []) if f.severity == "severe"]
    if measurement.valid_pixels < policy.min_valid_pixels:
        reasons.append(
            f"Only {measurement.valid_pixels:,} usable pixels (minimum {policy.min_valid_pixels:,}); "
            "too little data to draw a conclusion from a low statistic."
        )
        return out(Verdict.UNSUITABLE, eff, reasons)
    if severe:
        reasons.append(
            "Statistic is below the match threshold, and the image has conditions that can "
            "remove or displace the sensor pattern: " + "; ".join(f.message for f in severe)
        )
        return out(Verdict.UNSUITABLE, eff, reasons)

    blockers: list[str] = []
    if eff > policy.non_match_threshold:
        reasons.append(
            f"Statistic {eff:.1f} lies between the non-match threshold ({policy.non_match_threshold:g}) "
            f"and the match threshold ({policy.match_threshold:g})."
        )
        return out(Verdict.INCONCLUSIVE, eff, reasons)

    if measurement.geometry == "cropped":
        blockers.append("the image is a crop, for which non-match conclusions are not supported")
    if quality is not None:
        for f in quality.flags:
            if f.code in _BLOCK_NON_MATCH:
                blockers.append(f.message)
    diag = fingerprint_diagnostics or {}
    n_ref = int(diag.get("n_images", 0))
    if n_ref < policy.min_reference_images_for_non_match:
        blockers.append(
            f"the fingerprint was built from {n_ref} reference images "
            f"(at least {policy.min_reference_images_for_non_match} are required to support a non-match)"
        )
    split = (diag.get("split_half") or {}).get("pce")
    if split is None or split < policy.min_split_half_pce_for_non_match:
        blockers.append(
            "the fingerprint's split-half consistency is "
            + ("unavailable" if split is None else f"{split:.0f}")
            + f" (at least {policy.min_split_half_pce_for_non_match:g} is required to support a non-match)"
        )
    if blockers:
        reasons.append(
            f"Statistic {eff:.1f} is at or below the non-match threshold, but a low value cannot "
            "be read as evidence of a different source because: " + "; ".join(blockers) + "."
        )
        return out(Verdict.INCONCLUSIVE, eff, reasons)

    reasons.append(
        f"Statistic {eff:.1f} is at or below the non-match threshold of {policy.non_match_threshold:g}, "
        "the image is at native resolution with no detected conditions that would hide the "
        "sensor pattern, and the fingerprint meets the quality requirements."
    )
    return out(Verdict.NON_MATCH, eff, reasons)
