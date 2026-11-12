"""Reproducible empirical evaluation on images with known source devices.

Protocol (see ``VALIDATION.md``)
--------------------------------
* A JSON manifest lists devices, their model key and a **device-level split**
  (``calibration`` or ``test``). Thresholds are selected on calibration
  devices only and then applied, unchanged, to test devices: no device
  contributes to both.
* Reference (enrolment) and test images of a device come from different
  capture categories and are checked for exact and near duplicates.
* Every test image is scored against every fingerprint. Trials are stratified
  into same device, same model / different device, and different model, and by
  geometry (native vs cropped search) and condition (original, recompressed).
* Error rates are reported with exact binomial intervals and the number of
  trials and devices behind them.

Nothing here uses synthetic data.
"""

from __future__ import annotations

import csv
import io
import json
import multiprocessing as mp
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from . import stats
from .decision import DecisionPolicy, effective_pce
from .enrol import ReferenceInput, enrol
from .fingerprint import Fingerprint
from .ingest import hamming_hex, ingest_image
from .matching import compare
from .quality import assess_quality
from .residual import extract_residual
from .version import ALGORITHM_VERSION, ENGINE_VERSION, library_versions

IMAGE_EXT = {".jpg", ".jpeg", ".png"}


@dataclass(frozen=True)
class DeviceSpec:
    id: str
    dir: str
    model_key: str
    split: str  # "calibration" | "test"


def load_manifest(path: Path) -> dict[str, Any]:
    m = json.loads(Path(path).read_text())
    m["devices"] = [DeviceSpec(**d) for d in m["devices"]]
    return m


def _files(root: Path, dev: DeviceSpec, category: str, count: int) -> list[Path]:
    d = root / dev.dir / category
    files = sorted(p for p in d.iterdir() if p.suffix.lower() in IMAGE_EXT) if d.is_dir() else []
    return files[:count]


# ----------------------------------------------------------------- enrolment


def _enrol_device(args: tuple[str, list[str], str]) -> dict[str, Any]:
    from . import matching

    matching.FFT_WORKERS = 1
    dev_id, files, out_path = args
    t0 = time.time()
    refs = [ReferenceInput(Path(f).name, (lambda f=f: Path(f).read_bytes())) for f in files]
    res = enrol(refs)
    assert res.fingerprint is not None
    Path(out_path).write_bytes(res.fingerprint.to_bytes())
    d = res.fingerprint.diagnostics
    return {
        "device": dev_id,
        "submitted": len(files),
        "accepted": len(res.accepted),
        "rejected": [{"file": o.ref_id, "reasons": o.reasons} for o in res.outcomes if not o.accepted],
        "shape": list(res.fingerprint.shape),
        "split_half_pce": (d.get("split_half") or {}).get("pce"),
        "loo_pce_median": d["screening"]["loo_pce_median"],
        "digest": res.fingerprint.digest(),
        "warnings": res.warnings,
        "seconds": round(time.time() - t0, 1),
    }


# ------------------------------------------------------------------- scoring

_FPS: dict[str, Fingerprint] = {}


def _init_worker(fp_dir: str, dev_ids: list[str]) -> None:
    from . import matching

    matching.FFT_WORKERS = 1  # one thread per process: the pool already uses every core
    for d in dev_ids:
        _FPS[d] = Fingerprint.from_bytes((Path(fp_dir) / f"{d}.npz").read_bytes())


def _recompress(pixels: np.ndarray, quality: int) -> np.ndarray:
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    return np.asarray(Image.open(buf).convert("RGB" if pixels.ndim == 3 else "L"))


