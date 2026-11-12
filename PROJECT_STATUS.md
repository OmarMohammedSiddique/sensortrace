# Project status

Last updated: 2026-11-12. Algorithm `prnu-wavelet-mle-1.0`, decision logic `policy-1.0`.
Release candidate 0.1.0. Repository: private, `github.com/OmarMohammedSiddique/sensortrace`.

Status values: **Verified** (exercised by an automated test or a recorded run; evidence cited) ·
**Implemented, unverified** · **Experimental** (works; insufficiently validated) · **Blocked** ·
**Not started**. Only *Verified* counts toward the definition of done.

## Test evidence (this revision)

| Suite | Result | Command |
|---|---|---|
| Engine: unit, property, regression, reference cross-check | 94 passed (72% line coverage) | `make test-engine` |
| Backend: integration against PostgreSQL, Redis, object storage | 108 passed | `make test-backend` |
| Browser end-to-end against the Docker stack | 42 passed | `make test-e2e` |
| Lint, formatting, types | Clean | `make lint` |
| Dependency audit (`pip-audit` on engine and backend) | No known vulnerabilities | `make audit` |
| Static security scan (`bandit`, medium and above) | No findings | — |
| Empirical evaluation on real images | Completed; see VALIDATION.md | `make evaluate` |
| GitHub Actions (hosted Linux runners) | All five jobs pass: engine, backend, frontend, end-to-end (42 browser tests), dependency and image scan | `.github/workflows/ci.yml` |

## Definition of done

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Starts locally from documented instructions | Verified | `docker compose --profile app up --build -d --wait` from empty volumes; all services healthy |
| 2 | Register and sign in securely | Verified | `test_auth.py`; `e2e/auth.spec.ts` |
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
| 14 | Automated tests and CI checks pass | Verified | Local suites and a fully green GitHub Actions run |
| 15 | Evaluation framework runs reproducibly | Verified | Full run completed; resumable; deterministic inputs |
| 16 | Security and privacy controls tested | Verified | SECURITY.md "Testing performed" |
| 17 | Operable through Docker Compose | Verified | Requirement 1; browser suite runs against it |
| 18 | Responsive, accessible, coherent UI | Verified within the tested scope | `e2e/a11y.spec.ts` (axe, WCAG 2 A/AA, no serious or critical findings on 7 pages, 2 themes), `e2e/responsive.spec.ts` (375 px). No manual screen-reader review |
| 19 | Documentation matches implementation | Verified by review | Commands in README and DEPLOYMENT were the ones executed |
| 20 | No known release-blocking defects | Verified, with the open items below | |

## Product capabilities

| Area | Status | Notes |
|---|---|---|
| Accounts, sessions, API tokens, CSRF, rate limits | Verified | No MFA, SSO, email verification or self-service reset |
| Private investigations, evidence, notes, history | Verified | No sharing between accounts (by design) |
| Evidence ingestion (JPEG, PNG), hashing, metadata, duplicates | Verified | HEIC/HEIF not supported (licence; see LICENSE_DECISIONS.md) |
| Camera laboratory, sensors, reference upload and guidance | Verified | |
| Fingerprint creation, screening, versions, diagnostics, visualisations | Verified | |
| Comparison laboratory, ranked candidates, result page | Verified | |
| Background jobs: progress, cancel, retry, interruption recovery | Verified | |
| PDF comparison and investigation reports | Verified | |
| Export (account, investigation), permanent deletion, retention purge | Verified | |
| Dashboard, storage usage, activity, audit history | Verified | |
| Administration: account, security, data, processing configuration | Verified | Processing configuration is read-only (environment variables) |
| Guided onboarding with labelled synthetic demo data | Verified | `e2e/onboarding.spec.ts` |
| Public site: product, methodology, privacy, documentation | Verified | |
| Engine CLI | Verified | |

## Scientific capabilities

Full table in VALIDATION.md section 4. In short:

| Capability | Status |
|---|---|
| Same-size, camera-original JPEG from smartphones of 2011–2016, flat-field references | **Validated within scope** (13 devices: 0/3,680 false matches, 7/520 misses at the reference line) |
| JPEG recompression down to quality 60 at full resolution | **Validated within scope** |
| Same-model device discrimination, older smartphones | **Validated within scope** (0/560) |
| Smartphones released since about 2018 | **Not validated.** Outcome is inconclusive unless controls or a calibration exist |
| Same-model control rule | **Experimental** |
| Dedicated cameras | **Not validated** |
| Natural-image or small reference sets | **Not validated** |
| Cropped images | **Experimental** (false-match behaviour measured; detection on real crops not) |
| Resized, zoomed, stabilised, platform-processed images | **Unsupported** |
| HDR, portrait, night, multi-frame modes | **Not validated**; one unexplained failure pattern found (Huawei P9) |
| Non-match conclusions | **Experimental** (threshold is an engineering choice) |
| Delta-sPCE | **Experimental, information only** |
| Quality flags as predictors | **Not validated** (heuristics) |
| Video, manipulation localisation, AI-content detection | **Not started** (out of initial scope) |

## Open items

| # | Item | Severity | Detail |
|---|---|---|---|
| 2 | Patent freedom-to-operate not checked | High for commercial release | PRNU camera identification was patented (Binghamton). Needs a patent attorney. Not a blocker for private use |
| 3 | No licence chosen for SensorTrace | Medium | All rights reserved until decided |
| 4 | Validation scope is narrow | High for any evidential use | 13 older smartphones. See VALIDATION.md section 7 |
| 5 | Huawei P9: 17.5% of own images undetected, cause unknown | Medium | Reported as inconclusive by the product; documented |
| 6 | Per-address rate limiting needs a reverse proxy | Low | Off by default; per-account limit still applies. SECURITY.md |
| 7 | No production deployment performed | — | Not authorised; procedure documented in DEPLOYMENT.md, exercised only locally |
| 8 | No independent security review or penetration test | Medium | |
| 9 | Worker memory on Docker Desktop | Low | Docker's VM must have enough memory for the sensor size (about 1.5 GB per job at 12 MP) |
| 10 | Evaluation images sampled in dataset order | Low | First 40 per category rather than random |
| 11 | Cross-platform numerical reproducibility | Low | Regression fixture passes on macOS ARM64 and Linux x86-64 CI within tolerance; no bit-exact guarantee |

No critical or high-severity functional defect is known in the implemented scope. Items 2 and 4 limit how
the product may be used and described, not whether it works.

## Deliberately not built

Public or shared fingerprint directories; cross-account matching; probability or likelihood-ratio
output; camera-model identification; telemetry; scale search for resized images; HEIC decoding.

## Next priorities

1. Evaluate recent smartphones with several units per model; evaluate dedicated cameras.
3. Natural-image and small reference sets; real crops; platform-processed images.
4. Investigate the Huawei P9 failures.
5. Legal review: patents, licence choice, LGPL compliance of distributed images.
6. MFA and self-service password reset.
