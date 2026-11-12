# SensorTrace literature notes: PRNU camera-sensor fingerprinting

Compiled 2026-11-12. Scope: the five assigned references plus the foundational literature needed to implement and evaluate a PRNU engine.

## 0. How to read this document (verification status)

Every claim carries one of these tags, either inline or by the section it sits in.

| Tag | Meaning |
|---|---|
| **[V-full]** | I downloaded the PDF or source code and read the passage myself. |
| **[V-tool]** | Read through a page-summarising fetch tool (PMC and Springer pages). Numbers were extracted by that tool, not read by me from the page; equations may be paraphrased. Re-check against the PDF before quoting in anything external. |
| **[V-code]** | Read directly in source code. |
| **[MEM]** | From memory, unverified. Do not ship logic or claims that rest only on these. |
| **[NOT OPENED]** | I could not open the source at all. |

Source access summary:

| Source | Status |
|---|---|
| Ref 1, Martin & Newman 2025 (PMC11693528) | [V-tool], first 100k characters of the page plus reference-list tail. Supplement (Data S1) not opened. |
| Ref 2, Li & Law 2025 (PMC12737310) | [V-tool], first 100k characters. |
| Ref 3, Loison et al., arXiv 2610.25438v1 | [V-full], PDF read end to end (9 pages). |
| Ref 4, Loison et al., IPOL preprint 662 | [V-full], PDF read end to end (29 pages) and the source zip read [V-code]. |
| Ref 5, Shullani et al. 2017 (VISION) | [V-tool]. Direct download was blocked by a Springer bot check; the fetch tool got the article text but not the numeric tables (AUC values, Tables 2-4). |
| Lukas, Fridrich, Goljan 2006 | [V-full] for the denoiser appendix, sigma0 discussion, Np recommendation. Results tables not transcribed. |
| Chen, Fridrich, Goljan, Lukas 2008 | [V-full] for sections II-III (model, MLE, CRLB, zero-mean, Wiener). Sections IV-VI skimmed by keyword only. |
| Goljan, Fridrich, Filler 2009 | [V-full], whole paper. |
| Goljan & Fridrich 2008 (cropped and scaled) | [V-full] for method, threshold formula, conclusions. Result tables not transcribed. |
| Binghamton MATLAB code (`CompressionEI2016.zip`: `PCE.m`, `crosscorr2.m`, `WienerInDFT.m`, `ZeroMean.m`, `ZeroMeanTotal.m`, `rgb2gray1.m`, `SensorFingerprintFilter.m`) | [V-code]. The main toolbox (`getFingerprint.m`, `NoiseExtractFromImage.m`, `WaveNoise.m`, `IntenScale.m`, `Saturation.m`) is not downloadable (page says to email M. Goljan); known only via the polimi port. |
| polimi-ispl/prnu-python `functions.py` | [V-code]. |
| Iuliani, Fontani, Piva 2021 (arXiv 2009.04878v2) | [V-full]. Per-camera FPR table could not be aligned reliably from the PDF text (see D). |
| Vazquez-Padin et al. 2025 (arXiv 2510.09509) | [V-full] for abstract, introduction, section 4.2, conclusions. |
| Vazquez-Padin et al. 2026 (arXiv 2505.07380v2, Apple SDNP) | Abstract and introduction only. |
| Baracchi et al. 2021 | Abstract only (lab page). |
| Albisani et al. 2021 | [NOT OPENED] (IEEE paywall). Dataset README read; findings known only as cited by others. |
| Goljan 2008 (IWDW, PCE and false acceptance) | [NOT OPENED]. Known via Goljan 2009, IPOL 662 and the MATLAB code. |
| Goljan & Fridrich 2012 (lens distortion) | [NOT OPENED]. |
| Goljan, Chen, Comesana, Fridrich 2016 (compression) | Paper [NOT OPENED]; its code was read. |
| Mihcak, Kozintsev, Ramchandran 1999 | [NOT OPENED]. Algorithm taken from Lukas 2006 Appendix A, which restates it. |
| Ferrara et al. 2021 (J. Imaging, LR methods for camera attribution) | [NOT OPENED] (HTTP 403). |
| ENFSI evaluative reporting guideline; ENFSI image-authentication BPM; SWGDE image authentication; Meuwly et al. validation guideline | [NOT OPENED]. Only search-result snippets seen. |
| Al-Ani & Khelifi 2017; Montibeller 2024; Butora & Bas 2024; Bhat & Bianchi 2022; EIS papers (Taspinar, Mandelli) | [NOT OPENED]. Known only as cited. |

---

## A. Per-reference summaries

### A1. Martin & Newman 2025 [V-tool]

**Citation.** Martin, A., Newman, J. (2025). Significance of image brightness levels for PRNU camera identification. *Journal of Forensic Sciences* 70(1), 132-149. doi:10.1111/1556-4029.15673. PMCID PMC11693528. Published online 19 Nov 2024.

**Licence.** Reported by the fetch tool as CC BY 4.0, (c) 2024 The Authors. Confirm on the Wiley page before reuse.

**Contribution.** An empirical test of whether image brightness (dark, nominal, bright) changes PRNU error rates when the standard pipeline and the fixed PCE-60 rule are applied. It is a forensic-science validation paper, not an algorithm paper.

**Algorithm as stated.**
- Residual: `W = I - F(I)`, F a Daubechies wavelet denoiser.
- Questioned-image residual: `Q = G(W)`, where G is unspecified "further processing" removing NUAs from model-specific noise and JPEG compression.
- Fingerprint: `K = G( sum_i W_i I_i / sum_i I_i^2 )`, N = 30 reference images.
- Score: signed PCE between Q and `I * K`, defined by reference to Eq. 5 of Goljan et al. (the 2016 compression paper, their ref 15). Not reproduced on the page.
- Shifts: none admitted when image and fingerprint sizes match; all shifts admitted otherwise.
- Decision: match if PCE > 60. Justification: the Goljan 2009 Flickr study.
- Orientation (Flickr set only): two rotations tested (0/180 or 90/270 as applicable), larger PCE kept.
- Brightness labels from the cumulative intensity fraction: dark if fewer than 7% of pixels are at or above intensity 149; bright if at least 16% of pixels are at or above 238; otherwise nominal. The page is internally inconsistent about "less than" vs "at most" 149; check Data S1 before reproducing.

**Datasets and protocol.**
- StegoAppDB: 28,360 images, 28 smartphones, 10 models, 10 exposure settings per scene.
- Flickr set of Iuliani et al.: 31,994 images, 495 cameras, 79 models. 340 cameras had at least 30 nominal images and got fingerprints; 21,794 questioned images.
- 8,553,760 PCE scores in total.
- Statistics: two-sided pooled z-tests on proportions, Bonferroni over 4 tests, post hoc power analysis.

**Reported numbers (with conditions).**
- StegoAppDB, nominal fingerprints: TPR 100% (nominal questioned) vs 98.26% (bright), p ~ 0. TNR 99.974% (nominal) vs 99.937% (dark), p = 4.6e-6.
- StegoAppDB, auto-exposed fingerprints: Pixel 2 produced 2,464 of 2,553 false negatives (FNR about 86.8%); with nominal fingerprints the Pixel 2 FNR was 0.78%. Fingerprint image selection dominates.
- Flickr, nominal fingerprints: TPR 67.55% (nominal) vs 54.26% (dark). TNR 91.87% (nominal) vs 86.82% (dark) vs 89.67% (bright). That is an FPR of roughly 8% at PCE 60 on uncontrolled modern data.
- Per-camera spread on Flickr: TPR 0-100%, TNR 6.1-99.62%.
- FPRs for bright and dark images are significantly above the 0.0024% (2.4e-5) of Goljan 2009.

**Limitations stated.** Flickr provenance, post-processing and orientation are unknown; only two rotations tested; FPR is pooled across cameras, not within model; cameras are older models; post hoc power is limited.

**Code/data.** No code released. Datasets are third-party.

**Relevance.** Brightness must be a recorded covariate. Dark questioned images and dark reference images are a documented failure mode. A fixed threshold of 60 does not deliver the 2009 error rates on newer or uncontrolled data.

### A2. Li & Law 2025 [V-tool]

**Citation.** Li, Z., Law, N.-F. (2025). Recent Advances in Deep Learning-Based Source Camera Identification and Device Linking. *Sensors* 25(24), 7432. doi:10.3390/s25247432. PMCID PMC12737310. Published 6 Dec 2025.

**Licence.** CC BY 4.0. No new data, no code statement.

**Contribution.** A survey. It compares PRNU with deep-learning approaches for identification (closed-set classification) and device linking (same-source verification), and adds a small robustness experiment.

