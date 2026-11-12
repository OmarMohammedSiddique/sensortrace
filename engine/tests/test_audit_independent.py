"""Independent audit checks (see ``audit/SCIENTIFIC_AUDIT.md``).

Every expected value in this file is produced by code written for the audit from the published
definitions (explicit loops, closed forms, or a second library), never by calling the function
under test a second time. Tests marked ``xfail(strict=True)`` document a confirmed defect that was
reported but deliberately not fixed; the reason states which finding.
"""

from __future__ import annotations

import io
import math
from pathlib import Path

import numpy as np
import pytest
import pywt
from PIL import Image
from scipy.ndimage import uniform_filter
from scipy.stats import binomtest, norm

from sensortrace_engine import evaluation as ev
from sensortrace_engine import stats
from sensortrace_engine.decision import LITERATURE_DEFAULT_POLICY, Verdict, decide, effective_pce
from sensortrace_engine.denoise import adaptive_wiener_noise, wavelet_noise_residual
from sensortrace_engine.enrol import ReferenceInput, enrol
from sensortrace_engine.errors import NumericalError
from sensortrace_engine.fingerprint import Fingerprint, FingerprintAccumulator, estimate_fingerprint
from sensortrace_engine.ingest import ingest_image
from sensortrace_engine.matching import ComparisonMeasurement, circular_xcorr, compare, pce_at
from sensortrace_engine.pipeline import Candidate, analyse_questioned
from sensortrace_engine.quality import QualityReport
from sensortrace_engine.residual import (
    Residual,
    as_float_image,
    channel_residuals,
    intensity_weight,
    saturation_mask,
    to_gray,
    wiener_dft,
    zero_mean_total,
)
from sensortrace_engine.synthetic import SyntheticSensor, encode_png, jpeg_roundtrip

GOOD_FP = {"n_images": 30, "split_half": {"pce": 5000.0}}
CLEAN = QualityReport(metrics={})


def _res(w, intensity=None, saturated=None) -> Residual:
    w = np.asarray(w, dtype=np.float32)
    intensity = np.ones_like(w) if intensity is None else np.asarray(intensity, dtype=np.float32)
    saturated = np.zeros(w.shape, dtype=bool) if saturated is None else saturated
    return Residual(w=w, intensity=intensity, saturated=saturated, sigma0=3.0)


def _fp(k, n_images: int = 30) -> Fingerprint:
    return Fingerprint(k=np.asarray(k, dtype=np.float32), n_images=n_images, sigma0=3.0, color=True)


def _meas(pce, *, geometry="native", search=1, valid=1_000_000, tested=None) -> ComparisonMeasurement:
    return ComparisonMeasurement(
        geometry=geometry,
        pce=pce,
        ncc=0.0,
        search_size=search,
        valid_pixels=valid,
        valid_fraction=1.0,
        tested=tested or {},
    )


# --------------------------------------------------------------------------- ingestion


def _save(im: Image.Image, fmt: str, **kw) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format=fmt, **kw)
    return buf.getvalue()


@pytest.fixture(scope="module")
def asym_rgb() -> np.ndarray:
    """Random image whose red and blue channels differ strongly, so a BGR/RGB swap cannot hide."""
    rng = np.random.default_rng(0)
    a = rng.integers(0, 120, (96, 128, 3), dtype=np.uint8)
    a[..., 0] += 100
    return a


def test_png_path_returns_rgb_order_for_every_colour_type(asym_rgb):
    """The PNG path decodes with OpenCV (BGR). Expected values come from the source array / Pillow."""
    assert np.array_equal(ingest_image(_save(Image.fromarray(asym_rgb), "PNG")).pixels, asym_rgb)

    rgba = np.dstack([asym_rgb, np.random.default_rng(1).integers(0, 256, asym_rgb.shape[:2], dtype=np.uint8)])
    out = ingest_image(_save(Image.fromarray(rgba, "RGBA"), "PNG"))
    assert np.array_equal(out.pixels, asym_rgb) and any("Alpha" in n for n in out.decode_notes)

    pal = Image.fromarray(asym_rgb).quantize(64)
    out = ingest_image(_save(pal, "PNG"))
    assert np.array_equal(out.pixels, np.asarray(pal.convert("RGB")))
    out = ingest_image(_save(pal, "PNG", transparency=0))
    assert np.array_equal(out.pixels, np.asarray(pal.convert("RGB")))

    import cv2

    rgb16 = asym_rgb.astype(np.uint16) * 257 + 5
    ok, buf = cv2.imencode(".png", rgb16[..., ::-1])
    out = ingest_image(buf.tobytes())
    assert ok and out.bit_depth == 16 and np.array_equal(out.pixels, rgb16)
    # 16-bit samples are scaled, not truncated: 65535 -> 255.0
    assert as_float_image(np.array([[0, 65535]], dtype=np.uint16)).tolist() == [[0.0, 255.0]]


