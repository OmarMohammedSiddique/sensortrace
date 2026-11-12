# Scientific methodology

This document describes exactly what SensorTrace computes, where each step comes from, what it assumes
and where it stops being reliable. The implementation is in `engine/src/sensortrace_engine/`. The
algorithm version described here is `prnu-wavelet-mle-1.0`; decision logic `policy-1.1`.

Validation results are in [VALIDATION.md](VALIDATION.md). Source notes with per-paper detail are in
`docs/research/literature-notes.md`.

## 1. What the method can and cannot establish

Every image sensor has small, fixed pixel-to-pixel differences in sensitivity to light, called
photo-response non-uniformity (PRNU). They imprint a faint multiplicative pattern on every image the
sensor captures. The pattern is stable over time and differs between sensors, including sensors of the
same camera model.

SensorTrace tests one hypothesis at a time: *is this image consistent with the fingerprint of this
enrolled sensor?* It reports a similarity statistic and a conservative outcome.

- It links an image to an **enrolled sensor fingerprint**. It cannot name an unknown camera from a single
  photograph.
- It concerns the **physical sensor**, not the camera model. Model identification is a different problem
  and is not attempted.
- The outcome is a **statistical indication**. It is not proof of origin and not a probability that the
  image came from the sensor.

## 2. Signal model

Following Chen, Fridrich, Goljan and Lukas (2008), the camera output is modelled, after linearisation, as

$$I = I^{(0)} + I^{(0)} K + \Theta$$

where $I^{(0)}$ is the noise-free image, $K$ the PRNU factor (the fingerprint) and $\Theta$ all other
noise. Applying a denoising filter $F$ gives the noise residual

$$W = I - F(I) = I K + \Xi$$

with $\Xi$ modelled as independent zero-mean Gaussian noise of constant variance. This is an
idealisation chosen so that estimation has a closed form; real residuals also contain scene content that
the filter failed to remove.

## 3. Pipeline

### 3.1 Ingestion (`ingest.py`)

- File type is established from content (magic bytes and a real decode), never from the name or the
  declared MIME type. JPEG and PNG are supported.
- Dimensions are checked from the header before pixel data is decoded (decompression-bomb protection).
- The SHA-256 of the bytes as received is recorded; the bytes are stored unmodified.
- **Pixels are analysed in stored geometry.** The EXIF orientation tag is recorded but not applied, and
  nothing is resampled. PRNU is a pixel-exact pattern of the sensor grid.
- 8-bit samples are used as decoded. 16-bit PNG samples are scaled to the 0–255 range in floating point.
  Alpha channels are discarded and palette images expanded, with a note.
- The decoder and library versions are recorded with every result, because JPEG decoding is not
  bit-identical across decoder versions.

### 3.2 Noise residual (`denoise.py`)

The denoising filter is the wavelet-domain adaptive Wiener filter of Mihcak, Kozintsev and Ramchandran
(1999) as used by Lukas, Fridrich and Goljan (2006, Appendix A). Per colour channel:

1. Four-level separable wavelet transform with the 8-tap Daubechies filter (`db4`).
2. For each detail coefficient $c$ in each sub-band, the local signal variance is estimated for four
   window sizes $w \in \{3,5,7,9\}$ and the smallest is kept:

$$\hat\sigma^2 = \min_w \max\bigl(0,\ \overline{c^2}_{w\times w} - \sigma_0^2\bigr)$$

3. The noise part of the coefficient is $c\,\sigma_0^2 / (\hat\sigma^2 + \sigma_0^2)$.
4. The approximation band is set to zero and the transform inverted, which yields $W$ directly.

| Parameter | Value | Source |
|---|---|---|
| Wavelet, levels | `db4`, 4 | Lukas et al. 2006 |
| Windows | 3, 5, 7, 9 (minimum) | Lukas et al. 2006 |
| $\sigma_0$ (0–255 scale) | 3 | Within the 2–5 range used in the literature; Loison et al. 2026 (IPOL) found 3–5 best on Dresden |

**Implementation choices that differ between published codes** (recorded because they change scores):