def _score_image(args: tuple[str, str, list[str], bool]) -> list[dict[str, Any]]:
    dev_id, path, conditions, include_cropped = args
    img = ingest_image(Path(path).read_bytes())
    q = assess_quality(img)
    rows: list[dict[str, Any]] = []
    for cond in conditions:
        pixels = img.pixels if cond == "original" else _recompress(img.pixels, int(cond.removeprefix("jpeg")))
        res = extract_residual(pixels)
        for cand, fp in _FPS.items():
            same_size = set(res.shape) == set(fp.shape)
            if not same_size and not (include_cropped and cond == "original"):
                continue
            m = compare(res, fp)
            rows.append(
                {
                    "image": Path(path).name,
                    "sha256": img.sha256,
                    "dhash": img.dhash,
                    "device": dev_id,
                    "candidate": cand,
                    "condition": cond,
                    "geometry": m.geometry,
                    "pce": m.pce,
                    "eff_pce": effective_pce(m.pce, m.search_size) if m.pce is not None else None,
                    "ncc": m.ncc,
                    "rotation": m.rotation,
                    "search_size": m.search_size,
                    "valid_fraction": m.valid_fraction,
                    "mean_intensity": q.metrics["mean_intensity"],
                    "saturated_fraction": q.metrics["saturated_fraction"],
                    "texture_index": q.metrics["texture_index"],
                    "jpeg_quality": q.metrics["jpeg_quality_estimate"],
                }
            )
    return rows


def _score_job(job: tuple[str, str, list[str], bool]) -> tuple[tuple[str, str, list[str], bool], list[dict[str, Any]]]:
    return job, _score_image(job)


