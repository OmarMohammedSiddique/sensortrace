# Independent scientific audit of the SensorTrace PRNU engine

Date: 2026-11-12. Branch `audit/independent-review`. Engine `0.1.0`, algorithm `prnu-wavelet-mle-1.0`,
decision logic `policy-1.0`. Nothing was committed.

## 1. Scope and method

**Read in full:** every module in `engine/src/sensortrace_engine/` (ingest, denoise, residual, fingerprint,
enrol, matching, decision, pipeline, quality, stats, evaluation, cli, visualize, synthetic, version,
errors), all seven existing test files, `SCIENTIFIC_METHODOLOGY.md`, `VALIDATION.md`,
`backend/policies/vision-2017-validated.json`, `docs/validation/vision_subset_v1_results.json`,
`engine/evaluation/vision_subset_v1.json`, and the oracle `data/third_party/prnu-python/prnu/functions.py`.

**Method.** For each audit question the code was read first, then checked with code written for the audit:
explicit-loop implementations of the published definitions, closed-form cases, a 60-digit `mpmath`
reference for the multiple-testing formula, `scipy.stats.binomtest` and scikit-learn for the statistics,
the oracle, and the real VISION images and stored fingerprints under `data/`. The durable checks are in
`engine/tests/test_audit_independent.py` (51 tests: 48 pass, 3 are `xfail(strict=True)` and document
unfixed findings). Exploratory scripts were kept outside the repository.

**Primary literature opened and read (author-hosted copies, text extracted with `pdftotext`):**

| Source | Copy opened | Used for |
|---|---|---|
| Lukas, Fridrich, Goljan 2006 | `ws2.binghamton.edu/fridrich/Research/double.pdf` (manuscript T-IFS-00064-2005.R1) | Appendix A, steps 1-4; sigma0 |
| Chen, Fridrich, Goljan, Lukas 2008 | `ws2.binghamton.edu/fridrich/Research/DoubleColumnFinal.pdf` | model, Eq. 4-7, zero-mean, Fourier Wiener, colour handling |
| Goljan, Fridrich, Filler 2009 | `ws2.binghamton.edu/fridrich/Research/EI7254-18.pdf` | Eq. 8-10, Sec. 4.1, error rates at 60 |
| Goljan, Fridrich 2008 | `ws2.binghamton.edu/fridrich/Research/Crop_scale.pdf` | Sec. 2.2 worked threshold |
| Loison et al. 2026, IPOL 662 | `ipol.im/pub/pre/662/preprint.pdf` | Sec. 3.1, 3.3.1, Eq. 20-21, Alg. 9-11, Sec. 5.1.1 |

Not opened: see section 7.