- *Boundary handling and sampling grid.* The image is extended by symmetric reflection to a multiple of
  16 pixels plus a 16-pixel guard band, transformed with periodic boundary handling and cropped. The
  widely used Python port extends symmetrically inside the transform instead. A decimated wavelet
  transform is not shift-invariant, so the two conventions sample the image on different grids.
  Fingerprints and questioned images of the same size always use the same grid here. **The effect of the
  grid is not small on real images.** On a synthetic white-noise sensor, moving the grid by one pixel
  gives a residual correlated at about 0.96 with the original; on VISION camera JPEGs the correlation is
  0.55 to 0.65, and the same-device statistic of an individual image changes by between −77% and +86%
  depending on the device, with no systematic loss (median ratio 0.94 over 16 images) and no effect on
  different-device statistics (audit finding F-06). Consequences: scores from this engine are not
  comparable image-by-image with scores from an implementation using another grid, and the statistic of
  a crop whose offset is not a multiple of 16 cannot be predicted from the full-frame statistic.
- *Window averaging at sub-band borders* replicates the edge value.
- Images with a side under 64 pixels are refused rather than analysed with fewer levels.

### 3.3 Suppression of non-unique artefacts (`residual.py`)

Some structure in residuals is shared by all cameras of a model and would cause false matches. Two
standard operations remove the classical kinds (Chen et al. 2008; Goljan, Fridrich and Filler 2009):

- **Zero-mean.** The mean, then every column mean and row mean, is subtracted on each of the four 2×2
  colour-filter-array phases separately. This removes demosaicing periodicities and row/column readout
  patterns.
- **Wiener filtering in the frequency domain.** Chen et al. (2008) describe a 3×3 Wiener filter on the
  spectrum; this engine uses the variant of the Binghamton toolbox, which applies the adaptive rule of
  3.2 to the magnitude. The magnitude spectrum is flattened: with $F$ the DFT of
  the pattern and $|F|/\sqrt{MN}$ its normalised magnitude, the same adaptive rule as in 3.2 (with
  $\sigma$ the standard deviation of the pattern) estimates the "noise" part of the magnitude, and each
  frequency is scaled by the ratio. Spectral peaks such as the JPEG 8×8 grid are attenuated.

The residual of a questioned image is: per-channel residuals → luminance combination with weights
0.299, 0.587, 0.114 → zero-mean → frequency-domain Wiener.

**These operations do not remove the artefacts introduced by modern smartphone processing** (section 6).

### 3.4 Reference fingerprint (`fingerprint.py`, `enrol.py`)

The maximum-likelihood estimate of $K$ from $N$ reference images (Chen et al. 2008, Eq. 6) is computed
per colour channel:

$$\hat K = \frac{\sum_{k=1}^{N} W_k\, \tilde I_k}{\sum_{k=1}^{N} \tilde I_k^{\,2} + 1}$$

where $\tilde I$ is the image intensity scaled to 0–1 for values below 252, attenuated as
$\exp(-(I-252)^2/6)$ above it, and set to zero on saturated pixels (a pixel at or above 250 that equals
at least one of its four neighbours). The same weight is used in numerator and denominator. The estimate
is then zero-meaned per channel, combined to luminance and Wiener-filtered in the frequency domain.

Under the model, the variance of the estimate is bounded by $\sigma^2/\sum_k I_k^2$: it falls as $1/N$
and with brightness. This is why bright, unsaturated, featureless reference images are best and why
natural scenes need roughly twice as many images.

**Screening before estimation.** Enrolment is two passes over the reference set:

1. Every file is ingested and assessed. Exact duplicates, unreadable files, digitally zoomed images,
   images with more than half the pixels clipped, and images whose dimensions, colour channels, camera
   make/model or lens differ from the largest consistent group are rejected with a stated reason. Images
   stored transposed (rotated by 90°) are rejected because the rotation direction is ambiguous.
2. A leave-one-out check on a central crop (512 px, smaller for very large sets) computes, for each
   image, the PCE between its residual and the fingerprint estimated from all the other images. If the
   set is mutually consistent (median at least 50) an image scoring below 5 is rejected as probably from
   a different sensor. These two numbers are data-hygiene heuristics, not forensic thresholds. **This
   check exposes a lone foreign image only.** Several images from one other sensor vouch for each other
   and are accepted (audit finding F-07: 3 foreign images among 15 produced a fingerprint that matched
   both devices). A group scoring below 4% of the median is reported as a warning, not removed. The
   reference set must be assembled from one device; screening is not a substitute for that.

The accepted images are then accumulated at full resolution, one at a time.

