# Project status

Last updated: 2026-11-22. Algorithm `prnu-wavelet-mle-1.0`, decision logic `policy-1.1`.
Release candidate 0.1.0: latest pre-release `v0.1.0-rc.2` (2026-11-12); `main` has unreleased changes since,
listed in CHANGELOG.md. Repository: public, `github.com/OmarMohammedSiddique/sensortrace`, licensed under
the Apache License 2.0 (`LICENSE`, `NOTICE`).

**An independent audit was completed on 2026-11-12. Its findings supersede the summary below where they
differ: read `audit/RELEASE_READINESS.md` first.** It found and fixed eight high-severity defects and
showed that detection on recent smartphones is unreliable (15% of genuine images missed).

Status values: **Verified** (exercised by an automated test or a recorded run; evidence cited) ·
**Implemented, unverified** · **Experimental** (works; insufficiently validated) · **Blocked** ·
**Not started**. Only *Verified* counts toward the definition of done.

## Test evidence (this revision)

Results from the GitHub Actions run on `main` at commit `156486d` (2026-11-22), unless stated otherwise.

| Suite | Result | Command |
|---|---|---|
| Engine: unit, property, regression, reference cross-check, independent audit tests | 143 passed, 2 expected failures documenting open findings F-07 (#21) and F-09, 1 skipped: the expected failure for F-06 (#20) needs the VISION evaluation data, which CI does not have | `make test-engine` |
| Backend: integration against PostgreSQL, Redis, object storage, incl. security audit and two-step verification tests | 144 passed, 1 skipped | `make test-backend` |
| Browser end-to-end against the Docker stack | 45 passed | `make test-e2e` |
| Lint, formatting, types | Clean | `make lint` |
| Dependency audit (`pip-audit` on engine and backend, `npm audit`) and container image scan (Trivy) | No known vulnerabilities | `make audit`; CI job "Dependency and container checks" |
| Static security scan (`bandit`, medium and above) | No findings at the audit of 2026-11-12; not part of CI | |
| Code scanning (CodeQL default setup) | No open alerts. Of the 13 raised when it was switched on, 7 were fixed (#34) and 6 dismissed as false positives with reasons | GitHub code scanning |
| Empirical evaluation on real images | Completed; see VALIDATION.md. The algorithm has not changed since | `make evaluate` |
| GitHub Actions (hosted Linux runners) | All five jobs pass: engine, backend, frontend, end-to-end, dependency and container checks | `.github/workflows/ci.yml` |

## Repository controls

| Control | State |
|---|---|
| Branch protection | Ruleset `sensortrace-main-protection` on `main`: changes through pull requests only, the five CI jobs above must pass, no force pushes or deletion |
| Merging | Squash merge only; branches are deleted after merge |
| Code scanning | CodeQL default setup |
| Secret scanning | On, with push protection; no open alerts |
| Dependencies | Dependabot security updates and grouped version updates (#11); no open alerts |
| Third-party notices | `THIRD_PARTY_NOTICES.md`; both container images write full notices at build time (#36) |

## Definition of done

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Starts locally from documented instructions | Verified | `docker compose --profile app up --build -d --wait` from empty volumes; all services healthy |
| 2 | Register and sign in securely | Verified | `test_auth.py`, `test_mfa.py`; `e2e/auth.spec.ts`, `e2e/mfa.spec.ts` |
| 3 | Create a private investigation | Verified | `test_workflow.py`, `test_authorization.py`; `e2e/investigation.spec.ts`, `e2e/privacy.spec.ts` |
| 4 | Register a camera sensor | Verified | `e2e/investigation.spec.ts` |
| 5 | Upload multiple reference images | Verified | `e2e/investigation.spec.ts` (8 accepted, 1 rejected with reason); `test_uploads.py` |
| 6 | Genuine, reusable PRNU fingerprint | Verified | Engine tests; 13 real devices enrolled in the evaluation; `test_fingerprint_is_created_and_reusable` |
| 7 | Upload a questioned photograph | Verified | `e2e/investigation.spec.ts` |
| 8 | Real matching measurements | Verified | Engine tests; reference cross-check; evaluation on 520 real images |
| 9 | Distinguishes match, non-match, inconclusive | Verified | `test_decision_pipeline.py`; `test_workflow.py`; match and inconclusive in the browser suite. Non-match conclusions are **experimental** (see below) |
| 10 | Inspect measurements and limitations | Verified | `e2e/investigation.spec.ts` asserts statistic, caveats and policy status on the result page |
| 11 | Accurate PDF reports | Verified | `test_full_investigation_workflow` parses the PDF (hashes, numbers, caveats); browser download checked |
| 12 | Data persists correctly | Verified | Fresh-session checks in API and browser suites; migration test |
| 13 | Core APIs work and are documented | Verified | Contract test over the OpenAPI document; `docs/api/README.md` |
| 14 | Automated tests and CI checks pass | Verified | Green GitHub Actions run on `main` (2026-11-22); the same five jobs are required before any merge |
| 15 | Evaluation framework runs reproducibly | Verified | Full run completed; resumable; deterministic inputs |
| 16 | Security and privacy controls tested | Verified | SECURITY.md "Testing performed" |
| 17 | Operable through Docker Compose | Verified | Requirement 1; browser suite runs against it |
| 18 | Responsive, accessible, coherent UI | Verified within the tested scope | `e2e/a11y.spec.ts` (axe, WCAG 2 A/AA, no serious or critical findings on 7 pages, 2 themes), `e2e/responsive.spec.ts` (375 px). No manual screen-reader review |
| 19 | Documentation matches implementation | Verified by review | Commands in README and DEPLOYMENT were the ones executed |
| 20 | No known release-blocking defects | Verified, with the open items below | |

## Product capabilities

| Area | Status | Notes |
|---|---|---|
| Accounts, sessions, API tokens, CSRF, rate limits | Verified | No SSO, passkeys, email verification or self-service reset (#9) |
| Two-step verification (TOTP authenticator, single-use recovery codes) | Verified | Optional per account. `test_mfa.py`, `e2e/mfa.spec.ts`; operator reset with `python -m app.cli disable-mfa` |
| Password policy with an offline breached and guessable password check (zxcvbn) | Verified | `test_breached_and_guessable_passwords_rejected` |
| Private investigations, evidence, notes, history | Verified | No sharing between accounts (by design) |
| Evidence ingestion (JPEG, PNG), hashing, metadata, duplicates | Verified | HEIC/HEIF not supported (licence; see LICENSE_DECISIONS.md) |
| Camera laboratory, sensors, reference upload and guidance | Verified | |
| Fingerprint creation, screening, versions, diagnostics, visualisations | Verified | |
| Comparison laboratory, ranked candidates, result page | Verified | |
| Background jobs: progress, cancel, retry, interruption recovery | Verified | |
| PDF comparison and investigation reports | Verified | |
| Export (account, investigation), permanent deletion, retention purge | Verified | |
| Dashboard, storage usage, activity, audit history | Verified | Downloads are audited; source addresses are cleared from audit records after 90 days (`test_downloads_are_audited_and_previews_are_not`, `test_audit_retention_clears_old_addresses_and_ownerless_records`) |
| Administration: account, security, data, processing configuration | Verified | Processing configuration is read-only (environment variables) |
| Guided onboarding with labelled synthetic demo data | Verified | `e2e/onboarding.spec.ts` |
| Public site: product, methodology, privacy, documentation | Verified | |
| Engine CLI | Verified | |

## Scientific capabilities

Full table in VALIDATION.md section 5. In short:

| Capability | Status |
|---|---|
| Same-size, camera-original JPEG from smartphones of 2011–2016, flat-field references | **Validated within scope** (13 devices: 0/3,680 false matches, 7/520 misses at the reference line) |
| JPEG recompression down to quality 60 at full resolution | **Validated within scope** |
| Same-model device discrimination, older smartphones | **Validated within scope** (0/560) |
| Smartphones released since about 2018 | **Not validated.** Outcome is inconclusive unless controls or a calibration exist (#5) |
| Same-model control rule | **Experimental** |
| Dedicated cameras | **Not validated** (#10) |
| Natural-image or small reference sets | **Not validated** (#10) |
| Cropped images | **Experimental** (false-match behaviour measured; detection on real crops not) |
| Resized, zoomed, stabilised, platform-processed images | **Unsupported** |
| HDR, portrait, night, multi-frame modes | **Not validated**; one unexplained failure pattern found (Huawei P9, #6) |
| Non-match conclusions | **Experimental** (threshold is an engineering choice) |
| Delta-sPCE | **Experimental, information only** |
| Quality flags as predictors | **Not validated** (heuristics) |
| Video, manipulation localisation, AI-content detection | **Not started** (out of initial scope) |

## Open items

Item numbers stay fixed when an item closes, so gaps in the sequence are closed items. Each open item is
tracked in the GitHub issue named in its row, where one exists.

| # | Item | Severity | Detail |
|---|---|---|---|
| 2 | Patent freedom-to-operate not checked (#8) | High for commercial release | PRNU camera identification was patented (Binghamton). Needs a patent attorney. Not a blocker for private use |
| 4 | Validation scope is narrow (#5, #10) | High for any evidential use | 13 older smartphones validated; 12 phones from 2017 to 2021 evaluated but not validated. See VALIDATION.md section 6 |
| 5 | Genuine images with no detectable pattern, cause unknown (#6) | Medium | Huawei P9: 17.5% of own images undetected; the same pattern on several recent phones (Redmi Note 8T main camera 29 of 30; VALIDATION.md section 2). Reported as inconclusive by the product; documented |
| 6 | Per-address rate limiting needs a reverse proxy | Low | Off by default; per-account limit still applies. SECURITY.md |
| 7 | Vercel deployment has a 300-second job limit (#7) | Medium | Live at `sensortrace.vercel.app` and verified with synthetic data. Large real enrolments will probably time out there; not measured (first hands-on test: #1). Container deployment has no such limit but has only been run locally |
| 8 | No independent security review or penetration test | Medium | |
| 9 | Worker memory on Docker Desktop | Low | Docker's VM must have enough memory for the sensor size (about 1.5 GB per job at 12 MP) |
| 10 | Evaluation images sampled in dataset order | Low | First 40 per category rather than random |
| 11 | Cross-platform numerical reproducibility | Low | Regression fixture passes on macOS ARM64 and Linux x86-64 CI within tolerance; no bit-exact guarantee |
| 12 | Statistic depends strongly on the wavelet grid position on real JPEGs (#20) | Medium | Audit finding F-06. Crops at offsets that are not a multiple of 16 pixels give statistics that are not predictable from the full frame |
| 13 | Enrolment screening misses a group of images from a second sensor (#21) | Medium | Audit finding F-07. Only a lone foreign image is detected; the reference set must come from one device |
| 14 | LGPL checklist and development-only test oracle need a legal decision (#8, #35) | Low | Engineering checklist in `THIRD_PARTY_NOTICES.md`; the oracle is never imported, committed or shipped |
| 15 | No email verification or self-service password reset (#9) | Low | Needs an email provider; an operator resets passwords with the `reset-password` command |
| 16 | Frontend cannot move to TypeScript 7 yet (#37) | Low | `openapi-typescript` declares support for TypeScript 5 only |

No critical or high-severity functional defect is known in the implemented scope. Items 2 and 4 limit how
the product may be used and described, not whether it works.

## Deliberately not built

Public or shared fingerprint directories; cross-account matching; probability or likelihood-ratio
output; camera-model identification; telemetry; scale search for resized images; HEIC decoding.

## Next priorities

1. Evaluate recent smartphones with several units per model; evaluate dedicated cameras (#5, #10).
2. Natural-image and small reference sets; real crops; platform-processed images (#10).
3. Investigate the images with no detectable pattern on the Huawei P9 and recent phones (#6).
4. Shift-invariant residual and second-sensor screening (#20, #21).
5. Legal review: patents, LGPL compliance of distributed images, the development-only test oracle (#8, #35).
6. Measure job duration on the live deployment and handle the 300-second limit (#1, #7).
7. Email verification and self-service password reset, once an email provider is chosen (#9).
