from __future__ import annotations

import numpy as np
import pytest

from sensortrace_engine.denoise import wavelet_noise_residual
from sensortrace_engine.errors import ImageTooSmallError
from sensortrace_engine.residual import (
    extract_residual,
    intensity_weight,
    saturation_mask,
    to_gray,
    wiener_dft,
    zero_mean_total,
)


def test_residual_of_constant_image_is_zero():
    w = wavelet_noise_residual(np.full((128, 160), 120.0, dtype=np.float32))
    assert np.abs(w).max() < 1e-3


def test_residual_ignores_smooth_content_and_keeps_noise():
    rng = np.random.default_rng(0)
    yy, xx = np.mgrid[0:256, 0:256].astype(np.float32)
    smooth = 100 + 60 * np.sin(xx / 40) * np.cos(yy / 55)
    noise = rng.standard_normal(smooth.shape).astype(np.float32) * 2.0
    w_clean = wavelet_noise_residual(smooth)
    w_noisy = wavelet_noise_residual(smooth + noise)
    # Coefficients below the assumed noise level pass into the residual by design, so a
    # smooth image leaves a small non-zero residual; it must be far below the injected noise.
    assert w_clean.std() < 0.1 * noise.std()
    # Most of the injected white noise is recovered in the residual.
    corr = np.corrcoef(w_noisy.ravel(), noise.ravel())[0, 1]
    assert corr > 0.9


def test_residual_attenuates_strong_edges():
    img = np.full((128, 128), 60.0, dtype=np.float32)
    img[:, 64:] = 200.0
    w = wavelet_noise_residual(img)
    # A 140-level step must not pass into the residual at anything like full strength.
    assert np.abs(w).max() < 14.0


@pytest.mark.parametrize("shape", [(97, 131), (128, 128), (65, 200)])
def test_residual_preserves_shape_for_any_size(shape):
    rng = np.random.default_rng(1)
    w = wavelet_noise_residual(rng.uniform(0, 255, shape).astype(np.float32))
    assert w.shape == shape and w.dtype == np.float32 and np.isfinite(w).all()


def test_residual_is_deterministic():
    rng = np.random.default_rng(2)
    x = rng.uniform(0, 255, (96, 96)).astype(np.float32)
    assert np.array_equal(wavelet_noise_residual(x), wavelet_noise_residual(x.copy()))


def test_too_small_image_rejected():
    with pytest.raises(ImageTooSmallError):
        wavelet_noise_residual(np.zeros((32, 200), dtype=np.float32))


def test_zero_mean_total_removes_row_and_column_means_per_cfa_phase():
    rng = np.random.default_rng(3)
    x = rng.standard_normal((64, 80)).astype(np.float32)
    x += np.linspace(0, 5, 80, dtype=np.float32)[None, :]  # column trend
    x[0::2, 1::2] += 3.0  # CFA-phase offset
    z = zero_mean_total(x)
    for di in (0, 1):
        for dj in (0, 1):
            sub = z[di::2, dj::2]
            assert np.abs(sub.mean(axis=0)).max() < 1e-4
            assert np.abs(sub.mean(axis=1)).max() < 1e-4


def test_wiener_dft_suppresses_periodic_pattern():
    rng = np.random.default_rng(4)
    noise = rng.standard_normal((256, 256)).astype(np.float32)
    grid = np.zeros_like(noise)
    grid[::8, :] = 1.5
    grid[:, ::8] = 1.5
    grid -= grid.mean()
    filtered = wiener_dft(noise + grid)

    def grid_corr(a):
        return abs(float(np.corrcoef(a.ravel(), grid.ravel())[0, 1]))

    assert grid_corr(noise + grid) > 0.3
    assert grid_corr(filtered) < 0.25 * grid_corr(noise + grid)
    # ... while the white-noise component is largely preserved.
    assert np.corrcoef(filtered.ravel(), noise.ravel())[0, 1] > 0.8


def test_saturation_mask_flags_plateaus_not_isolated_pixels():
    x = np.full((20, 20), 100.0, dtype=np.float32)
    x[2:6, 2:6] = 255.0
    x[10, 10] = 255.0
    m = saturation_mask(x)
    assert m[3, 3] and not m[10, 10] and m.sum() == 16


def test_intensity_weight_shape():
    v = intensity_weight(np.array([[0.0, 126.0, 252.0, 255.0]], dtype=np.float32))[0]
    assert v[0] == 0 and abs(v[1] - 0.5) < 1e-6 and abs(v[2] - 1.0) < 1e-6 and v[3] < 0.25


def test_to_gray_weights():
    rgb = np.zeros((2, 2, 3), dtype=np.float32)
    rgb[..., 1] = 100
    assert np.allclose(to_gray(rgb), 58.7)


def test_extract_residual_handles_grayscale_and_uint16(sensor_a):
    img = sensor_a.capture(5)
    g = extract_residual(img[..., 1])
    assert g.w.shape == img.shape[:2]
    r16 = extract_residual(img.astype(np.uint16) * 257)
    r8 = extract_residual(img)
    assert np.allclose(r16.w, r8.w, atol=1e-3)