**Equations given.**
- `w_i = I_i - D(I_i) = I_i K + eps`.
- PCE: `PCE(x,y) = rho^2(s_peak) / [ (1/(MN - |A|)) * sum_{s not in A} rho^2(s) ]`, with rho the dot product of mean-removed x and circularly shifted y, A a small neighbourhood of the peak. No neighbourhood size and no explicit threshold are given.

**Numbers (as reported in the survey; conditions matter).**
- PRNU, Dresden, 19 devices, 50 smooth images per fingerprint: accuracy 0.9032-0.9263; TPR at FPR 1e-3 of 0.7672-0.8011.
- PRNU device linking, Dresden, 30 devices: TPR 0.0013-0.2240, FPR 0.0002-0.0004.
- Deep learning, device level: about 0.82 accuracy when there are fewer than 2 devices per model, about 0.44 with more. Dresden 74 devices 0.367-0.524; VISION 35 devices 0.721-0.943.
- Robustness test, 15 images: PRNU mean PCE 63.37 (default camera) falls to 0.15 and 0.27 after a beautification app or a "vivid" camera mode.

**Limitations stated.** Device-level deep learning is well below PRNU; cross-dataset generalisation is unproven; contrastive methods have high false-positive rates; the robustness test is tiny.

**Caveat on the survey itself.** The fetch tool flagged internal inconsistencies between text and tables (for example "around 0.65" in text vs 0.9520/0.9431/0.7448 in a table). Treat its numbers as pointers to the primary papers.

**Relevance.** Supports keeping PRNU as the device-level engine and not replacing it with a CNN classifier. Shows that app-level enhancement destroys the signal (a false-negative risk, not a false-positive one).

### A3. Loison et al. 2026, arXiv 2610.25438 [V-full]

**Citation.** Loison, B., Bammey, Q., Ehret, T., Grompone von Gioi, R., Muse, P., Gardella, M. "A New Hope for PRNU on Modern Smartphones? Evidence That Device-Specific Fingerprints Survive Computational Photography." arXiv:2610.25438v1 [cs.CV], 18 Oct 2026. Preprint, not peer reviewed.

**Licence.** arXiv non-exclusive distribution licence (no reuse rights granted). No code or dataset is linked.

**Contribution.** Shows that on 30 current flagship phones the standard sPCE separates same-device from different-device-same-model comparisons poorly, attributes this to a component shared by all fingerprints of one model and software version, and proposes a score normalisation, Delta-sPCE.

**Pipeline, exactly as stated.**
- Denoiser: Mihcak wavelet denoiser. `D_i = D(I_i)`, `R_i = I_i - D_i`. (Eq. 1)
- Fingerprint: `K = sum_l R_l D_l / sum_l D_l^2`. Note the weighting image is the *denoised* image D, not I. (Eq. 2)
- Post-processing: zero-mean of columns then rows (Chen 2008). No Wiener/DFT step is mentioned.
- Green channel only.
- Score (Eq. 3-4): `sPCE(R, I K) = sign(C(0,0)) * C(0,0)^2 / [ (1/(MN - |A|)) * sum_{(x,y) not in A} C(x,y)^2 ]`, with `C(x,y) = (1/MN) * sum_{m,n} R(m,n) * (I K)(m+x mod M, n+y mod N)`. A is a 5x5 square around (0,0). The peak is taken at zero shift only.
- Decision: `sPCE > t`.
- 20 reference images per device, portrait orientation only. Test images scored at original and 180-degree rotation, higher score kept; rotated 90 degrees first if orientation differs from the reference.

**Delta-sPCE (Eq. 6).** For query residual R, image I, candidate fingerprint K and the fingerprints `K_1..K_K` of the *other* cameras with the same model and software version:

`DeltasPCE = sPCE(R, I K) - (1/K) * sum_i sPCE(R, I K_i)`

Decide "same device" if `DeltasPCE > t_Delta`. This is T-norm (Auckenthaler et al. 2000) without the division by the background standard deviation; the authors report the full T-norm reduced accuracy in preliminary runs, probably because at most six background devices give a noisy standard deviation.

**Dataset.** 1,200 images, 30 phones, 3 brands, 8 model-and-software-version groups: Pixel 10 Pro XL (4 devices), Pixel 10 Pro (6), Galaxy S25 Ultra on three firmware builds (5, 3, 2), iPhone 17 Pro Max on iOS 26.2, 26.1, 26.0.1 (4, 4, 2). 40 images per device, split 20 reference and 20 test. Only images with no digital zoom and with the most common metadata profile (resolution plus EXIF tag set, including Make, Model, Focal Length, Software) for that model. 600 matching and 1,920 mismatching comparisons in total; the smallest groups have only 40 mismatching comparisons.

**Results (observed TPR at 5% FPR, thresholds fitted per group on the same data).**

| Group | sPCE TPR % | sPCE t | Delta TPR % | t_Delta |
|---|---|---|---|---|
| Pixel 10 Pro XL | 52.5 | 2,051 | 77.5 | 483 |
| Pixel 10 Pro | 50.8 | 2,652 | 60.0 | 908 |
| S25 Ultra S938BXXS7BYLR | 30.0 | 1,117 | 44.0 | 440 |
| S25 Ultra S938USQSBCZF5 | 51.7 | 1,802 | 63.3 | 828 |
| S25 Ultra S938USQS8BZBB | 47.5 | 719 | 70.0 | 68 |
| iPhone 17 Pro Max iOS 26.2 | 13.8 | 314 | 90.0 | 30 |
| iPhone 17 Pro Max iOS 26.1 | 11.2 | 1,527 | 93.8 | 59 |
| iPhone 17 Pro Max iOS 26.0.1 | 32.5 | 213 | 77.5 | 9 |

AUC: iOS 26.0.1 from 0.661 to 0.961; iOS 26.1 from 0.753 to 0.986.

Reading of the table that matters for us: to hold a 5% FPR between same-model devices, the plain sPCE threshold had to be between 213 and 2,652. A threshold of 60 would accept most different-device comparisons on these phones.

**Other observations.** Pixel matching scores are bimodal; the very high scores all come from landscape test images against portrait-only fingerprints, cause unknown. Score distributions change across firmware versions of the same model.

**Limitations stated by the authors.**
- At most six devices per group; conclusions are preliminary.
- 5% FPR is "too high for operational forensic applications"; smaller FPRs cannot be estimated with as few as 40 negatives.
- Delta-sPCE depends on the candidate set and assumes the true device is in it; "not yet suitable for operational use, which generally requires one-to-one verification with a stable decision threshold."
- Calibration would need representative images of the same model and software version from devices independent of the evaluation devices. This was not done.
- Open questions: identifying model and firmware first; background size; generalisation to night, portrait, zoom modes; whether a fixed background set of known-non-suspect devices removes the candidate-set dependence.

**My additional cautions (analysis, not in the paper).**
- Thresholds were fitted on the evaluated data per group. Reported TPRs are in-sample.
- With 40 negatives and zero observed false positives the two-sided 95% Clopper-Pearson upper bound on FPR is 8.8%; with 240 it is 1.5%. Nothing here supports forensic-grade error rates.
- For a mismatching candidate, the background mean includes the true device, which pushes mismatch scores negative. That mechanism only exists in closed-set tests. In open set (true device absent) the separation will be smaller.

### A4. Loison et al. 2026, IPOL 662 [V-full, V-code]

**Citation.** Loison, B., Bammey, Q., Grompone von Gioi, R., Muse, P., Gardella, M. "Photo Response Non-Uniformity Extraction and Detection." *Image Processing On Line* 16 (2026), pp. 1-29. doi:10.5201/ipol.2026.662. The PDF header says submitted 2025-12-17, accepted 2026-06-18, published "2026-07-00"; the web page still labels it a preprint that may change.

**Licence.** Article: CC-BY-NC-SA (stated in the PDF header). Source zip: no licence file inside; it bundles `prnu_python/functions.py` from polimi-ispl/prnu-python (GitHub reports MIT), which describes several functions as "as from Binghamton toolbox". The Binghamton toolbox is CC BY-NC 4.0 on its web page and "educational, research and non-profit purposes" in its file headers. See D for the licensing consequence.

**Contribution.** A unified, reproducible reference implementation and ablation of the classical pipeline. This is the best single source for implementation details.

**Model.** `I = g^gamma * [(1 + K_a) Y + Lambda]^gamma + Theta_q`, linearised to `I ~ I0 + I0 K + Theta` with `K = gamma K_a` (follows Chen 2008).