def test_png_grey_alpha_bit_depths_and_animation(asym_rgb):
    grey = np.asarray(Image.fromarray(asym_rgb).convert("L"))
    out = ingest_image(_save(Image.fromarray(asym_rgb).convert("LA"), "PNG"))
    # OpenCV expands grey+alpha to three identical channels; the luminance is unchanged.
    assert out.pixels.shape[:2] == grey.shape and np.array_equal(to_gray(as_float_image(out.pixels)).round(), grey)
    one = Image.fromarray(asym_rgb).convert("1")
    assert np.array_equal(ingest_image(_save(one, "PNG")).pixels, np.asarray(one.convert("L")))
    g16 = grey.astype(np.uint16) * 257 + 3
    assert np.array_equal(ingest_image(_save(Image.fromarray(g16), "PNG")).pixels, g16)
    apng = _save(Image.fromarray(asym_rgb), "PNG", save_all=True, append_images=[Image.fromarray(255 - asym_rgb)])
    out = ingest_image(apng)
    assert np.array_equal(out.pixels, asym_rgb) and any("multiple frames" in n for n in out.decode_notes)


def test_orientation_tags_and_colour_profiles_never_change_pixels(asym_rgb):
    plain = ingest_image(_save(Image.fromarray(asym_rgb), "PNG")).pixels
    exif = Image.Exif()
    exif[0x0112] = 6
    out = ingest_image(_save(Image.fromarray(asym_rgb), "PNG", exif=exif))
    assert out.exif_orientation == 6 and np.array_equal(out.pixels, plain)

    from PIL import ImageCms

    icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    assert np.array_equal(ingest_image(_save(Image.fromarray(asym_rgb), "PNG", icc_profile=icc)).pixels, plain)

    smooth = Image.fromarray(asym_rgb).resize((128, 96), Image.BICUBIC)
    base = _save(smooth, "JPEG", quality=95)
    ref = np.asarray(Image.open(io.BytesIO(base)).convert("RGB"))
    exif[0x0112] = 8
    for data in (
        _save(smooth, "JPEG", quality=95, exif=exif),
        _save(smooth, "JPEG", quality=95, icc_profile=icc),
        base + b"\x00" * 512,  # trailing bytes after EOI
    ):
        got = ingest_image(data)
        assert np.array_equal(got.pixels, ref)
    prog = _save(smooth, "JPEG", quality=95, progressive=True)
    assert ingest_image(prog).metadata["JpegProgressive"] is True
    cmyk = ingest_image(_save(smooth.convert("CMYK"), "JPEG", quality=95))
    assert cmyk.pixels.shape == ref.shape and any("CMYK" in n for n in cmyk.decode_notes)


# --------------------------------------------------------------------------- denoising


def _brute_shrink(c: np.ndarray, noise_var: float) -> np.ndarray:
    """Lukas et al. 2006, Appendix A, steps 2-3, written as explicit loops (edge replication)."""
    h, w = c.shape
    out = np.empty((h, w))
    for i in range(h):
        for j in range(w):
            best = math.inf
            for win in (3, 5, 7, 9):
                r = win // 2
                acc = 0.0
                for di in range(-r, r + 1):
                    for dj in range(-r, r + 1):
                        acc += c[min(max(i + di, 0), h - 1), min(max(j + dj, 0), w - 1)] ** 2
                best = min(best, max(0.0, acc / win**2 - noise_var))
            # noise part = coefficient minus the Wiener estimate c * var / (var + sigma0^2)
            out[i, j] = c[i, j] - c[i, j] * best / (best + noise_var)
    return out


def test_shrinkage_rule_matches_appendix_a_by_brute_force():
    c = np.random.default_rng(0).standard_normal((13, 17)) * 4
    assert np.allclose(adaptive_wiener_noise(c, 9.0), _brute_shrink(c, 9.0), atol=1e-12)


def _reference_denoised(x: np.ndarray, sigma0: float) -> np.ndarray:
    """F(I) built directly: keep the approximation band, Wiener-shrink the detail bands."""
    h, w = x.shape

    def pad(n: int) -> tuple[int, int]:
        total = math.ceil((n + 32) / 16) * 16
        return (total - n) // 2, (total - n) - (total - n) // 2

    (top, bottom), (left, right) = pad(h), pad(w)
    xp = np.pad(x.astype(np.float64), ((top, bottom), (left, right)), mode="symmetric")
    assert xp.shape[0] % 16 == 0 and xp.shape[1] % 16 == 0
    coeffs = pywt.wavedec2(xp, "db4", mode="periodization", level=4)
    assert len(pywt.Wavelet("db4").dec_lo) == 8 and len(coeffs) == 5
    den = [coeffs[0]]
    for detail in coeffs[1:]:
        den.append(tuple(band - _fast_noise(band, sigma0**2) for band in detail))
    return pywt.waverec2(den, "db4", mode="periodization")[top : top + h, left : left + w]


def _fast_noise(c: np.ndarray, nv: float) -> np.ndarray:
    est = np.min([np.maximum(uniform_filter(c * c, s, mode="nearest") - nv, 0) for s in (3, 5, 7, 9)], axis=0)
    return c * nv / (est + nv)


