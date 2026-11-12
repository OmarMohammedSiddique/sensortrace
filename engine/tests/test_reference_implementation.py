"""Cross-check against an independent implementation (polimi-ispl/prnu-python, MIT licence).

The reference code is a development-only oracle: it is never imported by the engine and never
shipped. Fetch it with ``scripts/fetch_reference_implementation.sh``; the tests skip when absent.

Known, documented differences (see ``docs/research/literature-notes.md`` B4): the reference
searches the global maximum of the correlation surface and excludes a 4x4 off-centre window,
where this engine tests the zero shift and excludes a centred 11x11 window; and its
maximum-likelihood numerator and denominator are weighted inconsistently. The comparison is
therefore made stage by stage, with tolerances that allow for those differences only.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

from sensortrace_engine.fingerprint import estimate_fingerprint
from sensortrace_engine.matching import circular_xcorr, compare, pce_at
from sensortrace_engine.residual import extract_residual, to_gray
from sensortrace_engine.synthetic import SyntheticSensor

REF = Path(os.environ.get("SENSORTRACE_PRNU_PYTHON", Path(__file__).resolve().parents[2] / "data/third_party/prnu-python"))
pytestmark = [pytest.mark.reference, pytest.mark.skipif(not (REF / "prnu" / "functions.py").exists(), reason="reference implementation not fetched")]

SIGMA = 3.0
BORDER = 32  # the two implementations treat image borders differently


@pytest.fixture(scope="module")
def ref():
    sys.path.insert(0, str(REF))
    import prnu
    from prnu import functions as f

    # NumPy 2 compatibility shim for the unmaintained reference: its intensity weighting does
    # integer arithmetic on uint8 input, which overflows. This is the same formula on floats.
    def inten_scale(im):
        x = im.astype(np.float32)
        out = np.exp(-((x - 252.0) ** 2) / 6.0)
        out[x < 252.0] = x[x < 252.0] / 252.0
        return out

    f.inten_scale = inten_scale
    return prnu


@pytest.fixture(scope="module")
def data():
    shape = (512, 640)
    a, b = SyntheticSensor(301, shape, prnu_strength=0.01), SyntheticSensor(302, shape, prnu_strength=0.01)
    refs = [a.capture(i, flat=True) for i in range(16)]
    return a, b, refs


def _inner(x):
    return x[BORDER:-BORDER, BORDER:-BORDER].ravel()


def _corr(x, y):
    return float(np.corrcoef(_inner(x), _inner(y))[0, 1])


def test_shrinkage_rule_is_identical(ref, data):
    """With the reference's transform convention, this engine's shrinkage rule reproduces the
    reference residual essentially exactly: the adaptive Wiener filter itself is the same."""
    import pywt

    from sensortrace_engine.denoise import adaptive_wiener_noise

    a, _, _ = data
    img = a.capture(10)
    ch = img[..., 1].astype(np.float32)
    coeffs = pywt.wavedec2(ch, "db4", level=4)  # reference convention: symmetric extension, no padding
    out = [np.zeros_like(coeffs[0])] + [tuple(adaptive_wiener_noise(band, SIGMA**2) for band in d) for d in coeffs[1:]]
    ours = pywt.waverec2(out, "db4")[: ch.shape[0], : ch.shape[1]]
    theirs = ref.functions.noise_extract(img[..., 1].copy(), 4, SIGMA)
    assert _corr(ours, theirs) > 0.99999
    assert np.abs(_inner(ours) - _inner(theirs)).max() < 0.02


def test_noise_residual_agrees_up_to_transform_phase(ref, data):
    """End to end the two residuals differ only through the sampling phase of the decimated
    wavelet transform (this engine pads and periodises; the reference extends symmetrically).
    A decimated DWT is shift-variant, so the same filter on a grid offset by one pixel gives a
    residual correlated at about 0.96-0.97 with the original. The agreement with the reference
    must be at that level, and the two must carry the same noise energy."""
    from sensortrace_engine.denoise import wavelet_noise_residual

    a, _, _ = data
    for seed in (10, 11, 12):
        img = a.capture(seed)
        mine = extract_residual(img, SIGMA).w
        theirs = ref.extract_single(img, sigma=SIGMA)
        assert _corr(mine, theirs) > 0.95
        assert np.isclose(_inner(mine).std(), _inner(theirs).std(), rtol=0.03)
    ch = a.capture(10)[..., 1].astype(np.float32)
    full, shifted = wavelet_noise_residual(ch, SIGMA), wavelet_noise_residual(ch[1:, 1:], SIGMA)
    self_shift = float(np.corrcoef(_inner(full[1:, 1:]), _inner(shifted))[0, 1])
    assert 0.93 < self_shift < 0.995  # the shift-variance that explains the difference above


def test_fingerprint_agrees(ref, data):
    _, _, refs = data
    mine = estimate_fingerprint(refs, sigma0=SIGMA).k
    theirs = ref.extract_multiple_aligned(refs, sigma=SIGMA, processes=1, tqdm_str=None)
    # Averaging over images removes most of the transform-phase difference.
    assert _corr(mine, theirs) > 0.97


def test_statistics_and_decisions_agree(ref, data):
    a, b, refs = data
    fp = estimate_fingerprint(refs, sigma0=SIGMA)
    k_ref = ref.extract_multiple_aligned(refs, sigma=SIGMA, processes=1, tqdm_str=None)
    rows = []
    for sensor, same in ((a, True), (b, False)):
        for seed in range(40, 52):
            img = sensor.capture(seed)
            mine = compare(extract_residual(img, SIGMA), fp).tested["rot0"]
            w_ref = ref.extract_single(img, sigma=SIGMA)
            ik_ref = to_gray(img.astype(np.float32)) * k_ref
            # the reference pipeline's arrays scored with this engine's statistic definition
            ref_pipeline = pce_at(circular_xcorr(w_ref, ik_ref), (0, 0)).pce
            # the reference's own end-to-end statistic (global maximum, 4x4 exclusion)
            ref_native = float(ref.pce(ref.crosscorr_2d(ik_ref, w_ref))["pce"])
            rows.append((same, mine, ref_pipeline, ref_native))
    same = [r for r in rows if r[0]]
    diff = [r for r in rows if not r[0]]
    # Same sensor: all three clearly detect; pipelines agree within 15 % under one statistic.
    for _, mine, rp, rn in same:
        assert mine > 60 and rp > 60 and rn > 60
        assert abs(mine - rp) / rp < 0.15
    # Different sensor: this engine and the reference pipeline stay low at zero shift.
    assert max(r[1] for r in diff) < 30 and max(r[2] for r in diff) < 30
    # The reference's global-maximum search inflates null scores, as documented.
    assert np.median([r[3] for r in diff]) > np.median([abs(r[1]) for r in diff])
    # Scores are strongly rank-correlated across all trials.
    from scipy.stats import spearmanr

    assert spearmanr([r[1] for r in rows], [r[2] for r in rows]).statistic > 0.9