**Algorithms given.**
1. Wavelet denoiser (Alg. 1-2): 2-D DWT, 'db4' (8 taps), 4 levels, via PyWavelets `wavedec2`. Approximation band set to zero. For each detail band W: `var_hat = min over sz in {3,5,7,9} of max(0, uniform_filter(W^2, sz) - sigma^2)`, then `noise = W * sigma^2 / (sigma^2 + var_hat)`. Inverse transform gives the noise residual directly. Their Eq. 5 gives the complementary denoised coefficient `w * var_hat / (var_hat + sigma^2)`.
2. BM3D alternative (sigma = 8 best in their test).
3. Flat-field estimator: mean of max-normalised flat images minus its Gaussian blur.
4. Combination: basic average; inverse-variance weighted average; MLE `K = sum R_l D_l / sum D_l^2` with D the denoised image; phase-only average.
5. Post-processing: zero-mean (column means, then row means, Alg. 7; plain, not per CFA phase); Wiener in DFT `K_WF = real(IFFT( F - wiener3x3(F) ))` with noise variance = variance of |F| (Alg. 8, `scipy.signal.wiener`).
6. Detection: Pearson correlation between `I0 * K` and R; PCE and sPCE as in A3, exclusion 5x5 default, peak at zero shift only (Alg. 9-11). Appendix derives normalised correlation as the GLRT for i.i.d. Gaussian noise of unknown variance.

**Dataset and protocol.** Dresden (via a Kaggle mirror): 8,650 photos, 33 camera instances, 14 models, 10 brands. Central 768x768 region cut into a 12x12 grid of 64x64 patches. Green channel only. Fingerprint from L = 50 patches. Positives: same instance, same patch location. **Negatives: same instance, different patch location.** No cross-device or same-model negatives are used. Metrics per camera: P = TPR at FPR 1e-3; R = equal error rate.

**Results (averages over cameras).**

| Variant | P (%) | R (%) |
|---|---|---|
| Baseline: wavelet sigma=3, basic average, Pearson, L=50, 64x64 | 74.9 | 4.8 |
| BM3D sigma=8 | 78.2 | 4.1 |
| MLE instead of average | 80.7 | 4.2 |
| + zero-mean | 79.6 | 3.7 |
| + zero-mean + Wiener DFT | 80.4 | 3.4 |
| Phase-only | 66.0 | 6.4 |
| sPCE instead of Pearson (sigma=3) | 72.1 | 4.8 |
| L = 100 | 97.0 | 0.5 |
| L = 150 | 100 | 0 |
| 32x32 patches | 34.2 | 14.0 |
| 128x128 patches | 89.4 | 2.8 |
| L = 1 (single 64x64 patch) | 0.2 | 47.2 |
| Excluding saturated pixels | 74.9 | 4.8 |

- sigma: wavelet best at 3 for Pearson; sPCE better at 4-5 (at sigma = 5 sPCE beats the baseline by +5 points P). Between sigma 2 and 5, P ranged 68.1-74.9%. The optimal sigma is not the true noise level; it is whatever suits the downstream steps.
- Speed: wavelet about 5 ms vs BM3D about 10 s for 144 patches.
- Per-camera spread is large: P from 27.4% (Fujifilm FinePix J50) to 100%.
- Thresholds found on this data: sPCE 38 gives FPR 1e-3; sPCE 60 gives FPR below 1e-5. At "no false alarms" the mean TPR falls to 45.7%.
- The threshold for a given FPR depends on the number of reference images L. A threshold fixed with L references gives a higher FPR if fewer are used.

**Limitations (stated or evident).**
- "High separability does not automatically guarantee stable or operationally robust performance."
- Flat-field estimator not evaluated (Dresden mirror lacks suitable images).
- Evident, not stated: because negatives are same-sensor different-location patches, the experiments cannot see NUAs or same-model collisions at all. The sPCE 38/60 thresholds apply to 64x64 Dresden patches with L = 50 and transfer to nothing else.

**Inconsistencies I found.**
- Text says the Wiener step gives "a 5.5%pt decrease in P" where the table shows an increase.
- Text says Goljan 2009 reported 60 "for a false positive rate of 1e-6". Goljan 2009 says FAR < 1e-6 for *different-model* negatives; the overall figure in that paper is 2.4e-5 (see B5).
- Code [V-code]: the peak is read at `C[-1,-1]` (zero shift under the flip convention) but the exclusion square is centred on `C[0,0]`. The 5x5 square still covers `[-1,-1]`, so the peak is excluded, but the window is off-centre by one sample.
- Code: the DFT Wiener is applied to the complex spectrum with `scipy.signal.wiener`; the Binghamton `WienerInDFT.m` filters the normalised *magnitude* with the adaptive multi-window filter. These are different filters (see B2).

### A5. Shullani et al. 2017, VISION [V-tool]

**Citation.** Shullani, D., Fontani, M., Iuliani, M., Al Shaya, O., Piva, A. (2017). VISION: a video and image dataset for source identification. *EURASIP Journal on Information Security* 2017:15. doi:10.1186/s13635-017-0067-2.

**Licence.** Article CC BY 4.0. Dataset: "available at no cost to the research community" at lesc.dinfo.unifi.it; the article states no licence for the data. **Commercial use of the dataset is not established.** Ask the authors.

**Dataset.** 35 portable devices, 11 brands (Apple 13, Samsung 8, Huawei 5, OnePlus 2, one each of Asus, Lenovo, LG, Microsoft, Sony, Wiko, Xiaomi). Same-model pairs/triples: 2x iPhone 4S, 2x iPhone 5, 3x iPhone 5c, 2x iPhone 6, 2x Galaxy S3 Mini. 11,732 native images; 7,565 also shared through Facebook high quality, Facebook low quality and WhatsApp, giving 34,427 images. 648 native videos; 1,914 with YouTube and WhatsApp versions. Image classes: flat (walls, sky) and natural. Devices date from roughly 2011-2016.

**PRNU protocol.** Denoiser of Lukas 2006; MLE of Chen 2008; PCE with a threshold "following Goljan 2009" (value not printed in the text the tool saw). Image test: reference from 100 flat-field images per device; 100 matching and 100 mismatching queries per device, mismatches drawn at random from other devices. Results are ROC curves and AUC by sharing platform.

**Numbers.** Not extracted by the fetch tool (they are in figures and tables). Iuliani 2021 [V-full] summarises VISION as AUC 0.99 and FPR below 0.001 at PCE 60 for native images with a good reference.

**Findings relevant to us.**
- Video identification collapses when in-camera digital stabilisation is on (most Apple devices, one Sony).
- Image and video fingerprints of one sensor differ by crop and scale; brute-force search recovers them for non-stabilised devices (accepted only if peak PCE >= 50); registration failed for two devices (D21, D26).
- Some devices lack orientation tags (D24, D33).

**Limitations.** Old devices (pre-computational-photography); only 5 same-model groups; mismatches sampled at random, so same-model negatives are a small minority of the negatives; skewed to Apple.

---

## B. Implementable algorithm specification

Notation: all image operations are element-wise. I is the image as float (0-255 scale unless stated), W the noise residual, K the fingerprint, MxN the size.

### B1. Noise residual extraction

**Source of truth.** Lukas 2006 Appendix A [V-full] restates the Mihcak 1999 filter. The polimi port [V-code] and IPOL Alg. 1-2 [V-full] implement it identically.

Per colour channel, on float data:

1. 4-level 2-D discrete wavelet transform, 8-tap Daubechies (PyWavelets name `db4`; filter length 8).
2. For every detail band c (horizontal, vertical, diagonal) at every level, and each window W in {3, 5, 7, 9}:
   `v_W(i,j) = max(0, mean over WxW window of c^2 - sigma0^2)`
3. `v(i,j) = min(v_3, v_5, v_7, v_9)`.
4. Wiener shrinkage. Denoised coefficient: `c_den = c * v / (v + sigma0^2)`. Equivalently, noise coefficient: `c_noise = c * sigma0^2 / (v + sigma0^2)`.
5. Residual: either `W = I - IDWT(c_den with approximation band kept)`, or directly `W = IDWT(c_noise with approximation band set to zero)`. These are the same by linearity. The code implementations use the second form.
6. If the reconstruction is larger than the input (odd sizes), crop to the input size (polimi does `W[:h,:w]`).

Parameter values and where they come from:

| Parameter | Value | Source |
|---|---|---|
| Wavelet | Daubechies 8-tap (`db4`) | Lukas 2006 App. A; IPOL 3.1.1 |
| Levels | 4 | same |
| Windows | 3, 5, 7, 9; take the minimum variance | same |
| sigma0 | 5 on a 0-255 scale, "to be conservative"; tested 1-6 with a "relatively flat" dependence | Lukas 2006 App. A |
| sigma0 | 5 default | polimi port |
| sigma0 | 3 best for Pearson, 4-5 better for sPCE, on Dresden 64x64 patches | IPOL 5.1.1, 5.2 |
| sigma0 | 2-3 in the Binghamton example scripts | [MEM] |