**Changes made.** Five engine files (`decision.py`, `matching.py`, `pipeline.py`, `fingerprint.py`,
`evaluation.py`) and the new test file. No fingerprint or PCE value changes: the regression
fixture `tests/fixtures/regression_v1.json` was not touched and still passes; a re-enrolment of VISION
device D01 reproduces the recorded digest `403f4d5f...24c0` exactly; five stored scores recomputed from the
image files agree with `scores.csv` to 1e-6. `ALGORITHM_VERSION` was not bumped. Decision *outcomes* change
in the cases described under F-02 to F-05 and F-11, so `DECISION_POLICY_VERSION` should be bumped (not done:
it is the owner's call and the backend stores it).

## 2. Traceability

Status key: **P** verified against paper text opened for this audit; **O** verified against the oracle;
**I** verified by independent computation; **N** not verified.

| Computation | Code | Published source | Status | Note |
|---|---|---|---|---|
| Format sniffing, decode, geometry | `ingest.py:ingest_image` | none | I | 30 constructed files; pixels equal source array / Pillow for every PNG colour type and bit depth; EXIF orientation, ICC, gAMA never alter pixels |
| Wavelet filter: 8-tap Daubechies, 4 levels | `denoise.py:wavelet_noise_residual` | Lukas 2006 App. A step 1 | P, I | `pywt.Wavelet("db4").dec_lo` has 8 taps; `W` equals `I - F(I)` with `F` built independently in float64, max abs diff < 2e-4 on 0-255 scale |
| Local variance, windows 3/5/7/9, minimum; Wiener shrinkage | `denoise.py:adaptive_wiener_noise` | Lukas 2006 App. A steps 2-3 | P, I, O | equals explicit-loop implementation to 4e-15 |
| sigma0 = 3 | `residual.py:extract_residual` default | Lukas 2006 uses 5; IPOL 662 Sec. 5.1.1 finds 3 best for correlation | P | a documented deviation from Lukas, not an error |
| Boundary extension, padding, crop | `denoise.py:_padding` | none (implementation choice) | I | no pixel shift for any size parity (impulse test, 40 random sizes); see F-06 for the consequence of the grid choice |
| Luminance weights 0.299/0.587/0.114 | `residual.py:to_gray` | Chen 2008 Sec. V ("linear combination as in RGB to grayscale") | P | oracle uses 0.29894/0.58704/0.11402; immaterial |
| Zero-mean on four CFA phases | `residual.py:zero_mean_total` | Goljan 2009 Sec. 4.1 (per CFA sub-lattice); Chen 2008 Sec. III-B (rows/columns per channel only) | P, O, I | equals oracle to 2e-7; row/column means < 1e-6 on even and odd sizes; commutes with the luminance combination, so the order difference from Goljan 2009 is immaterial |
| Wiener filter in DFT domain | `residual.py:wiener_dft` | Chen 2008 Sec. III-B describes a **3x3** Wiener filter with variance of `\|F\|` | O, I; **differs from paper** | implements the Binghamton-toolbox/oracle variant (3/5/7/9 minimum rule, variance of the spatial signal). Correlation with oracle 0.9996 (border mode differs). Methodology cites Chen without recording the deviation |
| ML estimator `sum(W I)/sum(I^2)` | `fingerprint.py:FingerprintAccumulator`, `_finalize` | Chen 2008 Eq. 6 | P, I | float32 streaming result equals an independent float64 accumulation to relative RMS 2.4e-7 after 400 images; `+1` regulariser and intensity attenuation follow the toolbox/oracle, not the paper |
| Saturation mask | `residual.py:saturation_mask` | none (toolbox convention, modified) | I | equals brute force; differs from oracle by design (98.7% agreement on a test image) |
| Split-half diagnostic | `fingerprint.py:finalize`, `_zero_shift_pce` | none | I | 200/200 split, PCE 23,524 on one synthetic sensor; cannot detect mixed sets (F-07) |
| Leave-one-out screening | `enrol.py:enrol` | none | I | see F-07 |
| Circular cross-correlation | `matching.py:circular_xcorr`, `_xcorr_from_fft` | Goljan 2009 Eq. 8 text | P, I | equals explicit double loop to 2e-7 relative |
| PCE: peak, 11x11, divisor `mn - \|N\|`, wrap, sign | `matching.py:pce_at` | Goljan 2009 Eq. 8 (unsigned); sign from IPOL 662 Alg. 11 | P, I | equals explicit-loop value to 1e-12 at four peak positions including corners; divisor count 623 = 24*31 - 121 |
| No peak search for same-size images; maximum of 0 and 180 degrees | `matching.py:compare` | Goljan 2009 Sec. 2.1 ("k = 1"), Sec. 2.2 (`PCE2`) | P, I | brute-force PCE 1808.4190 vs engine 1808.4193 with mask and intensity |
| Masked NCC | `matching.py:_ncc` | Lukas 2006 Eq. 6 | P, I | equals `np.corrcoef` on valid pixels; exactly 1 for `W = I K` |
| Rotation handling | `matching.py:_rot`, `compare` | none | I | applied to residual, intensity and mask together; reported value is the counter-clockwise correction (F-12) |
| Crop search `sum W I K(x+s)` | `matching.py:_cropped` | Goljan & Fridrich 2008 Sec. 2.1 | P (concept), I | equals exhaustive loops over every placement to 8e-8 relative; peak correct at all four borders; null z-variance 0.96 (region energy) and 0.97 (whole-surface fallback), so zero-padding does not bias the energy |
| Search adjustment | `decision.py:effective_pce` | Goljan 2009 Eq. 9-10; Goljan & Fridrich 2008 Sec. 2.2 | P, I | `tau(1e-5, 88,836,025) = 53.7722` reproduced; relative error vs 60-digit reference < 1e-9 wherever the result is above -60; saturates below (F-09) |
| Decision rules | `decision.py:decide`, `pipeline.py:analyse_questioned` | project's own rules | I | four defects found and fixed (F-02 to F-05), one more (F-11) |
| AUC, ROC, intervals, thresholds | `stats.py` | standard | I | AUC equals pair counting and scikit-learn to 1e-12 with ties; Clopper-Pearson and Wilson equal `scipy.stats.binomtest` to 1e-12; `threshold_for_fpr` is the smallest admissible threshold in 200 random cases with ties and is not off by one |
| Evaluation analysis | `evaluation.py:analyse` | project's protocol | I | reproduces `docs/validation/vision_subset_v1_results.json` field for field from `scores.csv` (only differences after this audit: F-10 threshold by one ulp, one note string) |
| Delta-sPCE | `pipeline.py:analyse_questioned` | arXiv:2610.25438 | N | only the abstract page was read, through a summarising fetch tool; definition not checked against the paper text |
| Mihcak et al. 1999 filter | `denoise.py` | ICASSP 1999 | N | not opened; checked only through Lukas 2006 App. A |

## 3. Findings

Severity reflects the consequence for a reported conclusion.

### F-01 (high) Shipped policy file overstates its evidence; reported, not fixed (`backend/` is out of scope)

`backend/policies/vision-2017-validated.json`:

1. The block named `held_out_test_operating_point` holds `n_same 520, n_diff 3680`. Those are **all 13
   devices, including the six calibration devices**. Recomputed held-out figures (test split only):
   0/880 false matches (95% upper bound 0.42%, not 0.10%), 0/280 misses (upper bound 1.3%).
2. `calibrated: true` while `threshold_selection` says "Fixed a priori ... not tuned". In `decide` this flag
   (a) removes the caveat that thresholds are uncalibrated and (b) enables the `calibrated_for_model` path,
   which returns "match supported" for a computational/unknown device with no controls, with the reason
   "The policy was calibrated with same-model negatives for this device model."
3. The scope lists five models. The same-model evidence per model is:

   | Model | Devices | Unordered device pairs | Trials | Max statistic | 95% upper bound on false-match rate |
   |---|---|---|---|---|---|
   | iPhone 4s | 2 | 1 | 80 | 8.6 | 4.5% |
   | iPhone 5 | 2 | 1 | 80 | 10.3 | 4.5% |
   | iPhone 6 | 2 | 1 | 80 | 21.4 | 4.5% |
   | Galaxy S3 Mini | 2 | 1 | 80 | 11.5 | 4.5% |
   | iPhone 5c | 3 | 3 | 240 | 18.8 | 1.5% |

   The pooled "0/560, upper bound 0.66%" is 7 device pairs. Treating the same-model alternative as addressed
   for every unit of a model from one pair is not supported, and firmware is not part of the model key.

Evidence: `recompute.py` output: `original n 280 880 240 ... CI fm 0.00418 CI miss 0.01309`;
`same-model apple iphone 6 80 devices 2 CP upper 0.0451 max 21.36` (and the other four rows).
Recommended: rename the block and use the 280/880 figures, or state plainly that it is the full set; set
`calibrated` to false or split the flag into "measured" and "calibrated"; drop the per-model scope or attach
the per-model counts.

### F-02 (high) A non-finite or degenerate statistic was reported as "non-match supported"; fixed

- `decide` with `pce = NaN` fell through every comparison to `NON_MATCH` (before: `nan pce clean conv ->
  non_match_supported`); `inf` gave a match.
- `pce_at` returns `0.0` when the correlation energy is zero or not finite. A residual that is identically
  zero, or a fingerprint containing NaN/Inf (accepted by `Fingerprint.from_bytes`, whose digest check passes),
  therefore scored PCE 0.0 and could reach "non-match supported".

Fix: `decide` returns `insufficient_or_unsupported` for a non-finite statistic; `compare` returns an
`unsupported` measurement with a note when the peak or energy is not finite or the energy is zero;
`Fingerprint.from_bytes` raises `NumericalError` for non-finite or non-2-D data.
Tests: `test_non_finite_statistic_never_supports_a_conclusion`,
`test_degenerate_correlation_is_unsupported_not_a_low_score`,
`test_fingerprint_with_non_finite_samples_is_refused_on_load`.

### F-03 (high) Searching more candidates could create "non-match supported"; fixed

The non-match line was applied to the search-adjusted statistic. The adjustment only lowers the value, so
adding candidate sensors moved intermediate results into the non-match zone:
`effective_pce(15, 2*c)` = 13.7, 10.7, 9.4, 6.5, 2.6 for c = 1, 5, 10, 50, 500. Before the fix:
`pce 15, 1 cand -> inconclusive`, `pce 15, 50 cand -> non_match_supported`. A correction for multiple
testing protects a match claim against chance peaks; it is not evidence of a different source.

Fix: the non-match line is compared with the unadjusted statistic (the maximum over the rotations tested);
the match line still uses the adjusted one. Effect on the VISION scores: different-device trials at or below
10 fall from 99.35% (adjusted) to 99.05% (unadjusted); same-device unchanged at 7/520.
Test: `test_searching_more_candidates_cannot_create_non_match_support`.

### F-04 (high) A weak control fingerprint cleared a shared artefact; fixed

Any same-model fingerprint counted as a control, whatever its quality. Two devices sharing a pattern
(synthetic, shared strength 0.004): a 20-image control scored PCE 325 and the outcome was correctly
`inconclusive / controls_failed`; a control built from two dark JPEG-50 images (split-half PCE 41) scored
0.1 and the outcome was `match_supported / same_model_controls`.

Fix (`pipeline.py`): a control that stays below the threshold is counted only if its fingerprint meets the
policy's own requirements for a non-match reading (`min_reference_images_for_non_match`,
`min_split_half_pce_for_non_match`); a control that reaches the threshold always counts; uncounted controls
are stated in the reasons and in `nua.n_controls_not_counted`.
Test: `test_weak_control_fingerprint_cannot_clear_a_shared_artefact`.
Not addressed: a control cannot be shown to be a *different physical device*; that rests on the declared
`device_id`. Enrolling one device twice under two ids gives `controls_failed` (safe direction).

