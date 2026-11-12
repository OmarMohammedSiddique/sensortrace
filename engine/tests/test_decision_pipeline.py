from __future__ import annotations

import numpy as np
import pytest

from sensortrace_engine.decision import (
    LITERATURE_DEFAULT_POLICY,
    DecisionPolicy,
    Verdict,
    decide,
    effective_pce,
)
from sensortrace_engine.fingerprint import estimate_fingerprint
from sensortrace_engine.matching import ComparisonMeasurement
from sensortrace_engine.pipeline import Candidate, analyse_questioned
from sensortrace_engine.quality import QualityFlag, QualityReport
from sensortrace_engine.synthetic import SyntheticSensor, encode_jpeg, encode_png

GOOD_FP = {"n_images": 30, "split_half": {"pce": 5000.0}}


def meas(pce, *, geometry="native", search=1, valid=1_000_000):
    return ComparisonMeasurement(
        geometry=geometry, pce=pce, ncc=0.0, search_size=search, valid_pixels=valid, valid_fraction=1.0
    )


def test_effective_pce_identity_for_single_test():
    for v in (-5.0, 0.0, 3.0, 60.0, 1e5):
        assert effective_pce(v, 1) == v


def test_effective_pce_decreases_with_search_size_and_stays_finite():
    prev = 400.0
    for n in (2, 100, 10_000, 10_000_000):
        e = effective_pce(400.0, n)
        assert np.isfinite(e) and e < prev
        prev = e
    assert np.isfinite(effective_pce(5e5, 1_000_000))
    # Large-value regime: adjustment is about 2 ln(n).
    assert effective_pce(5000.0, 1000) == pytest.approx(5000 - 2 * np.log(1000), abs=0.5)


def test_effective_pce_matches_goljan_threshold_example():
    # Goljan & Fridrich 2008: alpha = 1e-5 with k = 88,836,025 searched positions needs PCE 53.772.
    from scipy.stats import norm

    single = float(norm.isf(1e-5) ** 2)  # 18.19
    assert effective_pce(53.772, 88_836_025) == pytest.approx(single, abs=0.05)


def test_match_requires_addressing_same_model_alternative():
    m = meas(5000.0)
    assert decide(m, device_class="conventional").verdict is Verdict.MATCH
    d = decide(m, device_class="computational")
    assert d.verdict is Verdict.INCONCLUSIVE and d.nua["mitigation"] == "none"
    assert decide(m, device_class="unknown").verdict is Verdict.INCONCLUSIVE
    ok = decide(m, device_class="computational", control_pces=[3.0, -1.0])
    assert ok.verdict is Verdict.MATCH and ok.nua["mitigation"] == "same_model_controls"
    bad = decide(m, device_class="computational", control_pces=[3.0, 900.0])
    assert bad.verdict is Verdict.INCONCLUSIVE and bad.nua["mitigation"] == "controls_failed"


def test_calibrated_policy_scope_is_respected():
    pol = DecisionPolicy(
        policy_id="cal", match_threshold=80, non_match_threshold=5, calibrated=True, basis="test",
        calibration={"model_keys": ["apple iphone 6"]},
    )  # fmt: skip
    m = meas(500.0)
    assert decide(m, policy=pol, device_class="computational", model_key="apple iphone 6").verdict is Verdict.MATCH
    assert decide(m, policy=pol, device_class="computational", model_key="other").verdict is Verdict.INCONCLUSIVE


def test_non_match_needs_good_conditions():
    low = meas(1.0)
    q_clean = QualityReport(metrics={})
    assert (
        decide(low, quality=q_clean, fingerprint_diagnostics=GOOD_FP, device_class="conventional").verdict
        is Verdict.NON_MATCH
    )
    # weak fingerprint
    weak = decide(low, quality=q_clean, fingerprint_diagnostics={"n_images": 5, "split_half": {"pce": 5000}})
    assert weak.verdict is Verdict.INCONCLUSIVE
    # processing that can hide a match
    q_edit = QualityReport(metrics={}, flags=[QualityFlag("editing_software", "warning", "Edited.")])
    assert decide(low, quality=q_edit, fingerprint_diagnostics=GOOD_FP).verdict is Verdict.INCONCLUSIVE
    # crop
    assert (
        decide(meas(1.0, geometry="cropped", search=1000), quality=q_clean, fingerprint_diagnostics=GOOD_FP).verdict
        is Verdict.INCONCLUSIVE
    )


def test_unsuitable_outcomes():
    assert decide(ComparisonMeasurement(geometry="unsupported", notes=["x"])).verdict is Verdict.UNSUITABLE
    assert decide(meas(1.0, valid=1000), fingerprint_diagnostics=GOOD_FP).verdict is Verdict.UNSUITABLE
    q = QualityReport(metrics={}, flags=[QualityFlag("digital_zoom", "severe", "Zoomed.")])
    assert decide(meas(1.0), quality=q, fingerprint_diagnostics=GOOD_FP).verdict is Verdict.UNSUITABLE
    # ... but poor quality never blocks a high statistic
    assert decide(meas(900.0), quality=q, device_class="conventional").verdict is Verdict.MATCH


def test_between_thresholds_is_inconclusive():
    assert (
        decide(meas(30.0), fingerprint_diagnostics=GOOD_FP, device_class="conventional").verdict is Verdict.INCONCLUSIVE
    )