**Diagnostics stored with every fingerprint:** number of images, per-image statistics, screening
outcomes, the *split-half* PCE and correlation between fingerprints estimated from two disjoint halves of
the set, algorithm and library versions, the SHA-256 of every
reference file used, and a digest of the fingerprint samples. The web platform adds spectrum peakiness
and JPEG-grid energy; fingerprints made with the command-line tool do not carry those. Re-running the same algorithm version on
the same files reproduces the digest.

A fingerprint represents one sensor in one capture configuration. Other lenses, resolutions, aspect
ratios or modes of the same device need their own fingerprints; the platform models a device as a set of
sensors for this reason.

### 3.5 Detection statistic (`matching.py`)

For a questioned image with residual $W$, luminance $I$ and saturation mask, and a fingerprint $K$, the
arrays $X = W$ and $Y = I\,K$ (both zeroed on saturated pixels, means removed) are cross-correlated
circularly:

$$C(s) = \sum_x X(x+s)\,Y(x)$$

- **NCC** is the normalised correlation coefficient at the tested alignment.
- **Signed PCE** (Goljan, Fridrich and Filler 2009; signed variant from the Binghamton toolbox):

$$\mathrm{PCE} = \mathrm{sign}\bigl(C(s_0)\bigr)\;\frac{C(s_0)^2}{\dfrac{1}{MN-|\mathcal N|}\displaystyle\sum_{s\notin\mathcal N} C(s)^2}$$

with $\mathcal N$ an 11×11 neighbourhood of the tested alignment $s_0$, wrapping at the borders. The
sign matters: a strong negative correlation is not evidence of a match.

**Which alignments are tested**

| Relation of image to fingerprint | Tested | Trials |
|---|---|---|
| Same pixel dimensions | zero shift, at 0° and 180° (all four rotations for square images) | 2 (4 if square) |
| Transposed dimensions | zero shift, at 90° and 270° | 2 |
| Smaller in both dimensions (a crop) | every placement inside the fingerprint, at each rotation that fits | (H−h+1)(W−w+1) per rotation |
| Larger in either dimension, or otherwise incompatible | **not tested** ("unsupported") | 0 |

For same-size images the peak is read at zero shift only. Searching for the maximum of the whole surface
when no shift is plausible turns one test into millions and inflates scores from unrelated sensors. The
largest off-origin peak is still recorded as a diagnostic.

For crops the exact statistic $\sum_x W(x) I(x) K(x+s)$ is evaluated for every placement with one FFT.
**Cropped-image analysis is experimental**: see section 5 and VALIDATION.md.

Resized, digitally zoomed or otherwise resampled images are not registered. A downscaled image that
happens to fit inside the fingerprint is searched as a crop and, because resampling destroys the
alignment, does not match.

### 3.6 Multiple testing

Under the idealised model, with unrelated $X$ and $Y$, $\sqrt{\mathrm{PCE}}$ is a standard normal
deviate. When $k$ hypotheses are tested (rotations × placements × candidate sensors), the chance that at
least one exceeds a value is $1-(1-p)^k$. SensorTrace converts this back to an **equivalent single-test
PCE** ("adjusted statistic") and applies thresholds to that. For large values the adjustment is close to
subtracting $2\ln k$. The formula reproduces the worked example of Goljan and Fridrich (2008): at
$\alpha = 10^{-5}$ with $k = 88{,}836{,}025$ the required PCE is 53.77.

The idealised model is used only to scale thresholds with the number of hypotheses. It is not an
error model: on the VISION evaluation 4.7% of different-model trials exceed the value the model puts at
2.0%, and at PCE 60 the model gives 4.7×10⁻¹⁵ where Goljan et al. (2009) measured 2.4×10⁻⁵. The
Gaussian tail figures remain in the API payload for completeness, labelled as idealised; they are not
shown in the application or in reports (audit finding F-08).

## 4. Image quality assessment (`quality.py`)

Each image is assessed for conditions known to weaken or invalidate the analysis: resolution, fraction of
clipped pixels, darkness, estimated JPEG quality (from the quantisation table), strong texture, PNG
container (rarely a camera original), missing metadata, editing or sharing software named in metadata,
recorded digital zoom, mismatch between EXIF and actual dimensions, and special rendering modes
(EXIF `CustomRendered`, composite images). Flags are heuristics that inform the examiner and restrict the
conclusions the policy may draw. They are not findings.

## 5. Decision policy (`decision.py`)