Implementation details that differ between codebases and can change scores:
- Window averaging at band borders: polimi uses `uniform_filter(..., mode='constant')` (zero padding).
- DWT boundary mode: PyWavelets defaults to symmetric extension. The Binghamton `mdwt` routine is periodic [MEM]. Pick one and freeze it; fingerprints and queries must use the same.
- If the image is too small for 4 levels, polimi silently reduces the level count. We should refuse or record it, not silently change.
- sigma0 is on the 0-255 scale. If the engine works on 0-1 floats or 16-bit data, sigma0 must be rescaled.

**Colour handling.** Two conventions are in use:
- Fridrich lab: extract the residual in each of R, G, B, then combine to grey. Weights `0.2989, 0.5870, 0.1140` (Goljan & Fridrich 2008 [V-full]; `rgb2gray1.m` derives them as the first row of the inverse YIQ matrix [V-code]; polimi uses `0.29893602, 0.58704307, 0.11402090`).
- Loison et al. (refs 3 and 4): green channel only, on the argument that green has the densest CFA sampling so the least interpolation.
Neither paper compares the two. Treat as a configuration choice to be evaluated on our own data.

**Query residual.** Same extraction. In the Binghamton toolbox, `NoiseExtractFromImage.m` already applies `ZeroMeanTotal`, and the `WienerInDFT` step is added afterwards per `Example.m` (statement on the Binghamton page [V-full]). polimi `extract_single` does: noise extract, to grey, `zero_mean_total`, `wiener_dft` with sigma = sample std of the residual.

### B2. Post-processing

**Zero-mean (ZM).**
- What: subtract each column's mean, then each row's mean, so every row and column sums to zero (Chen 2008 III.B [V-full]).
- Why: removes the "linear pattern" from (a) CFA interpolation gain biases, which are periodic in row/column averages, and (b) row-wise and column-wise sensor readout and processing. These are shared by cameras of a model, so they cause false matches.
- Per CFA phase: Goljan 2009 [V-full] says the sample mean is subtracted, then "averages of each column and each row in each of four sub-sampled 2-D signals corresponding to four types of pixels in the Bayer CFA were subtracted". `ZeroMeanTotal.m` [V-code] does exactly that: apply row-and-column zero-mean separately to the four polyphase sublattices `(0::2,0::2)`, `(0::2,1::2)`, `(1::2,0::2)`, `(1::2,1::2)`.
- `ZeroMean.m` has a `'CFA'` option [V-code] that does plain row/column zero-mean and then removes one checkerboard mean. That is a third, weaker variant.
- IPOL 662 and arXiv 2610.25438 use plain row/column zero-mean, not per phase.
- Linear, so it commutes with RGB-to-grey conversion.
- Effect size: IPOL reports +4.7 points TPR at FPR 1e-3 for plain ZM. Chen 2008 Table II shows correlation between two phone-camera fingerprints falling after ZM and again after the Fourier step.

**Wiener filtering in the DFT domain (WF).**
- Why: suppress periodic content that survives ZM. Sources named: JPEG 8x8 blockiness, sensor-design patterns, on-board circuitry (Chen 2008; Goljan 2009). Flattens the spectrum toward the white-noise ideal.
- Three published variants. They are not interchangeable.

| Variant | Procedure | Source |
|---|---|---|
| Paper text | `K_WF = IFFT( F - Wiener3x3(F) )`, F = FFT(ZM(K)), noise variance = sample variance of abs(F). Applied "only when there exist artifacts in the form of visually identifiable patterns". | Chen 2008 III.B [V-full] |
| Binghamton code | `F = fft2(X)`; `Fmag = abs(F)/sqrt(M*N)`; `Fmag1 = WaveNoise(Fmag, sigma^2)` with sigma = std of X by default; `F = F * Fmag1 / Fmag` (where Fmag = 0, output 0); `real(ifft2(F))`. `WaveNoise` is the multi-window noise extractor of B1 applied to the magnitude image. | `WienerInDFT.m` [V-code]; polimi `wiener_dft` [V-code] |
| IPOL code | `real(ifft2(F - scipy.signal.wiener(F, (3,3), var(abs(F)))))` on the complex spectrum. | IPOL `utils.py` [V-code] |

- How the Binghamton variant works: for white noise of standard deviation sigma, the normalised magnitude has local mean square about sigma^2. Where the local energy exceeds sigma^2 (a spectral peak), the factor `sigma^2 / (sigma^2 + excess)` shrinks that frequency. Flat regions pass with factor near 1.
- Later Binghamton variants add a notch filter for JPEG blockiness and zero out the four 8x8 corners or an 8-pixel border (`SensorFingerprintFilter.m` options `z_g_w_n`, `_c8`, `_b8` [V-code]). The functions `WienerInDFT2/3/33` are not in the zip I could read.
- The Binghamton page states that skipping the DFT step "will significantly lower PCE and increase error rates."
- Goljan 2009 pipeline order for the fingerprint: per-channel MLE, RGB to grey, subtract mean, per-CFA-phase ZM, adaptive Wiener in the frequency domain.

**Neither step removes the modern smartphone NUAs.** Iuliani 2021 and arXiv 2610.25438 both applied the standard post-processing and still saw collisions.

### B3. Maximum-likelihood fingerprint estimator

**Formula.** `K = sum_k W_k I_k / sum_k I_k^2` (Chen 2008 Eq. 6 [V-full]; Goljan 2009 Eq. 2 [V-full]).

**Derivation assumptions (Chen 2008 II-III).**
- Sensor model `I = g^gamma [(1+K)Y + Lambda]^gamma + Theta_q`, linearised by first-order Taylor expansion: `I = I0 + I0 K + Theta`.
- `W = I - F(I) = I K + Xi`, with Xi i.i.d. Gaussian, zero mean, the same variance sigma^2 at every pixel and independent of the signal I K. This is an idealisation chosen so the estimator is closed-form; the paper says real images need a more complex model for detection (coloured noise, attenuation factor T).
- `W_k / I_k = K + Xi / I_k`; maximise the Gaussian log-likelihood over K.
- Cramer-Rao bound: `var(K) >= sigma^2 / sum_k I_k^2`. Variance falls as 1/N. The estimator is minimum-variance unbiased under the model.

**What the bound tells you about reference images.**
- Luminance as high as possible without saturation. Saturated pixels "carry no information about the PRNU factor".
- Smooth content (smaller sigma^2). "The best images are images of bright (but not saturated) uniformly white scenes. In practice, we recommend taking out-of-focus images of cloudy sky."
- Natural scenes work but need "about twice as many" images for the same quality.

**I or denoised I in the estimator?** Chen 2008 and Goljan 2009 use the image I. IPOL 662 Eq. 12 and arXiv 2610.25438 Eq. 2 use the denoised image. IPOL's own `chen.py` multiplies by the image. Unresolved inconsistency; decide and document.

**Intensity and saturation weighting.** Not in the papers; in the Binghamton code. The Binghamton FAQ [V-full] quotes the accumulation lines:

```
Inten = IntenScale(X) .* Saturation(X)
RPsum = RPsum + ImNoise .* Inten
NN    = NN + Inten.^2
```

and says the saturation correction can be skipped "in case the images are not overexposed and lack white saturated areas ... without loss of fingerprint quality". The functions themselves are known only from the polimi port [V-code]:
- `IntenScale(I)`: `I/T` for `I < T`; `exp(-(I-T)^2 / v)` for `I >= T`; T = 252, v = 6. Near-white pixels are down-weighted smoothly to about zero at 255.
- `Saturation(I)`: all ones if the image maximum is below 250. Otherwise a pixel is masked (0) when it equals the channel maximum (channel max > 250) and is not strictly different from all four of its horizontal/vertical neighbours, i.e. it sits in a flat clipped area.
- Final: `K = RPsum / (NN + 1)` (the +1 avoids division by zero), then grey, `zero_mean_total`, `wiener_dft` with sigma = std(K).

**Port discrepancy to avoid.** polimi accumulates the numerator as `W * I / 255` but the denominator as `(IntenScale * Saturation)^2`. The numerator therefore is not weighted by the same quantity as the denominator (different scale, 255 vs 252, and no saturation mask). The Binghamton lines above use `Inten` in both. Implement the consistent form.

IPOL measured no benefit from zeroing saturated residual pixels on Dresden (0.5% of pixels were white), so this matters mainly for overexposed reference sets.

**Per channel then grey.** Goljan 2009: estimate K in each of R, G, B, then combine with the luminance weights. Goljan & Fridrich 2008: `K = 0.2989 K_R + 0.5870 K_G + 0.1140 K_B`.

**Number and type of reference images cited.**

