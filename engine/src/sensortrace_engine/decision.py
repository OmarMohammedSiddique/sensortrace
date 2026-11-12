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
* **Non-unique artefacts.** Published studies (Iuliani et al. 2021; Loison et
  al. 2026) show that on many smartphones released since about 2018 the
  statistic between *different devices of the same model* is routinely far
  above any classical threshold. For a sensor whose pipeline is not declared
  conventional, a high statistic therefore supports a match only when the
  same-model alternative has been addressed: either the policy was calibrated
  on that model with same-model negatives, or fingerprints of other physical
  devices of the same model ("controls") were compared and stayed below the
  threshold. Otherwise the outcome is ``inconclusive``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any, Literal

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
    #: Minimum unsaturated pixels for a conclusion drawn from a statistic below the match
    #: threshold (non-match or inconclusive). A statistic at or above the match threshold is
    #: not gated by pixel count: see "quality gates" in the module docstring.
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


DeviceClass = Literal["conventional", "computational", "unknown"]

#: Default policy. The thresholds are reference lines from the literature, NOT calibrated
#: error-rate operating points; see SCIENTIFIC_METHODOLOGY.md for sources and caveats.
LITERATURE_DEFAULT_POLICY = DecisionPolicy(
    policy_id="literature-reference-uncalibrated",
    match_threshold=60.0,
    non_match_threshold=10.0,
    calibrated=False,
    basis=(
        "Uncalibrated reference lines. PCE = 60 is the convention of Goljan, Fridrich and Filler "
        "(2009), observed on pre-2009 cameras at full resolution: no exceedance in about one "
        "million different-model tests, overall false-alarm rate 2.4e-5 with 2.4% missed "
        "detections. No error rate can be attached to it for other devices: later studies "
        "measured false-match rates from 5% to over 60% at this value between same-model "
        "smartphones. The non-match line of 10 is an engineering choice inside the range "
        "expected for unrelated sensors under the idealised noise model; it is not a published "
        "or validated figure."
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
    #: How the same-model (non-unique artefact) alternative was treated.
    nua: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict.value,
            "label": self.label,
            "effective_pce": self.effective_pce,
            "reasons": self.reasons,
            "caveats": self.caveats,
            "policy": self.policy,
            "nua": self.nua,
        }


STANDARD_CAVEATS = [
    "This result is a statistical indication, not proof of origin, and not a probability that "
    "the image came from the sensor.",
    "The method tests an image against an enrolled sensor fingerprint. It cannot identify an "
    "unknown camera from a single image.",
]

NON_MATCH_CAVEAT = (
    "A low statistic does not exclude the sensor. Zoom, stabilisation, multi-frame processing, "
    "editing, resizing and dark or saturated content can all hide a true match."
)

COMPUTATIONAL_CAVEAT = (
    "Modern smartphones apply computational processing (multi-frame fusion, HDR, lens "
    "correction, synthetic blur) that can weaken the sensor pattern and add artefacts shared by "
    "different phones of the same model and software version."
)


def decide(
    measurement: ComparisonMeasurement,
    *,
    policy: DecisionPolicy = LITERATURE_DEFAULT_POLICY,
    quality: QualityReport | None = None,
    fingerprint_diagnostics: dict[str, Any] | None = None,
    device_class: DeviceClass = "unknown",
    model_key: str | None = None,
    control_pces: list[float] | None = None,
    n_candidates: int = 1,
) -> Decision:
    """Apply ``policy`` to one measurement.

    ``control_pces`` are the statistics obtained for the same questioned image
    against fingerprints of *other physical devices of the same model*.
    ``n_candidates`` is the number of sensors searched for this image; the
    statistic is adjusted for that many additional trials.
    """
    pol = policy.to_dict()
    caveats = list(STANDARD_CAVEATS)
    if not policy.calibrated:
        caveats.append(
            "Thresholds are uncalibrated reference lines from the literature. No false-match or "
            "missed-match rate is available for this device and these image conditions."
        )
    if device_class != "conventional":
        caveats.append(COMPUTATIONAL_CAVEAT)
    nua: dict[str, Any] = {"device_class": device_class, "model_key": model_key, "mitigation": "not_applicable"}

    def out(verdict: Verdict, eff: float | None, reasons: list[str]) -> Decision:
        return Decision(verdict, VERDICT_LABELS[verdict], eff, reasons, caveats, pol, nua)

    if measurement.geometry == "unsupported" or measurement.pce is None:
        return out(Verdict.UNSUITABLE, None, list(measurement.notes) or ["No valid test could be performed."])
    if not np.isfinite(measurement.pce):
        # A NaN compares False with every threshold and would otherwise fall through to
        # "non-match supported"; an infinite value would be read as a match.
        return out(
            Verdict.UNSUITABLE,
            None,
            ["The statistic is not a finite number, so the computation is invalid. No conclusion is drawn."],
        )

    trials = measurement.search_size * max(int(n_candidates), 1)
    eff = effective_pce(measurement.pce, trials)
    reasons: list[str] = []
    if trials > 1:
        reasons.append(
            f"{trials:,} hypotheses were tested (alignments x candidate sensors); the statistic was "
            f"adjusted from PCE {measurement.pce:.1f} to an equivalent single-test value of {eff:.1f}."
        )
    if measurement.geometry == "cropped":
        caveats.append(
            "Cropped-image analysis is experimental: the search adjustment relies on an idealised "
            "noise model and has not been empirically validated."
        )

    if eff >= policy.match_threshold:
        reasons.append(f"Statistic {eff:.1f} is at or above the match threshold of {policy.match_threshold:g}.")
        if device_class == "conventional":
            nua["mitigation"] = "declared_conventional"
            return out(Verdict.MATCH, eff, reasons)
        scope = (policy.calibration or {}).get("model_keys") or []
        if policy.calibrated and model_key and model_key in scope:
            nua["mitigation"] = "calibrated_for_model"
            reasons.append("The policy was calibrated with same-model negatives for this device model.")
            return out(Verdict.MATCH, eff, reasons)
        # Controls are compared unadjusted. The multiple-testing adjustment exists to make a
        # match harder to claim; applied to a control it would lower a high control statistic
        # and make the same-model alternative easier to dismiss as more sensors are searched.
        controls = [float(c) for c in (control_pces or [])]
        if controls:
            finite = [c for c in controls if np.isfinite(c)]
            # A control whose statistic is not finite was not validly tested: it counts as failed.
            worst = max(finite) if len(finite) == len(controls) else float("inf")
            nua.update(n_controls=len(controls), max_control=worst)
            if worst < policy.match_threshold:
                nua["mitigation"] = "same_model_controls"
                reasons.append(
                    f"{nua['n_controls']} control device(s) of the same model were tested against this "
                    f"image and stayed below the threshold (highest {worst:.1f}, unadjusted)."
                )
                caveats.append(
                    f"Support relative to {nua['n_controls']} same-model control device(s) is experimental. "
                    "A small control set cannot rule out artefacts shared with other units, "
                    "production batches or software versions."
                )
                return out(Verdict.MATCH, eff, reasons)
            nua["mitigation"] = "controls_failed"
            reasons.append(
                (
                    f"A control device of the same model also reaches the threshold (highest {worst:.1f}, "
                    "unadjusted). The high statistic is at least partly due to artefacts shared "
                    "by this model, so it does not single out one device."
                )
                if np.isfinite(worst)
                else "A control device of the same model did not yield a valid statistic, so the "
                "same-model alternative is not addressed."
            )
            return out(Verdict.INCONCLUSIVE, eff, reasons)
        nua["mitigation"] = "none"
        reasons.append(
            "The sensor's processing pipeline is not declared conventional, and on many recent "
            "smartphones different devices of the same model also produce high statistics. "
            "Without same-model control fingerprints or a calibration for this model, a match "
            "to this individual device cannot be supported. Enrol one or more other devices of "
            "the same model as controls and compare again."
        )
        return out(Verdict.INCONCLUSIVE, eff, reasons)

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

    # The non-match line is applied to the unadjusted statistic. The adjustment for the number of
    # hypotheses only lowers the value: it guards a match claim against chance peaks, and must not
    # turn an intermediate statistic into support for a non-match merely because more alignments
    # or candidate sensors were searched.
    raw = float(measurement.pce)
    if raw > policy.non_match_threshold:
        reasons.append(
            f"The statistic (unadjusted {raw:.1f}, adjusted {eff:.1f}) lies between the non-match "
            f"threshold ({policy.non_match_threshold:g}, applied to the unadjusted value) and the match "
            f"threshold ({policy.match_threshold:g}, applied to the adjusted value)."
        )
        return out(Verdict.INCONCLUSIVE, eff, reasons)

    blockers: list[str] = []
    lowest = min([raw, *(v for v in measurement.tested.values() if np.isfinite(v))])
    if lowest <= -policy.match_threshold:
        blockers.append(
            f"a strongly negative statistic ({lowest:.1f}) was measured, which is expected neither for "
            "an unrelated sensor nor for an unaltered image of this sensor (it can arise from "
            "intensity inversion or other processing)"
        )
    if measurement.geometry == "cropped":
        blockers.append("the image is a crop, for which non-match conclusions are not supported")
    if quality is not None:
        for f in quality.flags:
            if f.code in _BLOCK_NON_MATCH:
                blockers.append(f.message.rstrip("."))
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
            f"Statistic {raw:.1f} is at or below the non-match threshold, but a low value cannot "
            "be read as evidence of a different source because: " + "; ".join(blockers) + "."
        )
        return out(Verdict.INCONCLUSIVE, eff, reasons)

    caveats.append(NON_MATCH_CAVEAT)
    reasons.append(
        f"Statistic {raw:.1f} (unadjusted) is at or below the non-match threshold of {policy.non_match_threshold:g}, "
        "the image is at native resolution with no detected conditions that would hide the "
        "sensor pattern, and the fingerprint meets the quality requirements."
    )
    return out(Verdict.NON_MATCH, eff, reasons)
