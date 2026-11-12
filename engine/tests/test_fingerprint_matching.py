from __future__ import annotations

import numpy as np
import pytest

from sensortrace_engine.errors import (
    IncompatibleGeometryError,
    InsufficientReferenceError,
    NumericalError,
)
from sensortrace_engine.fingerprint import Fingerprint, FingerprintAccumulator, estimate_fingerprint
from sensortrace_engine.matching import circular_xcorr, compare, gaussian_tail, pce_at
from sensortrace_engine.residual import extract_residual, to_gray
from sensortrace_engine.synthetic import SyntheticSensor


def test_fingerprint_recovers_the_true_pattern(sensor_a, fp_a):
    truth = to_gray(sensor_a.k)
    corr = np.corrcoef(fp_a.k.ravel(), truth.ravel())[0, 1]
    assert corr > 0.8
    assert fp_a.shape == sensor_a.shape and fp_a.n_images == 24


def test_fingerprint_unrelated_to_other_sensor(sensor_b, fp_a):
    truth_b = to_gray(sensor_b.k)
    assert abs(np.corrcoef(fp_a.k.ravel(), truth_b.ravel())[0, 1]) < 0.02


def test_split_half_diagnostic_high_for_one_sensor_low_for_mixture(sensor_a, fp_a):
    assert fp_a.diagnostics["split_half"]["pce"] > 1000
    # even indices from one sensor, odd from unrelated sensors: halves share nothing
    imgs = [(sensor_a if i % 2 == 0 else SyntheticSensor(900 + i)).capture(i, flat=True) for i in range(12)]
    mixed = estimate_fingerprint(imgs)
    assert abs(mixed.diagnostics["split_half"]["pce"]) < 20


def test_more_reference_images_give_a_better_fingerprint(sensor_a):
    truth = to_gray(sensor_a.k).ravel()
    few = estimate_fingerprint([sensor_a.capture(i, flat=True) for i in range(4)])
    many = estimate_fingerprint([sensor_a.capture(i, flat=True) for i in range(24)])
    c_few = np.corrcoef(few.k.ravel(), truth)[0, 1]
    c_many = np.corrcoef(many.k.ravel(), truth)[0, 1]
    assert c_many > c_few


def test_accumulator_rejects_other_dimensions(sensor_a):
    acc = FingerprintAccumulator(sensor_a.shape)
    acc.add(sensor_a.capture(0))
    with pytest.raises(IncompatibleGeometryError):
        acc.add(sensor_a.capture(1)[:-2])


def test_minimum_reference_images(sensor_a):
    acc = FingerprintAccumulator(sensor_a.shape)
    acc.add(sensor_a.capture(0))
    with pytest.raises(InsufficientReferenceError):
        acc.finalize()


def test_fingerprint_serialisation_roundtrip_and_tamper_detection(fp_a):
    data = fp_a.to_bytes()
    back = Fingerprint.from_bytes(data)
    assert np.array_equal(back.k, fp_a.k)
    assert back.digest() == fp_a.digest()
    assert back.algorithm_version == fp_a.algorithm_version
    tampered = Fingerprint.from_bytes(data)
    tampered.k[0, 0] += 1.0
    import io
    import json

    buf = io.BytesIO()
    np.savez_compressed(buf, k=tampered.k, meta=np.frombuffer(json.dumps(fp_a.metadata()).encode(), dtype=np.uint8))
    with pytest.raises(NumericalError):
        Fingerprint.from_bytes(buf.getvalue())


def test_fingerprint_estimation_is_reproducible(sensor_a, fp_a):
    again = estimate_fingerprint([sensor_a.capture(i, flat=True) for i in range(24)])
    assert again.digest() == fp_a.digest()


# ---------------------------------------------------------------- statistics


def test_xcorr_locates_a_known_circular_shift():
    rng = np.random.default_rng(0)
    b = rng.standard_normal((64, 96))
    a = np.roll(b, (5, -7), axis=(0, 1))
    r = circular_xcorr(a, b)
    assert np.unravel_index(np.argmax(r), r.shape) == (5, 96 - 7)
    assert np.isclose(r.max(), ((b - b.mean()) ** 2).sum())


def test_pce_matches_hand_computation_and_is_signed():
    rng = np.random.default_rng(1)
    s = rng.standard_normal((64, 64))
    s[10, 20] = 30.0
    mask = np.ones_like(s, dtype=bool)
    mask[5:16, 15:26] = False
    expected = 30.0**2 / np.mean(s[mask] ** 2)
    assert np.isclose(pce_at(s, (10, 20)).pce, expected)
    s[10, 20] = -30.0
    assert np.isclose(pce_at(s, (10, 20)).pce, -expected)


