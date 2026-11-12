# Changelog

All notable changes are recorded here. Versions follow semantic versioning once a first release is tagged.

## Unreleased

Independent audit (see `audit/`). Decision logic `policy-1.1`.

### Fixed

- Decision policy: a low statistic is never reported as a non-match for computational or unknown
  devices (13% of genuine recent-phone photographs were); degenerate statistics are unsupported, not
  non-matches; the number of candidates no longer affects the non-match line; weak control fingerprints
  no longer clear a shared artefact.
- The shipped VISION policy file overstated its evidence and bypassed the same-model rule; it is now an
  uncalibrated policy with honest measurements attached.
- Security: uploads can no longer stall the API; request-size limits apply before authentication;
  parallel uploads are bounded; export archives are deleted with their data; open redirect closed;
  sign-in throttling cannot be used to lock everyone out; a password change revokes API tokens.
- Jobs recover after a worker crash (heartbeat-based), and transient failures are re-enqueued directly.
- Reports no longer fail on very long text.

### Changed

- Model-based tail probabilities are no longer shown in the application or in reports.
- Deleting data also deletes export archives that contain it.

### Added

- Evaluation on 12 smartphones from 2017-2021 (FloreView) and robustness experiments on real images.
- Audit reports, software bill of materials, independent numerical tests and security tests.

## 0.1.0 release candidate 1

Algorithm version `prnu-wavelet-mle-1.0`; decision logic `policy-1.0`.

### Engine

- Evidence ingestion for JPEG and PNG: content-based type verification, header-first size checks,
  SHA-256, metadata extraction, EXIF orientation recorded but not applied, near-duplicate hash.
- Wavelet-domain adaptive Wiener noise residual; zero-mean per colour-filter phase; frequency-domain
  Wiener filtering; saturation masking.
- Streaming maximum-likelihood fingerprint estimator with reference screening (duplicates, mixed
  resolutions/models/lenses, inconsistent images), split-half diagnostics and reproducible digests.
- Normalised correlation and signed PCE; native, rotated and cropped geometry; explicit refusal of
  unsupported geometry; multiple-testing adjustment.
- Four-outcome decision policy with provenance-labelled thresholds, quality gates and same-model control
  handling; open-set summaries. Delta-sPCE reported as experimental information only.
- Evaluation framework with device-level calibration/test split, stratified error rates with exact
  intervals, ROC and AUC, leakage checks and calibrated-policy export. Command-line interface.
- Cross-check against an independent reference implementation.

### Platform

- REST API v1 (accounts, sessions, API tokens, devices, sensors, reference images, fingerprints,
  investigations, evidence, notes, analyses, jobs, reports, exports, deletion, administration).
- Background jobs with progress, cancellation and retries; private object storage with signed, expiring,
  user-bound file access.
- PDF comparison and investigation reports.
- Web application: public site, dashboard, camera laboratory, investigations, comparison laboratory,
  reports, settings and guided onboarding with clearly labelled synthetic demo data.
- Docker Compose stack, database migrations, CI workflow.

### Known limitations

See PROJECT_STATUS.md and SCIENTIFIC_METHODOLOGY.md section 6.
