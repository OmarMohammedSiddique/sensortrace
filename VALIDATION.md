# Validation

What has been measured, on what data, and what has not. Method description:
[SCIENTIFIC_METHODOLOGY.md](SCIENTIFIC_METHODOLOGY.md).

**Summary.** The engine was evaluated on real photographs from 25 smartphones in two public datasets.

- **Older phones (13 devices, 2011–2016):** no false match at the reference threshold in 3,680
  different-device comparisons (560 between units of the same model), and misses confined to one device.
- **Recent phones (12 devices, 2017–2021):** no false match in 1,860 different-device comparisons, but
  **15% of genuine same-device photographs were missed**, almost all from four phones, one of which was
  essentially undetectable. Nothing in the image metadata predicts these misses.
- **Same-model collisions on recent phones remain untested**: no usable same-model pairs were available.
- Real crops, recompression, unseen-sensor galleries and small or natural reference sets were measured on
  the older phones (section 2).

**Nothing has been validated for dedicated cameras, for resized or platform-processed images, or for
distinguishing units of the same recent phone model.** An independent audit (`audit/`) reviewed the
method, the code and these results; the full benchmark tables are in `audit/BENCHMARK_RESULTS.md`.

## 1. Evaluation `vision-subset-v1`

Run on 2026-11-12 with algorithm `prnu-wavelet-mle-1.0` (Python 3.12.16, NumPy 2.5.4, SciPy 1.18.1,
PyWavelets 1.10.0, Pillow 13.0.0). Full machine output: `docs/validation/vision_subset_v1_report.md`,
`docs/validation/vision_subset_v1_results.json`. Per-trial scores (`scores.csv`) are produced by the run
and not committed.

![ROC and score distributions](docs/validation/vision_subset_v1.png)

### Data

VISION dataset (Shullani et al., EURASIP Journal on Information Security, 2017), © CSP Lab, University of
Florence, CC BY-SA 4.0. Images are downloaded by `scripts/download_vision_subset.sh` and never
redistributed.

| Device | Model | Released | Resolution | Role |
|---|---|---|---|---|
| D02, D10 | Apple iPhone 4s | 2011 | 3264×2448 | calibration |
| D05, D14, D18 | Apple iPhone 5c | 2013 | 3264×2448 | calibration |
| D03 | Huawei P9 | 2016 | 3968×2976 | calibration |
| D06, D15 | Apple iPhone 6 | 2014 | 3264×2448 | test |
| D29, D34 | Apple iPhone 5 | 2012 | 3264×2448 | test |
| D01, D26 | Samsung Galaxy S3 Mini (GT-I8190N / GT-I8190 variants) | 2012 | 2560×1920 | test |
| D11 | Samsung Galaxy S3 | 2012 | 3264×2448 | test |

- **Reference (enrolment) images:** the first 40 flat-field images of each device (`flat`).
- **Test images:** the first 40 natural images of each device (`nat`), camera originals. 520 in total.
- Five model groups contain two or three physical devices, giving same-model different-device trials.

### Protocol

- **Separation of enrolment and test.** Reference and test images come from different capture
  categories. Exact duplicates between the two sets: 0. Near-duplicate test pairs within a device
  (perceptual hash distance ≤ 2): 1, counted and kept.
- **Device-level split.** Six devices are calibration devices and seven are test devices; no device is
  in both. Thresholds derived from data use calibration devices only.
- **Trials.** Every test image is compared with every fingerprint of the same pixel dimensions
  (zero shift, 0° and 180°). Cross-resolution pairs go to the crop-search stratum.
- **Strata.** Same device; same model, different device; different model.
- **Conditions.** Original files, and the test devices' images recompressed in memory at JPEG quality
  90, 75 and 60 (Pillow, default chroma subsampling), compared with fingerprints from original
  reference images.
- **Statistic.** Adjusted signed PCE (section 3.6 of the methodology).
- **Uncertainty.** Exact binomial (Clopper–Pearson) 95% intervals. Trials sharing a device, a
  fingerprint or an image are not independent, so the intervals are narrower than the truth. There are
  13 devices; that, not the trial count, limits what can be generalised.

### Enrolment

All 40 reference images were accepted for every device. Split-half PCE of the fingerprints ranged from
77,000 to 753,000.

### Results: original images, native resolution

All 13 devices, every same-size pair:

| Stratum | Trials | Minimum | Median | 99th percentile | Maximum |
|---|---|---|---|---|---|
| Same device | 520 | −0.9 | 9,667 | 51,438 | 70,757 |
| Same model, different device | 560 | −5.3 | 0.3 | 12.2 | 21.4 |
| Different model | 3,120 | −17.4 | 0.0 | 7.5 | 15.9 |

At the reference line PCE = 60, which was fixed in advance and not tuned on this data:

| | Count | Rate | 95% interval |
|---|---|---|---|
| False matches, all different-device trials | 0 / 3,680 | 0% | 0 – 0.10% |
| False matches, same-model trials only | 0 / 560 | 0% | 0 – 0.66% |
| Misses, same-device trials | 7 / 520 | 1.3% | 0.5 – 2.8% |

