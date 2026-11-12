"""Audit experiments on authentic images (VISION subset). Deterministic; no synthetic data.

Run from the engine environment after `make eval-data` and `make evaluate`:

    cd engine && uv run python ../audit/experiments/robustness_vision.py

Inputs:  data/vision/ (images), data/eval/vision_subset_v1/ (cached fingerprints, scores.csv)
Output:  audit/experiments/robustness_vision_results.json

Experiments
-----------
E1  Open-set galleries: each held-out image against a gallery that does NOT contain its sensor.
E2  Threshold-free summary on held-out devices: EER and TPR at fixed FPR.
E3  Real crops: a 1024x768 region at a random offset, against the true sensor and another one.
E4  Incompatible transforms: images resized by 0.5 and 1.25.
E5  Reference sets: 5, 10, 20 flat-field images and 20 natural images.
"""

from __future__ import annotations

import json
import multiprocessing as mp
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
EVAL = ROOT / "data/eval/vision_subset_v1"
DATA = ROOT / "data/vision"
OUT = Path(__file__).with_name("robustness_vision_results.json")
SEED = 20261112
REFERENCE_LINE = 60.0

DEVICES = {  # id -> (directory, model key, split)
    "D05": ("D05_Apple_iPhone5c", "apple iphone 5c", "calibration"),
    "D14": ("D14_Apple_iPhone5c", "apple iphone 5c", "calibration"),
    "D18": ("D18_Apple_iPhone5c", "apple iphone 5c", "calibration"),
    "D02": ("D02_Apple_iPhone4s", "apple iphone 4s", "calibration"),
    "D10": ("D10_Apple_iPhone4s", "apple iphone 4s", "calibration"),
    "D03": ("D03_Huawei_P9", "huawei p9", "calibration"),
    "D06": ("D06_Apple_iPhone6", "apple iphone 6", "test"),
    "D15": ("D15_Apple_iPhone6", "apple iphone 6", "test"),
    "D29": ("D29_Apple_iPhone5", "apple iphone 5", "test"),
    "D34": ("D34_Apple_iPhone5", "apple iphone 5", "test"),
    "D01": ("D01_Samsung_GalaxyS3Mini", "samsung galaxy s3 mini", "test"),
    "D26": ("D26_Samsung_GalaxyS3Mini", "samsung galaxy s3 mini", "test"),
    "D11": ("D11_Samsung_GalaxyS3", "samsung galaxy s3", "test"),
}
TEST = [d for d, v in DEVICES.items() if v[2] == "test"]
PARTNER = {"D06": "D15", "D15": "D06", "D29": "D34", "D34": "D29", "D01": "D26", "D26": "D01", "D11": "D06"}


def files(dev: str, cat: str) -> list[Path]:
    return sorted((DATA / DEVICES[dev][0] / cat).glob("*.jpg"))


def load_fp(dev: str):
    from sensortrace_engine.fingerprint import Fingerprint

    return Fingerprint.from_bytes((EVAL / "fingerprints" / f"{dev}.npz").read_bytes())


def _setup():
    from sensortrace_engine import matching

    matching.FFT_WORKERS = 1


# ----------------------------------------------------------------- E1, E2