### F-05 (medium) Control statistics were deflated by the search size, and a NaN control was order-dependent; fixed

Controls were passed through `effective_pce` with the trial count of the main comparison. A control at raw
PCE 70 with 500 candidates and two rotations (1000 trials) became 56.4 and "stayed below the threshold". `max([5.0, nan])` is 5.0 in Python
while `max([nan, 5.0])` is NaN, so `[5, nan]` gave `match_supported` and `[nan, 5]` gave `controls_failed`.

Fix: controls are compared unadjusted; any non-finite control counts as failed.
Test: `test_controls_are_not_deflated_by_the_search_size_and_nan_controls_fail`.

### F-06 (medium) The statistic depends strongly on the wavelet grid position on real JPEGs; documentation claim wrong; not fixed

`SCIENTIFIC_METHODOLOGY.md` 3.2 says a grid offset of one pixel gives a residual "correlated at about
0.96-0.97", that the convention "does not affect matching of full-size images", and that it reduces the
statistic "slightly" for crops at offsets that are not multiples of 16. Section 7 says engine and oracle
residuals "correlate above 0.95". These hold for the synthetic white-noise sensor only.

Measured on VISION camera JPEGs, same filter, grid moved by (1, 1), scored against the engine's stored
fingerprints:

| Device (model) | Same-device PCE, engine grid | Same-device PCE, grid + (1,1) | Ratio |
|---|---|---|---|
| D06 (iPhone 6), 6 images | 6370, 6982, 3889, 9819, 3828, 2438 | 11829, 9631, 5945, 12757, 6349, 4149 | 1.30 to 1.86 |
| D15 (iPhone 6), 1 image | 3312 | 5258 | 1.59 |
| D29 (iPhone 5), 4 images | 9292, 10693, 3075, 8331 | 8234, 8311, 1799, 6444 | 0.59 to 0.89 |
| D05 (iPhone 5c), 4 images | 7888, 103, 7934, 8772 | 6190, 24, 6748, 7029 | 0.23 to 0.85 |
| D11 (Galaxy S3), 4 images | 12969, 17077, 16627, 12710 | 13862, 17022, 17741, 15247 | 1.00 to 1.20 |