| Source | Count | Type |
|---|---|---|
| Lukas 2006 | "we recommend using Np > 50" (averaging estimator) | natural |
| Chen 2008 | fewer needed with MLE than in Lukas 2006; worked examples use 10 and 125 flat images (two phone cameras) and 20 JPEG / 20 raw images (two Canons); natural needs about 2x | flat preferred |
| Goljan & Fridrich 2008 | 30 blue-sky TIFF images | flat |
| Goljan 2009 | N = 50 natural JPEGs, landscape only; "a larger N would probably lead to a better performance" | natural, uncontrolled |
| VISION 2017 | 100 flat-field | flat |
| Iuliani 2021 | 20-35 natural, no digital zoom | natural, uncontrolled |
| Martin & Newman 2025 | 30, nominal brightness | natural |
| arXiv 2610.25438 | 20 natural, portrait orientation | natural |
| PrnuModernDevices (Albisani) | 5 flat | flat |
| IPOL 662 | 50 patches baseline; 100 gives P 97%, 150 gives 100% on 64x64 | natural |

No source gives a hard minimum. Goljan 2009's failure analysis attributes most misses to poor fingerprints (dark night shots, edited or zoomed images mixed in). Martin & Newman show a Pixel 2 fingerprint from auto-exposed images giving 87% FNR vs 0.78% from nominal-brightness images.

### B4. Test statistic

**What is correlated.** `X = I * K` (the fingerprint modulated by the query image intensity) against `Y = W` (query residual). Goljan 2009 Eq. 7. Correlating W against K alone ignores the multiplicative model.

**Normalised cross-correlation.** `rho(s1,s2) = sum (X - mean X)(Y(shifted) - mean Y) / (||X - mean X|| * ||Y - mean Y||)`, shifts taken modulo the size (circular). If sizes differ, zero-pad the smaller one at the bottom/right first (Goljan 2009; Iuliani 2021 footnote 4).

**Surface by FFT** (`crosscorr2.m` [V-code]): subtract each array's mean; `C = real(ifft2( fft2(A) .* fft2(rot180(B)) ))`. With this flip convention the zero-shift sample is the **last** element `C(end,end)` (`C[-1,-1]`), not `C[0,0]`. The equivalent `ifft2(fft2(A) * conj(fft2(B)))` puts zero shift at `[0,0]`. Pick one convention and test it with a synthetic shifted pattern. No normalisation is needed because it cancels in the PCE ratio.

**PCE** (Goljan 2009 Eq. 8 [V-full]):

`PCE = C(s_peak)^2 / [ (1/(mn - |N|)) * sum_{s not in N} C(s)^2 ]`

- N is a small neighbourhood around the peak. **Size 11x11 in Goljan 2009** and as the default `squaresize = 11` in `PCE.m`. **5x5 in IPOL 662 and arXiv 2610.25438.** Unspecified in refs 1, 2, 5 and Iuliani 2021.
- The mean in the denominator is over the surface *excluding* the neighbourhood: divisor `mn - |N|`. `PCE.m` builds a vector of all samples outside the square and takes its mean [V-code].
- The neighbourhood wraps circularly (`PCE.m` circularly shifts the surface so the peak neighbourhood sits in a corner, then drops it).
- **Signed PCE:** `sign(C_peak) * C_peak^2 / energy`. In `PCE.m` since 26 Oct 2011 per its comment. A strongly negative correlation is not evidence of a match.

**Where the peak is searched.**
- No cropping suspected (same size, known alignment): do **not** search. Use the zero-shift value; k = 1 (Goljan 2009; `PCE.m` default `shift_range = [0,0]`; Martin & Newman; IPOL; arXiv 2610.25438).
- Possible cropping: maximum over the admissible shifts only, `k = (m_K - m + 1)(n_K - n + 1)` (Goljan 2009). `PCE.m` restricts the search to `C(end-shift_range(1):end, end-shift_range(2):end)`.
- Taking the global maximum of the whole surface when no shift is plausible is wrong: it turns a 1-sample test into an MN-sample maximum and raises the null score. polimi `pce()` does this (argmax over the full surface).

**Null distribution and theoretical threshold** (Goljan 2009 Eq. 9-10): if X and Y are independent, rho is about N(0, 1/mn) and PCE with k = 1 is chi-square with 1 degree of freedom. For k searched shifts:

`FAR = 1 - (1 - Q(sqrt(tau)))^k`, so `tau(alpha, k) = [ Q^-1( 1 - (1 - alpha)^(1/k) ) ]^2`.

Checks I computed: k = 1 gives tau = 9.55 (alpha 1e-3), 18.19 (1e-5), 22.60 (1e-6). Goljan & Fridrich 2008 quote tau = 53.772 for alpha = 1e-5 and k_max = 88,836,025; the formula reproduces 53.772. Under this ideal model PCE = 60 with k = 1 would mean a p-value of about 4.7e-15.

**The ideal model does not hold.** Goljan 2009: empirical PCE has "much thicker tails" than the model; they model shared NUA residue as a non-central chi-square and say the true distribution is a mixture. Use the formula to scale thresholds with search-space size, never as an error-rate claim.

**Orientation.** Goljan 2009 computes PCE for the image and its 180-degree rotation and takes the maximum ("PCE2"), because camera orientation is unknown. Each extra orientation is another trial under the null. arXiv 2610.25438 does the same and rotates 90 degrees if needed. Iuliani 2021 tests "all possible rigid rotations".

**Crops and scale.** See B6.

**Bugs in public implementations to avoid copying.**
- polimi `pce()`: the exclusion slice `[max_y - r : max_y + r]` with r = 2 is 4x4, not 5x5, and is not centred; when the peak is within r of index 0 the negative start index yields an empty slice, so nothing is excluded; the energy is the mean over all MN samples with zeros in place, not over MN - |N|.
- IPOL: exclusion window centred one sample away from the peak (A4).

### B5. Decision thresholds in the literature

| Threshold | Error rate associated | Conditions | Source |
|---|---|---|---|
| PCE 60 | FAR < 1e-6 for negatives from a **different camera model**: 0 exceedances in 1,024,050 tests; largest null PCE2 observed 57.267 | Flickr, 150 models, 6,827 fingerprints of N = 50 natural JPEGs, full-resolution uncropped images under 8 MP (most under 6 MP), zero shift, max over 0/180 degrees, 11x11 exclusion, ZM per CFA phase plus Wiener DFT | Goljan 2009 4.4 [V-full] |
| PCE 60 | **Overall FAR 2.4e-5, FRR 2.38%** (detection 97.62%) after mixing in same-model negatives with prior p = 0.0523 | same; 1,024,050 same-model tests; exceedances existed and were attributed to shared cameras or shared pictures, not all resolved; "the real FAR may turn out to be zero" | Goljan 2009 4.6 [V-full] |
| tau(alpha, k) | theoretical | k admissible shifts and scales | Goljan 2009 Eq. 10; Goljan & Fridrich 2008 |
| PCE 50 | accept a crop/scale registration | image-to-video registration | VISION [V-tool] |
| PCE 60 | "commonly accepted", FPR below 0.001 on VISION | 2011-2016 devices | Iuliani 2021 [V-full] |
| PCE 60 | FPR above 5% for many 2018-2020 models; text cites P20 Pro and Mate 20 Pro above 20%, Galaxy A50 and S10 above 10%, Redmi Note 7 above 5%, Nokia PureView 808 above 40%, and two cameras above 60% | Flickr, 45 phone and 25 camera models, 20-35 natural reference images | Iuliani 2021 [V-full] |
| PCE 60 | FPR about 8% (TNR 91.87%) nominal; worse for dark | Flickr set of Iuliani, N = 30 | Martin & Newman 2025 [V-tool] |
| sPCE 38 / 60 | FPR 1e-3 / below 1e-5 | Dresden 64x64 patches, L = 50, negatives = other locations of the same sensor, 5x5 exclusion | IPOL 662 [V-full] |
| sPCE 213-2,652 | FPR 5% between same-model, same-firmware devices | 2025 flagships, 20 reference images, 5x5 exclusion | arXiv 2610.25438 [V-full] |
| Correlation threshold at FAR 1e-3 | per camera, generalised-Gaussian fit | 9 cameras, about 320 images each | Lukas 2006 [V-full] |

