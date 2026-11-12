"""Noise residual extraction and suppression of non-unique artefacts.

Pipeline for a single image (Chen, Fridrich, Goljan, Lukas, IEEE TIFS 2008):

1. Per-channel wavelet residual ``W_c = I_c - F(I_c)`` (:mod:`denoise`).
2. Channels combined to a single luminance-weighted residual.
3. *Zero-meaning*: the mean of every row and every column is removed,
   separately on each of the four 2x2 colour-filter-array phases. This
   suppresses linear patterns and CFA-interpolation periodicities, which are
   shared by cameras of the same model and are therefore *non-unique*.
4. *Wiener filtering in the DFT domain*: the magnitude spectrum is flattened
   with the same adaptive Wiener rule, suppressing periodic peaks (JPEG 8x8
   blocking, residual demosaicing structure).

Saturated pixels carry no PRNU (the photo-response is clipped). They are
detected and returned as a mask so estimators and detectors can exclude them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray

from .denoise import adaptive_wiener_noise, wavelet_noise_residual
from .errors import NumericalError

FloatArray = NDArray[np.float32]
BoolArray = NDArray[np.bool_]

#: ITU-R BT.601 luma weights, the convention used throughout the PRNU literature.
LUMA_WEIGHTS = np.array([0.299, 0.587, 0.114], dtype=np.float32)

SATURATION_LEVEL = 250.0


def to_gray(rgb: NDArray[np.floating]) -> FloatArray:
    """Luminance-weighted combination of an ``(H, W, 3)`` array; 2-D arrays pass through."""
    if rgb.ndim == 2:
        return np.asarray(rgb, dtype=np.float32)
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError("expected (H, W) or (H, W, 3) array")
    return np.asarray(rgb.astype(np.float32, copy=False) @ LUMA_WEIGHTS, dtype=np.float32)


def saturation_mask(channel: NDArray[np.floating]) -> BoolArray:
    """True where a pixel is saturated.

    A pixel is considered saturated when its value is at or above
    ``SATURATION_LEVEL`` *and* equal to at least one of its four neighbours
    (a clipped plateau). Isolated bright pixels are not flagged.
    """
    x = np.asarray(channel)
    bright = x >= SATURATION_LEVEL
    if not bright.any():
        return np.zeros(x.shape, dtype=bool)
    eq = np.zeros(x.shape, dtype=bool)
    eq[:, 1:] |= x[:, 1:] == x[:, :-1]
    eq[:, :-1] |= x[:, :-1] == x[:, 1:]
    eq[1:, :] |= x[1:, :] == x[:-1, :]
    eq[:-1, :] |= x[:-1, :] == x[1:, :]
    return bright & eq


def intensity_weight(channel: NDArray[np.floating]) -> FloatArray:
    """Attenuated intensity used in the fingerprint estimator.

    Below ``T = 252`` the intensity is used as-is (scaled to 0..1); above it
    the weight decays as ``exp(-(I - T)^2 / v)`` with ``v = 6`` because values
    near clipping carry progressively less PRNU. (Chen et al. 2008 reference
    implementation convention.)
    """
    x = np.asarray(channel, dtype=np.float32)
    t, v = 252.0, 6.0
    out = np.exp(-((x - t) ** 2) / v, dtype=np.float32)
    below = x < t
    out[below] = x[below] / t
    return out


def _zero_mean(a: NDArray[np.floating]) -> NDArray[np.floating]:
    a = a - a.mean()
    a = a - a.mean(axis=1, keepdims=True)
    a = a - a.mean(axis=0, keepdims=True)
    return a


def zero_mean_total(x: NDArray[np.floating]) -> FloatArray:
    """Remove row and column means on each of the four 2x2 CFA phases."""
    out = np.empty(x.shape, dtype=np.float32)
    if x.ndim == 3:
        for c in range(x.shape[2]):
            out[..., c] = zero_mean_total(x[..., c])
        return out
    for di in (0, 1):
        for dj in (0, 1):
            out[di::2, dj::2] = _zero_mean(x[di::2, dj::2].astype(np.float64))
    return out


def wiener_dft(x: NDArray[np.floating], sigma: float | None = None) -> FloatArray:
    """Flatten the magnitude spectrum to suppress periodic (non-unique) artefacts.

    ``sigma`` defaults to the standard deviation of ``x``.
    """
    if x.ndim != 2:
        raise ValueError("wiener_dft expects a 2-D array")
    s = float(np.std(x)) if sigma is None else float(sigma)
    if s <= 0.0 or not np.isfinite(s):
        return np.zeros(x.shape, dtype=np.float32)
    h, w = x.shape
    f = np.fft.fft2(x.astype(np.float64))
    mag = np.abs(f) / np.sqrt(h * w)
    mag_noise = adaptive_wiener_noise(mag, s * s)
    zero = mag == 0
    mag[zero] = 1.0
    mag_noise[zero] = 0.0
    out = np.real(np.fft.ifft2(f * (mag_noise / mag)))
    return np.asarray(out, dtype=np.float32)


@dataclass(frozen=True)
class Residual:
    """Noise residual of one image, in the image's stored pixel geometry."""

    #: Post-processed single-channel residual, shape (H, W).
    w: FloatArray
    #: Luminance of the image on the 0..255 scale, shape (H, W).
    intensity: FloatArray
    #: True where any channel is saturated.
    saturated: BoolArray
    sigma0: float
    #: Per-rotation FFT of the masked residual, reused when comparing with several fingerprints.
    fft_cache: dict[int, Any] = field(default_factory=dict, repr=False, compare=False)

    @property
    def shape(self) -> tuple[int, int]:
        return (int(self.w.shape[0]), int(self.w.shape[1]))

    @property
    def saturated_fraction(self) -> float:
        return float(self.saturated.mean())