| Outcome | Meaning |
|---|---|
| Evidence supports a match | The adjusted statistic is at or above the match threshold, and the same-model alternative has been addressed (below) |
| Evidence supports a non-match | The statistic, **not** adjusted for the number of candidates or alignments, is at or below the non-match threshold and not strongly negative, **and** all of: native-resolution geometry, no flagged condition that could hide a match, at least 250,000 usable pixels, a fingerprint from at least 20 reference images with split-half PCE at least 100 |
| Inconclusive | Anything between the thresholds; a low statistic under conditions that could hide a match; a high statistic for which the same-model alternative is not addressed |
| Insufficient quality or unsupported analysis | Unsupported geometry; too few usable pixels; a severe quality condition together with a statistic below the match threshold |

Principles:

- **Poor quality can hide a match but cannot create one.** Quality gates therefore restrict non-match
  conclusions, never match conclusions.
- **Open set.** Every candidate is judged on its own. Nothing forces one of the enrolled sensors to be
  chosen. If several sensors exceed the threshold for one image, the summary states that no single
  source should be concluded.
- **Thresholds state their provenance.** The default policy, `literature-reference-uncalibrated`, uses
  PCE 60 (Goljan et al. 2009) and 10 as *reference lines*. No error rate is attached to them: the 2009
  figure (no exceedance in about one million different-model tests; overall false-alarm rate
  $2.4\times10^{-5}$ with 2.4% misses) was measured on pre-2009 cameras at full resolution and does not
  transfer. The non-match line of 10 is an engineering choice inside the range expected for unrelated
  sensors under the idealised model; it is not a published figure.
- **Calibrated policies** are produced by the evaluation framework (VALIDATION.md). They record the
  dataset, trial counts, target rates and the device models they cover, and they are valid only there.

### The same-model alternative

Each device declares its processing pipeline: `conventional` (dedicated cameras, and phones without
multi-frame computational processing), `computational` (modern smartphones) or `unknown` (treated as
computational). For a device that is not declared conventional, a statistic above the match threshold
supports a match only if one of these holds:

1. the active policy is calibrated with same-model negatives for that device model; or
2. at least one **other physical device of the same make and model** was enrolled and compared with the
   same image, its fingerprint meets the same quality requirements as for a non-match conclusion (at
   least 20 reference images, split-half PCE at least 100), and every such control stayed below the
   match threshold on the unadjusted statistic. This is labelled experimental: a
   small control set cannot rule out artefacts shared with other units, batches or software versions.

Otherwise the outcome is inconclusive and the reason is stated. If a control also exceeds the threshold,
the outcome is inconclusive for both.

**Delta-sPCE** (Loison et al. 2026: the statistic minus the mean statistic of same-model controls) is
computed when controls exist and shown as experimental information. Its authors state it is not suitable
for operational use; it is never used for an outcome.

## 6. Limitations

| Condition | Effect | Handling |
|---|---|---|
| Different devices of the same model | Shared processing artefacts can raise the statistic between devices, strongly on many phones since about 2018 | Same-model alternative (section 5); caveats on every result |
| Multi-frame fusion, HDR, night modes | Local shifts between regions; weakened or displaced pattern; misses | Flagged from metadata where recorded; blocks non-match conclusions. Not corrected |
| Portrait / synthetic blur | Pattern removed or replaced in blurred regions; on some phones a shared synthetic pattern causes false matches | Flagged where metadata records it. Not masked |
| Digital zoom, resizing | Resampling destroys alignment | Zoom flagged from metadata and refused in reference sets; no scale search |
| Cropping | Unknown offset; fewer pixels | Exhaustive placement search with adjustment for the number of placements; **experimental** |
| Electronic stabilisation, lens-distortion correction | Geometric warping, growing toward the edges | Not corrected |
| JPEG recompression, messaging and social platforms | Attenuation; usually also resizing | Quality estimated and flagged; measured in VALIDATION.md for recompression only |
| Screenshots, edited or AI-modified images | Pattern absent, displaced or partly replaced | Flagged where detectable (PNG container, software tag, dimension mismatch); otherwise not detectable |
| Dark or saturated content | PRNU is multiplicative: little signal in dark areas, none in clipped areas | Saturated pixels excluded; darkness flagged |
| Strong texture | Scene detail leaks into the residual | Flagged; no content-adaptive prediction of the expected statistic |
| Multiple sensors on one device | Different fingerprints | Modelled as separate sensors; mixed reference sets are split, not merged |
| Raw-developer or in-camera patterns shared across devices | False matches | Not detected |
| Video | Not supported | — |