**Caveats on transferring PCE 60 (each sourced above).**
1. The 1e-6 figure is for different-model negatives only. The headline overall figure is 2.4e-5 and is an upper bound contaminated by label noise.
2. Zero exceedances in 1,024,050 trials gives a 95% Clopper-Pearson upper bound of about 2.9e-6 (one-sided) or 3.6e-6 (two-sided) [my calculation]. "< 1e-6" is a point observation, not a bound.
3. The value depends on the exclusion size (11x11 there, 5x5 elsewhere), on whether shifts are searched, on how many rotations are tried, on the number of reference images (IPOL), on image size (they used native full resolution), and on the exact post-processing.
4. Cameras were pre-2009 compacts and DSLRs with conventional pipelines.
5. Goljan 2009 found same-model FAR indistinguishable from different-model FAR below a threshold of 50. Iuliani 2021 and arXiv 2610.25438 show that no longer holds.
6. Iuliani 2021: mismatching PCE is "often well above the median PCE obtained by matching images, suggesting that adjusting the threshold is not a solution", and even many devices of one model may not suffice to set a Neyman-Pearson threshold.
7. Brightness changes both error rates (Martin & Newman).
8. Per-camera variability is very large (IPOL P 27-100%; Martin & Newman per-camera TNR 6.1-99.6%).

**Conclusion for the engine.** No literature threshold may be hard-coded as a decision rule with an attached error rate. 60 can appear only as a labelled historical reference line.

### B6. Effects of processing, and what is recoverable

| Factor | Effect | Recoverable? | Cost / limits | Source |
|---|---|---|---|---|
| JPEG compression | Correlation falls gradually with quality factor; false rejections rise. Adds 8x8 block periodicity to residuals and fingerprints. | Partly. DFT Wiener / notch filtering removes block periodicity; signal loss is not recoverable. | Goljan & Fridrich 2008 tested scaling with QF 90, 75, 60 and conclude reliability "depends on the image content and subsequent JPEG compression"; their result tables were not transcribed. | Lukas 2006 Exp. III [V-full]; Chen 2008; Binghamton page |
| Heavy recompression, social media | Strong attenuation plus resizing. | Fingerprint and query should go through the same platform path, or be registered by scale search. | VISION provides WhatsApp/Facebook versions. Numbers not extracted. | VISION [V-tool] |
| Resizing (downscale) | Pixel grid desynchronised; zero score without registration. | Yes by brute-force scale search: `r_i = 1/(1 + 0.005 i)` down to `r_min = max(M/m, N/n)`, upsample the residual by 1/r (nearest neighbour worked better than bilinear), NCC, PCE; then refine with step `1/max(m,n)`. | "Reliable camera ID is possible for images linearly scaled down by a factor of 0.5 or more." One FFT pair per scale (about 200 coarse steps in their example). Threshold must rise: 53.77 instead of 18.2 at alpha = 1e-5 in their example. Hierarchical search about 4x faster, only for true matches. | Goljan & Fridrich 2008 [V-full] |
| Cropping | Unknown offset. | Yes: peak location over admissible shifts gives the crop. | "...or images with 90% or more cropped away". k shifts raise the threshold. Fewer pixels means lower PCE. | Goljan & Fridrich 2008; Goljan 2009 |
| Digital zoom | Crop plus upscale in camera. | Yes by the same search (Goljan 2009 recovered a ratio of 2.291 for one image). | They excluded zoomed images (about 0.2%) because searching every non-match is "computationally infeasible". Never include zoomed images in a reference set. | Goljan 2009; Iuliani 2021; arXiv 2610.25438 |
| Rotation by multiples of 90 degrees | Misalignment. | Yes, try orientations. | Each try is another trial. | Goljan 2009 |
| Sensor readout offset by orientation | One model (HP Photosmart R707) shifted the active area by 7 rows for portrait shots. | Yes with a small shift search. | Shows that zero-shift-only can miss true matches. | Goljan 2009 |
| Pixel binning / reduced-resolution modes | Different fingerprint geometry; and a NUA source: Huawei Mate 20 Pro collides at 10 and 20 MP but not at 40 MP. | Treat each resolution/mode as a separate fingerprint. | Never compare across output resolutions without registration. | Iuliani 2021 [V-full] |
| Electronic image stabilisation (video) | Per-frame warp; "leads PRNU based testing to failure". | Not robustly for in-camera stabilisation, per VISION. Later per-frame registration methods exist (cited by Iuliani as refs 21-24). | Not opened. | VISION [V-tool]; Iuliani 2021 |
| HDR / multi-frame fusion | Local translations between regions (maximum of a block correlation moved to [5,3] and [5,-3] in a Samsung example); misdetections. | Proposed: block-wise shift map (future work). | Not validated. | Vazquez-Padin 2025 [V-full] |
| Portrait mode, Apple | A synthetic noise pattern is added in defocused regions; shared across devices; false positives. | Mask the affected regions (depth map or pattern detection). | Reported to "significantly reduce false positives". Details not read. | Baracchi 2021 (abstract); Vazquez-Padin 2026 (abstract); Iuliani 2021 |
| Portrait mode, Samsung | Bokeh regions lose PRNU (blur plus added noise) but do not correlate across devices. | Exclude bokeh regions from estimation and detection. | Missed detections, not false alarms. | Vazquez-Padin 2025 [V-full] |
| Lens-distortion correction | Radially varying resampling; misalignment grows toward the edges. | Search over a radial distortion parameter and resample. | [MEM], source not opened (Goljan & Fridrich 2012). Zoom-dependent, so reference and query may need different parameters. | [MEM] |
| Gamma / tone adjustment | Little effect. | n/a | | Lukas 2006 Exp. II [V-full] |
| Dark or saturated content | PRNU is multiplicative: no signal in black or clipped areas. Dark images raise FNR and, on Flickr, FPR. | No. Flag and report. | | Lukas 2006; Goljan 2009 (I97, I139); Martin & Newman |
| Beautification apps / "vivid" modes | Mean PCE 63 to below 1 in a 15-image test. | No. | | Li & Law 2025 [V-tool] |
| Raster editing (Photoshop, colour quantisation) | Misses; also contaminates fingerprints. | No. | | Goljan 2009 (I57, I111, I128) |
| Raw developers | A software pattern added by Adobe raw development explains many DSLR collisions. | Detect the pattern, exclude or flag. | As cited; papers not opened. | Butora & Bas 2024 via Vazquez-Padin 2025 and arXiv 2610.25438 |

### B7. Non-unique artefacts (NUAs)

**Definition** (Goljan 2009 [V-full]): "a systematic signal that is non-unique to the individual sensor but may be shared between cameras of the same model or make or cameras with the same sensor architecture."

**Classical NUAs and their suppression.**

| NUA | Signature | Suppression | Source |
|---|---|---|---|
| CFA demosaicing | period-2 structure in row/column averages | zero-mean per CFA phase | Chen 2008; Goljan 2009 |
| Row/column readout and processing | row/column bias | zero-mean | Chen 2008 |
| JPEG block grid | peaks at multiples of 1/8 cycles per pixel | DFT Wiener; notch; drop borders/corners | Chen 2008; Binghamton code |
| Sensor-design patterns | structure in the spectrum | DFT filtering | Chen 2008 |
| Periodic residue generally | secondary peaks on the correlation surface | PCE penalises it: periodic structure raises the off-peak energy. Sign discards negative peaks. | Binghamton page; IPOL 4.2 |

**Detecting residual NUAs in a fingerprint (practical checks drawn from the above).**
- Spectrum of K should be flat; isolated peaks indicate periodic NUAs.
- Energy removed by ZM (the "linear pattern") relative to K. Chen 2008: below -10 dB for compacts and SLRs, can be higher for phone cameras.
- Correlation surface between K and an unrelated fingerprint should have no structure; secondary peaks or diagonal ridges indicate NUAs (Vazquez-Padin 2025 identify Samsung patterns by their diagonal correlations).
- Cross-device test: PCE between fingerprints of different devices of the same model. This is the only direct test, and it needs other devices.

**Modern smartphone NUAs (2020 onward).**
- Iuliani 2021: collisions across most brands; not explained by one technology. Apple cases tied to Portrait-mode images (EXIF `Custom Rendered: Portrait HDR`). Samsung S10e collisions spread across users with no metadata anomaly. Resolution-dependent cases point to pixel binning but not consistently.
- Albisani 2021 (as cited by Vazquez-Padin 2025): 100% of analysed blocks of flat-field images from Samsung S9 and S9+ were correlated across devices, preventing any valid fingerprint. Paper not opened.
- Vazquez-Padin 2025: Galaxy S9, S9+, S10, S10+ (global versions) share one diagonal pattern; traces in S21+; A53 has its own; A54/A55/A56 share one. Fingerprints from **raw** captures (PRO mode) avoid the collisions because raw bypasses the pipeline stage that adds the pattern. Not available on the A series or when no raw reference exists. Artefact suppression in JPEG-derived fingerprints is future work.
- Vazquez-Padin 2026: Apple's synthetic defocus noise pattern; masking affected regions reduces false positives.
- arXiv 2610.25438: Pixel 10 Pro (XL), S25 Ultra and iPhone 17 Pro Max all show a shared component strong enough to put same-model mismatch sPCE in the hundreds to thousands, in default mode with no zoom.
- Also cited there, not opened: SVD-based PRNU recovery for Samsung (Vazquez-Padin & Perez-Gonzalez 2026); watermark and DFT artefacts on Xiaomi Mi 9 and Samsung A50 (Montibeller 2024); flagging inconsistent images for exclusion (Bhat & Bianchi 2022).