def test_candidate_count_is_a_multiple_testing_cost():
    one = decide(meas(62.0), device_class="conventional", n_candidates=1)
    many = decide(meas(62.0), device_class="conventional", n_candidates=500)
    assert one.verdict is Verdict.MATCH and many.verdict is Verdict.INCONCLUSIVE
    assert many.effective_pce < 60 < one.effective_pce


def test_decision_never_contains_a_probability_of_origin():
    d = decide(meas(5000.0), device_class="conventional").to_dict()
    text = " ".join(d["reasons"] + d["caveats"]).lower()
    assert "not a probability" in text
    assert LITERATURE_DEFAULT_POLICY.calibrated is False and "uncalibrated" in " ".join(d["caveats"]).lower()


# ------------------------------------------------------------------ pipeline


@pytest.fixture(scope="module")
def trio():
    shape = (512, 640)  # > 250k pixels so conclusions are permitted
    sensors = [SyntheticSensor(s, shape) for s in (11, 12, 13)]
    fps = [estimate_fingerprint([s.capture(i, flat=True) for i in range(20)]) for s in sensors]
    return sensors, fps


def _cands(fps, device_class="conventional", model_key=None):
    return [
        Candidate(f"s{i}", fp, label=f"Sensor {i}", device_id=f"d{i}", model_key=model_key, device_class=device_class)
        for i, fp in enumerate(fps)
    ]


def test_pipeline_identifies_the_right_candidate_and_ranks_it_first(trio):
    sensors, fps = trio
    res = analyse_questioned(encode_png(sensors[1].capture(200)), _cands(fps))
    top = res.candidates[0]
    assert top.candidate_id == "s1" and top.rank == 1 and top.decision.verdict is Verdict.MATCH
    assert all(c.decision.verdict is not Verdict.MATCH for c in res.candidates[1:])
    assert res.summary["counts"]["match_supported"] == 1


def test_pipeline_does_not_force_a_match_for_an_unknown_source(trio):
    _, fps = trio
    stranger = SyntheticSensor(99, (512, 640))
    res = analyse_questioned(encode_png(stranger.capture(1)), _cands(fps))
    assert all(c.decision.verdict is not Verdict.MATCH for c in res.candidates)
    assert res.summary["counts"]["match_supported"] == 0
    assert "not enrolled" in res.summary["text"]


def test_pipeline_uses_same_model_controls_and_reports_delta(trio):
    sensors, fps = trio
    res = analyse_questioned(
        encode_png(sensors[0].capture(201)), _cands(fps, device_class="computational", model_key="acme x1")
    )
    top = res.candidates[0]
    assert top.candidate_id == "s0" and top.decision.verdict is Verdict.MATCH
    assert top.decision.nua["mitigation"] == "same_model_controls" and len(top.control_ids) == 2
    assert top.delta_spce is not None and top.delta_spce > 1000
    assert top.to_dict()["experimental"]["delta_spce"] == top.delta_spce


def test_shared_artefact_between_same_model_devices_is_not_called_a_match():
    """Two devices whose images share a strong common pattern (a simulated model-level
    artefact): each exceeds the threshold for the other's images, so neither is singled out."""
    shape = (512, 640)
    shared = SyntheticSensor(700, shape)
    a, b = SyntheticSensor(701, shape, prnu_strength=0.004), SyntheticSensor(702, shape, prnu_strength=0.004)
    a.k = a.k + shared.k
    b.k = b.k + shared.k
    fa = estimate_fingerprint([a.capture(i, flat=True) for i in range(20)])
    fb = estimate_fingerprint([b.capture(i, flat=True) for i in range(20)])
    cands = [
        Candidate("a", fa, device_id="da", model_key="m", device_class="computational"),
        Candidate("b", fb, device_id="db", model_key="m", device_class="computational"),
    ]
    res = analyse_questioned(encode_png(a.capture(300)), cands)
    by = {c.candidate_id: c for c in res.candidates}
    assert by["b"].measurement.pce > 60  # the false-match mechanism is present
    assert by["a"].decision.verdict is Verdict.INCONCLUSIVE
    assert by["a"].decision.nua["mitigation"] == "controls_failed"
    assert by["b"].decision.verdict is Verdict.INCONCLUSIVE


def test_pipeline_result_is_json_serialisable_and_versioned(trio):
    import json

    sensors, fps = trio
    res = analyse_questioned(encode_jpeg(sensors[2].capture(202), 92), _cands(fps))
    blob = json.dumps(res.to_dict(include_surface=True))
    d = json.loads(blob)
    assert d["provenance"]["algorithm_version"] and d["image"]["sha256"]
    assert d["candidates"][0]["measurement"]["surface_window"]


def test_low_statistic_is_never_a_non_match_for_computational_or_unknown_devices():
    """Measured on recent smartphones: 13% of genuine same-device images score near zero while
    meeting every other precondition, so a low statistic there cannot support a non-match."""
    low, clean = meas(0.3), QualityReport(metrics={})
    for cls in ("computational", "unknown"):
        d = decide(low, quality=clean, fingerprint_diagnostics=GOOD_FP, device_class=cls)
        assert d.verdict is Verdict.INCONCLUSIVE
        assert "conventional processing pipeline" in " ".join(d.reasons)
    assert (
        decide(low, quality=clean, fingerprint_diagnostics=GOOD_FP, device_class="conventional").verdict
        is Verdict.NON_MATCH
    )