def from_scores() -> dict:
    from sensortrace_engine import evaluation as ev
    from sensortrace_engine import stats
    from sensortrace_engine.decision import effective_pce

    rows = [
        r
        for r in ev.load_scores(EVAL / "scores.csv")
        if r["condition"] == "original" and r["geometry"] in ("native", "rotated") and r["pce"] is not None
    ]
    by_image: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        by_image.setdefault((r["device"], r["image"]), []).append(r)

    def gallery(include_own: bool, test_only: bool) -> dict:
        n = any_match = correct_only = wrong = multi = 0
        max_adj = []
        for (dev, _img), cands in by_image.items():
            if test_only and DEVICES[dev][2] != "test":
                continue
            g = [
                c
                for c in cands
                if (include_own or c["candidate"] != dev) and (not test_only or DEVICES[c["candidate"]][2] == "test")
            ]
            if not g:
                continue
            n += 1
            # the product charges every candidate in the gallery as an additional trial
            adj = {c["candidate"]: effective_pce(c["pce"], c["search_size"] * len(g)) for c in g}
            hits = [k for k, v in adj.items() if v >= REFERENCE_LINE]
            max_adj.append(max(v for k, v in adj.items() if k != dev) if any(k != dev for k in adj) else float("nan"))
            any_match += bool(hits)
            correct_only += hits == [dev]
            wrong += any(h != dev for h in hits)
            multi += len(hits) > 1
        out = {
            "images": n,
            "images_with_any_match": any_match,
            "images_matching_a_wrong_sensor": wrong,
            "images_with_multiple_matches": multi,
        }
        if include_own:
            out["images_matching_only_their_own_sensor"] = correct_only
        out["wrong_sensor_rate_ci95"] = list(stats.clopper_pearson(wrong, n))
        out["highest_adjusted_statistic_for_a_wrong_sensor"] = float(np.nanmax(max_adj))
        return out

    same = [r["eff_pce"] for r in rows if r["device"] == r["candidate"] and DEVICES[r["device"]][2] == "test"]
    diff = [
        r["eff_pce"]
        for r in rows
        if r["device"] != r["candidate"] and DEVICES[r["device"]][2] == "test" and DEVICES[r["candidate"]][2] == "test"
    ]
    roc = stats.roc_curve(same, diff)
    fnr = 1 - roc["tpr"]
    i = int(np.argmin(np.abs(roc["fpr"] - fnr)))

    def tpr_at(fpr: float) -> float | None:
        if len(diff) < 1 / fpr:
            return None  # the negatives cannot resolve this rate
        ok = roc["fpr"] <= fpr
        return float(roc["tpr"][ok].max())

    return {
        "E1_open_set": {
            "note": "Gallery of same-resolution sensors. 'unseen' removes the image's own sensor, so every match would be a false identification.",
            "all_devices_unseen_sensor": gallery(False, False),
            "all_devices_own_sensor_in_gallery": gallery(True, False),
            "held_out_devices_unseen_sensor": gallery(False, True),
            "held_out_devices_own_sensor_in_gallery": gallery(True, True),
        },
        "E2_threshold_free_held_out": {
            "n_same": len(same),
            "n_diff": len(diff),
            "auc": stats.auc(same, diff),
            "equal_error_rate": float((roc["fpr"][i] + fnr[i]) / 2),
            "tpr_at_fpr_0.01": tpr_at(0.01),
            "tpr_at_fpr_0.001": tpr_at(0.001),
            "note": "880 negatives resolve false-positive rates down to about 1/880 only; lower operating points are not reported.",
        },
    }


# ----------------------------------------------------------------- E3, E4


