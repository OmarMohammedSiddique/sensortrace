# Evaluation report: vision-subset-v1

Data: VISION dataset (Shullani et al., EURASIP Journal on Information Security, 2017). (c) CSP Lab, University of Florence. CC BY-SA 4.0.

Engine 0.1.0, algorithm `prnu-wavelet-mle-1.0`. Libraries: python 3.12.16, numpy 2.5.4, scipy 1.18.1, PyWavelets 1.10.0, pillow 13.0.0, opencv-python-headless 5.0.0.93.

Error rates below are observed frequencies on this dataset with 95% exact (Clopper-Pearson) intervals. Trials that share a device or image are not independent, so the intervals are optimistic. Nothing here transfers to devices, models or processing not represented.

## Protocol

- Calibration devices: D02, D03, D05, D10, D14, D18 (apple iphone 4s, apple iphone 5c, huawei p9)
- Test devices (disjoint): D01, D06, D11, D15, D26, D29, D34 (apple iphone 5, apple iphone 6, samsung galaxy s3, samsung galaxy s3 mini)
- Statistic: effective signed PCE (adjusted for the alignments searched)
- Targets used for threshold selection: FPR 0.01, miss rate 0.01
- Match threshold: smallest value whose empirical false-positive rate on calibration negatives does not exceed the target, computed on pooled and on same-model negatives; the larger is selected. Non-match threshold: largest value whose empirical miss rate on calibration positives does not exceed the target. A threshold is null when the calibration set is too small to resolve the target.

## Leakage checks

- Test images: 520
- Exact duplicates between reference and test sets: 0
- Near-duplicate test pairs within a device: 1. Near duplicates (dHash distance <= 2) are counted, not removed; they make trials less independent.

## Enrolment

| Device | Accepted refs | Fingerprint (HxW) | Split-half PCE | LOO crop PCE median |
|---|---|---|---|---|
| D01 | 40/40 | 1920x2560 | 272951 | 1641.9 |
| D02 | 40/40 | 2448x3264 | 542534 | 2261.1 |
| D03 | 40/40 | 2976x3968 | 92706.1 | 312.42 |
| D05 | 40/40 | 2448x3264 | 77165.1 | 317.37 |
| D06 | 40/40 | 2448x3264 | 752752 | 3752.4 |
| D10 | 40/40 | 2448x3264 | 350811 | 1373.7 |
| D11 | 40/40 | 2448x3264 | 531487 | 2352.3 |
| D14 | 40/40 | 2448x3264 | 354197 | 1747.8 |
| D15 | 40/40 | 2448x3264 | 746029 | 3525 |
| D18 | 40/40 | 2448x3264 | 479818 | 3030.8 |
| D26 | 40/40 | 1920x2560 | 232534 | 1010.6 |
| D29 | 40/40 | 2448x3264 | 119250 | 538.04 |
| D34 | 40/40 | 2448x3264 | 352660 | 1594.1 |

## Calibration (thresholds chosen here, original images, native geometry)

- Same-device trials: 240; same-model different-device trials: 320; different-model trials: 480
- Match threshold from pooled negatives: 9.12; from same-model negatives: 10.86; **selected: 10.86**
- **Non-match threshold selected: 0.1431**
- Largest different-device statistic in calibration: 18.77

## Held-out test devices

### Condition: original

| Negatives | Same-device trials | Different-device trials | Threshold | False matches (FPR, 95% CI) | Misses (FNR, 95% CI) | AUC |
|---|---|---|---|---|---|---|
| all_negatives, calibrated threshold | 280 | 880 | 10.86 | 6/880 = 0.0068 [0.0025, 0.0148] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| all_negatives, reference line 60 | 280 | 880 | 60 | 0/880 = 0.0000 [0.0000, 0.0042] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| same_model, calibrated threshold | 280 | 240 | 10.86 | 5/240 = 0.0208 [0.0068, 0.0479] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| same_model, reference line 60 | 280 | 240 | 60 | 0/240 = 0.0000 [0.0000, 0.0153] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| different_model, calibrated threshold | 280 | 640 | 10.86 | 1/640 = 0.0016 [0.0000, 0.0087] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| different_model, reference line 60 | 280 | 640 | 60 | 0/640 = 0.0000 [0.0000, 0.0057] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |

Three-way outcome counts at the calibrated thresholds: same source {'match': 280, 'inconclusive': 0, 'non_match': 0}; different source {'match': 6, 'inconclusive': 411, 'non_match': 463}.

### Condition: jpeg90

