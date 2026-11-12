"""Wavelet-domain denoising filter used to obtain the sensor noise residual.

Method
------
The filter is the spatially adaptive wavelet-domain Wiener filter of
Mihcak, Kozintsev and Ramchandran (ICASSP 1999) in the form used for PRNU work
by Lukas, Fridrich and Goljan (IEEE TIFS 2006, Appendix A):

1. Four-level separable orthogonal wavelet decomposition with the 8-tap
   Daubechies filter (``db4`` in PyWavelets naming).
2. In each detail sub-band (H, V, D at each level) the local variance of the
   noise-free coefficient is estimated by a MAP estimate for four square
   window sizes ``w in {3, 5, 7, 9}``::

       var_w(i,j) = max(0, mean_{w x w}(c^2)(i,j) - sigma0^2)

   and the minimum over the four windows is kept.
3. The denoised coefficient is the Wiener estimate
   ``c_den = c * var / (var + sigma0^2)``. Equivalently the *noise* part is
   ``c_noise = c * sigma0^2 / (var + sigma0^2)``.
4. The noise residual ``W = I - F(I)`` is obtained directly by inverting the
   transform of the noise parts with the approximation band set to zero.

This module is an independent implementation written from the published
description. It contains no third-party source code.

Boundary handling (an implementation choice, documented in
``SCIENTIFIC_METHODOLOGY.md``): the image is extended by symmetric reflection
to a multiple of ``2**levels`` plus a guard band before a periodised
transform, and cropped afterwards, so no wrap-around artefacts reach the
returned residual.
"""

from __future__ import annotations

import numpy as np
import pywt
from numpy.typing import NDArray
from scipy.ndimage import uniform_filter

from .errors import ImageTooSmallError, NumericalError

FloatArray = NDArray[np.float32]

WAVELET = "db4"  # 8-tap Daubechies
DEFAULT_LEVELS = 4
WINDOW_SIZES: tuple[int, ...] = (3, 5, 7, 9)
MIN_SIDE = 64


def _padding(n: int, block: int, guard: int) -> tuple[int, int]:
    total = int(np.ceil((n + 2 * guard) / block) * block)
    extra = total - n
    before = extra // 2
    return before, extra - before


def adaptive_wiener_noise(
    coeff: NDArray[np.floating], noise_var: float
) -> NDArray[np.floating]:
    """Return the noise component of a coefficient array.

    Implements steps 2-3 of the module docstring. Works on any real array
    (wavelet sub-band, or DFT magnitudes in :func:`residual.wiener_dft`).
    """
    sq = coeff * coeff
    est = None
    for w in WINDOW_SIZES:
        local = uniform_filter(sq, size=w, mode="nearest")
        local = np.maximum(local - noise_var, 0.0)
        est = local if est is None else np.minimum(est, local)
    assert est is not None
    return coeff * (noise_var / (est + noise_var))


def wavelet_noise_residual(
    channel: NDArray[np.floating],
    sigma0: float = 3.0,
    levels: int = DEFAULT_LEVELS,
) -> FloatArray:
    """Extract the noise residual ``W = I - F(I)`` of a single image channel.

    Parameters
    ----------
    channel:
        2-D array of intensities on the 0..255 scale (any float dtype).
    sigma0:
        Assumed standard deviation of the stationary noise component on the
        0..255 scale. The literature uses values between 2 and 5.
    levels:
        Number of wavelet decomposition levels.
    """
    if channel.ndim != 2:
        raise ValueError("channel must be a 2-D array")
    if sigma0 <= 0:
        raise ValueError("sigma0 must be positive")
    h, w = channel.shape
    if min(h, w) < MIN_SIDE:
        raise ImageTooSmallError(
            f"image side {min(h, w)} px is below the minimum of {MIN_SIDE} px"
        )

    block = 2**levels
    guard = block  # reflect at least one coarsest-level block on each side
    (top, bottom), (left, right) = _padding(h, block, guard), _padding(w, block, guard)
    x = np.pad(
        np.asarray(channel, dtype=np.float32),
        ((top, bottom), (left, right)),
        mode="symmetric",
    )

    coeffs = pywt.wavedec2(x, WAVELET, mode="periodization", level=levels)
    noise_var = float(sigma0) ** 2
    out: list = [np.zeros_like(coeffs[0])]
    for detail in coeffs[1:]:
        out.append(tuple(adaptive_wiener_noise(band, noise_var) for band in detail))
    rec = pywt.waverec2(out, WAVELET, mode="periodization")
    residual = np.asarray(rec[top : top + h, left : left + w], dtype=np.float32)
    if not np.all(np.isfinite(residual)):
        raise NumericalError("non-finite values in noise residual")
    return residual