Residual correlation between the two grids on real images: 0.55 to 0.65 (engine vs oracle on
`D06_I_nat_0001.jpg`: 0.549). Median ratio over the 16 images of the four-device run 0.94, so there is no
systematic loss, but the per-image effect is tens of percent in either direction and depends on the device. 96 different-device trials stayed low on both grids
(maxima 8.4 and 10.0). One image fell from 103 to 24, across the 60 line.

Consequences: (1) the two documentation statements are unsupported; (2) the statistic for a genuine crop at
an odd offset is not predictable from full-frame results, which adds to the reasons crop detection is
unvalidated; (3) a cycle-spun or multi-phase residual might be worth evaluating. Any change alters every
score, so nothing was changed. Test (needs the VISION data, `xfail` strict):
`test_wavelet_grid_phase_does_not_change_real_image_statistic_by_more_than_a_quarter`.

### F-07 (medium) Leave-one-out screening detects only a lone foreign image; not fixed

The leave-one-out fingerprint contains the other foreign images, so two or more images from one other
sensor vouch for each other. Synthetic, 512 px crop:

- 12 images of A + 3 of B: all 15 accepted; leave-one-out PCE of the three B images 2265, 2560, 2684; the
  resulting "A" fingerprint matches a new B image with PCE 4279.
