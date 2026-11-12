# Requirements traceability

Audit of 2026-11-12. Baseline commit `651b83e`; branch `audit/independent-review`; tracking issue #17.

Status values: **Verified** (evidence produced or re-checked during this audit) · **Experimental**
(implemented; insufficient empirical validation) · **Blocked** (cannot be completed without something
outside the project) · **Not validated** · **Not started**. "Verified" means the stated behaviour was
observed, not that the product is forensically validated.

## A. Scientific correctness

| Requirement | Status | Evidence |
|---|---|---|
| Ingestion: type from content, EXIF orientation recorded not applied, channel order, bit depth, original bytes preserved | Verified | `SCIENTIFIC_AUDIT.md` Q1; `engine/tests/test_ingest_quality.py`, `test_audit_independent.py`; end-to-end hash checks (E) |
| Noise residual (wavelet adaptive Wiener) matches the published method | Verified by brute-force reimplementation and against the reference oracle | `SCIENTIFIC_AUDIT.md` section 2 |
| Zero-mean per CFA phase, frequency-domain Wiener, saturation masking | Verified (the spectral filter is the toolbox variant, now stated) | same |
| ML fingerprint estimator, consistent weighting, float32 accumulation | Verified | same |
| Signed PCE: peak location, 11×11 exclusion, divisor, wrap-around, sign | Verified against hand computation and brute force | same |
| Rotation and crop alignment | Verified; rotation note direction fixed (F-12) | same; real crops in `BENCHMARK_RESULTS.md` 5 |
| Multiple-testing adjustment | Verified against Goljan and Fridrich (2008) example; saturation for very negative values documented (F-09, open) | same |
| Outcomes follow from stated rules; no forced match | Verified after fixes F-02 to F-05, F-11 and issue #18 | `test_decision_pipeline.py`, `test_audit_independent.py` |
| No score reported as a probability of identity | Verified; model-based tail figures removed from UI and reports (F-08) | `backend/tests/test_audit_security.py::test_reports_survive_very_long_text`; end-to-end check |
| Thresholds follow from calibrated evidence | **Not met, and stated as such.** Thresholds are literature reference lines; the shipped policy file overstated its evidence and was corrected (F-01) | `backend/policies/vision-2017-measured.json`, `VALIDATION.md` 3 |
| Multiple sensors and lenses per phone kept separate | Verified for mixed dimensions/model/lens; **not** for several images from a second same-model sensor (F-07, issue #21) | `test_enrol_stats.py`; `SCIENTIFIC_AUDIT.md` F-07 |
| Rescaling, cropping, recompression | Verified on real images: resampled never matches; crops located; recompression to Q60 detected | `BENCHMARK_RESULTS.md` 4–6 |
| HDR and computational photography | **Not validated**; failure patterns measured on five phones | `BENCHMARK_RESULTS.md` 2, 8 |
| Same-model false matches | Older phones: measured 0/560 over 7 device pairs. Recent phones: **not validated** (no usable pairs) | `BENCHMARK_RESULTS.md` 1–2; issue #5 |
| Wavelet-grid sensitivity | Open (F-06, issue #20); documentation corrected | `SCIENTIFIC_AUDIT.md` F-06 |
| Every core computation traced to a source | Verified, with the sources that could not be opened listed | `SCIENTIFIC_AUDIT.md` sections 2 and 7 |

## B. Reproducible empirical evaluation

| Requirement | Status | Evidence |
|---|---|---|
| Licensed authentic datasets with device labels | Verified: VISION and FloreView, CC BY-SA 4.0 | `LICENCE_AUDIT.md`; `BENCHMARK_RESULTS.md` |
| Same-sensor positives | Verified: 520 + 360 | `BENCHMARK_RESULTS.md` 1 |
| Different-sensor negatives incl. same model | Verified for older phones (560 same-model); recent phones: 60 same-model trials across different lenses only | same |
| Sensors absent from the gallery | Verified: 0/480 wrong attributions | `BENCHMARK_RESULTS.md` 3 |
| Separate enrolment, calibration and held-out data | Verified (device-level split; no leakage found by the independent reviewer) | `SCIENTIFIC_AUDIT.md` Q8 |
| Exact and near-duplicate checks | Verified: 0 exact; 1 and 0 near-duplicate pairs | evaluation reports |
| Compression, low quality, cropping, incompatible transforms | Verified on older phones; low-light analysed only descriptively (13 dark images) | `BENCHMARK_RESULTS.md` 4–6; `VALIDATION.md` 1 |
| Classical PRNU baseline documented | Verified | `BENCHMARK_RESULTS.md` 1 |
| Alternatives (delta-sPCE) | Not evaluated: unsuitable gallery; its source paper was not read verbatim by the reviewer. Labelled experimental | `SCIENTIFIC_AUDIT.md` 7 |
| FPR, FNR, TPR at stated FPR, ROC/AUC, EER, intervals | Verified, with the resolvable range stated | `BENCHMARK_RESULTS.md` 1; `docs/validation/*.json` |
| Thresholds not tuned on the test set | Verified: threshold fixed a priori; data-derived thresholds examined and rejected | `VALIDATION.md` 1 |
| Datasets, sample sizes, versions, parameters, seeds, scripts recorded | Verified | `REPRODUCIBILITY.md` |

## C. Provenance and licensing

| Requirement | Status | Evidence |
|---|---|---|
| Inventory with version, origin, licence, direct/transitive | Verified: 871 components | `SBOM.json`, `scripts/generate_sbom.py` |
| GPL/AGPL and non-commercial code | Verified absent | `LICENCE_AUDIT.md` |
| No copied research implementation | Verified by inspection; oracle is fetched, not vendored | same |
| Notice and attribution obligations | **Open**: no third-party notices file | issue #23 |
| Dataset restrictions | Verified: nothing redistributed | `LICENCE_AUDIT.md` |
| Project licence; patents | **Blocked** on the owner and on legal review | issue #8 |

## D. Security, privacy and evidence integrity

| Requirement | Status | Evidence |
|---|---|---|
| Sign-in, sessions, tokens | Verified; token and lockout behaviour fixed (F-13, F-17) | `SECURITY_AUDIT.md`; `backend/tests/test_auth.py`, `test_audit_security.py` |
| Account recovery | No self-service flow exists; operator command only | `SECURITY.md` known gaps |
| Authorisation on every route; IDOR | Verified: 74 routes, 76 cross-account attempts, all refused | `SECURITY_AUDIT.md` route matrix; `test_authorization.py` |
| Organisation-level authorisation | Not applicable: there are no organisations or sharing | — |
| Object storage permissions; signed URLs | Verified; tokens additionally bound to the owner's key prefix (F-10) | `SECURITY_AUDIT.md`; end-to-end checks |
| Upload checks, decoder safety, resource limits, isolation | Verified after fixing two high-severity denial-of-service defects (F-01, F-02) and the pool exhaustion (F-03) | `test_audit_security.py`, `test_uploads.py` |
| Rate limits, job quotas, retries, cancellation | Verified; job-limit race fixed (F-15); crash recovery fixed (issue #19) | `test_jobs_contract.py`; end-to-end worker-kill check |
| Secrets, dependencies, logging, telemetry, errors | Verified; dev-secret warning added (F-14); analytics payload reduced (F-06); `pip-audit` and `npm audit --omit=dev` clean | `SECURITY_AUDIT.md` 6 |
| Audit trail, SHA-256, provenance, report integrity | Verified; gaps filled (F-12); downloads still unaudited (issue #22) | end-to-end hash checks |
| Retention, export, deletion | Verified; archives now deleted with their data (F-04) | `test_workflow.py`, `test_audit_security.py` |
| Nothing public unintentionally | Verified: unauthenticated object-store and file-link requests refused | `test_jobs_contract.py` S3 test; end-to-end checks |

## E. End-to-end with authentic photographs

Run: `audit/experiments/e2e_real_data.py` against the rebuilt Docker stack; log in
`audit/experiments/e2e_real_data_log.json`. Browser journey: `frontend/e2e/` (42 tests, synthetic images).

| Step | Status | Evidence |
|---|---|---|
| 1 Register / sign in | Verified | script; `e2e/auth.spec.ts` |
| 2 Private investigation | Verified | script; second-user checks |
| 3 Register a sensor | Verified | script |
| 4 Upload authentic reference photographs (30, iPhone 6) | Verified, hashes equal to the files | script |
| 5 Genuine fingerprint | Verified: 62 s, split-half PCE 545,055 | script |
| 6 Upload questioned photographs | Verified | script |
| 7 Real comparisons with numerical evidence | Verified: same device PCE 5,631 | script |
| 8 Qualified outcomes | Verified: match for the same device; no match for another unit of the same model or another model; resized image neither match nor non-match; bad files rejected with reasons | script |
| 9 Accurate report | Verified: PDF hash equals stored hash; evidence hash and fingerprint digest present; no probability | script |
| 10 Persistence across restart | Verified: database, API, worker and web restarted; results, evidence bytes and fingerprint digest unchanged | script |
| Unrelated sensors, bad images, unauthorised users | Verified | script |
| Worker failure | See RELEASE_READINESS.md | script |

## Tests: real computation or mock?

Classification by the independent reviewers (`SCIENTIFIC_AUDIT.md` section 5, `SECURITY_AUDIT.md`):

- Engine tests compute real results on synthetic sensors; none mocks the code under test. Before the
  audit most checked self-consistency rather than an independently known answer; `test_audit_independent.py`
  adds brute-force and closed-form checks. Synthetic sensors do not exercise the real-JPEG behaviour found
  in F-06.
- Backend tests run against real PostgreSQL, Redis and storage with jobs executed in-process; a few use
  the real queue. Monkeypatching is limited to fault injection (a failing handler, an unreachable queue).
- Browser tests drive the real stack with synthetic images.
- Real photographs are exercised only by the evaluations and the end-to-end script, not by CI (the data
  is not redistributable).
