"""Sensor enrolment: screening of reference images and fingerprint estimation.

Two passes over the reference set:

1. **Screen.** Every file is ingested and quality-assessed. Exact duplicates,
   unreadable files, and images whose geometry or capture configuration
   (dimensions, camera make/model, lens) differs from the dominant group are
   rejected with a stated reason - images from different sensors, lenses or
   resolutions are never silently merged. A leave-one-out consistency check on
   a central crop identifies images that do not share the pattern common to
   the rest of the set.
2. **Estimate.** The accepted images are accumulated at full resolution by the
   streaming maximum-likelihood estimator.

The thresholds used for *screening* are data-hygiene heuristics. They are not
forensic decision thresholds.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .errors import CancelledError, EngineError, InsufficientReferenceError
from .fingerprint import MIN_REFERENCE_IMAGES, Fingerprint, FingerprintAccumulator, _finalize
from .ingest import DEFAULT_LIMITS, IngestedImage, IngestLimits, ingest_image
from .matching import circular_xcorr, pce_at
from .quality import assess_quality
from .residual import (
    as_float_image,
    channel_residuals,
    extract_residual,
    intensity_weight,
    saturation_mask,
)

ProgressFn = Callable[[str, int, int], None]
CancelFn = Callable[[], bool]

RECOMMENDED_REFERENCE_IMAGES = 30


@dataclass(frozen=True)
class EnrolConfig:
    sigma0: float = 3.0
    #: Reject a reference whose leave-one-out crop PCE is below this ...
    loo_reject_below: float = 5.0
    #: ... but only when the set's median leave-one-out PCE is at least this.
    loo_median_required: float = 50.0
    #: Reject references with more than this fraction of clipped pixels.
    max_saturated_fraction: float = 0.5
    reject_inconsistent: bool = True


@dataclass(frozen=True)
class ReferenceInput:
    ref_id: str
    load: Callable[[], bytes]


@dataclass
class ReferenceOutcome:
    ref_id: str
    accepted: bool = False
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    sha256: str | None = None
    width: int | None = None
    height: int | None = None
    quality: dict[str, Any] | None = None
    loo_pce: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "ref_id": self.ref_id,
            "accepted": self.accepted,
            "reasons": self.reasons,
            "warnings": self.warnings,
            "sha256": self.sha256,
            "width": self.width,
            "height": self.height,
            "quality": self.quality,
            "loo_pce": self.loo_pce,
        }


@dataclass
class EnrolmentResult:
    fingerprint: Fingerprint | None
    outcomes: list[ReferenceOutcome]
    warnings: list[str]
    group: dict[str, Any]

    @property
    def accepted(self) -> list[ReferenceOutcome]:
        return [o for o in self.outcomes if o.accepted]


def _group_key(img: IngestedImage) -> tuple:
    md = img.metadata
    return (
        img.width,
        img.height,
        img.channels,
        str(md.get("Make", "")).strip().lower(),
        str(md.get("Model", "")).strip().lower(),
        str(md.get("LensModel", "")).strip().lower(),
    )


def _describe_group(key: tuple) -> dict[str, Any]:
    return {
        "width": key[0],
        "height": key[1],
        "channels": key[2],
        "make": key[3] or None,
        "model": key[4] or None,
        "lens_model": key[5] or None,
    }


def _center_crop(a: np.ndarray, side: int) -> np.ndarray:
    h, w = a.shape[:2]
    ch, cw = min(side, h), min(side, w)
    ch -= ch % 2
    cw -= cw % 2
    top = ((h - ch) // 2) & ~1  # keep CFA phase
    left = ((w - cw) // 2) & ~1
    return a[top : top + ch, left : left + cw]


def _check(cancel: CancelFn | None) -> None:
    if cancel is not None and cancel():
        raise CancelledError("enrolment was cancelled")


def enrol(
    references: Sequence[ReferenceInput],
    *,
    config: EnrolConfig = EnrolConfig(),
    limits: IngestLimits = DEFAULT_LIMITS,
    progress: ProgressFn | None = None,
    should_cancel: CancelFn | None = None,
) -> EnrolmentResult:
    """Screen ``references`` and estimate a fingerprint from the accepted ones."""
    n = len(references)
    outcomes = [ReferenceOutcome(ref_id=r.ref_id) for r in references]
    warnings: list[str] = []
    report = progress or (lambda stage, done, total: None)

    # ---- pass 1a: ingest, quality, grouping ---------------------------------
    keys: dict[int, tuple] = {}
    seen: dict[str, str] = {}
    for i, ref in enumerate(references):
        _check(should_cancel)
        o = outcomes[i]
        try:
            img = ingest_image(ref.load(), limits)
        except EngineError as exc:
            o.reasons.append(f"Rejected: {exc}")
            report("screening", i + 1, n)
            continue
        o.sha256, o.width, o.height = img.sha256, img.width, img.height
        q = assess_quality(img, role="reference")
        o.quality = q.to_dict()
        o.warnings.extend(f.message for f in q.flags if f.severity != "info")
        if img.sha256 in seen:
            o.reasons.append(f"Rejected: exact duplicate of reference {seen[img.sha256]}.")
        elif q.metrics["saturated_fraction"] > config.max_saturated_fraction:
            o.reasons.append("Rejected: more than half of the pixels are clipped.")
        elif q.has("digital_zoom"):
            o.reasons.append("Rejected: digitally zoomed images are resampled and cannot be used.")
        else:
            seen[img.sha256] = ref.ref_id
            keys[i] = _group_key(img)
        report("screening", i + 1, n)

    if not keys:
        raise InsufficientReferenceError("no usable reference images")
    counts = Counter(keys.values())
    dominant, _ = counts.most_common(1)[0]
    if len(counts) > 1:
        warnings.append(
            "The reference set mixes images with different dimensions, camera models or lenses. "
            "Only the largest consistent group was used; a phone with several cameras needs a "
            "separate sensor entry for each."
        )
    candidates: list[int] = []
    for i, key in keys.items():
        if key == dominant:
            candidates.append(i)
            continue
        o = outcomes[i]
        if key[:2] == (dominant[1], dominant[0]):
            o.reasons.append(
                f"Rejected: stored as {key[0]}x{key[1]} px, transposed relative to the main group "
                f"({dominant[0]}x{dominant[1]} px). Rotated references cannot be merged because the "
                "rotation direction is ambiguous."
            )
        elif key[:3] != dominant[:3]:
            o.reasons.append(
                f"Rejected: {key[0]}x{key[1]} px differs from the main group "
                f"({dominant[0]}x{dominant[1]} px). Different resolutions are not merged."
            )
        else:
            o.reasons.append("Rejected: camera make, model or lens in the metadata differs from the main group.")

    # ---- pass 1b: leave-one-out consistency on a central crop ---------------
    m = len(candidates)
    side = 512 if m <= 60 else 384 if m <= 150 else 256
    rps: list[np.ndarray] = []
    nns: list[np.ndarray] = []
    tests: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    for j, i in enumerate(candidates):
        _check(should_cancel)
        img = ingest_image(references[i].load(), limits)
        crop = as_float_image(_center_crop(img.pixels, side))
        raw = channel_residuals(crop, config.sigma0)
        if crop.ndim == 3:
            wgt = np.stack([intensity_weight(crop[..., c]) for c in range(3)], axis=2)
            for c in range(3):
                wgt[..., c][saturation_mask(crop[..., c])] = 0.0
        else:
            wgt = intensity_weight(crop)
            wgt[saturation_mask(crop)] = 0.0
        rps.append(raw * wgt)
        nns.append(wgt * wgt)
        r = extract_residual(crop, config.sigma0)
        tests.append((r.w, r.intensity, r.saturated))
        report("consistency", j + 1, m)

    accepted = list(candidates)
    if m >= 3:
        rp_sum = np.sum(rps, axis=0)
        nn_sum = np.sum(nns, axis=0)
        loo: list[float] = []
        for j in range(m):
            k = _finalize(rp_sum - rps[j], nn_sum - nns[j])
            w, inten, sat = tests[j]
            valid = ~sat
            surf = circular_xcorr(np.where(valid, w, 0.0), np.where(valid, inten * k, 0.0))
            loo.append(pce_at(surf, (0, 0)).pce)
        median = float(np.median(loo))
        for j, i in enumerate(candidates):
            outcomes[i].loo_pce = loo[j]
        if median >= config.loo_median_required:
            for j, i in enumerate(candidates):
                if loo[j] < config.loo_reject_below:
                    msg = (
                        f"shares no detectable pattern with the other references (leave-one-out "
                        f"PCE {loo[j]:.1f} on a {side}px crop; set median {median:.0f})"
                    )
                    if config.reject_inconsistent:
                        outcomes[i].reasons.append(f"Rejected: {msg}. It may come from a different sensor.")
                        accepted.remove(i)
                    else:
                        outcomes[i].warnings.append(f"Image {msg}.")
            # The leave-one-out check can only expose a lone foreign image: several images from one
            # other sensor vouch for each other. A group far below the rest is reported, not removed.
            low = [outcomes[i].ref_id for j, i in enumerate(candidates) if i in accepted and loo[j] < 0.04 * median]
            if low:
                warnings.append(
                    f"{len(low)} reference image(s) agree far less with the set than the others do "
                    f"(leave-one-out PCE below 4% of the median {median:.0f}): {', '.join(low[:5])}"
                    + ("..." if len(low) > 5 else "")
                    + ". They may come from a different sensor. Screening cannot reliably detect several "
                    "images from one other device; check the reference set by hand."
                )
        else:
            warnings.append(
                f"The references show weak mutual consistency (median leave-one-out PCE {median:.1f} "
                f"on a {side}px crop). This is expected for few, dark, textured or heavily processed "
                "images; the resulting fingerprint may be weak."
            )
    del rps, nns, tests

    if len(accepted) < MIN_REFERENCE_IMAGES:
        raise InsufficientReferenceError(
            f"only {len(accepted)} usable reference image(s) remain after screening; "
            f"at least {MIN_REFERENCE_IMAGES} are required"
        )
    if len(accepted) < RECOMMENDED_REFERENCE_IMAGES:
        warnings.append(
            f"{len(accepted)} reference images were used. At least {RECOMMENDED_REFERENCE_IMAGES} "
            "well-exposed, low-texture images are recommended for a reliable fingerprint."
        )

    # ---- pass 2: full-resolution estimate -----------------------------------
    acc = FingerprintAccumulator((dominant[1], dominant[0]), color=dominant[2] == 3, sigma0=config.sigma0)
    used: list[str] = []
    for j, i in enumerate(accepted):
        _check(should_cancel)
        img = ingest_image(references[i].load(), limits)
        acc.add(img.pixels)
        outcomes[i].accepted = True
        used.append(img.sha256)
        report("estimating", j + 1, len(accepted))
    _check(should_cancel)
    report("finalising", 0, 1)
    fp = acc.finalize()
    fp.diagnostics["reference_sha256"] = used
    fp.diagnostics["screening"] = {
        "submitted": n,
        "accepted": len(accepted),
        "rejected": n - len(accepted),
        "loo_crop_side": side,
        "loo_pce_median": float(np.median([outcomes[i].loo_pce for i in candidates])) if m >= 3 else None,
        "config": {
            "sigma0": config.sigma0,
            "loo_reject_below": config.loo_reject_below,
            "loo_median_required": config.loo_median_required,
            "max_saturated_fraction": config.max_saturated_fraction,
            "reject_inconsistent": config.reject_inconsistent,
        },
    }
    fp.diagnostics["group"] = _describe_group(dominant)
    fp.diagnostics["warnings"] = warnings
    report("finalising", 1, 1)
    return EnrolmentResult(fingerprint=fp, outcomes=outcomes, warnings=warnings, group=_describe_group(dominant))