- 12 A + 10 B: all 22 accepted; fingerprint matches A at 33,445 and B at 26,559.

The split-half diagnostic does not help (both halves contain both sensors). The opposite errors did not
occur in the cases tried: genuine dark, textured references among flat ones were kept (LOO 32,000 to
41,000), and a lone intruder in a weak set was rejected (LOO -0.5 against a median of 76). When the set
median is below 50 nothing is screened and only a warning is issued, which the methodology states.

A fix needs a clustering step and thresholds of its own, so it is reported, not applied. Until then the
methodology should say that screening does not protect against several images from a second device of the
same model and resolution. Test (`xfail` strict):
`test_enrolment_rejects_a_group_of_images_from_a_second_sensor`.

### F-08 (medium) Gaussian tail figures are emitted with every measurement and are wrong by orders of magnitude for real images; not fixed

`ComparisonMeasurement.to_dict` carries `p_value_gaussian` and `p_false_alarm_gaussian`. No probability of
identity is produced anywhere, and the caveats say so. But these two numbers read as false-alarm
probabilities and the model behind them does not hold:

- VISION different-model native trials (n = 3120, statistic is the maximum of two rotations): 4.7% exceed
  z = 2.326 where the model predicts 2.0%; 0.67% exceed z = 3.09 where it predicts 0.2%.
- At PCE 60 the emitted figure is 4.7e-15. Goljan et al. 2009 measured an overall false-acceptance rate of
  2.4e-5 at that threshold and state that the statistic has "much thicker tails" than the model.

Recommended: remove the two fields from result payloads and reports, or replace them with the model-free
statement of how many hypotheses were searched. Left in place because consumers outside `engine/` read
them.

### F-09 (low) `effective_pce` saturates at -67.396 and can exceed the raw value; not fixed (changes adjusted scores)

When the family-wise tail probability rounds to 1 the function returns `-(isf(1 - 1e-16))^2 = -67.396`.
Examples (engine / exact): PCE 0 with 100 trials: -67.4 / -131.9; PCE 1.26 with 1000 trials: -67.4 / -273.0;
PCE -100 with 2 trials: **-67.4** (above the raw value) / -205.8. The function is monotone (no decreasing
step on a 243-point grid for seven search sizes, nor on a 6001-point scan across the internal branch at
`log p = -30`), finite for all inputs tested, exact to 1e-9 wherever the result is above -60, and the
identity for one trial. `Phi(z_eff) = Phi(z)^n` evaluated as `ndtri_exp(n * log_ndtr(z))` is exact in the
negative range. No decision depends on values this low, and no row of `scores.csv` is at the floor
(minimum adjusted value -17.4), so a fix would not alter the published evaluation, but it does change
emitted numbers and was therefore not applied.
Test (`xfail` strict): `test_effective_pce_is_exact_and_never_above_the_raw_value_for_negative_statistics`.

### F-10 (low) Data-derived non-match threshold exceeded its target by one trial; fixed

`threshold_for_fnr` counts a miss as `score < t`; the policy declares a non-match at `score <= t`. With the
VISION calibration set the selected value 0.14310547905267437 is itself a calibration score, giving 3/240 =
1.25% in-sample false non-matches against a 1% target. Fix: `evaluation.analyse` steps the threshold one
float down. Re-running the analysis on the existing `scores.csv` changes exactly one number in the results
(to 0.14310547905267434); `data/eval/.../policy.json` and the committed results JSON were not regenerated.
This data-derived threshold is not shipped. Test: `test_evaluation_strata_split_and_in_sample_rates`.

### F-11 (low) A strongly negative statistic was reported as "non-match supported" and hidden by the rotation maximum; fixed

For `W = -I K` the engine reports PCE -0.02 (the 180-degree value) while the 0-degree value is -1991.
A signed statistic that far below zero is expected under neither hypothesis; an intensity-inverted copy of
a genuine image produces it. Fix: a statistic at or below minus the match threshold, at any rotation tested,
blocks the non-match conclusion (outcome inconclusive, reason stated).
Test: `test_strongly_negative_statistic_is_not_reported_as_a_non_match`.

### F-12 (low) Rotation note described the wrong direction; fixed

An image stored rotated 90 degrees counter-clockwise is reported with `rotation = 270`: the value is the
counter-clockwise rotation *applied to the image* to align it, as the field comment says. The user-facing
note said "the image rotated by 270 degrees relative to the fingerprint's stored pixel grid". Reworded to
"after rotating the stored image by N degrees counter-clockwise to align it". Numbers unchanged.
Test: `test_reported_rotation_is_the_counter_clockwise_correction`.

