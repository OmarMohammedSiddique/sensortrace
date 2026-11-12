"""Command-line interface to the forensic engine.

sensortrace enrol --out sensor.npz ref1.jpg ref2.jpg ...
sensortrace compare --fingerprint sensor.npz [--fingerprint other.npz] questioned.jpg
sensortrace evaluate manifest.json --out results/
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .enrol import ReferenceInput, enrol
from .errors import EngineError
from .fingerprint import Fingerprint
from .pipeline import Candidate, analyse_questioned


def _cmd_enrol(a: argparse.Namespace) -> int:
    refs = [ReferenceInput(Path(p).name, (lambda p=p: Path(p).read_bytes())) for p in a.images]
    res = enrol(refs, progress=lambda s, d, t: print(f"\r{s}: {d}/{t}   ", end="", file=sys.stderr))
    print(file=sys.stderr)
    assert res.fingerprint is not None
    Path(a.out).write_bytes(res.fingerprint.to_bytes())
    print(
        json.dumps(
            {"fingerprint": a.out, **res.fingerprint.metadata(), "outcomes": [o.to_dict() for o in res.outcomes]},
            indent=2,
            default=str,
        )
    )
    return 0


def _cmd_compare(a: argparse.Namespace) -> int:
    cands = [
        Candidate(
            Path(p).stem,
            Fingerprint.from_bytes(Path(p).read_bytes()),
            label=Path(p).stem,
            device_id=Path(p).stem,
            device_class=a.device_class,
        )
        for p in a.fingerprint
    ]
    res = analyse_questioned(Path(a.image).read_bytes(), cands)
    print(json.dumps(res.to_dict(), indent=2, default=str))
    return 0


def _fmt(x: Any, nd: int = 4) -> str:
    return "n/a" if x is None else (f"{x:.{nd}g}" if isinstance(x, float) else str(x))


def _op_line(name: str, s: dict[str, Any]) -> str:
    op = s.get("operating_point")
    if not op:
        return f"| {name} | {s['n_same']} | {s['n_diff']} | n/a | n/a | n/a | {_fmt(s.get('auc'))} |"
    return (
        f"| {name} | {op['n_same']} | {op['n_diff']} | {_fmt(op['threshold'])} | "
        f"{op['false_positives']}/{op['n_diff']} = {op['fpr']:.4f} [{op['fpr_ci'][0]:.4f}, {op['fpr_ci'][1]:.4f}] | "
        f"{op['false_negatives']}/{op['n_same']} = {op['fnr']:.4f} [{op['fnr_ci'][0]:.4f}, {op['fnr_ci'][1]:.4f}] | {_fmt(s.get('auc'))} |"
    )


def render_report(result: dict[str, Any], leakage: dict[str, Any], enrol_log: dict[str, Any]) -> str:
    p, c = result["protocol"], result["calibration"]
    out = [
        f"# Evaluation report: {result['dataset']['name']}",
        "",
        f"Data: {result['dataset'].get('attribution', '')}",
        "",
        f"Engine {result['engine']['engine_version']}, algorithm `{result['engine']['algorithm_version']}`. "
        f"Libraries: {', '.join(f'{k} {v}' for k, v in result['engine']['libraries'].items())}.",
        "",
        "Error rates below are observed frequencies on this dataset with 95% exact (Clopper-Pearson) "
        "intervals. Trials that share a device or image are not independent, so the intervals are "
        "optimistic. Nothing here transfers to devices, models or processing not represented.",
        "",
        "## Protocol",
        "",
        f"- Calibration devices: {', '.join(p['devices']['calibration'])} ({', '.join(p['models']['calibration'])})",
        f"- Test devices (disjoint): {', '.join(p['devices']['test'])} ({', '.join(p['models']['test'])})",
        f"- Statistic: {p['statistic']}",
        f"- Targets used for threshold selection: FPR {p['target_fpr']:g}, miss rate {p['target_fnr']:g}",
        f"- {c['method']}",
        "",
        "## Leakage checks",
        "",
        f"- Test images: {leakage['test_images']}",
        f"- Exact duplicates between reference and test sets: {leakage['exact_reference_test_duplicates']}",
        f"- Near-duplicate test pairs within a device: {leakage['near_duplicate_test_pairs_within_device']}. {leakage['note']}",
        "",
        "## Enrolment",
        "",
        "| Device | Accepted refs | Fingerprint (HxW) | Split-half PCE | LOO crop PCE median |",
        "|---|---|---|---|---|",
    ]
    for d in sorted(enrol_log):
        e = enrol_log[d]
        out.append(
            f"| {d} | {e['accepted']}/{e['submitted']} | {e['shape'][0]}x{e['shape'][1]} | {_fmt(e['split_half_pce'], 6)} | {_fmt(e['loo_pce_median'], 5)} |"
        )
    out += [
        "",
        "## Calibration (thresholds chosen here, original images, native geometry)",
        "",
        f"- Same-device trials: {c['n_same']}; same-model different-device trials: {c['n_same_model_diff']}; different-model trials: {c['n_different_model_diff']}",
        f"- Match threshold from pooled negatives: {_fmt(c['match_threshold_pooled_negatives'])}; from same-model negatives: {_fmt(c['match_threshold_same_model_negatives'])}; **selected: {_fmt(c['match_threshold_selected'])}**",
        f"- **Non-match threshold selected: {_fmt(c['non_match_threshold_selected'])}**",
        f"- Largest different-device statistic in calibration: {_fmt(c['summary_all'].get('max_diff'))}",
        "",
        "## Held-out test devices",
        "",
    ]
    for cond, block in result["test"].items():
        out += [
            f"### Condition: {cond}",
            "",
            "| Negatives | Same-device trials | Different-device trials | Threshold | False matches (FPR, 95% CI) | Misses (FNR, 95% CI) | AUC |",
            "|---|---|---|---|---|---|---|",
        ]
        for name, entry in block.items():
            out.append(_op_line(f"{name}, calibrated threshold", entry["calibrated"]))
            out.append(_op_line(f"{name}, reference line 60", entry["reference_line"]))
        conf = block["all_negatives"].get("confusion_calibrated")
        if conf:
            out += [
                "",
                f"Three-way outcome counts at the calibrated thresholds: same source {conf['same_source']}; different source {conf['different_source']}.",
            ]
        out.append("")
    if "cropped_search_negatives" in result:
        k = result["cropped_search_negatives"]
        out += [
            "## Crop search (experimental)",
            "",
            f"{k['n']} cross-resolution trials, all true negatives. Raw PCE at or above 60: {k['raw_pce_exceeding_reference_line']} "
            f"(max {k['raw_pce_max']:.1f}). After search adjustment: {k['adjusted_exceeding_reference_line']} "
            f"(max {k['adjusted_max']:.1f}; FPR 95% CI [{k['adjusted_fpr_ci'][0]:.4f}, {k['adjusted_fpr_ci'][1]:.4f}]). "
            "No true-positive cropped trials exist in this dataset, so detection power for crops is not measured here.",
            "",
        ]
    out += [
        "## Per-device results (test split, original images)",
        "",
        "| Device | Model | Same-device median | Same-device min | Largest other-device | Misses | False matches |",
        "|---|---|---|---|---|---|---|",
    ]
    for d, e in sorted(result["test_per_device"].items()):
        out.append(
            f"| {d} | {e['model_key']} | {_fmt(e['same_median'], 5)} | {_fmt(e['same_min'], 4)} | {_fmt(e['diff_max'], 4)} | {e['misses_at_selected']}/{e['n_same']} | {e['false_matches_at_selected']}/{e['n_diff']} |"
        )
    return "\n".join(out) + "\n"


def _cmd_evaluate(a: argparse.Namespace) -> int:
    from . import evaluation as ev

    manifest_path = Path(a.manifest).resolve()
    manifest = ev.load_manifest(manifest_path)
    manifest["root"] = str((manifest_path.parent / manifest["root"]).resolve())
    out = Path(a.out)
    scores = out / "scores.csv"
    if scores.exists() and not a.rescore:
        rows = ev.load_scores(scores)
    else:
        rows = ev.run_scoring(manifest, out, workers=a.workers, include_cropped=not a.no_cropped)
        rows = ev.load_scores(scores)
    enrol_log = json.loads((out / "enrolment.json").read_text())
    ref_hashes: dict[str, set[str]] = {}
    for d in manifest["devices"]:
        fp = Fingerprint.from_bytes((out / "fingerprints" / f"{d.id}.npz").read_bytes())
        ref_hashes[d.id] = set(fp.diagnostics.get("reference_sha256", []))
    leakage = ev.find_leakage(rows, enrol_log, ref_hashes)
    result = ev.analyse(rows, manifest, target_fpr=a.target_fpr, target_fnr=a.target_fnr)
    result["leakage"] = leakage
    (out / "results.json").write_text(json.dumps(result, indent=2))
    (out / "report.md").write_text(render_report(result, leakage, enrol_log))
    pol = ev.calibrated_policy(result, manifest)
    if pol is not None:
        (out / "policy.json").write_text(json.dumps(pol.to_dict(), indent=2))
    try:
        _plot(rows, manifest, result, out)
    except ImportError:
        print("matplotlib not installed; skipping plots", file=sys.stderr)
    print((out / "report.md").read_text())
    return 0


def _plot(rows: list[dict[str, Any]], manifest: dict[str, Any], result: dict[str, Any], out: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    from . import stats

    split = {d.id: d.split for d in manifest["devices"]}
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.4))
    for cond in manifest["conditions"]:
        sel = [
            r
            for r in rows
            if split[r["device"]] == "test"
            and split[r["candidate"]] == "test"
            and r["condition"] == cond
            and r["geometry"] in ("native", "rotated")
            and r["eff_pce"] is not None
        ]
        same = [r["eff_pce"] for r in sel if r["device"] == r["candidate"]]
        diff = [r["eff_pce"] for r in sel if r["device"] != r["candidate"]]
        if not same or not diff:
            continue
        roc = stats.roc_curve(same, diff)
        axes[0].plot(np.clip(roc["fpr"], 1e-4, 1), roc["tpr"], label=f"{cond} (AUC {stats.auc(same, diff):.4f})")
        if cond == "original":
            bins = np.linspace(-2, 7, 90)
            sl = lambda v: np.sign(v) * np.log10(1 + np.abs(v))  # noqa: E731
            axes[1].hist(sl(np.array(diff)), bins=bins, alpha=0.7, label=f"different device (n={len(diff)})")
            axes[1].hist(sl(np.array(same)), bins=bins, alpha=0.7, label=f"same device (n={len(same)})")
    thr = result["calibration"]["match_threshold_selected"]
    for v, lab in ((60.0, "reference line 60"), (thr, "calibrated threshold")):
        if v:
            axes[1].axvline(np.log10(1 + v), ls="--", lw=1, color="k" if lab.startswith("ref") else "C3", label=lab)
    axes[0].set(
        xscale="log", xlabel="False-positive rate", ylabel="True-positive rate", title="ROC, held-out test devices"
    )
    axes[0].legend(fontsize=8)
    axes[1].set(
        xlabel="sign(x) * log10(1 + |effective PCE|)", ylabel="Trials", title="Score distributions (original images)"
    )
    axes[1].legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(out / "evaluation.png", dpi=140)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="sensortrace", description="SensorTrace forensic engine")
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("enrol", help="estimate a sensor fingerprint from reference images")
    e.add_argument("--out", required=True)
    e.add_argument("images", nargs="+")
    e.set_defaults(fn=_cmd_enrol)
    c = sub.add_parser("compare", help="compare a questioned image with one or more fingerprints")
    c.add_argument("--fingerprint", action="append", required=True)
    c.add_argument("--device-class", choices=["conventional", "computational", "unknown"], default="unknown")
    c.add_argument("image")
    c.set_defaults(fn=_cmd_compare)
    v = sub.add_parser("evaluate", help="run the empirical evaluation described by a manifest")
    v.add_argument("manifest")
    v.add_argument("--out", required=True)
    v.add_argument("--workers", type=int, default=6)
    v.add_argument("--target-fpr", type=float, default=0.01)
    v.add_argument("--target-fnr", type=float, default=0.01)
    v.add_argument("--rescore", action="store_true")
    v.add_argument("--no-cropped", action="store_true")
    v.set_defaults(fn=_cmd_evaluate)
    a = p.parse_args(argv)
    try:
        return int(a.fn(a))
    except EngineError as exc:
        print(f"error [{exc.code}]: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