Held-out test devices only (280 same-device, 880 different-device trials): 0 false matches
(0 – 0.42%), 0 misses (0 – 1.3%); lowest same-device statistic 1,149; highest different-device 21.4;
AUC 1.0 (the two distributions do not overlap).

Same-model different-device trials score slightly higher than different-model trials (maximum 21.4
against 15.9), consistent with weak residual model-level artefacts, but remain far below the threshold
for these 2011–2016 devices.

### Known failure case found

**All seven misses are from one device, the Huawei P9 (D03): 7 of its 40 natural images (17.5%) score
below 3 against their own fingerprint**, while the other 33 score in the thousands. The seven images
have the same dimensions, orientation, software version, zoom ratio and rendering tag as the others, so
they cannot be recognised from metadata. The cause has not been established. The P9 is a dual-camera
phone that fuses a colour and a monochrome sensor, which is a plausible explanation but is not verified.

Consequences in the product: all P9 images carry `CustomRendered = 1`, which SensorTrace flags and which
blocks a non-match conclusion, so these seven would be reported as *inconclusive*, not as a non-match.
More generally this is direct evidence that a low statistic does not exclude a device.

### Results: recompressed images (test devices)

| Condition | Lowest same-device statistic | Median same-device | False matches at 60 | Misses at 60 |
|---|---|---|---|---|
| Original | 1,149 | 9,997 | 0 / 880 | 0 / 280 |
| JPEG quality 90 | 682 | 7,394 | 0 / 880 | 0 / 280 |
| JPEG quality 75 | 238 | 3,648 | 0 / 880 | 0 / 280 |
| JPEG quality 60 | 131 | 2,080 | 0 / 880 | 0 / 280 |

Recompression lowers the statistic steadily (median falls by about a factor of five at quality 60) but
did not cause a miss at full resolution on these devices. This covers recompression only: real platforms
also resize, which this version does not handle.

### Results: image quality

Thirteen same-device test images had a mean intensity below 60 (dark scenes); the lowest statistic among
them was 101. Too few to state a rate; consistent with the expectation that dark images score lower.
No analysis by texture or saturation level was made.

### Threshold selection from data

For comparison, thresholds were also derived from the calibration devices at a 1% target:
a match threshold of 10.9 and a non-match threshold of 0.14. On the test devices that threshold produced
6 false matches in 880 (0.7%, interval 0.25 – 1.5%), five of them same-model (2.1% of 240). **This
data-derived threshold is not offered in the product.** A 1% target is far too loose for this purpose,
and the calibration set (800 different-device trials) cannot resolve targets much below 1/800. Because
the two score distributions are separated by two orders of magnitude, the data cannot say where between
about 22 and 1,100 a threshold should sit; the literature value of 60 lies in that gap and is retained.

### Crop search (experimental)

1,280 cross-resolution trials (a smaller image searched over every placement inside a larger
fingerprint), all true negatives. Raw PCE reached 37.3; after adjustment for the number of placements
the maximum was 10.7 and none reached 60 (0 – 0.29%). **No true-positive cropped trial exists in this
evaluation, so detection of genuine crops on real images is not validated.** It is verified on synthetic
data only.

## 2. Further measurements made during the audit

Details and tables: `audit/BENCHMARK_RESULTS.md`. Scripts: `audit/experiments/`.

| Experiment | Data | Result |
|---|---|---|
| Recent smartphones, baseline at 60 | FloreView, 12 devices, 30 flat references, 30 natural test images each | 0 / 1,860 false matches (0 – 0.20%); **54 / 360 misses (15.0%, 11.5 – 19.1%)**: Redmi Note 8T 29/30, Galaxy S20+ 14/30, Galaxy S10+ 8/30, OnePlus 8T 2/30, Pixel 3a 1/30, seven phones 0/30 |
| Unseen sensors (own sensor removed from the gallery) | VISION, 480 images | 0 attributed to a wrong sensor (0 – 0.77%); highest wrong-sensor statistic 17.2 |
| Real crops, 1024×768 at random offsets | VISION held-out devices, 105 images | True sensor located at the exact offset 105/105; 104/105 at or above 60 after adjustment for 6.8–14.7 million placements; other sensor 0/105 (highest 8.4) |
| Resampled images (50% downscale; 125% upscale) | Same 105 images, true sensor | Never matched (highest 8.3); whole-image upscales refused as unsupported |
| Reference sets of 5, 10, 20 flat and 20 natural images | 4 VISION devices (2 same-model pairs), 20 test images each | 0/80 misses and 0/80 same-model false matches in every configuration; lowest same-device statistic 247 |
| Outcomes for genuine same-device images | Both datasets | Found and fixed: 48 of 360 recent-phone images were being reported as "non-match supported" (section 10 of the benchmark report) |

## 3. Decision policies shipped

| Policy | Thresholds | Status |
|---|---|---|
| `literature-reference-uncalibrated` (default) | match 60, non-match 10 | Reference lines; no error rate claimed |
| `vision-2017-measured` | match 60, non-match 10 | The same uncalibrated lines with the VISION measurements attached for information. It does **not** lift the same-model requirement: per-model evidence is one device pair for four of five models |