### F-13 (low) Evaluation hygiene; fixed

- Crop "negatives" were every cropped row, on the assumption that all are different-device. True for this
  dataset (0 same-device crops among 1280) but not in general; now filtered on `device != candidate`.
- The module docstring said reference and test images are "checked for exact and near duplicates".
  Reference-versus-test near duplicates are not checked (only SHA-256 equality; perceptual hashes are
  compared among test images of a device). Docstring corrected; the check itself was not added.

Test: `test_same_device_crops_are_not_counted_as_crop_negatives`.

### F-14 (low) The evaluated statistic is not the deployed statistic when several candidates are compared; needs a decision

The evaluation adjusts for the alignments searched only (2 for every native trial). The product also
multiplies the trial count by the number of candidate sensors. Charging candidates is a legitimate
family-wise correction under the idealised null and errs toward fewer matches, but:

- the miss rates in `VALIDATION.md` describe single-candidate use only;
- the same image and fingerprint give different adjusted values, and can give different outcomes,
  depending on which other sensors were selected for the run (62 is a match alone and inconclusive among
  500), which is awkward to explain and to reproduce;
- because of the two-rotation adjustment the line "60" corresponds to a raw two-rotation PCE of 61.37
  (`effective_pce(60, 2) = 58.64`), whereas Goljan et al. 2009 applied 60 to the raw maximum of the two.

No code change. Options: keep and document; or apply the candidate count only in the open-set summary.

### F-15 (info) Ingestion: no mis-decoding found

Thirty constructed inputs. Correct: RGB/RGBA/palette/palette+tRNS/grey/1-bit/2-bit/16-bit grey/16-bit
RGB(A) PNG all equal the source or Pillow sample for sample, in RGB order; EXIF orientation (JPEG and PNG
`eXIf`), ICC and gAMA do not alter pixels; progressive, 4:2:0, greyscale JPEG decode as Pillow does; CMYK
JPEG is converted with a note; APNG and MPO analyse the first frame with a note; zero-size, oversized and
truncated files raise typed errors; a 231 kB PNG that expands to 79 MP is accepted within limits (54 s for
ingest plus residual). Observations: grey+alpha PNG becomes three identical channels and the note says
"colour samples"; the `shape[2] == 2` branch is unreachable; sub-8-bit PNGs are expanded without a note;
bytes after the JPEG end marker are accepted silently; `JpegQuantHash` masks table entries to 8 bits.
Tests: `test_png_path_returns_rgb_order_for_every_colour_type`,
`test_png_grey_alpha_bit_depths_and_animation`,
`test_orientation_tags_and_colour_profiles_never_change_pixels`.

### F-16 (info) Smaller observations

- A match is not gated by `min_valid_pixels` (PCE 70 with 100 usable pixels is a match for a conventional
  device). This follows the stated principle; the dataclass comment said "for any conclusion" and was
  corrected.
- Square images are tested at four rotations (4 trials); the methodology table says two.
- The residual of a rotated image is rotated, not re-extracted. Measured PCE ratio 0.991 to 0.997 on 12
  synthetic images.
- `wiener_dft` averages the spectrum with edge replication although the spectrum is periodic; 2.9% RMS
  difference from wrap-around on a 120x160 array, negligible at megapixel sizes.
- Enrolment keeps every candidate's crop arrays in memory for the leave-one-out pass, about 8.6 MB per
  image at 512 px (roughly 0.5 GB for 60 references); the crop shrinks for larger sets but the total is
  unbounded.
- `mypy src` reports 9 errors, all present before this audit.

## 4. Answers to the audit questions

1. **Ingestion.** Type is verified from magic bytes plus a full decode restricted to the sniffed format.
   Orientation, channel order, bit depth, alpha and palette are handled correctly; original bytes are hashed
   and never modified; no crash, hang or silent mis-decode was found (F-15).
2. **Denoising and residual.** The filter implements Lukas 2006 Appendix A exactly, with no off-by-one for
   any size. Zero-mean and the DFT Wiener filter match the oracle; the latter follows the toolbox, not the
   text of Chen 2008. The grid position matters far more on real JPEGs than documented (F-06).
3. **Fingerprint.** The estimator is Chen 2008 Eq. 6 with consistent weights in numerator and denominator;
   float32 accumulation is sound for hundreds of images (2.4e-7); post-processing order is equivalent to the
   papers. Split-half is meaningful for a single sensor but blind to mixtures; leave-one-out screening can
   accept a foreign group (F-07). No wrongful rejection of a genuine reference was produced.
