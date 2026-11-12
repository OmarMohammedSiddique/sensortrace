# Benchmark results

Audit date 2026-11-12. Algorithm `prnu-wavelet-mle-1.0`. Every number below was produced by the scripts
named and can be regenerated (see `REPRODUCIBILITY.md`). All images are authentic photographs with
device-level ground truth from two public datasets; no synthetic data appears in this file.

**Reading these results.** They describe these devices and conditions only. Trials that share a device
or a fingerprint are not independent, so the binomial intervals are optimistic. The numbers of devices
(13 and 12) limit generalisation far more than the numbers of trials.

## Datasets

| Dataset | Devices | Period | Reference images | Test images | Licence |
|---|---|---|---|---|---|
| VISION subset v1 (Shullani et al. 2017) | 13 smartphones, 7 models, 5 models with 2–3 units | 2011–2016 | 40 flat-field per device | 40 natural per device (520) | CC BY-SA 4.0 |
| FloreView subset v1 (Baracchi et al. 2023) | 12 smartphones, 10 models | 2017–2021 | 30 flat-field per device | 30 natural per device, one still per scene (360) | CC BY-SA 4.0 |

Label provenance: device identity comes from the datasets' directory structure, as published by the
University of Florence. Labels were not independently checked. Exact duplicates between reference and
test sets: 0 in both. Near-duplicate test pairs within a device (perceptual hash distance ≤ 2): 1 in
VISION, 0 in FloreView.

## 1. Baseline: classical PRNU at the reference line (PCE ≥ 60)

One candidate per comparison, same pixel dimensions, original camera files. The threshold was fixed in
advance from the literature and not tuned on either dataset.

| Dataset | Trials | False matches | 95% interval | Misses | 95% interval | AUC |
|---|---|---|---|---|---|---|
| VISION, held-out devices (7) | 280 same / 880 different | 0 | 0 – 0.42% | 0 | 0 – 1.3% | 1.000 |
| VISION, all devices (13) | 520 / 3,680 | 0 | 0 – 0.10% | 7 (1.3%) | 0.5 – 2.8% | — |
| VISION, same model only | — / 560 (7 device pairs) | 0 | 0 – 0.66% | — | — | — |
| **FloreView (12 recent phones)** | 360 / 1,860 | 0 | 0 – 0.20% | **54 (15.0%)** | 11.5 – 19.1% | 0.931 |

Equal-error rate on VISION held-out devices: 0 (the distributions do not overlap). True-positive rate at
1% false-positive rate: 100%. Operating points below about 1/880 cannot be resolved by this data and are
not reported.

Highest different-device statistic: 21.4 (VISION, a same-model pair) and 20.3 (FloreView).

Source: `docs/validation/vision_subset_v1_results.json`, `docs/validation/floreview_subset_v1_results.json`.

## 2. Recent smartphones: misses are frequent and device-specific

FloreView, same-device comparisons at the reference line:

| Device | Model | Year | Misses | Median statistic | Minimum |
|---|---|---|---|---|---|
| D02 | Apple iPhone X | 2017 | 0 / 30 | 3,349 | 573 |
| D19 | Google Pixel 3a | 2019 | 0 / 30 | 11,159 | 2,535 |
| D23 | Google Pixel 3a (16:9 mode) | 2019 | 1 / 30 | 4,683 | 0.6 |
| D04 | Xiaomi Redmi Note 8T (3.5 mm lens) | 2019 | 0 / 30 | 32,730 | 13,850 |
| **D10** | **Xiaomi Redmi Note 8T (4.7 mm lens)** | 2019 | **29 / 30** | **−0.01** | −1.5 |
| D30 | Samsung Galaxy S10+ | 2019 | 8 / 30 | 71,757 | −2.6 |
| **D25** | **Samsung Galaxy S20+** | 2020 | **14 / 30** | 135 | −3.5 |
| D43 | OnePlus 8T | 2020 | 2 / 30 | 2,698 | −2.5 |
| D34 | Google Pixel 5 | 2020 | 0 / 30 | 5,621 | 1,195 |
| D37 | Apple iPhone 12 | 2020 | 0 / 30 | 1,446 | 94 |
| D17 | Samsung Galaxy S21+ | 2021 | 0 / 30 | 51,373 | 396 |
| D14 | Apple iPhone 13 mini | 2021 | 0 / 30 | 4,096 | 146 |

Findings:

- **Eight of twelve phones had no miss; four account for 53 of the 54 misses.** One (Redmi Note 8T D10)
  is essentially undetectable: its natural images share dimensions, focal length, aperture, firmware,
  orientation and JPEG quality with its flat-field references, yet 29 of 30 score about zero. The cause
  was not established (the main camera of that phone bins a 48-megapixel sensor to 12; unverified).
- **The failure cannot be predicted from metadata** in the cases examined, so the product cannot warn
  about it per image. This is the strongest evidence in the audit that a low statistic does not exclude
  a device.
- **No false match occurred** among 1,860 different-device comparisons of recent phones, including
  phones of the same brand and generation (iPhone 12 / 13 mini / X; Galaxy S10+ / S20+ / S21+).
- **Same-model collisions on recent phones remain untested.** The two same-model pairs in this subset
  turned out to be unusable for it: the two Pixel 3a units have different image dimensions (4:3 and
  16:9) and the two Redmi Note 8T units used different lenses. Only 60 same-model trials exist, all for
  the Redmi pair across different lenses. The published reports of same-model false matches on recent
  phones (Iuliani et al. 2021; Loison et al. 2026) are therefore neither confirmed nor contradicted here.

## 3. Open-set galleries (unseen sensors)

VISION, original images. Each image is compared with a gallery of every same-resolution sensor, and the
statistic is adjusted for the gallery size as the product does. Script:
`audit/experiments/robustness_vision.py` (E1).

| Gallery | Images | Matched a wrong sensor | 95% interval | Matched only its own sensor | Highest wrong-sensor statistic |
|---|---|---|---|---|---|
| Own sensor **removed** (all devices) | 480 | 0 | 0 – 0.77% | n/a | 17.2 |
| Own sensor **removed** (held-out devices) | 280 | 0 | 0 – 1.3% | n/a | 18.7 |
| Own sensor present (all devices) | 520 | 0 | 0 – 0.71% | 513 | 17.0 |
| Own sensor present (held-out devices) | 280 | 0 | 0 – 1.3% | 280 | 18.3 |

No image from an unenrolled sensor was attributed to an enrolled one, and no image matched more than
one sensor.

## 4. JPEG recompression (VISION held-out devices)

Images recompressed in memory and compared with fingerprints from original references.

| Quality | Lowest same-device statistic | Median | False matches at 60 | Misses at 60 |
|---|---|---|---|---|
| Original | 1,149 | 9,997 | 0 / 880 | 0 / 280 |
| 90 | 682 | 7,394 | 0 / 880 | 0 / 280 |
| 75 | 238 | 3,648 | 0 / 880 | 0 / 280 |
| 60 | 131 | 2,080 | 0 / 880 | 0 / 280 |

## 5. Real crops

VISION held-out devices, 15 natural images each (105). A 1024×768 region at a seeded random offset,
searched over every placement and rotation in the full fingerprint (14.65 million hypotheses for an
8-megapixel sensor, 6.76 million for the 5-megapixel ones). Script E3.

| Candidate | Located at the true offset | Adjusted statistic ≥ 60 | Minimum | Median | Maximum |
|---|---|---|---|---|---|
| True sensor | 105 / 105 | 104 / 105 | 19.7 | 983 | — |
| Another sensor (same model where available) | — | 0 / 105 | — | — | 8.4 (raw 40.0) |

Detection of genuine crops is now measured on real images for this crop size and these devices: one miss
in 105 (95% interval 0.02 – 5.2%), no false match (0 – 3.5%). Smaller crops, other aspect ratios and
recent phones were not tested, and the audit found that the statistic of a crop at an offset that is not
a multiple of 16 pixels differs unpredictably from the full-frame value (scientific finding F-06).
Cross-resolution negatives from the main evaluations: 0 of 1,280 (VISION) and 0 of 1,050 (FloreView)
reached 60 after adjustment (highest 10.7 and 9.5).

## 6. Incompatible transforms

The same 105 true same-sensor images, resampled. Script E4.

| Transform | How the engine treated it | Reached 60 | Highest adjusted statistic |
|---|---|---|---|
| Downscaled to 50% | Searched as a crop | 0 / 105 | 8.3 |
| Quarter of the image upscaled by 1.25 | Searched as a crop | 0 / 105 | 7.0 |
| Whole image upscaled by 1.25 | Refused as unsupported geometry | — | — |