No calibrated policy is shipped. Thresholds derived from the VISION calibration split at 1% targets
(10.9 and 0.14) were examined and rejected (section 1). A non-match conclusion is available only for
devices declared conventional and additionally requires the quality and fingerprint conditions in the
methodology; it remains experimental.

## 4. Verification that is not empirical validation

| Check | Result |
|---|---|
| Engine unit, property and regression tests on synthetic sensors | Pass (`make test-engine`) |
| Cross-check against an independent implementation (polimi-ispl/prnu-python) | Shrinkage rule reproduces the reference to correlation > 0.99999. On synthetic sensors the statistics agree within 15%; on real JPEGs individual scores differ widely because the two use different wavelet grids |
| Independent scientific audit (`audit/SCIENTIFIC_AUDIT.md`) | Core numerics confirmed by brute-force reimplementation; every headline figure in this document recomputed from the score file; defects found in the decision layer and fixed |
| Multiple-testing adjustment against the worked example in Goljan and Fridrich (2008) | Reproduces PCE 53.77 for α = 10⁻⁵, k = 88,836,025 |

These show the implementation does what the methodology says. They say nothing about accuracy on real
cameras.

## 5. Validation status of each capability

| Capability | Status | Basis |
|---|---|---|
| Fingerprint from 30–40 flat-field reference images | Validated within scope | 25 devices |
| Fingerprint from 5–20 flat-field or 20 natural images | Measured on 4 older phones only | No miss or false match; too few devices to generalise |
| Same-size image, older smartphones (2011–2016), camera-original JPEG | Validated within scope | 0/3,680 false matches, 7/520 misses |
| JPEG recompression to quality 60 at full resolution | Validated within scope | Older phones |
| Distinguishing units of the same model, older smartphones | Measured: 0/560 | **Seven device pairs in five models**; not enough to claim it per model |
| Unseen-sensor rejection | Validated within scope | 0/480 on older phones |
| Detecting a match on recent smartphones (2017–2021) | **Unreliable and device-dependent** | 15% missed overall; 0% to 97% per device |
| False matches between *different models* of recent smartphones | Measured: 0/1,860 | 12 devices |
| Distinguishing units of the *same* recent model | **Not validated.** Published studies report frequent false matches | Product requires a same-model control and otherwise answers inconclusive |
| Same-model control rule | **Experimental** | Logic tested; no real-data validation on affected devices |
| Dedicated cameras (DSLR, mirrorless, compact) | **Not validated** | No data evaluated |
| 180° rotated images | Validated within scope | 22 of 520 same-device trials on the older phones had their best statistic at 180° |
| 90° rotated images | Synthetic only | |
| Cropped images | Measured on older phones for one crop size; **experimental** elsewhere | 104/105 detected, 0/105 and 0/2,330 false matches; statistic varies unpredictably with crop offset |
| Resized, zoomed, stabilised or platform-processed images | **Unsupported**; verified never to match | 0/210 |
| HDR, portrait, night and other multi-frame modes | **Not validated** as conditions | Unexplained failure patterns on the Huawei P9 and four recent phones |
| Non-match conclusions | **Experimental**, conventional devices only | A rule that allowed them for recent phones was wrong 13% of the time and was removed |
| Delta-sPCE | **Experimental, information only** | Not evaluated; not validated by its authors |
| PNG and 16-bit input | Verified on synthetic data only | |
| Quality flags | Heuristics, **not validated** as predictors | They did not predict the recent-phone misses |

## 6. Limits of this evaluation

- Twenty-five smartphones in total. No dedicated camera. The recent-phone set has no usable same-model
  pair, and four of its twelve devices behave very differently from the rest, so its averages describe
  no particular phone.
- Flat-field references and 40 of them per device: a favourable enrolment condition.
- 40 test images per device, taken in sequence from the dataset rather than sampled.
- Negatives share fingerprints and images; intervals assume independence and are optimistic.
- One run, one decoder version. No cross-platform reproducibility run was made.
- No independent replication.

## 7. Reproducing

```bash
make reference-oracle
```

```bash
make eval-data
```

```bash
make evaluate
```

The download is about 2.8 GB. The evaluation takes roughly one to three hours on an 8–10 core machine
and is resumable: finished images are recorded in `scores.partial.jsonl` and fingerprints are cached, so
re-running the command continues where it stopped. Output goes to `data/eval/vision_subset_v1/`. To
evaluate other data, write a manifest like `engine/evaluation/vision_subset_v1.json` and pass it to
`sensortrace evaluate`.

## 8. What would most improve confidence

1. Recent smartphones with several units per model and firmware version, captured with identical
   settings (the missing same-model test).
1. The cause of the undetectable images on the Redmi Note 8T, Galaxy S20+ and S10+ (pixel binning and
   multi-frame processing are suspects).
2. Dedicated cameras with several bodies per model.
3. Natural-image reference sets and smaller reference counts.
4. Real cropped, resized and platform-processed images with known source.
5. Investigation of the Huawei P9 failure pattern.
6. Independent replication on other hardware and library versions.