4. **Detection statistic.** Correlation convention, PCE definition, masked NCC, rotation and crop search are
   all correct against brute force; zero-padding does not bias the energy; border peaks are found. The
   rotation note was misleading (F-12); degenerate surfaces scored 0.0 (F-02).
5. **`effective_pce`.** Mathematically right, monotone, reproduces Goljan & Fridrich 2008; inaccurate only
   in the deep-negative range (F-09). Its use for the non-match line and for controls was wrong (F-03,
   F-05); charging candidates is defensible but changes what was validated (F-14).
6. **Decision policy.** After the fixes no path was found that returns "match supported" for an
   unknown/computational device without counted controls or a policy scope entry (enumerated over
   device class and control lists in `test_match_is_unreachable_without_addressing_the_same_model_alternative`).
   Before the fixes: weak controls (F-04), deflated or NaN controls (F-05), NaN to non-match (F-02),
   candidate count to non-match (F-03), negative statistics (F-11). Controls of a different fingerprint
   shape are excluded. The remaining route to an unsupported match is the policy file itself (F-01).
   Nothing is presented as a probability of identity; the Gaussian tail fields are the closest (F-08).
7. **Statistics.** AUC, ROC, Clopper-Pearson, Wilson, confusion counts and `threshold_for_fpr` are correct;
   the latter refuses targets below 1/n. One interface mismatch in the non-match threshold (F-10).
8. **Evaluation.** No calibration/test leakage: pairs are used only when image device and candidate are in
   the same split, and altering every test-split score leaves the thresholds unchanged
   (`test_test_split_scores_cannot_influence_calibrated_thresholds`). Strata are assigned correctly. Every
   headline figure in `VALIDATION.md` was reproduced from `scores.csv` with independent code:
   520/560/3120 trials; minima -0.9/-5.3/-17.4; medians 9667/0.3/0.0; 99th percentiles 51438/12.2/7.5;
   maxima 70757/21.4/15.9; 0/3680 and 0/560 false matches; 7/520 misses, all D03; held-out 0/880 and 0/280,
   minimum 1149, maximum 21.4; recompression minima 682/238/131 and medians 7394/3648/2080; thresholds 10.86
   and 0.14 with 6/880 false matches, five same-model; crop 1280 trials, raw maximum 37.3, adjusted 10.7;
   22 of 520 at 180 degrees; 13 dark images, minimum 101; split-half 77,165 to 752,752. All seven P9 misses
   carry `CustomRendered = 1` and two re-run end to end give `inconclusive`, as stated.
9. **Tests.** Section 5.

## 5. Classification of the existing tests

(a) checks a computation against an independently known answer; (b) self-consistency or behaviour on
synthetic data with loose bounds; (c) mocks the thing under test. No test of class (c) was found.

| File | Class | Comment |
|---|---|---|
| `test_denoise_residual.py` | mostly (b); (a) for `to_gray`, `intensity_weight`, the small saturation case, zero-mean property | no comparison of the filter with an independent implementation here |
| `test_fingerprint_matching.py` | (a) for the circular shift, the hand-computed PCE, wrap-around, Gaussian tail values, recovery of the synthetic ground-truth pattern; (b) for the rest | crop and rotation are checked end to end on one synthetic case each, never against exhaustive search |
| `test_decision_pipeline.py` | (a) for the Goljan & Fridrich example; (b) for the rule tests and pipeline runs | the rule tests restate the implementation's rules; `test_candidate_count_is_a_multiple_testing_cost` pins a design choice (F-14) |
| `test_enrol_stats.py` | (a) for AUC closed forms, interval reference values, the hand-worked ROC; (b) for enrolment | one intruder only (F-07); tie handling in threshold selection untested |
| `test_ingest_quality.py` | (a) for decoded pixels against source arrays, header-only bombs, corrupt files; (b) for quality flags | no CMYK, APNG, 16-bit grey, eXIf, ICC cases |
| `test_reference_implementation.py` | (a) against the oracle | synthetic data only, wide tolerances (0.95 correlation, 15%); the shrinkage test places the engine's own shrinkage function inside the oracle's transform; real JPEGs behave differently (F-06) |
| `test_regression.py` | (b) | pins numbers the code itself produced; detects change, not error |

