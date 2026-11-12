"""Reference fingerprint (PRNU factor) estimation.

Model (Chen, Fridrich, Goljan, Lukas, IEEE TIFS 2008): the residual of image
``i`` is ``W_i = I_i K + Xi_i`` where ``K`` is the multiplicative PRNU factor
and ``Xi_i`` is modelled as independent Gaussian noise. The maximum-likelihood
estimate from ``N`` images is

    K_hat = sum_i(W_i I_i) / sum_i(I_i^2)

computed per colour channel. Saturated pixels contribute nothing (weight 0)
and near-saturated intensities are attenuated (:func:`residual.intensity_weight`).
The per-channel estimate is zero-meaned per CFA phase, combined to luminance
and Wiener-filtered in the DFT domain to remove artefacts shared by cameras
of the same model.

The accumulator is streaming: images are processed one at a time and never
held in memory together. Two half-accumulators (even/odd images) are kept so a
split-half consistency diagnostic can be reported without a second pass.
"""

from __future__ import annotations

import hashlib
import io
import json
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray

from .errors import IncompatibleGeometryError, InsufficientReferenceError, NumericalError
from .residual import (
    as_float_image,
    channel_residuals,
    intensity_weight,
    saturation_mask,
    to_gray,
    wiener_dft,
    zero_mean_total,
)
from .version import ALGORITHM_VERSION, ENGINE_VERSION, library_versions

FloatArray = NDArray[np.float32]

MIN_REFERENCE_IMAGES = 2
FINGERPRINT_FORMAT = 1


@dataclass(frozen=True)
class ReferenceStats:
    """Per-reference-image statistics recorded during accumulation."""

    index: int
    saturated_fraction: float
    mean_intensity: float
    residual_std: float


@dataclass
class Fingerprint:
    """An estimated PRNU factor with the metadata needed to reproduce it."""

    k: FloatArray
    n_images: int
    sigma0: float
    color: bool
    algorithm_version: str = ALGORITHM_VERSION
    engine_version: str = ENGINE_VERSION
    libraries: dict[str, str] = field(default_factory=library_versions)
    diagnostics: dict[str, Any] = field(default_factory=dict)

    @property
    def shape(self) -> tuple[int, int]:
        return (int(self.k.shape[0]), int(self.k.shape[1]))

    def digest(self) -> str:
        """SHA-256 over shape and the little-endian float32 samples of ``K``."""
        h = hashlib.sha256()
        h.update(f"{self.k.shape[0]}x{self.k.shape[1]}:".encode())
        h.update(np.ascontiguousarray(self.k, dtype="<f4").tobytes())
        return h.hexdigest()

    def metadata(self) -> dict[str, Any]:
        return {
            "format": FINGERPRINT_FORMAT,
            "height": self.shape[0],
            "width": self.shape[1],
            "n_images": self.n_images,
            "sigma0": self.sigma0,
            "color": self.color,
            "algorithm_version": self.algorithm_version,
            "engine_version": self.engine_version,
            "libraries": self.libraries,
            "diagnostics": self.diagnostics,
            "digest": self.digest(),
        }

    def to_bytes(self) -> bytes:
        """Serialise to a compressed ``.npz`` container (no pickle)."""
        buf = io.BytesIO()
        np.savez_compressed(
            buf,
            k=np.ascontiguousarray(self.k, dtype="<f4"),
            meta=np.frombuffer(json.dumps(self.metadata()).encode(), dtype=np.uint8),
        )
        return buf.getvalue()

    @classmethod
    def from_bytes(cls, data: bytes) -> Fingerprint:
        with np.load(io.BytesIO(data), allow_pickle=False) as z:
            k = np.asarray(z["k"], dtype=np.float32)
            meta = json.loads(bytes(z["meta"]).decode())
        if meta.get("format") != FINGERPRINT_FORMAT:
            raise NumericalError(f"unsupported fingerprint format {meta.get('format')}")
        fp = cls(
            k=k,
            n_images=int(meta["n_images"]),
            sigma0=float(meta["sigma0"]),
            color=bool(meta["color"]),
            algorithm_version=str(meta["algorithm_version"]),
            engine_version=str(meta["engine_version"]),
            libraries=dict(meta["libraries"]),
            diagnostics=dict(meta["diagnostics"]),
        )
        if fp.digest() != meta["digest"]:
            raise NumericalError("fingerprint digest mismatch: data is corrupt or was altered")
        return fp


class _Half:
    __slots__ = ("n", "nn", "rp")

    def __init__(self, shape: tuple[int, ...]) -> None:
        self.rp = np.zeros(shape, dtype=np.float32)
        self.nn = np.zeros(shape, dtype=np.float32)
        self.n = 0


def _finalize(rp: FloatArray, nn: FloatArray) -> FloatArray:
    k = rp / (nn + 1.0)
    k = zero_mean_total(k)
    gray = to_gray(k)
    out = wiener_dft(gray)
    if not np.all(np.isfinite(out)):
        raise NumericalError("non-finite values in fingerprint")
    return out