def test_pce_neighbourhood_wraps_around_edges():
    rng = np.random.default_rng(2)
    s = rng.standard_normal((40, 40))
    s[0, 0] = 25.0
    s[39, 39] = 1000.0  # inside the wrapped 11x11 neighbourhood: must not count as energy
    assert pce_at(s, (0, 0)).pce > 300


def test_gaussian_tail_reference_values():
    p, ps = gaussian_tail(0.0)
    assert np.isclose(p, 0.5)
    p, ps = gaussian_tail(60.0, 1)
    assert np.isclose(p, 4.7e-15, rtol=0.1) and np.isclose(ps, p, rtol=1e-3)
    p1, p100 = gaussian_tail(9.0, 100)
    assert np.isclose(p100, 1 - (1 - p1) ** 100)


def test_same_sensor_high_other_sensor_low(sensor_a, sensor_b, fp_a):
    same = compare(extract_residual(sensor_a.capture(100)), fp_a)
    other = compare(extract_residual(sensor_b.capture(100)), fp_a)
    assert same.geometry == "native" and same.rotation == 0 and same.search_size == 2
    assert same.pce > 1000 and same.ncc > 0.1
    assert other.pce < 25 and abs(other.ncc) < 0.02


def test_null_distribution_is_centred_and_light_tailed(fp_a):
    """Unrelated synthetic sensors: zero-shift signed PCE behaves like z**2 with a sign."""
    vals = []
    for i in range(40):
        r = extract_residual(SyntheticSensor(500 + i).capture(i))
        vals.append(compare(r, fp_a).tested["rot0"])
    vals = np.array(vals)
    assert np.abs(vals).max() < 20
    assert 0.2 < np.mean(vals > 0) < 0.8


def test_jpeg_compression_lowers_but_does_not_destroy_the_statistic(sensor_a, fp_a):
    hi = compare(extract_residual(sensor_a.capture(101)), fp_a).pce
    q90 = compare(extract_residual(sensor_a.capture(101, jpeg_quality=90)), fp_a).pce
    q60 = compare(extract_residual(sensor_a.capture(101, jpeg_quality=60)), fp_a).pce
    assert hi > q90 > q60 > 60


@pytest.mark.parametrize("k", [1, 2, 3])
def test_rotated_images_are_matched_and_reported(sensor_a, fp_a, k):
    m = compare(extract_residual(np.rot90(sensor_a.capture(102), k)), fp_a)
    assert m.pce > 1000
    assert m.rotation == (360 - 90 * k) % 360
    assert m.geometry == ("native" if k == 2 else "rotated")


def test_crop_is_located_at_the_true_offset(sensor_a, fp_a):
    img = sensor_a.capture(103)[40:200, 60:300]
    m = compare(extract_residual(img), fp_a)
    assert m.geometry == "cropped" and m.shift == (40, 60) and m.rotation == 0
    assert m.pce > 1000
    # 0 and 180 deg placements, plus 90 and 270 deg because the transposed crop also fits
    assert m.search_size == 2 * (256 - 160 + 1) * (384 - 240 + 1) + 2 * (256 - 240 + 1) * (384 - 160 + 1)


def test_crop_from_other_sensor_is_not_significant_after_search_adjustment(sensor_b, fp_a):
    m = compare(extract_residual(sensor_b.capture(104)[40:200, 60:300]), fp_a)
    assert m.pce < 60
    assert m.p_false_alarm_gaussian > 1e-3


def test_larger_or_resampled_image_is_unsupported(sensor_a, fp_a):
    import cv2

    img = sensor_a.capture(105)
    up = cv2.resize(img, None, fx=1.25, fy=1.25, interpolation=cv2.INTER_CUBIC)
    m = compare(extract_residual(up), fp_a)
    assert m.geometry == "unsupported" and m.pce is None and m.notes


def test_downscaled_image_does_not_match(sensor_a, fp_a):
    """A resized image fits inside the fingerprint and is searched as a crop; the
    pattern is destroyed by resampling, so it must not produce a match."""
    import cv2

    img = sensor_a.capture(106)
    down = cv2.resize(img, None, fx=0.8, fy=0.8, interpolation=cv2.INTER_AREA)
    m = compare(extract_residual(down), fp_a)
    assert m.geometry == "cropped" and m.pce < 60


def test_saturated_regions_are_excluded(sensor_a, fp_a):
    img = sensor_a.capture(107).copy()
    img[:, :192] = 255
    m = compare(extract_residual(img), fp_a)
    assert 0.45 < m.valid_fraction < 0.55
    assert m.pce > 500