Important behaviour that had no real test before this audit: any part of `evaluation.py` (strata, split
separation, threshold selection in context, crop stratum); non-finite and degenerate statistics; the
interaction of search adjustment with the non-match line and with controls; control quality; crop search
correctness at borders; float32 accumulation error; `effective_pce` over its full range; `cli.py`;
`visualize.py`. Still untested: `cli.py`, `visualize.py`, `calibrated_policy`, `find_leakage`, the `_plot`
function, and anything on real images in the default test run.

## 6. Claims in the project documents found overstated or unsupported

| Document | Claim | Assessment |
|---|---|---|
| `SCIENTIFIC_METHODOLOGY.md` 3.2 | one-pixel grid offset gives a residual correlated at 0.96-0.97; convention "does not affect matching of full-size images"; reduces the statistic "slightly" for crops | synthetic only; real JPEGs 0.55-0.65 and -77% to +86% (F-06) |
| `SCIENTIFIC_METHODOLOGY.md` 7, `VALIDATION.md` 3 | engine and oracle residuals correlate above 0.95; statistics agree within 15% | synthetic only; 0.549 and 6370 vs 11828 on a real image |
| `SCIENTIFIC_METHODOLOGY.md` 3.3 | frequency-domain Wiener filter attributed to Chen 2008 with "the same adaptive rule" | Chen 2008 specifies a 3x3 Wiener filter with the variance of the Fourier magnitude; the engine follows the toolbox variant |
| `SCIENTIFIC_METHODOLOGY.md` 3.4 | screening rejects an image "probably from a different sensor" | only a single such image (F-07) |
| `SCIENTIFIC_METHODOLOGY.md` 3.5 | same-size images: 2 trials | 4 for square images |
| `SCIENTIFIC_METHODOLOGY.md` 3.4 | spectrum diagnostics "stored with every fingerprint" | added by the backend; fingerprints from the engine CLI do not have them |
| `VALIDATION.md` 2, policy JSON | same-model alternative "treated as addressed" for five models | one device pair for four of them; upper bound 4.5% per model (F-01) |
| policy JSON | `held_out_test_operating_point` | all 13 devices (F-01) |
| policy JSON | `calibrated: true` | thresholds are literature values (F-01) |
| `VALIDATION.md` 4 | "Distinguishing devices of the same model, older smartphones: validated within scope, 560 trials" | 560 trials are 7 device pairs |
| `VALIDATION.md` 1 | miss and false-match rates | hold for one candidate per comparison only (F-14); the document does disclose non-independence |
| `decision.py` policy basis | "later studies measured false-match rates from 5% to over 60%" | not verified; Iuliani et al. 2021 was not opened |

Statements checked and found accurate: every numeric result in `VALIDATION.md` (question 8); the Goljan &
Fridrich 2008 example; "FRR 2.38%, FAR 2.4e-5 at 60" and "FAR < 1e-6" for different models in Goljan et al.
2009; the P9 `CustomRendered` statement; "no true-positive cropped trial exists".

## 7. Not verified

- Mihcak, Kozintsev, Ramchandran 1999: not opened.
- Iuliani, Fontani, Piva 2021; Martin & Newman 2025; Li & Law 2025; Shullani et al. 2017: not opened.
- arXiv:2610.25438: only the abstract page, through a tool that summarises; no sentence of the paper was
  read verbatim, so the Delta-sPCE definition and the authors' operational caveat are unverified.
- IPOL 662: the preprint PDF was read, not the published article.
- IEEE and SPIE versions of record of the four Binghamton papers: author-hosted copies were read instead.
- `docs/research/literature-notes.md` was not relied on and was not checked line by line.
- The multi-hour scoring run was not repeated. Verified instead: five scores recomputed from files, one
  fingerprint re-enrolled to an identical digest, and the analysis stage re-run on `scores.csv`.
- Reference-versus-test near-duplicate leakage was not measured (flat-field versus natural categories make
  it unlikely).
- Whether 60, the non-match line 10, sigma0 = 3 and the screening constants were fixed before any VISION
  score was seen cannot be established from the repository.
- The backend test suite was not run (out of scope, another auditor is working there). The decision
  changes F-02 to F-05 and F-11 alter outcomes only in the cases described; the one backend test that uses
  controls enrols 20 references per device and should be unaffected.
- No dedicated camera, no post-2016 phone, no genuine crop and no platform-processed image was available,
  so nothing can be said about them beyond what `VALIDATION.md` already disclaims.

## 8. Final state

```
uv run pytest -q            142 passed, 3 xfailed
uv run ruff check src tests All checks passed
uv run ruff format --check  26 files already formatted
```