def _crop_and_transform(job: tuple[str, str, int]) -> dict:
    _setup()
    from sensortrace_engine.decision import effective_pce
    from sensortrace_engine.ingest import ingest_image
    from sensortrace_engine.matching import compare
    from sensortrace_engine.residual import extract_residual

    dev, path, idx = job
    rng = np.random.default_rng([SEED, idx])
    img = ingest_image(Path(path).read_bytes()).pixels
    own, other = load_fp(dev), load_fp(PARTNER[dev])
    h, w = img.shape[:2]
    ch, cw = 768, 1024
    top, left = int(rng.integers(0, h - ch + 1)), int(rng.integers(0, w - cw + 1))
    crop = np.ascontiguousarray(img[top : top + ch, left : left + cw])
    res = extract_residual(crop)
    m_own, m_other = compare(res, own), compare(res, other)
    out = {
        "device": dev,
        "image": Path(path).name,
        "crop_offset": [top, left],
        "crop_own": {"pce": m_own.pce, "eff": effective_pce(m_own.pce, m_own.search_size), "shift": list(m_own.shift), "rotation": m_own.rotation,
                     "search": m_own.search_size, "located": list(m_own.shift) == [top, left] and m_own.rotation == 0},
        "crop_other": {"pce": m_other.pce, "eff": effective_pce(m_other.pce, m_other.search_size), "candidate": PARTNER[dev]},
    }  # fmt: skip
    half = cv2.resize(img, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
    m_half = compare(extract_residual(half), own)
    out["resized_0.5_own"] = {
        "geometry": m_half.geometry,
        "pce": m_half.pce,
        "eff": effective_pce(m_half.pce, m_half.search_size) if m_half.pce is not None else None,
    }
    up = cv2.resize(img[: h // 2, : w // 2], None, fx=1.25, fy=1.25, interpolation=cv2.INTER_CUBIC)
    # an upscaled quarter still fits inside the fingerprint: it must be searched and must not match
    m_up = compare(extract_residual(up), own)
    out["upscaled_1.25_region_own"] = {
        "geometry": m_up.geometry,
        "pce": m_up.pce,
        "eff": effective_pce(m_up.pce, m_up.search_size) if m_up.pce is not None else None,
    }
    big = cv2.resize(img, None, fx=1.25, fy=1.25, interpolation=cv2.INTER_CUBIC)
    out["upscaled_1.25_full_own"] = {"geometry": compare(extract_residual(big), own).geometry}
    return out


# --------------------------------------------------------------------- E5


def _reference_sets(job: tuple[str, str, int]) -> dict:
    _setup()
    from sensortrace_engine.enrol import ReferenceInput, enrol
    from sensortrace_engine.ingest import ingest_image
    from sensortrace_engine.matching import compare
    from sensortrace_engine.residual import extract_residual

    dev, kind, n = job
    refs = files(dev, "flat")[:n] if kind == "flat" else files(dev, "nat")[20 : 20 + n]
    res = enrol([ReferenceInput(p.name, (lambda p=p: p.read_bytes())) for p in refs])
    fp = res.fingerprint
    assert fp is not None

    def scores(d: str) -> list[float]:
        out = []
        for p in files(d, "nat")[:20]:  # disjoint from the natural reference images (21-40)
            m = compare(extract_residual(ingest_image(p.read_bytes()).pixels), fp)
            out.append(float(m.pce))
        return out

    same, diff = scores(dev), scores(PARTNER[dev])
    return {
        "device": dev, "reference_type": kind, "requested": n, "accepted": len(res.accepted),
        "split_half_pce": (fp.diagnostics.get("split_half") or {}).get("pce"),
        "same_device": {"n": len(same), "min": min(same), "median": float(np.median(same)), "below_60": int(sum(s < REFERENCE_LINE for s in same))},
        "same_model_other_device": {"candidate_images_from": PARTNER[dev], "n": len(diff), "max": max(diff), "at_or_above_60": int(sum(s >= REFERENCE_LINE for s in diff))},
    }  # fmt: skip


def main() -> int:
    if not (EVAL / "scores.csv").exists():
        print("run `make evaluate` first", file=sys.stderr)
        return 1
    results: dict = {"seed": SEED, "reference_line": REFERENCE_LINE}
    results.update(from_scores())
    print(json.dumps(results["E1_open_set"]["held_out_devices_unseen_sensor"]), flush=True)

    ctx = mp.get_context("spawn")
    crop_jobs = [(d, str(p), 1000 * i + j) for i, d in enumerate(TEST) for j, p in enumerate(files(d, "nat")[:15])]
    ref_jobs = [
        (d, k, n)
        for d in ("D06", "D15", "D29", "D34")
        for k, n in (("flat", 5), ("flat", 10), ("flat", 20), ("natural", 20))
    ]
    with ctx.Pool(4) as pool:
        crops = []
        for k, r in enumerate(pool.imap_unordered(_crop_and_transform, crop_jobs), start=1):
            crops.append(r)
            if k % 20 == 0:
                print(f"crops/transforms {k}/{len(crop_jobs)}", flush=True)
        refs = []
        for r in pool.imap_unordered(_reference_sets, ref_jobs):
            refs.append(r)
            print(
                f"reference set {r['device']} {r['reference_type']} n={r['requested']}: min same {r['same_device']['min']:.0f}, max other {r['same_model_other_device']['max']:.1f}",
                flush=True,
            )
    crops.sort(key=lambda r: (r["device"], r["image"]))
    refs.sort(key=lambda r: (r["device"], r["reference_type"], r["requested"]))

    own = [c["crop_own"] for c in crops]
    other = [c["crop_other"] for c in crops]
    results["E3_real_crops"] = {
        "n": len(crops), "crop_pixels": [768, 1024],
        "true_sensor": {"located_at_true_offset": int(sum(o["located"] for o in own)), "adjusted_at_or_above_60": int(sum(o["eff"] >= REFERENCE_LINE for o in own)),
                        "adjusted_min": float(min(o["eff"] for o in own)), "adjusted_median": float(np.median([o["eff"] for o in own]))},
        "other_sensor": {"adjusted_at_or_above_60": int(sum(o["eff"] >= REFERENCE_LINE for o in other)), "adjusted_max": float(max(o["eff"] for o in other)),
                         "raw_max": float(max(o["pce"] for o in other))},
        "per_image": crops,
    }  # fmt: skip
    half = [c["resized_0.5_own"] for c in crops]
    upr = [c["upscaled_1.25_region_own"] for c in crops]
    results["E4_incompatible_transforms"] = {
        "n": len(crops),
        "resized_0.5_true_sensor": {"geometry": sorted({h["geometry"] for h in half}), "adjusted_at_or_above_60": int(sum((h["eff"] or -1) >= REFERENCE_LINE for h in half)),
                                    "adjusted_max": float(max(h["eff"] for h in half if h["eff"] is not None))},
        "upscaled_1.25_region_true_sensor": {"geometry": sorted({u["geometry"] for u in upr}), "adjusted_at_or_above_60": int(sum((u["eff"] or -1) >= REFERENCE_LINE for u in upr)),
                                             "adjusted_max": float(max(u["eff"] for u in upr if u["eff"] is not None))},
        "upscaled_1.25_full_image": {"geometry": sorted({c["upscaled_1.25_full_own"]["geometry"] for c in crops})},
        "note": "These are true same-sensor images. Not matching them is the documented behaviour: resampled images are unsupported.",
    }  # fmt: skip
    results["E5_reference_sets"] = refs
    OUT.write_text(json.dumps(results, indent=2) + "\n")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