Things the software deliberately does not do: assign a probability of origin; report a likelihood ratio;
claim an error rate outside validated scope; identify a camera model; search a public or shared database
of fingerprints.

## 7. Verification of the implementation

- **Unit and property tests** (`engine/tests/`) cover each stage: the filter, zero-mean, spectral
  whitening, saturation handling, the estimator, the statistic (against hand-computed values, wrap-around
  and sign), rotation and crop handling, the multiple-testing adjustment (against the published example),
  the decision policy and the statistics functions.
- **Independent reference method** (`tests/test_reference_implementation.py`). The engine is compared
  with polimi-ispl/prnu-python, used as a development-only oracle. With the reference's transform
  convention this engine's shrinkage rule reproduces the reference residual to a correlation above
  0.99999. End to end, **on the synthetic sensor**, the residuals correlate above 0.95, fingerprints above
  0.97, and the two pipelines' statistics agree within 15% for same-sensor images while both stay low
  for different-sensor images. On real camera JPEGs the two implementations use different transform
  grids and individual scores differ widely (0.55 residual correlation and 6,370 against 11,828 on one
  VISION image; see 3.2), though both detect the same images. The reference's own score (global
  maximum, 4×4 exclusion) is higher for unrelated sensors, as documented.
- **Independent audit** (`audit/SCIENTIFIC_AUDIT.md`, `tests/test_audit_independent.py`): brute-force
  implementations of each definition written by a separate reviewer confirm the filter, the estimator,
  the statistic, the crop search and the statistics functions, and found defects in the decision layer
  that were fixed in decision logic `policy-1.1`.
- **Empirical evaluation on real images**: VALIDATION.md.

Synthetic sensors (`synthetic.py`) are used for unit tests and onboarding only. They follow the textbook
model without real camera processing and say nothing about real-world accuracy.

## 8. Reproducing a result

1. Install the engine: `cd engine && uv sync`.
2. Enrol: `uv run sensortrace enrol --out sensor.npz ref_*.jpg`. The output lists every accepted and
   rejected reference image with reasons, the diagnostics and the fingerprint digest.
3. Compare: `uv run sensortrace compare --fingerprint sensor.npz questioned.jpg`.
4. The same algorithm version, library versions and input bytes reproduce the same numbers. Reports list
   all of these.

## References

- Mihcak, M. K., Kozintsev, I., Ramchandran, K. (1999). Spatially adaptive statistical modeling of wavelet image coefficients and its application to denoising. ICASSP.
- Lukas, J., Fridrich, J., Goljan, M. (2006). Digital camera identification from sensor pattern noise. IEEE Trans. Information Forensics and Security 1(2).
- Chen, M., Fridrich, J., Goljan, M., Lukas, J. (2008). Determining image origin and integrity using sensor noise. IEEE Trans. Information Forensics and Security 3(1).
- Goljan, M., Fridrich, J. (2008). Camera identification from cropped and scaled images. Proc. SPIE 6819.
- Goljan, M., Fridrich, J., Filler, T. (2009). Large scale test of sensor fingerprint camera identification. Proc. SPIE 7254.
- Shullani, D., Fontani, M., Iuliani, M., Al Shaya, O., Piva, A. (2017). VISION: a video and image dataset for source identification. EURASIP J. Information Security 2017:15.
- Iuliani, M., Fontani, M., Piva, A. (2021). A leak in PRNU based source identification. Questioning fingerprint uniqueness. IEEE Access 9.
- Martin, A., Newman, J. (2025). Significance of image brightness levels for PRNU camera identification. Journal of Forensic Sciences 70(1), 132-149. doi:10.1111/1556-4029.15673.
- Li, Z., Law, N.-F. (2025). Recent advances in deep learning-based source camera identification and device linking. Sensors 25(24), 7432. doi:10.3390/s25247432.
- Loison, B., Bammey, Q., Grompone von Gioi, R., Muse, P., Gardella, M. (2026). Photo response non-uniformity extraction and detection. Image Processing On Line 16, 1-29. doi:10.5201/ipol.2026.662.
- Loison, B., Bammey, Q., Ehret, T., Grompone von Gioi, R., Muse, P., Gardella, M. (2026). A new hope for PRNU on modern smartphones? Evidence that device-specific fingerprints survive computational photography. arXiv:2610.25438 (preprint, not peer reviewed).