def as_float_image(pixels: NDArray) -> FloatArray:
    """Convert decoded pixels to float32 on the 0..255 scale, shape (H, W) or (H, W, 3)."""
    a = np.asarray(pixels)
    if a.ndim not in (2, 3) or (a.ndim == 3 and a.shape[2] != 3):
        raise ValueError("expected (H, W) or (H, W, 3) pixels")
    if a.dtype == np.uint8:
        return a.astype(np.float32)
    if a.dtype == np.uint16:
        return (a.astype(np.float32)) * np.float32(255.0 / 65535.0)
    if np.issubdtype(a.dtype, np.floating):
        return a.astype(np.float32, copy=False)
    raise ValueError(f"unsupported pixel dtype {a.dtype}")


def channel_residuals(image: FloatArray, sigma0: float) -> FloatArray:
    """Raw per-channel wavelet residuals, same shape as ``image``."""
    if image.ndim == 2:
        return wavelet_noise_residual(image, sigma0)
    out = np.empty(image.shape, dtype=np.float32)
    for c in range(3):
        out[..., c] = wavelet_noise_residual(image[..., c], sigma0)
    return out


def extract_residual(pixels: NDArray, sigma0: float = 3.0) -> Residual:
    """Full residual pipeline for a questioned (test) image."""
    image = as_float_image(pixels)
    raw = channel_residuals(image, sigma0)
    gray_w = to_gray(raw)
    gray_w = zero_mean_total(gray_w)
    gray_w = wiener_dft(gray_w)
    if image.ndim == 3:
        sat = np.zeros(image.shape[:2], dtype=bool)
        for c in range(3):
            sat |= saturation_mask(image[..., c])
    else:
        sat = saturation_mask(image)
    if not np.all(np.isfinite(gray_w)):
        raise NumericalError("non-finite values in post-processed residual")
    return Residual(w=gray_w, intensity=to_gray(image), saturated=sat, sigma0=float(sigma0))