**Mitigation strategies in the literature.**
1. Exclude or flag affected images or regions by metadata or pattern detection (portrait, HDR, zoom, known patterns). Per-pipeline work; "may be incomplete" (arXiv 2610.25438).
2. Build fingerprints from raw captures where the device is available and supports it.
3. Mask affected regions (depth map, bokeh mask).
4. Normalise the score against a same-model background (Delta-sPCE).
5. Remove the shared component from fingerprints directly (posed as an open question in arXiv 2610.25438; SVD work not opened).

**Delta-sPCE specification.**
- Definition: A3 above (Eq. 6 of arXiv 2610.25438).
- Needs: (a) the questioned image's model **and software version** to be known; (b) fingerprints of other physical devices of exactly that model and version, built the same way; in the paper 1 to 5 background devices.
- Depends on the candidate set: the value changes when the background set changes.
- Assumes closed set.
- Variance normalisation (full T-norm) was tried and rejected with these background sizes.
- Validation status: one preprint, 30 devices, 3 models, at most 6 per group, in-sample thresholds, evaluated at 5% FPR only. The authors say it is not suitable for operational use. No independent replication found.
- A fixed, independent background cohort of known-non-suspect devices would remove the candidate-set dependence. This is the authors' open question, not a validated method.

**What the three assigned recent papers propose, in one line each.**
- Ref 1: record and account for brightness; do not rely on the 2009 error rates.
- Ref 2: no new method; PRNU remains stronger than deep learning at device level.
- Ref 3: Delta-sPCE.

### B8. Open-set attribution and calibration

**What the score is.** PCE is a similarity score. It is not a probability, not a likelihood ratio, and its null distribution is not the textbook chi-square in practice (Goljan 2009).

**Thresholds at a target false-positive rate.**
- Fix the full configuration first: residual extractor, sigma0, colour handling, post-processing, estimator, number and type of reference images, image size, exclusion size, shift/scale/rotation search. IPOL shows the threshold moves with the reference count.
- Estimate the null score distribution on a calibration set that matches the casework condition: same model, ideally same firmware and capture mode, **different physical devices**. arXiv 2610.25438 states the calibration devices should be independent of the evaluation devices.
- The smallest FPR you can claim is limited by the number of independent negatives. Zero false positives in n trials gives a 95% upper bound of about 3/n. To support 1e-3 you need on the order of 3,000 independent negatives; for 1e-6, about 3 million.
- Negatives that share a device or a fingerprint are not independent. Count devices and device pairs, not just comparisons.
- If no same-model calibration data exists, the system must say that no error rate is available for this device model. Iuliani 2021 warns that even many same-model devices may not yield a reliable Neyman-Pearson threshold.

**Open set.** The questioned image may come from a device that is not enrolled. A 1:N search must therefore keep a threshold; the top-ranked candidate is not an identification. Goljan 2009 Part 5 searched 6,827 fingerprints for 145 images with a threshold of 60: 8 images had no candidate above threshold, 4 of those still ranked the right camera first "however the evidence is weak". 1:N search multiplies the false-alarm opportunity by N; correct with `1 - (1 - alpha)^N` or calibrate on the maximum score.

**Likelihood ratios.**
- Score-based LR: `LR(s) = p(s | same source) / p(s | different source)`, with both densities estimated from calibration scores (kernel density, logistic regression, or isotonic/PAV calibration are the usual options [MEM]).
- The different-source population must be chosen and stated. For PRNU the relevant population is other devices of the same model and firmware; using mixed-model negatives overstates the LR on modern phones.
- LRs must not be extrapolated beyond the support of the calibration data. Cap reported values at what the number of calibration comparisons can support [MEM: commonly argued in the forensic LR literature].
- Validation metrics for LR systems: Cllr, minimum Cllr, calibration loss, Tippett plots, rates of misleading evidence [MEM; Meuwly, Ramos, Haraksim 2017, not opened].
- A J. Imaging 2021 paper applies LR methods to PRNU camera attribution and, per a search snippet, argues for moving from similarity scores to likelihood ratios and follows the Meuwly et al. validation guideline. Not opened (HTTP 403).

**Forensic-science guidance.** I could not open the primary documents. The following is from memory and search snippets and must be checked by whoever writes customer-facing wording:
- ENFSI Guideline for Evaluative Reporting in Forensic Science (v3.0, 2015): evaluative reports should be based on a likelihood ratio for at least two stated propositions; the examiner reports the probability of the findings given each proposition, not the probability of the proposition (avoid the transposed conditional). A search snippet confirms the LR basis and that the LR says nothing about propositions other than the two considered.
- An ENFSI best-practice manual for image authentication and a SWGDE "Best Practices for Image Authentication" (2018) exist; I did not retrieve their PRNU wording.
- General principles in these and in the PCAST 2016 / NAS 2009 reports [MEM]: validated methods, error rates measured under casework-like conditions, known limitations disclosed, no claims of individualisation to the exclusion of all others.

**What must not be claimed.**
- That a score above 60 (or any literature number) implies a specific false-positive rate for a customer's device.
- "This image was taken by this camera" as a categorical fact, or any wording equivalent to uniqueness or certainty.
- A posterior probability of source ("99.9% likely this phone") without an explicit prior that the user supplied.
- That a low score excludes the device. Zoom, HDR, stabilisation, editing, resizing, dark content all cause misses.
- That the fingerprint is unique among same-model devices for post-2018 smartphones, without same-model validation.
- An error rate for a model, firmware, capture mode or processing path that is not represented in our validation data.
- Any error rate lower than our own negative count supports.
- That Delta-sPCE is a validated method.

**What can be reported honestly.** The score; the full configuration; the calibration population and its size; the empirical position of the score in the same-source and different-source calibration distributions with confidence intervals; quality covariates (brightness, saturation fraction, texture, resolution, reference count, detected modes); and explicit statements of what was not tested.

### B9. Evaluation protocol recommendations

Grounded in the weaknesses documented above.

**Units and splits.**
- Split by physical device, never by image. Devices used to tune sigma0, post-processing, thresholds or calibration must be disjoint from test devices.
- Reference and query images of one device must be disjoint and should come from different sessions and scenes. Burst frames and near-duplicates leak scene content into both sides.
- Keep model, firmware, resolution, capture mode, orientation and sharing platform as recorded strata.

**Negatives.**
- Report three FPRs separately: different brand; same brand, different model; **same model (and same firmware where known)**. Goljan 2009 did this split (Parts 3 and 4). VISION-style random negatives and IPOL's same-sensor-different-location negatives cannot reveal NUAs.
- Report pooled FPR only together with the prior mix used (Goljan 2009 used p = 0.0523 for same-model).

**Leakage and label noise.**
- Web-scraped "one user equals one device" labels are noisy: shared cameras and shared pictures produced false "false alarms" in Goljan 2009; Iuliani 2021 used geotags and one camera's EXIF serial number to argue devices differed. Prefer physically controlled devices with serial numbers; treat scraped data as secondary.
- Thresholds fitted on the evaluation data (as in arXiv 2610.25438) give optimistic numbers. Use nested or held-out calibration.

**Datasets seen in these papers.**

| Dataset | Use | Licence as found |
|---|---|---|
| Dresden (74 devices, 25 models per Li & Law) | classical cameras, multiple instances per model | not verified |
| VISION (35 devices) | older phones, social-media versions, video | not stated in the article |
| PrnuModernDevices (22 phones, 550 images: 5 flat, 10 natural, 10 bokeh each) | modern phones, portrait mode | CC BY-SA 4.0 (README [V-full]) |
| StegoAppDB (28 phones) | exposure variation | not checked |
| Iuliani Flickr set (486 devices) | modern, uncontrolled | "upon request" |
| Loison 2026 set (30 phones) | 2025 flagships | not released |
| Forchheim, SOCRatES, Daxing | listed by Li & Law | not checked |

