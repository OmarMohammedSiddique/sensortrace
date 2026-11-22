# Changelog

All notable changes are recorded here. Versions follow semantic versioning once a first release is tagged.

## Unreleased

### Added

- Optional two-step verification with an authenticator app (TOTP, RFC 6238) and ten single-use recovery
  codes, with `python -m app.cli disable-mfa` for operators (#38). The migration adds four columns to
  `users`.
- New passwords are checked offline with zxcvbn against breached and common passwords, words, names and
  keyboard patterns (#22).
- Downloads of originals, fingerprints, reports and export archives are recorded in the audit history, as
  is detaching a comparison from an investigation (#22).
- Audit retention: source addresses are cleared from audit records after 90 days
  (`ST_AUDIT_ADDRESS_RETENTION_DAYS`), and ownerless records that carry one are removed (#22).
- Third-party notices: `THIRD_PARTY_NOTICES.md`, and both container images write full notices at build
  time (#23).
- `PRODUCT.md`, a root `CLAUDE.md` with the working rules, a documentation index in `docs/README.md` and
  YAML issue forms (#39).

### Changed

- Licensed under the Apache License 2.0, with a NOTICE file and licence fields in every package manifest.
- The web image no longer ships sharp or libvips; Next.js image optimisation is switched off (#23).
- GitHub Actions in CI are pinned to commit SHAs.
- `docs/adr/` is now `docs/decisions/` (#39).

### Fixed

- Account deletion: the failed-password throttle is keyed by account, so wrong passwords from one account
  no longer block deletion for every account behind the same proxy.
- Registration runs under a database lock, so concurrent sign-ups cannot both become administrator or
  return a server error for an address already in use.
- Code scanning alerts: the web proxy no longer puts client-supplied paths in log format strings, and job
  failure logs use the parsed identifier.
- Development dependencies: the minimatch advisory is cleared.

## 0.1.0 release candidate 2

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