@pytest.mark.parametrize("shape", [(64, 64), (97, 131), (65, 200), (255, 257)])
def test_residual_equals_image_minus_independently_denoised_image(shape):
    x = np.random.default_rng(1).uniform(0, 255, shape).astype(np.float32)
    w = wavelet_noise_residual(x, 3.0)
    assert np.abs(w - (x.astype(np.float64) - _reference_denoised(x, 3.0))).max() < 2e-4


def test_residual_is_not_shifted_for_any_size_parity():
    """An isolated bright pixel must appear in the residual at exactly the same coordinates."""
    rng = np.random.default_rng(2)
    for _ in range(40):
        h, w = (int(v) for v in rng.integers(64, 180, 2))
        y, x = int(rng.integers(8, h - 8)), int(rng.integers(8, w - 8))
        img = np.full((h, w), 100.0, dtype=np.float32)
        img[y, x] += 6.0
        res = wavelet_noise_residual(img)
        assert np.unravel_index(int(np.argmax(res)), res.shape) == (y, x)


def test_residual_scale_equivariance_and_non_finite_inputs():
    x = np.random.default_rng(3).uniform(0, 255, (96, 96)).astype(np.float32)
    a = wavelet_noise_residual(x, 3.0)
    b = wavelet_noise_residual(x * 1000.0, 3000.0) / 1000.0
    assert np.abs(a - b).max() < 1e-4 * np.abs(a).max()
    bad = x.copy()
    bad[5, 5] = np.nan
    with pytest.raises(NumericalError):
        wavelet_noise_residual(bad)
    with pytest.raises(NumericalError):
        wavelet_noise_residual(x * np.float32(1e30))


# --------------------------------------------------------------------------- post-processing


@pytest.mark.parametrize("shape", [(64, 80), (65, 81), (63, 80)])
def test_zero_mean_per_cfa_phase_on_even_and_odd_sizes(shape):
    x = np.random.default_rng(4).standard_normal(shape)
    z = zero_mean_total(x)
    for di in (0, 1):
        for dj in (0, 1):
            sub = z[di::2, dj::2]
            assert abs(sub.mean(axis=0)).max() < 1e-6 and abs(sub.mean(axis=1)).max() < 1e-6
    assert np.abs(zero_mean_total(z) - z).max() < 1e-6  # idempotent


def test_zero_mean_commutes_with_luminance_combination():
    """The engine zero-means per channel then combines; Goljan et al. 2009 combine first. Same result."""
    k = np.random.default_rng(5).standard_normal((64, 80, 3)).astype(np.float32)
    assert np.abs(to_gray(zero_mean_total(k)) - zero_mean_total(to_gray(k))).max() < 1e-5


def test_wiener_dft_matches_an_independent_implementation():
    rng = np.random.default_rng(6)
    x = rng.standard_normal((120, 160))
    x += 0.5 * np.sin(np.arange(160) * 2 * np.pi / 8)[None, :]
    h, w = x.shape
    f = np.fft.fft2(x)
    mag = np.abs(f) / math.sqrt(h * w)
    assert np.isclose((mag**2).mean(), (x**2).mean())  # Parseval: same scale as the spatial variance
    expected = np.fft.ifft2(f * _fast_noise(mag, x.var()) / mag).real
    assert np.abs(wiener_dft(x) - expected).max() < 1e-5
    # the periodic component is attenuated far more than the white component
    line = np.abs(np.fft.fft2(wiener_dft(x)))[0, 20] / np.abs(f)[0, 20]
    assert line < 0.2


def test_saturation_mask_by_brute_force():
    x = np.random.default_rng(7).integers(240, 256, (40, 50)).astype(np.float32)
    expected = np.zeros(x.shape, dtype=bool)
    for i in range(40):
        for j in range(50):
            for di, dj in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                ii, jj = i + di, j + dj
                if x[i, j] >= 250 and 0 <= ii < 40 and 0 <= jj < 50 and x[ii, jj] == x[i, j]:
                    expected[i, j] = True
    assert np.array_equal(saturation_mask(x), expected)


# --------------------------------------------------------------------------- fingerprint


def test_streaming_float32_estimator_matches_float64_ml_estimate():
    """K = sum(W I) / (sum(I^2) + 1) accumulated independently in float64 over many images."""
    sensor = SyntheticSensor(3, (96, 128))
    acc = FingerprintAccumulator(sensor.shape)
    rp = np.zeros((*sensor.shape, 3))
    nn = np.zeros((*sensor.shape, 3))
    for i in range(120):
        img = sensor.capture(i, flat=(i % 2 == 0))
        if i % 7 == 0:
            img = img.copy()
            img[10:40, 10:60] = 255  # clipped region: weight must be exactly zero
        acc.add(img)
        im = img.astype(np.float64)
        raw = channel_residuals(as_float_image(img), 3.0).astype(np.float64)
        wgt = np.where(im < 252.0, im / 252.0, np.exp(-((im - 252.0) ** 2) / 6.0))
        for c in range(3):
            wgt[..., c][saturation_mask(im[..., c])] = 0.0
        rp += raw * wgt
        nn += wgt * wgt
    k64 = wiener_dft(to_gray(zero_mean_total(rp / (nn + 1.0))))
    k32 = acc.finalize().k
    assert np.sqrt(((k32 - k64) ** 2).mean()) / k64.std() < 1e-5
    assert np.allclose(intensity_weight(np.array([[0.0, 126.0, 255.0]], np.float32)), [[0.0, 0.5, math.exp(-1.5)]])


