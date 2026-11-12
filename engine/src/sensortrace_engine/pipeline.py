"""High-level questioned-image analysis: one image against one or more candidates."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from .decision import (
    LITERATURE_DEFAULT_POLICY,
    Decision,
    DecisionPolicy,
    DeviceClass,
    Verdict,
    decide,
)
from .fingerprint import Fingerprint
from .ingest import DEFAULT_LIMITS, IngestedImage, IngestLimits, ingest_image
from .matching import ComparisonMeasurement, compare
from .quality import QualityReport, assess_quality
from .residual import Residual, extract_residual
from .version import ALGORITHM_VERSION, ENGINE_VERSION, library_versions


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    fingerprint: Fingerprint
    label: str = ""
    #: Identifier of the physical device the sensor belongs to (controls must be other devices).
    device_id: str | None = None
    #: Normalised make/model (and firmware where known); equal keys mean "same model".
    model_key: str | None = None
    device_class: DeviceClass = "unknown"


@dataclass
class CandidateResult:
    candidate_id: str
    label: str
    measurement: ComparisonMeasurement
    decision: Decision
    fingerprint_digest: str
    rank: int = 0
    #: Experimental: PCE minus the mean PCE of same-model control devices (Loison et al. 2026).
    delta_spce: float | None = None
    control_ids: list[str] = field(default_factory=list)

    def to_dict(self, *, include_surface: bool = False) -> dict[str, Any]:
        return {
            "candidate_id": self.candidate_id,
            "label": self.label,
            "rank": self.rank,
            "fingerprint_digest": self.fingerprint_digest,
            "experimental": {
                "delta_spce": self.delta_spce,
                "control_ids": self.control_ids,
                "note": (
                    "Delta-sPCE (statistic minus the mean statistic of same-model control devices) "
                    "is an unvalidated research measure. It depends on the control set and is shown "
                    "for information only; it is not used for the decision."
                ),
            }
            if self.delta_spce is not None
            else None,
            "measurement": self.measurement.to_dict(include_surface=include_surface),
            "decision": self.decision.to_dict(),
        }


@dataclass
class AnalysisResult:
    image: IngestedImage
    quality: QualityReport
    residual: Residual
    candidates: list[CandidateResult]
    summary: dict[str, Any] = field(default_factory=dict)

    def to_dict(self, *, include_surface: bool = False) -> dict[str, Any]:
        return {
            "image": self.image.summary(),
            "quality": self.quality.to_dict(),
            "candidates": [c.to_dict(include_surface=include_surface) for c in self.candidates],
            "summary": self.summary,
            "provenance": {
                "algorithm_version": ALGORITHM_VERSION,
                "engine_version": ENGINE_VERSION,
                "libraries": library_versions(),
                "sigma0": self.residual.sigma0,
            },
        }


def summarise(results: Sequence[CandidateResult]) -> dict[str, Any]:
    """Open-set summary over a candidate list. Never forces a selection."""
    matches = [r for r in results if r.decision.verdict is Verdict.MATCH]
    counts = {v.value: sum(1 for r in results if r.decision.verdict is v) for v in Verdict}
    if not results:
        text = "No candidate sensors were compared."
    elif len(matches) == 1:
        text = (
            f"The evidence supports a match with one enrolled sensor ({matches[0].label or matches[0].candidate_id}) "
            f"out of {len(results)} compared."
        )
    elif len(matches) > 1:
        text = (
            f"The statistic exceeds the match threshold for {len(matches)} enrolled sensors. An image "
            "originates from one sensor, so this indicates shared non-unique artefacts (for example "
            "between devices of the same model) or related fingerprints. No single source should be "
            "concluded from this result."
        )
    elif counts[Verdict.NON_MATCH.value] == len(results):
        text = (
            "The evidence supports a non-match for every enrolled sensor compared. The image may "
            "originate from a sensor that is not enrolled."
        )
    else:
        text = (
            "No enrolled sensor reached the match threshold. The image may originate from a sensor "
            "that is not enrolled, or conditions may prevent detection; see the individual results."
        )
    return {"counts": counts, "multiple_matches": len(matches) > 1, "text": text}


def analyse_questioned(
    data: bytes,
    candidates: Sequence[Candidate],
    *,
    policy: DecisionPolicy = LITERATURE_DEFAULT_POLICY,
    sigma0: float = 3.0,
    limits: IngestLimits = DEFAULT_LIMITS,
) -> AnalysisResult:
    """Ingest a questioned image and compare it with every candidate fingerprint."""
    image = ingest_image(data, limits)
    quality = assess_quality(image, role="questioned")
    residual = extract_residual(image.pixels, sigma0)
    measurements = [compare(residual, cand.fingerprint) for cand in candidates]
    results: list[CandidateResult] = []
    for idx, cand in enumerate(candidates):
        m = measurements[idx]
        controls = [
            j
            for j, other in enumerate(candidates)
            if j != idx
            and cand.model_key
            and other.model_key == cand.model_key
            and cand.device_id is not None
            and other.device_id is not None
            and other.device_id != cand.device_id
            and other.fingerprint.shape == cand.fingerprint.shape
            and measurements[j].pce is not None
        ]
        control_pces = [float(measurements[j].pce) for j in controls]  # type: ignore[arg-type]
        d = decide(
            m,
            policy=policy,
            quality=quality,
            fingerprint_diagnostics=cand.fingerprint.diagnostics,
            device_class=cand.device_class,
            model_key=cand.model_key,
            control_pces=control_pces,
            n_candidates=len(candidates),
        )
        r = CandidateResult(cand.candidate_id, cand.label, m, d, cand.fingerprint.digest())
        if control_pces and m.pce is not None:
            r.delta_spce = float(m.pce - sum(control_pces) / len(control_pces))
            r.control_ids = [candidates[j].candidate_id for j in controls]
        results.append(r)
    results.sort(key=lambda r: (r.decision.effective_pce is None, -(r.decision.effective_pce or 0.0)))
    for i, r in enumerate(results, start=1):
        r.rank = i
    summary = summarise(results)
    if len([r for r in results if r.decision.verdict is Verdict.MATCH]) > 1:
        for r in results:
            if r.decision.verdict is Verdict.MATCH:
                r.decision.caveats.append(
                    "More than one enrolled sensor exceeded the match threshold for this image; "
                    "this match must not be treated as source identification on its own."
                )
    return AnalysisResult(image=image, quality=quality, residual=residual, candidates=results, summary=summary)
