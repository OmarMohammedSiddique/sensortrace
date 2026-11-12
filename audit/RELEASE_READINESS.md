# Release readiness

Independent audit of 2026-11-12. Baseline commit `651b83e`; audited branch
`audit/independent-review`; tracking issue #17. Algorithm `prnu-wavelet-mle-1.0`, decision logic
`policy-1.1`.

## Verdict

**The software works and is safe to operate as a private tool. It is not forensically validated, and it
must not be presented as such.**

- As an engineering product (accounts, private storage, jobs, reports, deployment): **ready for private
  and internal use.** No critical or high-severity defect is known to remain.
- As a forensic method: **validated only for one narrow case** (linking a camera-original JPEG to an
  enrolled older smartphone, 2011–2016). On recent smartphones it misses a substantial share of genuine
  images and cannot yet distinguish units of the same model, so for them it can only ever answer
  "inconclusive" without control devices. Dedicated cameras are untested.
- For commercial release: **blocked** by legal items (patents, licence choice, third-party notices).

## What the audit did

| Part | Method | Report |
|---|---|---|
| A. Scientific correctness | Fresh reviewer with no access to the authors' conclusions; brute-force reimplementation of every definition; headline results recomputed from raw scores | `SCIENTIFIC_AUDIT.md` |
| B. Empirical evaluation | Second public dataset (12 recent phones); open-set, real-crop, resampling and reference-set experiments on real images | `BENCHMARK_RESULTS.md`, `REPRODUCIBILITY.md` |
| C. Licensing | Bill of materials generated from resolved dependencies; licence review | `LICENCE_AUDIT.md`, `SBOM.json` |
| D. Security | Fresh reviewer attacking the running local stack; every route enumerated; reproductions and tests | `SECURITY_AUDIT.md` |
| E. End to end | Real photographs through the real stack, including a full restart and a killed worker | `experiments/e2e_real_data.py`, `REQUIREMENTS_TRACEABILITY.md` |

## Defects found and fixed

