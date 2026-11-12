"""Fingerprint detection statistics: normalised correlation and signed PCE.

Detection model (Chen et al. 2008; Goljan, Fridrich, Filler 2009): for a
questioned image with residual ``W`` and luminance ``I``, and a candidate
fingerprint ``K``, the presence of the fingerprint is tested by correlating
``W`` with ``I * K``.

* **NCC** - the normalised correlation coefficient at the tested alignment.
* **Signed PCE** - peak-to-correlation energy,
  ``sign(c_peak) * c_peak^2 / mean(c_s^2 for s outside N_peak)``, where ``c``
  is the circular cross-correlation surface and ``N_peak`` an 11x11
  neighbourhood of the peak. PCE normalises the peak by the empirical variance
  of the correlation at wrong alignments, which makes it far more stable across
  image sizes and content than the raw correlation.

Geometry
--------
PRNU is a pixel-exact pattern. Only these relations between the questioned
image and the fingerprint are tested:

``native``   same pixel dimensions; tested at zero shift (and 180 deg rotation).
``rotated``  transposed dimensions; tested at 90 and 270 deg rotation.
``cropped``  questioned image is smaller in both dimensions; an exhaustive
             search over all translations is performed, and the multiple-testing
             cost is reported as ``search_size``.

Anything else (resampled, digitally zoomed, larger than the fingerprint) is
reported as ``unsupported`` rather than guessed at.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy import fft as sfft
from scipy.stats import norm

from .fingerprint import Fingerprint
from .residual import Residual

FloatArray = NDArray[np.float32]

Geometry = Literal["native", "rotated", "cropped", "unsupported"]

#: Threads used by the FFT. -1 uses every core; set SENSORTRACE_FFT_WORKERS=1 when many
#: processes run in parallel (evaluation, multi-worker deployments) to avoid oversubscription.
FFT_WORKERS = int(os.environ.get("SENSORTRACE_FFT_WORKERS", "-1"))

PEAK_EXCLUSION = 11  # side of the square neighbourhood excluded around the peak
SURFACE_WINDOW = 33  # side of the correlation-surface window kept for visualisation


def _rfft(x: NDArray[np.floating]) -> NDArray[np.complexfloating]:
    """Real FFT in single precision. The statistic is a ratio of sums over millions of
    samples, so complex64 round-off (relative 1e-6) is far below the correlation noise floor."""
    return sfft.rfft2(np.ascontiguousarray(x, dtype=np.float32), workers=FFT_WORKERS)


def _xcorr_from_fft(fa: NDArray[np.complexfloating], b: NDArray[np.floating]) -> FloatArray:
    b0 = b.astype(np.float32) - np.float32(b.mean(dtype=np.float64))
    return np.asarray(sfft.irfft2(fa * np.conj(_rfft(b0)), s=b.shape, workers=FFT_WORKERS), dtype=np.float32)


def circular_xcorr(a: NDArray[np.floating], b: NDArray[np.floating]) -> FloatArray:
    """Circular cross-correlation ``r[s] = sum_x a[x + s] * b[x]`` (means removed).

    ``r[0, 0]`` is the zero-shift correlation (un-normalised).
    """
    if a.shape != b.shape:
        raise ValueError("arrays must have the same shape")
    a0 = a.astype(np.float32) - np.float32(a.mean(dtype=np.float64))
    return _xcorr_from_fft(_rfft(a0), b)


@dataclass(frozen=True)
class PceResult:
    pce: float
    peak_value: float
    peak: tuple[int, int]
    energy: float


def pce_at(
    surface: NDArray[np.floating],
    peak: tuple[int, int],
    *,
    energy_region: NDArray[np.bool_] | None = None,
    exclusion: int = PEAK_EXCLUSION,
) -> PceResult:
    """Signed PCE of ``surface`` for a given peak location.

    ``energy_region`` optionally restricts which shifts contribute to the
    correlation energy (used by the crop search to ignore wrapped shifts).
    """
    h, w = surface.shape
    r = exclusion // 2
    rows = np.arange(peak[0] - r, peak[0] + r + 1) % h
    cols = np.arange(peak[1] - r, peak[1] + r + 1) % w
    sq = np.square(surface, dtype=np.float64)
    if energy_region is None:
        total = float(sq.sum())
        count = h * w
        excl = float(sq[np.ix_(rows, cols)].sum())
        excl_n = rows.size * cols.size
    else:
        total = float(sq[energy_region].sum())
        count = int(energy_region.sum())
        sub = energy_region[np.ix_(rows, cols)]
        excl = float(sq[np.ix_(rows, cols)][sub].sum())
        excl_n = int(sub.sum())
    n = count - excl_n
    if n <= 0:
        return PceResult(0.0, float(surface[peak]), peak, 0.0)
    energy = (total - excl) / n
    value = float(surface[peak])
    if energy <= 0.0 or not np.isfinite(energy):
        return PceResult(0.0, value, peak, 0.0)
    return PceResult(float(np.sign(value) * value * value / energy), value, peak, float(energy))


def gaussian_tail(pce: float, search_size: int = 1) -> tuple[float, float]:
    """Idealised false-alarm figures for a signed PCE value.

    Under the textbook assumption that off-peak correlation values are i.i.d.
    zero-mean Gaussian, ``sqrt(PCE)`` is a standard normal deviate. Returns
    ``(p_single, p_search)``: the single-test tail probability and the
    probability that at least one of ``search_size`` independent tests exceeds
    it. **These are model-based reference figures, not measured error rates and
    not the probability that the image came from the sensor.** Real images
    violate the model (see ``SCIENTIFIC_METHODOLOGY.md``).
    """
    z = float(np.sign(pce) * np.sqrt(abs(pce)))
    p = float(norm.sf(z))
    n = max(int(search_size), 1)
    p_search = float(-np.expm1(n * np.log1p(-min(p, 1.0 - 1e-16))))
    return p, p_search


@dataclass
class ComparisonMeasurement:
    """Raw measurements from testing one image against one fingerprint."""

    geometry: Geometry
    pce: float | None = None
    ncc: float | None = None
    peak_value: float | None = None
    #: Offset (row, col) of the questioned image inside the fingerprint grid.
    shift: tuple[int, int] | None = None
    #: Rotation (degrees counter-clockwise, in stored pixel geometry) at which the best statistic was found.
    rotation: int | None = None
    #: Number of (rotation, shift) hypotheses examined.
    search_size: int = 0
    p_value_gaussian: float | None = None
    p_false_alarm_gaussian: float | None = None
    #: Number of pixels used in the statistic (not saturated, inside overlap).
    valid_pixels: int = 0
    valid_fraction: float = 0.0
    #: Largest PCE found anywhere on the surface in the native case (diagnostic only).
    offgrid_peak_pce: float | None = None
    offgrid_peak_shift: tuple[int, int] | None = None
    #: Per-rotation PCE values examined.
    tested: dict[str, float] = field(default_factory=dict)
    #: Window of the normalised correlation surface around the peak (for visualisation).
    surface_window: FloatArray | None = None
    notes: list[str] = field(default_factory=list)

    def to_dict(self, *, include_surface: bool = False) -> dict:
        d = {
            "geometry": self.geometry,
            "pce": self.pce,
            "ncc": self.ncc,
            "peak_value": self.peak_value,
            "shift": list(self.shift) if self.shift is not None else None,
            "rotation": self.rotation,
            "search_size": self.search_size,
            "p_value_gaussian": self.p_value_gaussian,
            "p_false_alarm_gaussian": self.p_false_alarm_gaussian,
            "valid_pixels": self.valid_pixels,
            "valid_fraction": self.valid_fraction,
            "offgrid_peak_pce": self.offgrid_peak_pce,
            "offgrid_peak_shift": list(self.offgrid_peak_shift) if self.offgrid_peak_shift else None,
            "tested": self.tested,
            "notes": self.notes,
        }
        if include_surface and self.surface_window is not None:
            d["surface_window"] = self.surface_window.tolist()
        return d


def _rot(res: Residual, k: int) -> tuple[FloatArray, FloatArray, NDArray[np.bool_]]:
    if k == 0:
        return res.w, res.intensity, res.saturated
    return np.rot90(res.w, k), np.rot90(res.intensity, k), np.rot90(res.saturated, k)


def _ncc(a: NDArray, b: NDArray, valid: NDArray[np.bool_]) -> float:
    n = int(valid.sum())
    if n < 2:
        return 0.0
    av = a[valid].astype(np.float64)
    bv = b[valid].astype(np.float64)
    av -= av.mean()
    bv -= bv.mean()
    denom = float(np.sqrt((av * av).sum() * (bv * bv).sum()))
    return float((av * bv).sum() / denom) if denom > 0 else 0.0


def _window(surface: NDArray[np.floating], peak: tuple[int, int], energy: float) -> FloatArray:
    h, w = surface.shape
    r = SURFACE_WINDOW // 2
    rows = np.arange(peak[0] - r, peak[0] + r + 1) % h
    cols = np.arange(peak[1] - r, peak[1] + r + 1) % w
    scale = np.sqrt(energy) if energy > 0 else 1.0
    return np.asarray(surface[np.ix_(rows, cols)] / scale, dtype=np.float32)


def _native(w: FloatArray, inten: FloatArray, sat: NDArray[np.bool_], k: FloatArray, cache: dict, key: int):
    valid = ~sat
    fa = cache.get(key)
    if fa is None:
        a = np.where(valid, w, np.float32(0.0))
        fa = cache[key] = _rfft(a - np.float32(a.mean(dtype=np.float64)))
    b = np.where(valid, inten * k, np.float32(0.0))
    surface = _xcorr_from_fft(fa, b)
    res = pce_at(surface, (0, 0))
    return surface, res, _ncc(w, inten * k, valid), valid


def _cropped(w: FloatArray, inten: FloatArray, sat: NDArray[np.bool_], k: FloatArray):
    """Exhaustive translation search for an image smaller than the fingerprint.

    The exact statistic ``sum_x W[x] I[x] K[x + s]`` is evaluated for every
    placement ``s`` with one FFT by correlating ``K`` with the zero-padded
    product ``W * I``.
    """
    fh, fw = k.shape
    h, wd = w.shape
    valid = ~sat
    prod = np.where(valid, w * inten, np.float32(0.0)).astype(np.float32)
    prod -= np.float32(prod.mean(dtype=np.float64))
    pad = np.zeros((fh, fw), dtype=np.float32)
    pad[:h, :wd] = prod
    k0 = k.astype(np.float32) - np.float32(k.mean(dtype=np.float64))
    surface = np.asarray(
        sfft.irfft2(_rfft(k0) * np.conj(_rfft(pad)), s=(fh, fw), workers=FFT_WORKERS), dtype=np.float32
    )
    region = np.zeros((fh, fw), dtype=bool)
    region[: fh - h + 1, : fw - wd + 1] = True
    n_shifts = int(region.sum())
    masked = np.where(region, surface, -np.inf)
    peak_flat = int(np.argmax(masked))
    peak = (peak_flat // fw, peak_flat % fw)
    # With few valid shifts the energy estimate from the valid region alone is
    # unreliable; fall back to the whole surface (wrapped shifts are still
    # mis-aligned and behave as noise).
    use_region = region if n_shifts >= 16 * PEAK_EXCLUSION * PEAK_EXCLUSION else None
    res = pce_at(surface, peak, energy_region=use_region)
    k_crop = k[peak[0] : peak[0] + h, peak[1] : peak[1] + wd]
    return surface, res, _ncc(w, inten * k_crop, valid), valid, n_shifts


def compare(residual: Residual, fingerprint: Fingerprint) -> ComparisonMeasurement:
    """Test one questioned-image residual against one fingerprint."""
    fh, fw = fingerprint.shape
    h, w = residual.shape
    k = fingerprint.k

    if (h, w) == (fh, fw):
        geometry: Geometry = "native"
        rotations = [0, 2] if h != w else [0, 1, 2, 3]
        mode = "native"
    elif (w, h) == (fh, fw):
        geometry = "rotated"
        rotations = [1, 3]
        mode = "native"
    else:
        fits = h <= fh and w <= fw
        fits_t = w <= fh and h <= fw
        if not (fits or fits_t):
            return ComparisonMeasurement(
                geometry="unsupported",
                notes=[
                    f"Questioned image is {w}x{h} px; fingerprint is {fw}x{fh} px. The image is "
                    "larger than the fingerprint in at least one dimension, so it cannot be a "
                    "crop of this sensor output at this resolution. It may have been resampled, "
                    "or come from a different sensor or capture mode. No test was performed."
                ],
            )
        geometry = "cropped"
        rotations = ([0, 2] if fits else []) + ([1, 3] if fits_t else [])
        mode = "cropped"

    best: ComparisonMeasurement | None = None
    best_valid = False
    tested: dict[str, float] = {}
    search = 0
    for rot in rotations:
        wr, ir, sr = _rot(residual, rot)
        if mode == "native":
            surface, res, ncc, valid = _native(wr, ir, sr, k, residual.fft_cache, rot)
            search += 1
        else:
            surface, res, ncc, valid, n_shifts = _cropped(wr, ir, sr, k)
            search += n_shifts
        tested[f"rot{rot * 90}"] = res.pce
        if best is None or res.pce > (best.pce if best.pce is not None else -np.inf):
            m = ComparisonMeasurement(
                geometry=geometry,
                pce=res.pce,
                ncc=ncc,
                peak_value=res.peak_value,
                shift=res.peak if mode == "cropped" else (0, 0),
                rotation=rot * 90,
                valid_pixels=int(valid.sum()),
                valid_fraction=float(valid.mean()),
                surface_window=_window(surface, res.peak, res.energy),
            )
            if mode == "native":
                flat = int(np.argmax(surface))
                gp = (flat // surface.shape[1], flat % surface.shape[1])
                if gp != (0, 0):
                    g = pce_at(surface, gp)
                    m.offgrid_peak_pce = g.pce
                    sr_, sc_ = gp
                    if sr_ > surface.shape[0] // 2:
                        sr_ -= surface.shape[0]
                    if sc_ > surface.shape[1] // 2:
                        sc_ -= surface.shape[1]
                    m.offgrid_peak_shift = (sr_, sc_)
            best = m
            # pce_at returns 0.0 when the correlation energy is zero or not finite. That is
            # "no statistic", not "a statistic of zero", and must not be scored as a low value.
            best_valid = bool(np.isfinite(res.peak_value) and np.isfinite(res.energy) and res.energy > 0.0)

    assert best is not None and best.pce is not None
    if not best_valid:
        return ComparisonMeasurement(
            geometry="unsupported",
            tested=tested,
            search_size=search,
            valid_pixels=best.valid_pixels,
            valid_fraction=best.valid_fraction,
            notes=[
                "The correlation between the image residual and the fingerprint has no measurable "
                "energy or is not finite (for example a residual that is identically zero, or a "
                "fingerprint containing invalid values). No statistic could be computed."
            ],
        )
    best.tested = tested
    best.search_size = search
    best.p_value_gaussian, best.p_false_alarm_gaussian = gaussian_tail(best.pce, search)
    if geometry == "rotated" or (geometry == "native" and best.rotation not in (0, None)):
        best.notes.append(
            f"Best statistic found after rotating the stored image by {best.rotation} degrees "
            "counter-clockwise to align it with the fingerprint's pixel grid."
        )
    if geometry == "cropped":
        best.notes.append(
            f"Image is smaller than the fingerprint; {search:,} placements were searched. "
            "A larger search raises the chance of a spuriously high peak, which the "
            "search-adjusted figure accounts for under an idealised model only."
        )
    return best