def test_fingerprint_with_non_finite_samples_is_refused_on_load():
    fp = _fp(np.random.default_rng(8).standard_normal((70, 80)))
    assert Fingerprint.from_bytes(fp.to_bytes()).digest() == fp.digest()
    fp.k[3, 4] = np.nan
    with pytest.raises(NumericalError):
        Fingerprint.from_bytes(fp.to_bytes())


# --------------------------------------------------------------------------- statistic


def _brute_xcorr(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """C(s) = sum_x (a - mean)(x + s) (b - mean)(x), circular, by definition."""
    a = a - a.mean()
    b = b - b.mean()
    h, w = a.shape
    out = np.empty((h, w))
    for s0 in range(h):
        for s1 in range(w):
            out[s0, s1] = (np.roll(a, (-s0, -s1), (0, 1)) * b).sum()
    return out


def _brute_pce(c: np.ndarray, peak: tuple[int, int]) -> tuple[float, int]:
    """Goljan, Fridrich, Filler 2009, Eq. 8, with an 11x11 wrapped neighbourhood; signed."""
    h, w = c.shape
    total, n = 0.0, 0
    for i in range(h):
        for j in range(w):
            di = min((i - peak[0]) % h, (peak[0] - i) % h)
            dj = min((j - peak[1]) % w, (peak[1] - j) % w)
            if di <= 5 and dj <= 5:
                continue
            total += c[i, j] ** 2
            n += 1
    return float(np.sign(c[peak]) * c[peak] ** 2 / (total / n)), n


def test_cross_correlation_and_pce_match_the_definitions():
    rng = np.random.default_rng(9)
    a, b = rng.standard_normal((24, 31)), rng.standard_normal((24, 31))
    c = _brute_xcorr(a, b)
    assert np.abs(circular_xcorr(a, b) - c).max() < 1e-4 * np.abs(c).max()
    for peak in [(0, 0), (3, 29), (23, 30), (12, 15)]:
        expected, n = _brute_pce(c, peak)
        assert n == 24 * 31 - 121  # divisor is mn - |N|
        assert pce_at(c, peak).pce == pytest.approx(expected, rel=1e-12)


def test_native_comparison_matches_brute_force_with_mask_and_intensity():
    rng = np.random.default_rng(10)
    h, w = 40, 52
    noise = rng.standard_normal((h, w)).astype(np.float32)
    inten = rng.uniform(50, 200, (h, w)).astype(np.float32)
    k = (rng.standard_normal((h, w)) * 0.01).astype(np.float32)
    sat = rng.random((h, w)) < 0.1
    resid = noise + 3 * inten * k
    m = compare(_res(resid, inten, sat), _fp(k))
    x = np.where(~sat, resid, 0).astype(np.float64)
    y = np.where(~sat, inten * k, 0).astype(np.float64)
    expected, _ = _brute_pce(_brute_xcorr(x, y), (0, 0))
    assert m.tested["rot0"] == pytest.approx(expected, rel=1e-4)
    assert m.ncc == pytest.approx(np.corrcoef(resid[~sat], (inten * k)[~sat])[0, 1], rel=1e-9)
    assert m.search_size == 2 and m.valid_pixels == int((~sat).sum())
    # Closed form: W = I K exactly gives correlation 1; W = -I K is strongly negative, never a match.
    assert compare(_res(inten * k, inten), _fp(k)).ncc == pytest.approx(1.0, abs=1e-9)
    neg = compare(_res(-inten * k, inten), _fp(k))
    assert neg.tested["rot0"] < -1000 and neg.pce < 1


def test_reported_rotation_is_the_counter_clockwise_correction():
    k = np.random.default_rng(11).standard_normal((40, 52)).astype(np.float32)
    for quarter_turns in (1, 2, 3):
        m = compare(_res(np.rot90(k, quarter_turns)), _fp(k))
        # An image stored rotated q*90 deg counter-clockwise is aligned by a further (4 - q)*90 deg.
        assert m.rotation == (4 - quarter_turns) * 90 and m.pce > 1000
        assert np.array_equal(np.rot90(np.rot90(k, quarter_turns), m.rotation // 90), k)
        assert "counter-clockwise" in m.notes[0]
    square = np.random.default_rng(12).standard_normal((48, 48)).astype(np.float32)
    assert compare(_res(np.rot90(square, 1)), _fp(square)).search_size == 4  # all four rotations are tried


@pytest.mark.parametrize(
    "h,w,offset",
    [(20, 25, (0, 0)), (20, 25, (17, 20)), (20, 25, (5, 9)), (37, 30, (0, 15)), (19, 45, (18, 0)), (36, 44, (1, 1))],
)
def test_crop_search_equals_exhaustive_sum_over_every_placement(h, w, offset):
    """sum_x W(x) I(x) K(x + s) for every valid s, by explicit loops; peaks at the borders included."""
    fh, fw = 37, 45
    rng = np.random.default_rng(13)
    k = rng.standard_normal((fh, fw)).astype(np.float32)
    inten = rng.uniform(50, 200, (h, w)).astype(np.float32)
    sat = rng.random((h, w)) < 0.05
    resid = (inten * k[offset[0] : offset[0] + h, offset[1] : offset[1] + w] * 0.5).astype(np.float32)
    resid += rng.standard_normal((h, w)).astype(np.float32) * 20

    prod = np.where(~sat, resid * inten, 0).astype(np.float64)
    prod -= prod.mean()
    brute = np.empty((fh - h + 1, fw - w + 1))
    for s0 in range(brute.shape[0]):
        for s1 in range(brute.shape[1]):
            brute[s0, s1] = (prod * k[s0 : s0 + h, s1 : s1 + w]).sum()

    from sensortrace_engine.matching import _cropped

    surface, res, _ncc, _valid, n_shifts = _cropped(resid, inten, sat, k)
    assert n_shifts == brute.size
    assert np.abs(surface[: brute.shape[0], : brute.shape[1]] - brute).max() < 1e-5 * np.abs(brute).max()
    assert res.peak == offset == tuple(int(v) for v in np.unravel_index(int(np.argmax(brute)), brute.shape))


def test_degenerate_correlation_is_unsupported_not_a_low_score():
    k = np.random.default_rng(14).standard_normal((70, 80)).astype(np.float32)
    m = compare(_res(np.zeros((70, 80))), _fp(k))  # residual identically zero: no energy
    assert m.geometry == "unsupported" and m.pce is None and m.notes
    d = decide(m, quality=CLEAN, fingerprint_diagnostics=GOOD_FP, device_class="conventional")
    assert d.verdict is Verdict.UNSUITABLE
    bad = k.copy()
    bad[0, 0] = np.inf
    assert compare(_res(k), _fp(bad)).pce is None


# --------------------------------------------------------------------------- multiple testing


def test_effective_pce_reproduces_goljan_fridrich_2008_threshold():
    """Goljan & Fridrich 2008, Sec. 2.2: k_max = 88,836,025 and P_FA <= 1e-5 give tau = 53.772."""
    k = 88_836_025
    per_test = -math.expm1(math.log1p(-1e-5) / k)  # 1 - (1 - alpha)^(1/k), Eq. 10 of Goljan et al. 2009
    tau = float(norm.isf(per_test) ** 2)
    assert tau == pytest.approx(53.772, abs=5e-4)
    assert effective_pce(tau, k) == pytest.approx(float(norm.isf(1e-5) ** 2), abs=1e-6)


def test_effective_pce_against_direct_formula_and_monotone_everywhere():
    for n in (2, 3, 10, 100, 1000):
        for pce in (0.25, 1.0, 4.0, 9.0, 16.0, 25.0):
            p = float(norm.sf(math.sqrt(pce)))
            family = 1.0 - (1.0 - p) ** n
            if family > 1.0 - 1e-9:  # the naive double-precision formula itself is no longer usable
                continue
            z = float(norm.isf(family))
            assert effective_pce(pce, n) == pytest.approx(math.copysign(z * z, z), rel=1e-6, abs=1e-6)
    grid = np.concatenate([-np.logspace(6, -6, 49), [0.0], np.logspace(-6, 6, 193)])
    for n in (1, 2, 4, 1000, 745_890, 88_836_025, 10**8):
        vals = [effective_pce(float(v), n) for v in grid]
        assert np.all(np.isfinite(vals)) and np.all(np.diff(vals) >= 0)
        # never raises the statistic (values below the -67.4 floor are covered by the xfail test below)
        assert all(e <= v + 1e-9 for e, v in zip(vals, grid, strict=True) if v > -60)
    fine = [effective_pce(float(v), 88_836_025) for v in np.linspace(53.0, 56.0, 6001)]
    assert np.all(np.diff(fine) > 0)  # no step at the internal change of formula
    for pce in (-5.0, 0.0, 3.0, 60.0, 5000.0):
        vals = [effective_pce(pce, n) for n in (1, 2, 10, 1000, 10**6, 10**8)]
        assert np.all(np.diff(vals) <= 0)


@pytest.mark.xfail(
    strict=True,
    reason="Audit finding F-09 (not fixed, changes adjusted scores): when the search-adjusted tail "
    "probability rounds to 1 the result saturates at -67.396, so for a raw statistic below that value "
    "the 'adjusted' figure is larger than the raw one, and deep-negative adjusted values are wrong "
    "(exact value for PCE 0 with 100 trials is -131.9). No decision is affected.",
)
def test_effective_pce_is_exact_and_never_above_the_raw_value_for_negative_statistics():
    from scipy.special import log_ndtr, ndtri_exp

    for pce, n in [(-100.0, 2), (0.0, 100), (1.26, 1000), (-1e6, 2)]:
        z = math.copysign(math.sqrt(abs(pce)), pce)
        ze = float(ndtri_exp(n * log_ndtr(z)))  # Phi(z_eff) = Phi(z)^n, the definition, in the log domain
        assert effective_pce(pce, n) <= pce
        assert effective_pce(pce, n) == pytest.approx(math.copysign(ze * ze, ze), rel=1e-6)


# --------------------------------------------------------------------------- decision policy


def test_non_finite_statistic_never_supports_a_conclusion():
    for bad in (float("nan"), float("inf"), float("-inf")):
        d = decide(_meas(bad), quality=CLEAN, fingerprint_diagnostics=GOOD_FP, device_class="conventional")
        assert d.verdict is Verdict.UNSUITABLE and d.effective_pce is None


def test_searching_more_candidates_cannot_create_non_match_support():
    kw = dict(quality=CLEAN, fingerprint_diagnostics=GOOD_FP, device_class="conventional")
    assert decide(_meas(15.0, search=2), n_candidates=1, **kw).verdict is Verdict.INCONCLUSIVE
    many = decide(_meas(15.0, search=2), n_candidates=500, **kw)
    assert many.effective_pce < LITERATURE_DEFAULT_POLICY.non_match_threshold < 15.0
    assert many.verdict is Verdict.INCONCLUSIVE
    # and a genuinely low statistic is still a non-match whatever the candidate count
    assert decide(_meas(2.0, search=2), n_candidates=500, **kw).verdict is Verdict.NON_MATCH


def test_controls_are_not_deflated_by_the_search_size_and_nan_controls_fail():
    kw = dict(device_class="computational", n_candidates=500)
    d = decide(_meas(5000.0, search=2), control_pces=[70.0], **kw)
    assert effective_pce(70.0, 1000) < 60 < 70.0  # the adjustment would have hidden this control
    assert d.verdict is Verdict.INCONCLUSIVE and d.nua["mitigation"] == "controls_failed"
    for controls in ([5.0, float("nan")], [float("nan"), 5.0], [float("nan")]):
        d = decide(_meas(5000.0), device_class="unknown", control_pces=controls)
        assert d.verdict is Verdict.INCONCLUSIVE and d.nua["mitigation"] == "controls_failed"
    ok = decide(_meas(5000.0), device_class="unknown", control_pces=[5.0, -3.0])
    assert ok.verdict is Verdict.MATCH and ok.nua["max_control"] == 5.0


def test_match_is_unreachable_without_addressing_the_same_model_alternative():
    for device_class in ("unknown", "computational"):
        for controls in (None, []):
            d = decide(_meas(1e6), device_class=device_class, control_pces=controls, model_key="acme x")
            assert d.verdict is Verdict.INCONCLUSIVE and d.nua["mitigation"] == "none"
    for pce in (-1e6, -61.0, 0.0, 59.999):
        assert decide(_meas(pce), device_class="conventional").verdict is not Verdict.MATCH


def test_strongly_negative_statistic_is_not_reported_as_a_non_match():
    kw = dict(quality=CLEAN, fingerprint_diagnostics=GOOD_FP, device_class="conventional")
    assert decide(_meas(-5000.0), **kw).verdict is Verdict.INCONCLUSIVE
    hidden = _meas(-0.02, search=2, tested={"rot0": -1991.0, "rot180": -0.02})
    assert decide(hidden, **kw).verdict is Verdict.INCONCLUSIVE
    assert decide(_meas(-3.0, search=2, tested={"rot0": -3.0, "rot180": -7.0}), **kw).verdict is Verdict.NON_MATCH


def test_weak_control_fingerprint_cannot_clear_a_shared_artefact():
    """Two same-model devices share a pattern. A proper control exposes it; a control built from two
    dark, compressed images does not, and must therefore not be counted as a control."""
    shape = (512, 640)
    shared = SyntheticSensor(700, shape, prnu_strength=0.004)
    a, b = SyntheticSensor(701, shape), SyntheticSensor(702, shape)
    a.k = a.k + shared.k
    b.k = b.k + shared.k
    fa = estimate_fingerprint([a.capture(i, flat=True) for i in range(20)])
    weak = estimate_fingerprint([jpeg_roundtrip((b.capture(i) // 3).astype(np.uint8), 50) for i in range(2)])
    questioned = encode_png(a.capture(300))

    def run(control: Fingerprint):
        cands = [
            Candidate("a", fa, device_id="da", model_key="m", device_class="computational"),
            Candidate("b", control, device_id="db", model_key="m", device_class="computational"),
        ]
        return {c.candidate_id: c for c in analyse_questioned(questioned, cands).candidates}

    by = run(weak)
    assert by["b"].measurement.pce < 60 and weak.n_images == 2  # the weak control sees nothing
    assert by["a"].decision.verdict is Verdict.INCONCLUSIVE and by["a"].decision.nua["mitigation"] == "none"
    assert by["a"].decision.nua["n_controls_not_counted"] == 1
    strong = estimate_fingerprint([b.capture(i, flat=True) for i in range(20)])
    by = run(strong)
    assert by["b"].measurement.pce > 60  # the artefact is really there
    assert by["a"].decision.nua["mitigation"] == "controls_failed"


# --------------------------------------------------------------------------- enrolment screening


@pytest.mark.xfail(
    strict=True,
    reason="Audit finding F-07 (not fixed): leave-one-out screening only detects a lone foreign image. "
    "Two or more images from one other sensor support each other inside the leave-one-out "
    "fingerprint, are all accepted, and the resulting fingerprint matches both devices.",
)
def test_enrolment_rejects_a_group_of_images_from_a_second_sensor(sensor_a, sensor_b):
    def ref(sensor, i):
        return ReferenceInput(f"s{sensor.seed}_{i}", lambda: encode_png(sensor.capture(i, flat=True)))

    res = enrol([ref(sensor_a, i) for i in range(12)] + [ref(sensor_b, i) for i in range(3)])
    assert len(res.accepted) == 12


# --------------------------------------------------------------------------- statistics


def test_auc_and_roc_against_pair_counting_and_scikit_learn():
    sklearn_metrics = pytest.importorskip("sklearn.metrics")
    rng = np.random.default_rng(15)
    same = np.round(rng.normal(1.0, 1.0, 300), 1)  # rounding creates ties
    diff = np.round(rng.normal(0.0, 1.0, 500), 1)
    pairs = (same[:, None] > diff[None, :]).sum() + 0.5 * (same[:, None] == diff[None, :]).sum()
    assert stats.auc(same, diff) == pytest.approx(pairs / (same.size * diff.size), abs=1e-12)
    y = np.r_[np.ones(same.size), np.zeros(diff.size)]
    assert stats.auc(same, diff) == pytest.approx(sklearn_metrics.roc_auc_score(y, np.r_[same, diff]), abs=1e-12)
    roc = stats.roc_curve(same, diff)
    for t, fpr, tpr in zip(roc["thresholds"][1:], roc["fpr"][1:], roc["tpr"][1:], strict=True):
        assert fpr == pytest.approx((diff >= t).mean()) and tpr == pytest.approx((same >= t).mean())
    assert np.trapezoid(roc["tpr"], roc["fpr"]) == pytest.approx(stats.auc(same, diff), abs=1e-12)


@pytest.mark.parametrize("k,n", [(0, 10), (1, 10), (5, 100), (0, 3680), (7, 520), (100, 100), (3, 3)])
def test_intervals_against_scipy_binomtest(k, n):
    exact = binomtest(k, n).proportion_ci(0.95, method="exact")
    assert stats.clopper_pearson(k, n) == pytest.approx((exact.low, exact.high), abs=1e-12)
    wilson = binomtest(k, n).proportion_ci(0.95, method="wilson")
    assert stats.wilson_interval(k, n) == pytest.approx((wilson.low, wilson.high), abs=1e-12)


def test_threshold_for_fpr_is_the_smallest_admissible_threshold_and_refuses_unresolvable_targets():
    rng = np.random.default_rng(16)
    for _ in range(200):
        n = int(rng.integers(1, 400))
        d = np.round(rng.normal(0, 3, n), int(rng.integers(0, 3)))  # ties are common
        target = float(rng.choice([0.5, 0.2, 0.1, 0.05, 0.01, 0.003]))
        t = stats.threshold_for_fpr(d, target)
        if n < 1 / target:
            assert t is None  # an error rate below 1/n is never claimed
            continue
        assert t is not None and (d >= t).mean() <= target
        # brute force over every candidate threshold: nothing smaller is admissible
        smaller = [c for c in np.unique(d) if c < t]
        assert all((d >= c).mean() > target for c in smaller)
    confusion = stats.confusion([1, 5, 9], [0, 5, 9], 9, 5)
    assert confusion["same_source"] == {"match": 1, "inconclusive": 0, "non_match": 2}


# --------------------------------------------------------------------------- evaluation framework


def _eval_rows_and_manifest(seed: int = 0):
    rng = np.random.default_rng(seed)
    devices = [
        ev.DeviceSpec("C1", "c1", "model a", "calibration"),
        ev.DeviceSpec("C2", "c2", "model a", "calibration"),
        ev.DeviceSpec("C3", "c3", "model b", "calibration"),
        ev.DeviceSpec("T1", "t1", "model c", "test"),
        ev.DeviceSpec("T2", "t2", "model c", "test"),
        ev.DeviceSpec("T3", "t3", "model d", "test"),
    ]
    rows = []
    for dev in devices:
        for i in range(120):
            for cand in devices:
                same = dev.id == cand.id
                score = float(rng.normal(900, 300) if same else rng.normal(0, 2))
                rows.append(
                    {
                        "image": f"{dev.id}_{i}",
                        "device": dev.id,
                        "candidate": cand.id,
                        "condition": "original",
                        "geometry": "native",
                        "pce": score,
                        "eff_pce": score,
                    }
                )
    manifest = {"name": "toy", "devices": devices, "conditions": ["original"]}
    return rows, manifest


def test_evaluation_strata_split_and_in_sample_rates():
    rows, manifest = _eval_rows_and_manifest()
    dev = {d.id: d for d in manifest["devices"]}
    assert ev._stratum({"device": "C1", "candidate": "C1"}, dev) == "same_device"
    assert ev._stratum({"device": "C1", "candidate": "C2"}, dev) == "same_model"
    assert ev._stratum({"device": "C1", "candidate": "C3"}, dev) == "different_model"
    out = ev.analyse(rows, manifest, target_fpr=0.01, target_fnr=0.01)
    cal = out["calibration"]
    assert (cal["n_same"], cal["n_same_model_diff"], cal["n_different_model_diff"]) == (360, 240, 480)
    block = out["test"]["original"]
    assert block["all_negatives"]["calibrated"]["n_same"] == 360  # cross-split pairs are never used
    assert block["all_negatives"]["calibrated"]["n_diff"] == 720
    assert block["same_model"]["calibrated"]["n_diff"] == 240

    is_cal = {d.id for d in manifest["devices"] if d.split == "calibration"}
    cal_same = np.array([r["eff_pce"] for r in rows if r["device"] == r["candidate"] and r["device"] in is_cal])
    cal_diff = np.array(
        [r["eff_pce"] for r in rows if r["device"] != r["candidate"] and {r["device"], r["candidate"]} <= is_cal]
    )
    match_thr, non_match_thr = cal["match_threshold_selected"], cal["non_match_threshold_selected"]
    assert (cal_diff >= match_thr).mean() <= 0.01
    # the decision rule declares a non-match at "<=": the in-sample rate must respect the target
    assert (cal_same <= non_match_thr).mean() <= 0.01


def test_test_split_scores_cannot_influence_calibrated_thresholds():
    rows, manifest = _eval_rows_and_manifest()
    base = ev.analyse(rows, manifest)["calibration"]
    is_test = {d.id for d in manifest["devices"] if d.split == "test"}
    shuffled = [dict(r) for r in rows]
    for r in shuffled:
        if r["device"] in is_test or r["candidate"] in is_test:
            r["eff_pce"] = r["pce"] = -r["eff_pce"] * 7.0
    after = ev.analyse(shuffled, manifest)["calibration"]
    for key in ("match_threshold_selected", "non_match_threshold_selected", "match_threshold_pooled_negatives"):
        assert after[key] == base[key]


def test_same_device_crops_are_not_counted_as_crop_negatives():
    rows, manifest = _eval_rows_and_manifest()
    extra = [
        {**rows[0], "geometry": "cropped", "candidate": "C2", "eff_pce": 3.0, "pce": 20.0},
        {**rows[0], "geometry": "cropped", "candidate": "C1", "eff_pce": 4000.0, "pce": 4020.0},  # true positive
    ]
    out = ev.analyse(rows + extra, manifest)["cropped_search_negatives"]
    assert out["n"] == 1 and out["adjusted_max"] == 3.0 and out["raw_pce_exceeding_reference_line"] == 0


# --------------------------------------------------------------------------- real data (optional)

_ROOT = Path(__file__).resolve().parents[2]
_REAL_IMAGE = _ROOT / "data/vision/D06_Apple_iPhone6/nat/D06_I_nat_0001.jpg"
_REAL_FP = _ROOT / "data/eval/vision_subset_v1/fingerprints/D06.npz"


@pytest.mark.slow
@pytest.mark.skipif(not (_REAL_IMAGE.exists() and _REAL_FP.exists()), reason="VISION evaluation data not present")
@pytest.mark.xfail(
    strict=True,
    reason="Audit finding F-06 (documentation claim, nothing to fix in code): on real camera JPEGs the "
    "same filter on a wavelet grid moved by one pixel changes the same-device statistic by tens of "
    "percent (measured -77% to +70% over 16 images of 4 devices; +86% for this image), not 'slightly'. "
    "The 0.96-0.97 residual correlation quoted in SCIENTIFIC_METHODOLOGY.md holds for synthetic white "
    "noise only (0.55-0.65 measured on real JPEGs).",
)
def test_wavelet_grid_phase_does_not_change_real_image_statistic_by_more_than_a_quarter():
    from sensortrace_engine.residual import extract_residual

    fp = Fingerprint.from_bytes(_REAL_FP.read_bytes())
    img = as_float_image(ingest_image(_REAL_IMAGE.read_bytes()).pixels)
    engine = extract_residual(img)

    def shifted_grid(ch: np.ndarray) -> np.ndarray:
        h, w = ch.shape
        x = np.pad(ch, ((17, 31), (17, 31)), mode="symmetric")  # same filter, grid moved by (1, 1)
        coeffs = pywt.wavedec2(x, "db4", mode="periodization", level=4)
        out = [np.zeros_like(coeffs[0])] + [tuple(_fast_noise(b, 9.0) for b in d) for d in coeffs[1:]]
        return pywt.waverec2(out, "db4", mode="periodization")[17 : 17 + h, 17 : 17 + w].astype(np.float32)

    raw = np.stack([shifted_grid(img[..., c]) for c in range(3)], axis=2)
    other = Residual(wiener_dft(zero_mean_total(to_gray(raw))), engine.intensity, engine.saturated, 3.0)
    a, b = compare(engine, fp).tested["rot0"], compare(other, fp).tested["rot0"]
    assert a > 1000 and b > 1000
    assert abs(b - a) / a < 0.25