| Severity | Defect | Found by | Fix |
|---|---|---|---|
| High | "Non-match supported" was reported for 13% of genuine same-device photographs from recent phones | New benchmark | Non-match only for devices declared conventional (issue #18) |
| High | A NaN or degenerate statistic could be reported as a non-match | Scientific review F-02 | Reported as unsupported |
| High | Adding candidate sensors could turn an intermediate result into a non-match | F-03 | Non-match line uses the unadjusted statistic |
| High | A two-image control fingerprint could unlock "match supported" despite a shared artefact | F-04 | Controls must meet fingerprint quality requirements |
| High | The shipped policy file labelled all-device figures as held-out, claimed calibration it did not have, and bypassed the same-model rule for five models on thin evidence | F-01 | Policy rewritten as uncalibrated measurements; bypass removed |
| High | One 231 KB upload could freeze the API for 20–37 s | Security review F-01 | Decoding moved off the request loop |
| High | Request bodies of hundreds of megabytes were read before authentication | F-02 | Limits enforced first; 1 MB for non-upload bodies |
| High | A job stayed "running" for ever after its worker was killed | End-to-end run | Heartbeat-based recovery (issue #19) |
| Medium | 100 concurrent requests from one account exhausted the database pool | F-03 | Parallel uploads bounded per account |
| Medium | Export archives outlived the data they contained | F-04 | Deleted with the data |
| Medium | Open redirect through the sign-in `next` parameter | F-05 | Target validated |
| Medium | One client could lock everyone out of sign-in | F-13 | Per-address limit only with trusted addresses |
| Medium | Model-based "false alarm" figures understated real rates by orders of magnitude | Scientific F-08 | Removed from UI and reports |
| Medium | Control statistics were deflated by the search adjustment | F-05 | Fixed |
| Low | Job-limit race; report failure on long text; tokens surviving a password change; analytics receiving record identifiers; proxy dropping the API's CSP; header handling; file-token binding; audit gaps; threshold off-by-one; rotation note; storage test leaking buckets | Both reviews | Fixed |

Documentation claims found overstated were corrected in `SCIENTIFIC_METHODOLOGY.md`, `VALIDATION.md` and
`SECURITY.md` (list in `SCIENTIFIC_AUDIT.md` section 6).

## Capability status

### Verified (within the stated scope)

- Core numerics: denoising filter, fingerprint estimator, signed PCE, rotation and crop search,
  multiple-testing adjustment, statistics functions.
- Linking a camera-original JPEG to an enrolled **2011–2016 smartphone**: 0/3,680 false matches,
  7/520 misses (one device); survives JPEG recompression to quality 60.
- Rejection of images from sensors that are not enrolled: 0/480 wrong attributions.
- Locating a real 1024×768 crop on those phones: 105/105 located, 104/105 above the threshold, no false
  match.
- Resampled images never match and are never called a non-match.
- Evidence integrity: stored hashes equal file hashes; reports carry them; results persist across a full
  restart.
- Access control: no cross-account access on any of 74 routes; private storage; signed, user-bound,
  expiring file links.
- Operations: clean start from documented commands, background jobs, cancellation, crash recovery,
  export, permanent deletion, retention purge.
- The full workflow with authentic photographs (28/28 checks) and through the browser (42 tests).

### Experimental (implemented; do not rely on)

- Cropped images on anything other than the tested case; the statistic of a crop varies unpredictably
  with its offset (issue #20).
- "Non-match supported", now limited to devices declared conventional; its threshold is an engineering
  choice.
- The same-model control rule for computational devices.
- Fingerprints from fewer than 30 references or from natural images (measured on four phones only).
- Delta-sPCE (information only).
- Enrolment screening against several foreign images (issue #21).
- The Vercel deployment's 300-second job limit with full-resolution photographs (issue #7).

### Not validated

- **Detecting a match on recent smartphones**: 15% missed overall, 0% to 97% per device; not predictable
  from metadata.
- **Distinguishing units of the same recent model**: no usable data obtained (issue #5).
- Dedicated cameras.
- HDR, portrait, night and other computational modes as controlled conditions.
- Images from messaging and social platforms (resized, therefore unsupported).
- Quality flags as predictors of failure.

### Blocked (outside the project)

- Patent freedom-to-operate and the choice of a licence (issue #8).
- A lawyer's review of LGPL obligations and of using a port of non-commercial code as a test oracle.
- Independent replication and an external penetration test.

## Open items

| Issue | Item | Severity |
|---|---|---|
| #5 | Same-model validation on recent phones | High for any use on modern devices |
| #20 | Wavelet-grid sensitivity of the statistic | Medium |
| #21 | Screening misses groups of foreign reference images | Medium |
| #8, #23 | Licence, patents, third-party notices | Blocks distribution |
| #22 | Breached-password check; audit of downloads; audit-log retention | Low |
| #9 | Multi-factor authentication, self-service password reset | Low for private use |
| #7 | Vercel job time limit | Low for local use |
| #6 | Cause of undetectable images (Huawei P9 and four recent phones) | Research |
| — | `effective_pce` saturates for strongly negative values (F-09); candidate count not charged in the evaluation (F-14) | Low, documented |

## Test evidence at the audited commit

| Suite | Result |
|---|---|
| Engine (unit, regression, reference cross-check, independent audit tests) | 143 passed, 3 expected failures that document open findings F-06, F-07, F-09 |
| Backend integration (incl. 17 security audit tests) | 130 passed |
| Browser end-to-end against the rebuilt stack | see the pull request checks |
| End-to-end with authentic photographs | 28 / 28 checks |
| `pip-audit` (engine, backend); `npm audit --omit=dev` | No known vulnerabilities |
| Lint, formatting, type checks | Clean |

## Conditions for use

1. Describe results as statistical indications under a stated, uncalibrated policy. Never as
   identification, proof or probability.
2. Treat "inconclusive" as the expected answer for recent smartphones unless same-model controls are
   enrolled, and treat a low statistic as uninformative for them.
3. Declare a device "conventional" only for dedicated cameras and phones without multi-frame processing;
   that declaration is what permits match and non-match conclusions without controls.
4. Assemble reference sets from one device, one lens and one mode; screening does not guarantee it.
5. Do not claim forensic certification or courtroom admissibility.
