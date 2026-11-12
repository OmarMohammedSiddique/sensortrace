from __future__ import annotations

import numpy as np
import pytest

from sensortrace_engine import stats
from sensortrace_engine.enrol import EnrolConfig, ReferenceInput, enrol
from sensortrace_engine.errors import CancelledError, InsufficientReferenceError
from sensortrace_engine.matching import compare
from sensortrace_engine.residual import extract_residual
from sensortrace_engine.synthetic import encode_png


def refs(sensor, n, start=0, prefix="r"):
    return [
        ReferenceInput(f"{prefix}{i}", (lambda i=i: encode_png(sensor.capture(i, flat=True))))
        for i in range(start, start + n)
    ]


def test_enrol_produces_a_working_fingerprint_with_progress(sensor_a, sensor_b):
    events = []
    res = enrol(refs(sensor_a, 12), progress=lambda s, d, t: events.append((s, d, t)))
    assert res.fingerprint is not None and len(res.accepted) == 12
    assert {e[0] for e in events} == {"screening", "consistency", "estimating", "finalising"}
    assert events[-1] == ("finalising", 1, 1)
    assert compare(extract_residual(sensor_a.capture(50)), res.fingerprint).pce > 1000
    assert compare(extract_residual(sensor_b.capture(50)), res.fingerprint).pce < 30
    d = res.fingerprint.diagnostics
    assert d["screening"]["accepted"] == 12 and len(d["reference_sha256"]) == 12
    assert any("recommended" in w for w in res.warnings)  # fewer than the recommended count


def test_enrol_rejects_duplicates_unreadable_and_foreign_images(sensor_a, sensor_b):
    items = refs(sensor_a, 10)
    items.append(ReferenceInput("dup", items[0].load))
    items.append(ReferenceInput("junk", lambda: b"not an image"))
    items.append(ReferenceInput("intruder", lambda: encode_png(sensor_b.capture(3, flat=True))))
    items.append(ReferenceInput("small", lambda: encode_png(sensor_a.capture(4, flat=True)[:200, :300])))
    items.append(ReferenceInput("rot", lambda: encode_png(np.rot90(sensor_a.capture(5, flat=True)))))
    res = enrol(items)
    by = {o.ref_id: o for o in res.outcomes}
    assert len(res.accepted) == 10
    assert "duplicate" in by["dup"].reasons[0]
    assert by["junk"].reasons and not by["junk"].accepted
    assert "different sensor" in by["intruder"].reasons[0] and by["intruder"].loo_pce < 5
    assert "differs from the main group" in by["small"].reasons[0]
    assert "transposed" in by["rot"].reasons[0]
    assert any("mixes" in w for w in res.warnings)
    # The intruder must not have contaminated the estimate.
    assert compare(extract_residual(sensor_b.capture(60)), res.fingerprint).pce < 30


def test_enrol_keeps_foreign_image_when_rejection_disabled(sensor_a, sensor_b):
    items = refs(sensor_a, 8) + [ReferenceInput("intruder", lambda: encode_png(sensor_b.capture(3, flat=True)))]
    res = enrol(items, config=EnrolConfig(reject_inconsistent=False))
    by = {o.ref_id: o for o in res.outcomes}
    assert by["intruder"].accepted and by["intruder"].warnings


def test_enrol_cancellation_and_insufficient(sensor_a):
    calls = {"n": 0}

    def cancel():
        calls["n"] += 1
        return calls["n"] > 5

    with pytest.raises(CancelledError):
        enrol(refs(sensor_a, 8), should_cancel=cancel)
    with pytest.raises(InsufficientReferenceError):
        enrol(refs(sensor_a, 1))
    with pytest.raises(InsufficientReferenceError):
        enrol([ReferenceInput("x", lambda: b"junk")])


def test_enrol_is_reproducible(sensor_a):
    a = enrol(refs(sensor_a, 6)).fingerprint
    b = enrol(refs(sensor_a, 6)).fingerprint
    assert a.digest() == b.digest()


# ------------------------------------------------------------------- stats


def test_auc_known_values():
    assert stats.auc([3, 4, 5], [0, 1, 2]) == 1.0
    assert stats.auc([0, 1, 2], [3, 4, 5]) == 0.0
    assert stats.auc([1, 2], [1, 2]) == 0.5
    rng = np.random.default_rng(0)
    s, d = rng.normal(1, 1, 4000), rng.normal(0, 1, 4000)
    from scipy.stats import norm

    assert stats.auc(s, d) == pytest.approx(norm.cdf(1 / np.sqrt(2)), abs=0.02)
    lo, hi = stats.auc_bootstrap(s, d, n_boot=300)
    assert lo < stats.auc(s, d) < hi


def test_intervals_reference_values():
    lo, hi = stats.clopper_pearson(0, 100)
    assert lo == 0.0 and hi == pytest.approx(0.0362, abs=5e-4)  # ~3/n rule
    lo, hi = stats.clopper_pearson(5, 100)
    assert lo == pytest.approx(0.0164, abs=5e-4) and hi == pytest.approx(0.1128, abs=5e-4)
    lo, hi = stats.wilson_interval(5, 100)
    assert lo == pytest.approx(0.0215, abs=5e-4) and hi == pytest.approx(0.1118, abs=5e-4)
    assert stats.clopper_pearson(0, 0) == (0.0, 1.0)


def test_roc_and_operating_point():
    same, diff = [10, 20, 30, 40], [1, 2, 3, 25]
    op = stats.operating_point(same, diff, 22)
    assert (op.false_positives, op.false_negatives) == (1, 2) and op.fpr == 0.25 and op.fnr == 0.5
    roc = stats.roc_curve(same, diff)
    assert roc["fpr"][0] == 0 and roc["tpr"][-1] == 1 and roc["fpr"][-1] == 1
    assert np.all(np.diff(roc["fpr"]) >= 0) and np.all(np.diff(roc["tpr"]) >= 0)
    c = stats.confusion(same, diff, 22, 5)
    assert c["same_source"] == {"match": 2, "inconclusive": 2, "non_match": 0}
    assert c["different_source"] == {"match": 1, "inconclusive": 0, "non_match": 3}


def test_threshold_selection_refuses_unsupported_error_rates():
    diff = np.arange(100.0)
    # 100 impostors cannot support a 1e-3 claim.
    assert stats.threshold_for_fpr(diff, 1e-3) is None
    t = stats.threshold_for_fpr(diff, 0.05)
    assert t is not None and (diff >= t).mean() <= 0.05 and (diff >= t - 1).mean() > 0.05
    same = np.arange(200.0)
    t2 = stats.threshold_for_fnr(same, 0.01)
    assert t2 is not None and (same < t2).mean() <= 0.01
    assert stats.threshold_for_fnr(same[:10], 0.01) is None