Resampled images from the true sensor are never matched. That is the documented behaviour (resampling
is unsupported), and it means such images yield "inconclusive" or "unsupported", never a non-match.

## 7. Number and type of reference images

Four VISION held-out devices (two iPhone 6, two iPhone 5). Test: 20 natural images of the device and 20
of the other unit of the same model, disjoint from the natural reference images. Script E5.

| References | Devices | Lowest same-device statistic (per device) | Misses at 60 | Highest same-model other-device statistic | False matches at 60 |
|---|---|---|---|---|---|
| 5 flat-field | 4 | 247 – 1,237 | 0 / 80 | 9.2 | 0 / 80 |
| 10 flat-field | 4 | 530 – 2,198 | 0 / 80 | 17.2 | 0 / 80 |
| 20 flat-field | 4 | 847 – 3,844 | 0 / 80 | 14.8 | 0 / 80 |
| 20 natural | 4 | 256 – 2,450 | 0 / 80 | 11.8 | 0 / 80 |

On these four older phones, fingerprints from as few as five flat-field images, or from twenty natural
images, still separated the two units of a model. The statistic grows with the number of references
(median roughly doubling from 5 to 20). Four devices of two models is too few to generalise.

## 8. Known failure cases

| Case | Evidence | How the product reports it |
|---|---|---|
| Huawei P9 (VISION D03): 7 of 40 own images undetected, metadata identical to the detected ones | Section 1 | Inconclusive (the device's images carry a special-rendering tag that blocks non-match conclusions) |
| Redmi Note 8T, 4.7 mm lens (FloreView D10): 29 of 30 undetected | Section 2 | Inconclusive. **Before this audit the product reported "evidence supports a non-match" for 28 of them**; see section 10 |
| Galaxy S20+, S10+, OnePlus 8T: 14, 8 and 2 of 30 undetected | Section 2 | Inconclusive (previously a non-match for 13, 5 and 2) |
| Resampled images | Section 6 | Unsupported or inconclusive |
| One crop in 105 below the threshold | Section 5 | Inconclusive |

## 9. Outcomes the product would give for genuine same-device photographs

Each same-device trial was passed through the decision logic with the image's real quality flags and the
fingerprint's real diagnostics (one candidate, default policy).

| Dataset | Device declared | Match supported | Inconclusive | Non-match supported | Insufficient |
|---|---|---|---|---|---|
| VISION (520) | conventional | 513 | 7 | 0 | 0 |
| VISION (520) | computational | 0 | 520 | 0 | 0 |
| FloreView (360), **before** the fix in section 10 | conventional | 306 | 5 | **48** | 1 |
| FloreView (360), **before** the fix | computational | 0 | 311 | **48** | 1 |
| FloreView (360), after the fix | computational | 0 | 359 | 0 | 1 |

A device declared computational never receives "match supported" from one candidate alone: that needs a
same-model control (methodology, section 5).

## 10. Defect found by this benchmark and fixed

**False non-match conclusions on recent phones (issue #18, high severity).** With the decision logic as
shipped, 48 of 360 genuine same-device photographs from recent phones (13.3%, 95% interval 10.0 – 17.3%)
received "evidence supports a non-match": Redmi Note 8T 28 of 30, Galaxy S20+ 13, Galaxy S10+ 5, OnePlus
8T 2. Every precondition for a non-match was met (native resolution, no blocking quality flag, strong
30-image fingerprint); the pattern is simply absent from those images.

Fix (decision logic `policy-1.1`): a low statistic supports a non-match only for a device declared to
have a conventional pipeline; for computational or unknown devices it is inconclusive, with the reason
stated. If a recent phone were wrongly declared conventional the false non-match would still occur,
which is why non-match conclusions remain labelled experimental and the declaration is explained in the
interface.

## 11. What was not measured

- Same-model collisions on phones newer than 2016 (no usable pairs in the data obtained).
- Dedicated cameras.
- Images processed by messaging or social platforms (VISION contains such versions; they are resized
  and therefore unsupported).
- HDR, portrait and night modes as controlled conditions.
- Delta-sPCE: not evaluated; the candidate galleries here contain too few same-model devices, and its
  authors describe it as unsuitable for operational use.
- Threshold calibration: the data-derived thresholds from the VISION calibration split (10.9 and 0.14 at
  1% targets) were examined and rejected as operating points; see VALIDATION.md.
- Repeatability across machines and library versions beyond the CI regression test.