def _zero_shift_pce(a: FloatArray, b: FloatArray) -> tuple[float, float]:
    # Local import: matching depends on this module for the Fingerprint type.
    from .matching import circular_xcorr, pce_at

    surface = circular_xcorr(a, b)
    res = pce_at(surface, (0, 0))
    a0 = a - a.mean()
    b0 = b - b.mean()
    denom = float(np.sqrt((a0 * a0).sum() * (b0 * b0).sum()))
    ncc = float((a0 * b0).sum() / denom) if denom > 0 else 0.0
    return res.pce, ncc


class FingerprintAccumulator:
    """Streaming maximum-likelihood PRNU estimator."""

    def __init__(self, shape: tuple[int, int], *, color: bool = True, sigma0: float = 3.0) -> None:
        if sigma0 <= 0:
            raise ValueError("sigma0 must be positive")
        self.shape = (int(shape[0]), int(shape[1]))
        self.color = bool(color)
        self.sigma0 = float(sigma0)
        full = (*self.shape, 3) if self.color else self.shape
        self._halves = (_Half(full), _Half(full))
        self.stats: list[ReferenceStats] = []

    @property
    def n_images(self) -> int:
        return self._halves[0].n + self._halves[1].n

    def add(self, pixels: NDArray) -> ReferenceStats:
        """Add one reference image (stored pixel geometry, no resampling)."""
        image = as_float_image(pixels)
        if image.shape[:2] != self.shape:
            raise IncompatibleGeometryError(
                f"reference image is {image.shape[1]}x{image.shape[0]} px but the fingerprint "
                f"is {self.shape[1]}x{self.shape[0]} px; images of a different size cannot be merged"
            )
        if self.color and image.ndim == 2:
            image = np.repeat(image[..., None], 3, axis=2)
        elif not self.color and image.ndim == 3:
            image = to_gray(image)

        raw = channel_residuals(image, self.sigma0)
        if image.ndim == 3:
            weight = np.empty(image.shape, dtype=np.float32)
            sat_any = np.zeros(self.shape, dtype=bool)
            for c in range(3):
                sat = saturation_mask(image[..., c])
                sat_any |= sat
                wgt = intensity_weight(image[..., c])
                wgt[sat] = 0.0
                weight[..., c] = wgt
        else:
            sat_any = saturation_mask(image)
            weight = intensity_weight(image)
            weight[sat_any] = 0.0

        half = self._halves[self.n_images % 2]
        half.rp += raw * weight
        half.nn += weight * weight
        half.n += 1

        st = ReferenceStats(
            index=self.n_images - 1,
            saturated_fraction=float(sat_any.mean()),
            mean_intensity=float(to_gray(image).mean()),
            residual_std=float(raw.std()),
        )
        self.stats.append(st)
        return st

    def finalize(self) -> Fingerprint:
        n = self.n_images
        if n < MIN_REFERENCE_IMAGES:
            raise InsufficientReferenceError(
                f"at least {MIN_REFERENCE_IMAGES} reference images are required, got {n}"
            )
        a, b = self._halves
        k = _finalize(a.rp + b.rp, a.nn + b.nn)

        diagnostics: dict[str, Any] = {
            "n_images": n,
            "fingerprint_std": float(k.std()),
            "mean_saturated_fraction": float(np.mean([s.saturated_fraction for s in self.stats])),
            "mean_intensity": float(np.mean([s.mean_intensity for s in self.stats])),
            "reference_stats": [asdict(s) for s in self.stats],
        }
        if a.n >= 1 and b.n >= 1:
            ka = _finalize(a.rp, a.nn)
            kb = _finalize(b.rp, b.nn)
            pce, ncc = _zero_shift_pce(ka, kb)
            diagnostics["split_half"] = {
                "pce": pce,
                "ncc": ncc,
                "n_a": a.n,
                "n_b": b.n,
                "description": (
                    "Signed PCE and correlation between fingerprints estimated from two "
                    "disjoint halves of the reference set. High values indicate a stable, "
                    "shared sensor pattern; values near zero indicate the reference set "
                    "does not contain a consistent pattern."
                ),
            }
        return Fingerprint(k=k, n_images=n, sigma0=self.sigma0, color=self.color, diagnostics=diagnostics)


def estimate_fingerprint(images: list[NDArray], *, sigma0: float = 3.0) -> Fingerprint:
    """Convenience wrapper for in-memory image lists (tests, small sets)."""
    if not images:
        raise InsufficientReferenceError("no reference images supplied")
    first = np.asarray(images[0])
    acc = FingerprintAccumulator(first.shape[:2], color=first.ndim == 3, sigma0=sigma0)
    for im in images:
        acc.add(im)
    return acc.finalize()
