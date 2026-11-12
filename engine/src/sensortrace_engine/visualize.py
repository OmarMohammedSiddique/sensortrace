"""Visualisations of residuals, fingerprints and correlation surfaces.

Every image produced here is a **contrast-enhanced rendering for human
inspection**. The numerical arrays used for matching are float32 data with a
dynamic range far below what a display can show; renderings are stretched,
possibly down-sampled, and must never be used as analysis input.
"""

from __future__ import annotations

import io
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image

VISUALISATION_NOTICE = (
    "Contrast-enhanced visualisation. Values are stretched to +/-3 standard deviations and the "
    "image may be down-sampled; it is not the numerical data used for matching."
)


def _png(a: NDArray[np.uint8]) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(a).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def render_noise(pattern: NDArray[np.floating], *, max_side: int = 1024, clip_sigma: float = 3.0) -> bytes:
    """Grey PNG of a residual or fingerprint, stretched to ``+/-clip_sigma`` std."""
    a = np.asarray(pattern, dtype=np.float32)
    h, w = a.shape
    scale = max_side / max(h, w)
    if scale < 1.0:
        # Central crop at native scale preserves the pattern's fine structure;
        # down-sampling would average it away.
        ch, cw = min(h, max_side), min(w, max_side)
        top, left = (h - ch) // 2, (w - cw) // 2
        a = a[top : top + ch, left : left + cw]
    s = float(a.std())
    if s <= 0:
        return _png(np.full(a.shape, 128, dtype=np.uint8))
    v = np.clip((a - float(a.mean())) / (clip_sigma * s), -1, 1)
    return _png(np.rint((v + 1) * 127.5).astype(np.uint8))


def render_spectrum(pattern: NDArray[np.floating], *, max_side: int = 512) -> bytes:
    """Log-magnitude DFT spectrum (centred) as a grey PNG; periodic artefacts show as peaks."""
    a = np.asarray(pattern, dtype=np.float32)
    h, w = a.shape
    side = min(h, w, 1024)
    side -= side % 2
    top, left = (h - side) // 2, (w - side) // 2
    crop = a[top : top + side, left : left + side]
    win = np.outer(np.hanning(side), np.hanning(side)).astype(np.float32)
    mag = np.abs(np.fft.fftshift(np.fft.fft2((crop - crop.mean()) * win)))
    logm = np.log1p(mag)
    lo, hi = np.percentile(logm, [5, 99.9])
    v = np.clip((logm - lo) / max(hi - lo, 1e-9), 0, 1)
    img = np.rint(v * 255).astype(np.uint8)
    if side > max_side:
        img = cv2.resize(img, (max_side, max_side), interpolation=cv2.INTER_AREA)
    return _png(img)


def spectrum_diagnostics(pattern: NDArray[np.floating]) -> dict[str, Any]:
    """Frequency-domain diagnostics: peakiness of the spectrum and JPEG-grid energy.

    ``peak_to_median`` is the ratio of the largest magnitude (excluding DC) to
    the median magnitude: a flat (white) spectrum gives small values, strong
    periodic artefacts give large ones. ``block8_ratio`` compares energy at the
    8-pixel JPEG block frequencies with the spectrum median.
    """
    a = np.asarray(pattern, dtype=np.float64)
    h, w = a.shape
    hh, ww = h - h % 8, w - w % 8
    a = a[:hh, :ww]
    mag = np.abs(np.fft.fft2(a - a.mean()))
    mag[0, 0] = 0.0
    med = float(np.median(mag))
    if med <= 0:
        return {"peak_to_median": 0.0, "block8_ratio": 0.0}
    rows = [k * hh // 8 for k in range(1, 8)]
    cols = [k * ww // 8 for k in range(1, 8)]
    block = [mag[r, 0] for r in rows] + [mag[0, c] for c in cols] + [mag[r, c] for r in rows for c in cols]
    return {
        "peak_to_median": float(mag.max() / med),
        "block8_ratio": float(np.mean(block) / med),
    }


def surface_stats(window: NDArray[np.floating]) -> dict[str, Any]:
    """Summary of the correlation-surface window (in units of off-peak standard deviation)."""
    a = np.asarray(window, dtype=np.float64)
    c = a.shape[0] // 2
    return {
        "side": int(a.shape[0]),
        "center_value": float(a[c, c]),
        "max_value": float(a.max()),
        "min_value": float(a.min()),
    }
