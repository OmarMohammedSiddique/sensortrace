# ADR 0002: Forensic method and conservative decision policy

Status: accepted (2026-11-12)

## Context

The literature review (`docs/research/literature-notes.md`) established that:

1. The classical PRNU pipeline (wavelet residual, maximum-likelihood fingerprint, zero-mean and spectral
   whitening, peak-to-correlation energy) is well documented and reproducible from the papers.
2. Public implementations disagree in details that change scores (exclusion window size, where the peak
   is read, weighting of the estimator), and some contain defects.
3. The widely quoted threshold PCE = 60 was measured on pre-2009 cameras. On smartphones released since
   about 2018, different devices of the same model often exceed it (Iuliani et al. 2021 report
   false-match rates from 5% to over 60% for some models; Loison et al. 2026 needed thresholds of 213 to
   2,652 to hold a 5% rate on 2025 flagships).
4. The proposed normalisation (Delta-sPCE) is described by its own authors as not suitable for
   operational use.
5. The Binghamton reference toolbox is licensed for non-commercial use only.

## Decision

- **Implement the classical pipeline independently from the published descriptions.** No third-party
  PRNU source code is included. An MIT-licensed port is used only as a development-time test oracle.
- **Follow the Binghamton conventions where sources differ**, because the large-scale results in the
  literature were produced with them: per-channel estimation then luminance combination; intensity
  weighting with saturation exclusion applied consistently to numerator and denominator; zero-mean on
  each of the four colour-filter phases; Wiener filtering of the spectrum magnitude; signed PCE with an
  11 x 11 exclusion window; the peak read at zero shift when no translation is plausible.
- **Four outcomes, never a probability.** Match supported, non-match supported, inconclusive,
  insufficient or unsupported.
- **No literature threshold carries an error rate.** The default policy is labelled uncalibrated.
  Calibrated policies are produced only by the evaluation framework, record their data and scope, and
  apply only to the models they cover.
- **Same-model alternative.** Each device declares its processing pipeline. Unless it is declared
  conventional, a statistic above the threshold supports a match only when the policy is calibrated for
  that model or when other physical devices of the same model, enrolled as controls, stay below the
  threshold for the same image. Otherwise the outcome is inconclusive, with an explanation.
- **Quality gates block non-match conclusions, not match conclusions.** Poor quality can hide a match but
  cannot create one.
- **Multiple testing is charged.** Rotations, crop positions and the number of candidate sensors are
  counted, and the statistic is adjusted to an equivalent single-test value.
- **Delta-sPCE is reported as experimental information only** and never used for an outcome.
- **Unsupported geometry is refused, not guessed.** Resampled or zoomed images are not searched for scale.

## Consequences

- For modern smartphones the product will often answer "inconclusive" until the user enrols a control
  device of the same model. This is intended: it reflects the state of the science.
- Scale search (resized images) and lens-distortion compensation are future modules.