| Negatives | Same-device trials | Different-device trials | Threshold | False matches (FPR, 95% CI) | Misses (FNR, 95% CI) | AUC |
|---|---|---|---|---|---|---|
| all_negatives, calibrated threshold | 280 | 880 | 10.86 | 5/880 = 0.0057 [0.0018, 0.0132] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| all_negatives, reference line 60 | 280 | 880 | 60 | 0/880 = 0.0000 [0.0000, 0.0042] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| same_model, calibrated threshold | 280 | 240 | 10.86 | 5/240 = 0.0208 [0.0068, 0.0479] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| same_model, reference line 60 | 280 | 240 | 60 | 0/240 = 0.0000 [0.0000, 0.0153] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| different_model, calibrated threshold | 280 | 640 | 10.86 | 0/640 = 0.0000 [0.0000, 0.0057] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| different_model, reference line 60 | 280 | 640 | 60 | 0/640 = 0.0000 [0.0000, 0.0057] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |

Three-way outcome counts at the calibrated thresholds: same source {'match': 280, 'inconclusive': 0, 'non_match': 0}; different source {'match': 5, 'inconclusive': 420, 'non_match': 455}.

### Condition: jpeg75

| Negatives | Same-device trials | Different-device trials | Threshold | False matches (FPR, 95% CI) | Misses (FNR, 95% CI) | AUC |
|---|---|---|---|---|---|---|
| all_negatives, calibrated threshold | 280 | 880 | 10.86 | 8/880 = 0.0091 [0.0039, 0.0178] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| all_negatives, reference line 60 | 280 | 880 | 60 | 0/880 = 0.0000 [0.0000, 0.0042] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| same_model, calibrated threshold | 280 | 240 | 10.86 | 8/240 = 0.0333 [0.0145, 0.0646] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| same_model, reference line 60 | 280 | 240 | 60 | 0/240 = 0.0000 [0.0000, 0.0153] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| different_model, calibrated threshold | 280 | 640 | 10.86 | 0/640 = 0.0000 [0.0000, 0.0057] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| different_model, reference line 60 | 280 | 640 | 60 | 0/640 = 0.0000 [0.0000, 0.0057] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |

Three-way outcome counts at the calibrated thresholds: same source {'match': 280, 'inconclusive': 0, 'non_match': 0}; different source {'match': 8, 'inconclusive': 423, 'non_match': 449}.

### Condition: jpeg60

| Negatives | Same-device trials | Different-device trials | Threshold | False matches (FPR, 95% CI) | Misses (FNR, 95% CI) | AUC |
|---|---|---|---|---|---|---|
| all_negatives, calibrated threshold | 280 | 880 | 10.86 | 7/880 = 0.0080 [0.0032, 0.0163] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| all_negatives, reference line 60 | 280 | 880 | 60 | 0/880 = 0.0000 [0.0000, 0.0042] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| same_model, calibrated threshold | 280 | 240 | 10.86 | 3/240 = 0.0125 [0.0026, 0.0361] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| same_model, reference line 60 | 280 | 240 | 60 | 0/240 = 0.0000 [0.0000, 0.0153] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| different_model, calibrated threshold | 280 | 640 | 10.86 | 4/640 = 0.0063 [0.0017, 0.0159] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |
| different_model, reference line 60 | 280 | 640 | 60 | 0/640 = 0.0000 [0.0000, 0.0057] | 0/280 = 0.0000 [0.0000, 0.0131] | 1 |

Three-way outcome counts at the calibrated thresholds: same source {'match': 280, 'inconclusive': 0, 'non_match': 0}; different source {'match': 7, 'inconclusive': 386, 'non_match': 487}.

## Crop search (experimental)

1280 cross-resolution trials, all true negatives. Raw PCE at or above 60: 0 (max 37.3). After search adjustment: 0 (max 10.7; FPR 95% CI [0.0000, 0.0029]). No true-positive cropped trials exist in this dataset, so detection power for crops is not measured here.

## Per-device results (test split, original images)

| Device | Model | Same-device median | Same-device min | Largest other-device | Misses | False matches |
|---|---|---|---|---|---|---|
| D01 | samsung galaxy s3 mini | 18176 | 1928 | 6.543 | 0/40 | 0/40 |
| D06 | apple iphone 6 | 6357.4 | 1149 | 15.28 | 0/40 | 4/160 |
| D11 | samsung galaxy s3 | 14518 | 1890 | 10.84 | 0/40 | 0/160 |
| D15 | apple iphone 6 | 10986 | 2157 | 21.36 | 0/40 | 1/160 |
| D26 | samsung galaxy s3 mini | 7853.4 | 2515 | 11.5 | 0/40 | 1/40 |
| D29 | apple iphone 5 | 9779.5 | 3074 | 9.39 | 0/40 | 0/160 |
| D34 | apple iphone 5 | 8884.5 | 1549 | 10.35 | 0/40 | 0/160 |
