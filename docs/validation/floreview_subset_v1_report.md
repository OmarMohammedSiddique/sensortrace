# Evaluation report: floreview-subset-v1

Data: FloreView dataset (Baracchi, Shullani, Iuliani, Piva, IEEE Access, 2023). (c) CSP Lab, University of Florence. CC BY-SA 4.0.

Engine 0.1.0, algorithm `prnu-wavelet-mle-1.0`. Libraries: python 3.12.16, numpy 2.5.4, scipy 1.18.1, PyWavelets 1.10.0, pillow 13.0.0, opencv-python-headless 5.0.0.93.

Error rates below are observed frequencies on this dataset with 95% exact (Clopper-Pearson) intervals. Trials that share a device or image are not independent, so the intervals are optimistic. Nothing here transfers to devices, models or processing not represented.

## Protocol

- Calibration devices:  ()
- Test devices (disjoint): D02, D04, D10, D14, D17, D19, D23, D25, D30, D34, D37, D43 (apple iphone 12, apple iphone 13 mini, apple iphone x, google pixel 3a, google pixel 5, oneplus 8t, samsung galaxy s10+, samsung galaxy s20+, samsung galaxy s21+, xiaomi redmi note 8t)
- Statistic: effective signed PCE (adjusted for the alignments searched)
- Targets used for threshold selection: FPR 0.01, miss rate 0.01
- Match threshold: smallest value whose empirical false-positive rate on calibration negatives does not exceed the target, computed on pooled and on same-model negatives; the larger is selected. Non-match threshold: largest value whose empirical miss rate on calibration positives does not exceed the target. A threshold is null when the calibration set is too small to resolve the target.

## Leakage checks

- Test images: 360
- Exact duplicates between reference and test sets: 0
- Near-duplicate test pairs within a device: 0. Near duplicates (dHash distance <= 2) are counted, not removed; they make trials less independent.

## Enrolment

| Device | Accepted refs | Fingerprint (HxW) | Split-half PCE | LOO crop PCE median |
|---|---|---|---|---|
| D02 | 30/30 | 3024x4032 | 227290 | 1808.5 |
| D04 | 30/30 | 3000x4000 | 962724 | 4167.9 |
| D10 | 30/30 | 3000x4000 | 705231 | 2748.8 |
| D14 | 30/30 | 3024x4032 | 454915 | 1708.7 |
| D17 | 30/30 | 3024x4032 | 4.67942e+06 | 31486 |
| D19 | 25/30 | 3024x4032 | 255956 | 1105.6 |
| D23 | 23/30 | 2160x3840 | 163697 | 1892.1 |
| D25 | 30/30 | 3024x4032 | 415784 | 1343.4 |
| D30 | 30/30 | 3024x4032 | 882877 | 46966 |
| D34 | 30/30 | 3024x4032 | 165633 | 660.99 |
| D37 | 29/30 | 3024x4032 | 215792 | 1082.9 |
| D43 | 30/30 | 3000x4000 | 3.40809e+06 | 17303 |

## Calibration (thresholds chosen here, original images, native geometry)

- Same-device trials: 0; same-model different-device trials: 0; different-model trials: 0
- Match threshold from pooled negatives: n/a; from same-model negatives: n/a; **selected: n/a**
- **Non-match threshold selected: n/a**
- Largest different-device statistic in calibration: n/a

## Held-out test devices

### Condition: original

| Negatives | Same-device trials | Different-device trials | Threshold | False matches (FPR, 95% CI) | Misses (FNR, 95% CI) | AUC |
|---|---|---|---|---|---|---|
| all_negatives, calibrated threshold | 360 | 1860 | n/a | n/a | n/a | 0.9306 |
| all_negatives, reference line 60 | 360 | 1860 | 60 | 0/1860 = 0.0000 [0.0000, 0.0020] | 54/360 = 0.1500 [0.1147, 0.1911] | 0.9306 |
| same_model, calibrated threshold | 360 | 60 | n/a | n/a | n/a | 0.9381 |
| same_model, reference line 60 | 360 | 60 | 60 | 0/60 = 0.0000 [0.0000, 0.0596] | 54/360 = 0.1500 [0.1147, 0.1911] | 0.9381 |
| different_model, calibrated threshold | 360 | 1800 | n/a | n/a | n/a | 0.9304 |
| different_model, reference line 60 | 360 | 1800 | 60 | 0/1800 = 0.0000 [0.0000, 0.0020] | 54/360 = 0.1500 [0.1147, 0.1911] | 0.9304 |

## Crop search (experimental)

1050 cross-resolution trials, all true negatives. Raw PCE at or above 60: 0 (max 32.5). After search adjustment: 0 (max 9.5; FPR 95% CI [0.0000, 0.0035]). No true-positive cropped trials exist in this dataset, so detection power for crops is not measured here.

## Per-device results (test split, original images)

| Device | Model | Same-device median | Same-device min | Largest other-device | Misses | False matches |
|---|---|---|---|---|---|---|
| D02 | apple iphone x | 3349 | 573.4 | 8.336 | None/30 | None/210 |
| D04 | xiaomi redmi note 8t | 32730 | 1.385e+04 | 4.539 | None/30 | None/60 |
| D10 | xiaomi redmi note 8t | -0.012216 | -1.488 | 4.342 | None/30 | None/60 |
| D14 | apple iphone 13 mini | 4096 | 146.4 | 5.431 | None/30 | None/210 |
| D17 | samsung galaxy s21+ | 51373 | 396.2 | 4.759 | None/30 | None/210 |
| D19 | google pixel 3a | 11159 | 2535 | 6.975 | None/30 | None/210 |
| D23 | google pixel 3a | 4683.1 | 0.592 | n/a | None/30 | None/0 |
| D25 | samsung galaxy s20+ | 134.86 | -3.479 | 6.253 | None/30 | None/210 |
| D30 | samsung galaxy s10+ | 71757 | -2.555 | 14.13 | None/30 | None/210 |
| D34 | google pixel 5 | 5621.1 | 1195 | 5.925 | None/30 | None/210 |
| D37 | apple iphone 12 | 1446.3 | 94.03 | 4.547 | None/30 | None/210 |
| D43 | oneplus 8t | 2698.2 | -2.51 | 20.34 | None/30 | None/60 |
