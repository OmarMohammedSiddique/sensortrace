"""Deterministic scientific regression test.

Fixed synthetic inputs must keep producing the recorded numbers. A failure means numerical output
changed: either a defect was introduced, or the change is intended and ``ALGORITHM_VERSION`` must be
bumped and the fixture regenerated with ``python tests/test_regression.py --write``.

Tolerances allow for floating-point differences between platforms and library builds, not for
algorithmic change.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

from sensortrace_engine.decision import decide, effective_pce
from sensortrace_engine.fingerprint import estimate_fingerprint
from sensortrace_engine.matching import compare
from sensortrace_engine.residual import extract_residual
from sensortrace_engine.synthetic import SyntheticSensor, jpeg_roundtrip
from sensortrace_engine.version import ALGORITHM_VERSION

FIXTURE = Path(__file__).parent / "fixtures" / "regression_v1.json"
SHAPE = (384, 512)


def compute() -> dict:
    a, b = SyntheticSensor(4001, SHAPE, prnu_strength=0.008), SyntheticSensor(4002, SHAPE, prnu_strength=0.008)
    fp = estimate_fingerprint([a.capture(i, flat=True) for i in range(12)])
    k = fp.k.astype(np.float64)
    cases = {
        "same_png": a.capture(100),
        "same_png_2": a.capture(101),
        "other_png": b.capture(100),
        "same_jpeg85": jpeg_roundtrip(a.capture(102), 85),
        "same_rot90": np.rot90(a.capture(103), 1),
        "same_crop": a.capture(104)[32:288, 64:448],
        "same_saturated": np.where(np.arange(SHAPE[1])[None, :, None] < 200, 255, a.capture(105)).astype(np.uint8),
    }
    out: dict = {
        "algorithm_version": ALGORITHM_VERSION,
        "fingerprint": {
            "std": float(k.std()),
            "abs_mean": float(np.abs(k).mean()),
            "split_half_pce": fp.diagnostics["split_half"]["pce"],
            "split_half_ncc": fp.diagnostics["split_half"]["ncc"],
            "samples": [float(k[y, x]) for y, x in ((10, 10), (100, 200), (300, 400), (383, 511))],
        },
        "cases": {},
    }
    for name, img in cases.items():
        m = compare(extract_residual(img), fp)
        d = decide(m, device_class="conventional", fingerprint_diagnostics={"n_images": 30, "split_half": {"pce": 1e4}})
        out["cases"][name] = {
            "pce": m.pce,
            "ncc": m.ncc,
            "effective_pce": effective_pce(m.pce, m.search_size),
            "geometry": m.geometry,
            "rotation": m.rotation,
            "shift": list(m.shift),
            "search_size": m.search_size,
            "valid_pixels": m.valid_pixels,
            "verdict": d.verdict.value,
        }
    return out


@pytest.fixture(scope="module")
def current() -> dict:
    return compute()


@pytest.fixture(scope="module")
def recorded() -> dict:
    return json.loads(FIXTURE.read_text())


def test_fixture_matches_algorithm_version(recorded):
    assert recorded["algorithm_version"] == ALGORITHM_VERSION, "bump the fixture together with the algorithm version"


def test_fingerprint_numbers(current, recorded):
    for key in ("std", "abs_mean", "split_half_ncc"):
        assert current["fingerprint"][key] == pytest.approx(recorded["fingerprint"][key], rel=2e-3)
    assert current["fingerprint"]["split_half_pce"] == pytest.approx(recorded["fingerprint"]["split_half_pce"], rel=1e-2)
    assert current["fingerprint"]["samples"] == pytest.approx(recorded["fingerprint"]["samples"], rel=2e-2, abs=2e-6)


@pytest.mark.parametrize("name", ["same_png", "same_png_2", "other_png", "same_jpeg85", "same_rot90", "same_crop", "same_saturated"])
def test_case_numbers(current, recorded, name):
    c, r = current["cases"][name], recorded["cases"][name]
    for key in ("geometry", "rotation", "shift", "search_size", "valid_pixels", "verdict"):
        assert c[key] == r[key], key
    if abs(r["pce"]) > 20:
        assert c["pce"] == pytest.approx(r["pce"], rel=1e-2)
        assert c["effective_pce"] == pytest.approx(r["effective_pce"], rel=1e-2)
    else:  # near-zero statistics: compare on an absolute scale
        assert c["pce"] == pytest.approx(r["pce"], abs=0.5)
    assert c["ncc"] == pytest.approx(r["ncc"], rel=1e-2, abs=2e-4)


if __name__ == "__main__":
    if "--write" in sys.argv:
        FIXTURE.parent.mkdir(exist_ok=True)
        FIXTURE.write_text(json.dumps(compute(), indent=2) + "\n")
        print(f"wrote {FIXTURE}")