**Metrics.**
- TPR at fixed low FPR, and the threshold that achieves it, per stratum. AUC and EER only as secondary indicators (IPOL's warning about separability vs threshold stability).
- Per-device results and their spread, not only the mean.
- Threshold stability across devices of a model and across firmware.
- For LR output: Cllr, minimum Cllr, Tippett plots, rates of misleading evidence [MEM].

**Uncertainty.**
- FPR, FNR, TPR: exact Clopper-Pearson or Wilson intervals. With zero events use the exact upper bound (about 3/n at 95%).
- Comparisons sharing a device or a fingerprint are correlated, so binomial intervals on raw comparison counts are too narrow. Use a cluster bootstrap that resamples devices (and, for pairs, both devices).
- AUC and TPR-at-FPR: bootstrap by device; DeLong only if independence holds.
- Do not report an FPR below about 3/n_independent.

**Robustness matrix.** JPEG quality, downscale factor, crop fraction, platform recompression, brightness class, texture, orientation, zoom, HDR, portrait, night mode, number of reference images (5, 10, 20, 50, 100), flat vs natural references.

**Reproducibility.** Freeze and log every parameter listed in B8 with each score. Regression-test against a reference implementation on fixed inputs.

---

## C. Things that commonly go wrong in PRNU implementations

Each item is tied to something observed in the sources or code above.

1. **Orientation.** Applying EXIF rotation to some images and not others, or mixing portrait and landscape in a reference set. Goljan 2009 and arXiv 2610.25438 restrict reference sets to one orientation and test 180 degrees. Some devices omit orientation tags (VISION D24, D33). Work in sensor coordinates; never auto-rotate silently.
2. **Resizing or resampling before extraction.** Thumbnails, "fit to max side" loaders, colour-managed decoders that resample. Any interpolation destroys alignment and attenuates the signal.
3. **Comparing different sensors or modes of one phone.** Main vs ultrawide vs tele; binned vs full resolution; photo vs video. Iuliani 2021 filtered by focal length; arXiv 2610.25438 by focal length and zoom tags. One fingerprint per sensor and output mode.
4. **Integer arithmetic.** Subtracting or squaring `uint8` wraps. The polimi port's `IntenScale` computes `(im - T)` on `uint8` (harmless there only because wrapped entries are overwritten) and `Saturation` relies on `uint8` differences being compared to zero only. Convert to float first.
5. **sigma0 on the wrong scale.** sigma0 = 5 is for 0-255 data.
6. **Forgetting to multiply K by I** in detection (correlating W with K instead of with I*K).
7. **Inconsistent numerator and denominator weighting in the MLE** (the polimi discrepancy in B3).
8. **PCE neighbourhood.** Wrong size (4x4 from an off-by-one slice), not centred on the peak, not wrapping at the borders, or dividing by MN instead of MN - |N|. Comparing scores computed with 11x11 and 5x5 exclusions as if on one scale.
9. **Peak location convention.** With the flip-based FFT correlation the zero-shift sample is the last element, not the first. Verify with a synthetic test.
10. **Searching for the maximum when no shift is admissible.** Inflates null scores; the threshold must then scale with the search size.
11. **Unsigned PCE.** Squaring hides a strong negative correlation, which is not a match.
12. **Circular wraparound.** Circular correlation assumes periodic signals; with zero-padded unequal sizes, only shifts inside the admissible range are meaningful. Exclude the others from the peak search.
13. **Not removing the mean** before correlation, or skipping ZM/DFT post-processing on one side only (fingerprint processed, query residual not, or vice versa).
14. **Contaminated reference sets.** Zoomed, edited, dark, saturated, portrait-mode or HDR images in the reference set (Goljan 2009 failure cases; Martin & Newman Pixel 2 case). Images from two devices merged under one label.
15. **Too few or unsuitable reference images**, and reusing a threshold calibrated for a different reference count (IPOL).
16. **Colour-space surprises.** Decoders that return BGR, apply ICC transforms, or upsample chroma differently; HEIF vs JPEG decode paths. Fix the decoder and its settings.
17. **Silent parameter changes.** A port that lowers the wavelet level count for small images; different DWT boundary modes between fingerprint and query.
18. **Thresholds copied from papers.** See B5.
19. **Evaluation leakage.** Random image-level splits, negatives from the same sensor, thresholds tuned on test data, same-model negatives missing.
20. **Treating the top-ranked candidate in a 1:N search as a match** without a threshold (open-set error).
21. **Multiple trials uncorrected.** Rotations, scales, shifts and database size all multiply false-alarm opportunities.
22. **Ignoring image content.** Dark, saturated, heavily textured images have weak or contaminated residuals; Chen 2008 builds a per-block correlation predictor from intensity, texture and signal flattening for this reason.

---

## D. Open questions and things I could not verify

**Could not access.**
- VISION numeric tables (AUC by platform, video results, registration table) and the PCE threshold value it used. Direct download blocked; text obtained only through the summarising tool.
- Data S1 of Martin & Newman (notation, exact brightness rule, camera table), and the middle of the article beyond what the tool summarised.
- Goljan 2008 (IWDW); Goljan & Fridrich 2012 (lens distortion); Goljan et al. 2016 (compression) paper text; Mihcak et al. 1999; Albisani et al. 2021; Baracchi et al. 2021 full text; Al-Ani & Khelifi 2017; Montibeller 2024; Butora & Bas 2024; Bhat & Bianchi 2022; the EIS literature.
- The main Binghamton toolbox files (`getFingerprint.m`, `NoiseExtractFromImage.m`, `WaveNoise.m`, `IntenScale.m`, `Saturation.m`, `Example.m`). The download link is replaced by "contact M. Goljan". Their behaviour here comes from the polimi port, which I showed deviates in at least the MLE weighting and the PCE function.
- ENFSI, SWGDE, Meuwly et al., and the J. Imaging 2021 LR paper. Everything in B8 attributed to them is from memory or search snippets.

**Marked from memory in the text.** Binghamton example sigma value; `mdwt` boundary mode; lens-distortion method; LR calibration methods and metrics; PCAST/NAS principles.

**Ambiguities in sources I did read.**
- Iuliani 2021 Table 4 (cameras): the PDF text extraction lists 25 models and 25 FPR values, but aligned naively the values contradict the body text (which says Fujifilm X-T30 and Sigma fp both exceed 60%). I therefore quote only the body text. Read the table from the PDF image before citing per-camera figures.
- Martin & Newman: licence and the strict vs non-strict brightness inequality.
- Li & Law: text/table inconsistencies noted by the tool.
- IPOL 662: the issues listed in A4.
- MLE with I vs denoised I (B3).

**Licensing risk (needs a decision before any code is written from these sources).**
- The Binghamton toolbox is CC BY-NC 4.0 on its page, and its file headers grant use for "educational, research and non-profit purposes" only; commercial use needs written permission (the page names a contact at Binghamton).
- polimi-ispl/prnu-python is MIT on GitHub but labels its functions "as from Binghamton toolbox". Whether MIT can validly cover a port of non-commercial code is a legal question I cannot answer.
- IPOL 662: article CC-BY-NC-SA; code zip has no licence file and embeds the polimi file.
- The algorithms themselves are published in the papers (Lukas 2006 Appendix A; Chen 2008; Goljan 2009). An implementation written from the papers and this specification, without copying those code files, avoids the code-licence question. Patents were not searched; a search result surfaced at least one related US patent (US8855358B2, tamper detection). Get legal review.
- Dataset licences for commercial validation are mostly unstated (VISION, Dresden, StegoAppDB, the Flickr sets). PrnuModernDevices is CC BY-SA 4.0.

**Scientific open questions that affect the product.**
1. Is there any validated one-to-one method that restores low FPR between same-model modern smartphones from JPEG/HEIF output? I found none. Delta-sPCE needs a cohort; raw-capture fingerprints need the device and a capable model; region masking is pipeline-specific.
2. How large must a same-model background cohort be, and does a fixed independent cohort make Delta-sPCE stable in open set? Unanswered (authors' own open question).
3. How do NUAs vary across firmware updates? arXiv 2610.25438 sees distribution shifts between iOS point releases, so calibration may expire with each update.
4. Which ZM variant (plain, per CFA phase, checkerboard) and which DFT filter variant is best on modern demosaiced, multi-frame output? Not compared anywhere I read. Many phone sensors are quad-Bayer or binned, so a period-2 assumption may not match the CFA.
5. Green-only vs luminance-weighted RGB: no head-to-head comparison found.
6. Appropriate exclusion-neighbourhood size as a function of resolution and interpolation: 11x11 and 5x5 are both used without justification in the texts I read.
7. HEIF/HEVC output: block structure differs from JPEG's fixed 8x8 grid, so the JPEG notch assumptions may not apply. Only mentioned (Baracchi abstract), not analysed in anything I opened.
8. The Pixel landscape/portrait bimodality in arXiv 2610.25438 is unexplained by its authors.
9. Counter-forensics (fingerprint removal or copying) was not in scope here and was not researched. A Binghamton paper on defending against fingerprint-copy attacks is listed on their code page.