def run_scoring(
    manifest: dict[str, Any], out_dir: Path, *, workers: int = 6, include_cropped: bool = True
) -> list[dict[str, Any]]:
    """Enrol every device, score every test image, and write ``scores.csv``."""
    root = Path(manifest["root"])
    out_dir.mkdir(parents=True, exist_ok=True)
    fp_dir = out_dir / "fingerprints"
    fp_dir.mkdir(exist_ok=True)
    devices: list[DeviceSpec] = manifest["devices"]
    ref_cfg, test_cfg = manifest["reference"], manifest["test"]

    enrol_jobs, ref_files, test_files = [], {}, {}
    for dev in devices:
        ref_files[dev.id] = _files(root, dev, ref_cfg["category"], ref_cfg["count"])
        test_files[dev.id] = _files(root, dev, test_cfg["category"], test_cfg["count"])
        if not ref_files[dev.id] or not test_files[dev.id]:
            raise FileNotFoundError(f"no images found for device {dev.id} under {root / dev.dir}")
        if not (fp_dir / f"{dev.id}.npz").exists():
            enrol_jobs.append((dev.id, [str(p) for p in ref_files[dev.id]], str(fp_dir / f"{dev.id}.npz")))

    enrol_log_path = out_dir / "enrolment.json"
    enrol_log = json.loads(enrol_log_path.read_text()) if enrol_log_path.exists() else {}
    ctx = mp.get_context("spawn")
    if enrol_jobs:
        with ctx.Pool(min(workers, 4, len(enrol_jobs))) as pool:
            for r in pool.imap_unordered(_enrol_device, enrol_jobs):
                enrol_log[r["device"]] = r
                print(
                    f"enrolled {r['device']}: {r['accepted']}/{r['submitted']} refs, split-half PCE {r['split_half_pce']:.0f}, {r['seconds']}s",
                    flush=True,
                )
        enrol_log_path.write_text(json.dumps(enrol_log, indent=2))

    # Recompressed conditions are evaluated on test devices only: calibration uses originals.
    jobs = [
        (dev.id, str(p), list(manifest["conditions"]) if dev.split == "test" else ["original"], include_cropped)
        for dev in devices
        for p in test_files[dev.id]
    ]
    # Scoring is resumable: finished images are appended to a partial file and skipped on restart.
    partial = out_dir / "scores.partial.jsonl"
    rows: list[dict[str, Any]] = []
    done: set[tuple[str, str]] = set()
    if partial.exists():
        for line in partial.read_text().splitlines():
            rec = json.loads(line)
            rows.extend(rec["rows"])
            done.add((rec["device"], rec["path"]))
    todo = [j for j in jobs if (j[0], j[1]) not in done]
    print(f"scoring {len(todo)} images ({len(done)} already done)", flush=True)
    t0 = time.time()
    if todo:
        with (
            ctx.Pool(workers, initializer=_init_worker, initargs=(str(fp_dir), [d.id for d in devices])) as pool,
            partial.open("a") as sink,
        ):
            for i, (job, r) in enumerate(pool.imap_unordered(_score_job, todo), start=1):
                rows.extend(r)
                sink.write(json.dumps({"device": job[0], "path": job[1], "rows": r}) + "\n")
                sink.flush()
                if i % 10 == 0 or i == len(todo):
                    print(f"scored {i}/{len(todo)} images ({time.time() - t0:.0f}s)", flush=True)
    rows.sort(key=lambda r: (r["device"], r["image"], r["condition"], r["candidate"]))
    with (out_dir / "scores.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    return rows


def load_scores(path: Path) -> list[dict[str, Any]]:
    rows = []
    with Path(path).open() as f:
        for r in csv.DictReader(f):
            for k in (
                "pce",
                "eff_pce",
                "ncc",
                "valid_fraction",
                "mean_intensity",
                "saturated_fraction",
                "texture_index",
                "jpeg_quality",
            ):
                r[k] = float(r[k]) if r[k] not in ("", "None") else None
            for k in ("rotation", "search_size"):
                r[k] = int(r[k]) if r[k] not in ("", "None") else None
            rows.append(r)
    return rows


# ------------------------------------------------------------------ analysis


def _stratum(row: dict[str, Any], dev: dict[str, DeviceSpec]) -> str:
    if row["device"] == row["candidate"]:
        return "same_device"
    if dev[row["device"]].model_key == dev[row["candidate"]].model_key:
        return "same_model"
    return "different_model"


def _summarise(same: list[float], diff: list[float], thr: float | None) -> dict[str, Any]:
    out: dict[str, Any] = {"n_same": len(same), "n_diff": len(diff)}
    if same and diff:
        out["auc"] = stats.auc(same, diff)
        out["auc_ci_trial_bootstrap"] = list(stats.auc_bootstrap(same, diff, n_boot=1000))
    if thr is not None:
        out["operating_point"] = stats.operating_point(same, diff, thr).to_dict()
    if diff:
        out["max_diff"] = float(np.max(diff))
        out["diff_quantiles"] = {q: float(np.quantile(diff, float(q))) for q in ("0.5", "0.95", "0.99")}
    if same:
        out["same_quantiles"] = {q: float(np.quantile(same, float(q))) for q in ("0.01", "0.05", "0.5")}
    return out


def find_leakage(
    rows: list[dict[str, Any]], enrol_log: dict[str, Any], ref_hashes: dict[str, set[str]]
) -> dict[str, Any]:
    """Exact duplicates between reference and test sets, and near-duplicate test images."""
    seen: dict[str, tuple[str, str]] = {}
    for r in rows:
        seen.setdefault(r["sha256"], (r["device"], r["dhash"]))
    exact = [s for s, (d, _) in seen.items() if s in ref_hashes.get(d, set())]
    by_dev: dict[str, list[str]] = defaultdict(list)
    for _s, (d, h) in seen.items():
        by_dev[d].append(h)
    near = 0
    for hs in by_dev.values():
        for i in range(len(hs)):
            for j in range(i + 1, len(hs)):
                if hamming_hex(hs[i], hs[j]) <= 2:
                    near += 1
    return {
        "test_images": len(seen),
        "exact_reference_test_duplicates": len(exact),
        "near_duplicate_test_pairs_within_device": near,
        "note": "Near duplicates (dHash distance <= 2) are counted, not removed; they make trials less independent.",
    }


def analyse(
    rows: list[dict[str, Any]],
    manifest: dict[str, Any],
    *,
    target_fpr: float = 0.01,
    target_fnr: float = 0.01,
    reference_line: float = 60.0,
) -> dict[str, Any]:
    """Select thresholds on calibration devices and evaluate them on test devices."""
    dev = {d.id: d for d in manifest["devices"]}
    split = {d.id: d.split for d in manifest["devices"]}

    def pick(sp: str, cond: str, geom: tuple[str, ...], strata: tuple[str, ...]) -> list[float]:
        return [
            r["eff_pce"]
            for r in rows
            if r["eff_pce"] is not None
            and split[r["device"]] == sp
            and split[r["candidate"]] == sp
            and r["condition"] == cond
            and r["geometry"] in geom
            and _stratum(r, dev) in strata
        ]

    native = ("native", "rotated")
    cal_same = pick("calibration", "original", native, ("same_device",))
    cal_sm = pick("calibration", "original", native, ("same_model",))
    cal_dm = pick("calibration", "original", native, ("different_model",))
    cal_diff = cal_sm + cal_dm

    match_thr = stats.threshold_for_fpr(cal_diff, target_fpr)
    match_thr_sm = stats.threshold_for_fpr(cal_sm, target_fpr)
    non_match_thr = stats.threshold_for_fnr(cal_same, target_fnr)
    # The stricter of the pooled and same-model thresholds is used.
    candidates = [t for t in (match_thr, match_thr_sm) if t is not None]
    chosen = max(candidates) if candidates else None

    result: dict[str, Any] = {
        "dataset": {k: manifest[k] for k in ("name", "attribution") if k in manifest},
        "engine": {
            "algorithm_version": ALGORITHM_VERSION,
            "engine_version": ENGINE_VERSION,
            "libraries": library_versions(),
        },
        "protocol": {
            "target_fpr": target_fpr,
            "target_fnr": target_fnr,
            "reference_line": reference_line,
            "statistic": "effective signed PCE (adjusted for the alignments searched)",
            "devices": {sp: sorted(d.id for d in dev.values() if d.split == sp) for sp in ("calibration", "test")},
            "models": {
                sp: sorted({d.model_key for d in dev.values() if d.split == sp}) for sp in ("calibration", "test")
            },
        },
        "calibration": {
            "n_same": len(cal_same),
            "n_same_model_diff": len(cal_sm),
            "n_different_model_diff": len(cal_dm),
            "match_threshold_pooled_negatives": match_thr,
            "match_threshold_same_model_negatives": match_thr_sm,
            "match_threshold_selected": chosen,
            "non_match_threshold_selected": non_match_thr,
            "summary_all": _summarise(cal_same, cal_diff, chosen),
            "summary_same_model": _summarise(cal_same, cal_sm, chosen),
            "method": (
                "Match threshold: smallest value whose empirical false-positive rate on calibration "
                "negatives does not exceed the target, computed on pooled and on same-model "
                "negatives; the larger is selected. Non-match threshold: largest value whose "
                "empirical miss rate on calibration positives does not exceed the target. "
                "A threshold is null when the calibration set is too small to resolve the target."
            ),
        },
        "test": {},
    }

    for cond in manifest["conditions"]:
        t_same = pick("test", cond, native, ("same_device",))
        block: dict[str, Any] = {}
        for name, strata in (
            ("all_negatives", ("same_model", "different_model")),
            ("same_model", ("same_model",)),
            ("different_model", ("different_model",)),
        ):
            t_diff = pick("test", cond, native, strata)
            entry = {
                "calibrated": _summarise(t_same, t_diff, chosen),
                "reference_line": _summarise(t_same, t_diff, reference_line),
            }
            if chosen is not None and non_match_thr is not None:
                entry["confusion_calibrated"] = stats.confusion(t_same, t_diff, chosen, non_match_thr)
            block[name] = entry
        result["test"][cond] = block

    # Experimental strata: crop search (questioned image smaller than the fingerprint).
    crop_diff = [
        r["eff_pce"]
        for r in rows
        if r["geometry"] == "cropped" and r["eff_pce"] is not None and r["condition"] == "original"
    ]
    crop_raw = [
        r["pce"] for r in rows if r["geometry"] == "cropped" and r["pce"] is not None and r["condition"] == "original"
    ]
    if crop_diff:
        result["cropped_search_negatives"] = {
            "n": len(crop_diff),
            "note": "All cross-resolution trials are different-device by construction (true negatives).",
            "raw_pce_exceeding_reference_line": int(np.sum(np.array(crop_raw) >= reference_line)),
            "adjusted_exceeding_reference_line": int(np.sum(np.array(crop_diff) >= reference_line)),
            "adjusted_fpr_ci": list(
                stats.clopper_pearson(int(np.sum(np.array(crop_diff) >= reference_line)), len(crop_diff))
            ),
            "raw_pce_max": float(np.max(crop_raw)),
            "adjusted_max": float(np.max(crop_diff)),
        }

    # Per-device spread on the test split (original condition).
    per_dev: dict[str, Any] = {}
    for d in dev.values():
        if d.split != "test":
            continue
        s = [
            r["eff_pce"]
            for r in rows
            if r["device"] == d.id
            and r["candidate"] == d.id
            and r["condition"] == "original"
            and r["eff_pce"] is not None
        ]
        n = [
            r["eff_pce"]
            for r in rows
            if r["candidate"] == d.id
            and r["device"] != d.id
            and split[r["device"]] == "test"
            and r["condition"] == "original"
            and r["geometry"] in native
            and r["eff_pce"] is not None
        ]
        per_dev[d.id] = {
            "model_key": d.model_key,
            "n_same": len(s),
            "same_median": float(np.median(s)) if s else None,
            "same_min": float(np.min(s)) if s else None,
            "n_diff": len(n),
            "diff_max": float(np.max(n)) if n else None,
            "misses_at_selected": int(np.sum(np.array(s) < chosen)) if (s and chosen is not None) else None,
            "false_matches_at_selected": int(np.sum(np.array(n) >= chosen)) if (n and chosen is not None) else None,
        }
    result["test_per_device"] = per_dev
    return result


def calibrated_policy(result: dict[str, Any], manifest: dict[str, Any]) -> DecisionPolicy | None:
    """Build a scoped decision policy from an evaluation result, or ``None`` if unsupported."""
    cal = result["calibration"]
    if cal["match_threshold_selected"] is None or cal["non_match_threshold_selected"] is None:
        return None
    counts = defaultdict(int)
    for d in manifest["devices"]:
        if d.split == "calibration":
            counts[d.model_key] += 1
    scope = sorted(k for k, n in counts.items() if n >= 2)
    test_all = result["test"]["original"]["all_negatives"]["calibrated"].get("operating_point")
    return DecisionPolicy(
        policy_id=f"calibrated-{manifest['name']}",
        match_threshold=float(cal["match_threshold_selected"]),
        non_match_threshold=float(min(cal["non_match_threshold_selected"], cal["match_threshold_selected"])),
        calibrated=True,
        basis=(
            f"Thresholds selected on calibration devices of the {manifest['name']} evaluation at a target "
            f"false-positive rate of {result['protocol']['target_fpr']:g} and miss rate of "
            f"{result['protocol']['target_fnr']:g}, native-resolution camera-original JPEGs only. "
            "Valid only for the listed models and comparable conditions."
        ),
        calibration={
            "dataset": manifest["name"],
            "attribution": manifest.get("attribution"),
            "model_keys": scope,
            "n_same": cal["n_same"],
            "n_same_model_diff": cal["n_same_model_diff"],
            "n_different_model_diff": cal["n_different_model_diff"],
            "target_fpr": result["protocol"]["target_fpr"],
            "target_fnr": result["protocol"]["target_fnr"],
            "held_out_test_operating_point": test_all,
            "algorithm_version": ALGORITHM_VERSION,
        },
    )
