"""Evaluation statistics: ROC, AUC, error rates with confidence intervals, threshold selection.

All functions take raw scores for *same-source* (genuine) and
*different-source* (impostor) trials. Higher scores indicate same source.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.stats import beta, norm


def wilson_interval(k: int, n: int, confidence: float = 0.95) -> tuple[float, float]:
    """Wilson score interval for a binomial proportion."""
    if n <= 0:
        return (0.0, 1.0)
    z = float(norm.isf((1 - confidence) / 2))
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, float(centre - half)), min(1.0, float(centre + half)))


def clopper_pearson(k: int, n: int, confidence: float = 0.95) -> tuple[float, float]:
    """Exact (conservative) binomial interval. With ``k = 0`` the upper bound is the
    largest rate still compatible with observing no errors (approx. 3/n at 95 %)."""
    if n <= 0:
        return (0.0, 1.0)
    a = 1 - confidence
    lo = 0.0 if k == 0 else float(beta.ppf(a / 2, k, n - k + 1))
    hi = 1.0 if k == n else float(beta.ppf(1 - a / 2, k + 1, n - k))
    return (lo, hi)


def roc_curve(same: ArrayLike, diff: ArrayLike) -> dict[str, NDArray[np.float64]]:
    """Empirical ROC. Returns thresholds (descending), FPR and TPR at ``score >= threshold``."""
    s = np.asarray(same, dtype=np.float64)
    d = np.asarray(diff, dtype=np.float64)
    thr = np.unique(np.concatenate([s, d]))[::-1]
    s_sorted = np.sort(s)
    d_sorted = np.sort(d)
    tpr = 1.0 - np.searchsorted(s_sorted, thr, side="left") / max(s.size, 1)
    fpr = 1.0 - np.searchsorted(d_sorted, thr, side="left") / max(d.size, 1)
    return {
        "thresholds": np.concatenate([[np.inf], thr]),
        "fpr": np.concatenate([[0.0], fpr]),
        "tpr": np.concatenate([[0.0], tpr]),
    }


def auc(same: ArrayLike, diff: ArrayLike) -> float:
    """Area under the ROC curve via the Mann-Whitney statistic (ties count one half)."""
    s = np.asarray(same, dtype=np.float64)
    d = np.asarray(diff, dtype=np.float64)
    if s.size == 0 or d.size == 0:
        return float("nan")
    d_sorted = np.sort(d)
    less = np.searchsorted(d_sorted, s, side="left")
    leq = np.searchsorted(d_sorted, s, side="right")
    return float((less + 0.5 * (leq - less)).sum() / (s.size * d.size))


def auc_bootstrap(
    same: ArrayLike, diff: ArrayLike, *, n_boot: int = 2000, confidence: float = 0.95, seed: int = 0
) -> tuple[float, float]:
    """Percentile bootstrap interval for the AUC (trials resampled independently per class).

    Trials sharing a device or image are not independent, so this interval is
    optimistic; device-level resampling is reported separately by the
    evaluation framework when enough devices exist.
    """
    s = np.asarray(same, dtype=np.float64)
    d = np.asarray(diff, dtype=np.float64)
    if s.size == 0 or d.size == 0:
        return (float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    vals = np.empty(n_boot)
    for b in range(n_boot):
        vals[b] = auc(rng.choice(s, s.size), rng.choice(d, d.size))
    a = (1 - confidence) / 2
    return (float(np.quantile(vals, a)), float(np.quantile(vals, 1 - a)))


@dataclass(frozen=True)
class OperatingPoint:
    threshold: float
    false_positives: int
    n_diff: int
    false_negatives: int
    n_same: int

    @property
    def fpr(self) -> float:
        return self.false_positives / self.n_diff if self.n_diff else float("nan")

    @property
    def fnr(self) -> float:
        return self.false_negatives / self.n_same if self.n_same else float("nan")

    def to_dict(self, confidence: float = 0.95) -> dict[str, Any]:
        return {
            "threshold": self.threshold,
            "n_same": self.n_same,
            "n_diff": self.n_diff,
            "false_positives": self.false_positives,
            "false_negatives": self.false_negatives,
            "fpr": self.fpr,
            "fnr": self.fnr,
            "fpr_ci": list(clopper_pearson(self.false_positives, self.n_diff, confidence)),
            "fnr_ci": list(clopper_pearson(self.false_negatives, self.n_same, confidence)),
            "confidence": confidence,
            "ci_method": "Clopper-Pearson (exact binomial; assumes independent trials)",
        }


def operating_point(same: ArrayLike, diff: ArrayLike, threshold: float) -> OperatingPoint:
    s = np.asarray(same, dtype=np.float64)
    d = np.asarray(diff, dtype=np.float64)
    return OperatingPoint(
        threshold=float(threshold),
        false_positives=int((d >= threshold).sum()),
        n_diff=int(d.size),
        false_negatives=int((s < threshold).sum()),
        n_same=int(s.size),
    )


def threshold_for_fpr(diff: ArrayLike, target_fpr: float) -> float | None:
    """Smallest threshold whose *empirical* FPR on ``diff`` does not exceed ``target_fpr``.

    Returns ``None`` when the calibration set is too small to resolve the
    target (fewer than ``1 / target_fpr`` impostor trials): a threshold cannot
    honestly be claimed for an error rate the data cannot measure.
    """
    d = np.sort(np.asarray(diff, dtype=np.float64))
    if d.size == 0 or target_fpr <= 0 or d.size < 1.0 / target_fpr:
        return None
    allowed = int(np.floor(target_fpr * d.size))
    # threshold just above the (allowed+1)-th largest impostor score
    idx = d.size - allowed - 1
    return float(np.nextafter(d[idx], np.inf))


def threshold_for_fnr(same: ArrayLike, target_fnr: float) -> float | None:
    """Largest threshold whose empirical miss rate on ``same`` does not exceed ``target_fnr``."""
    s = np.sort(np.asarray(same, dtype=np.float64))
    if s.size == 0 or target_fnr <= 0 or s.size < 1.0 / target_fnr:
        return None
    allowed = int(np.floor(target_fnr * s.size))
    return float(s[allowed])


def confusion(same: ArrayLike, diff: ArrayLike, match_thr: float, non_match_thr: float) -> dict[str, dict[str, int]]:
    """Three-way confusion table for (match / inconclusive / non-match) decisions."""
    out: dict[str, dict[str, int]] = {}
    for name, arr in (("same_source", np.asarray(same, float)), ("different_source", np.asarray(diff, float))):
        out[name] = {
            "match": int((arr >= match_thr).sum()),
            "inconclusive": int(((arr < match_thr) & (arr > non_match_thr)).sum()),
            "non_match": int((arr <= non_match_thr).sum()),
        }
    return out
