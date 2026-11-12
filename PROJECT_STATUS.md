# Project status

Last updated: 2026-11-12. Algorithm `prnu-wavelet-mle-1.0`, decision logic `policy-1.0`.

Status values: **Verified** (exercised by an automated test or a recorded manual run, evidence cited) ·
**Implemented, unverified** · **In progress** · **Experimental** (works, insufficiently validated) ·
**Blocked** · **Not started**. Only *Verified* counts toward the definition of done.

## Definition of done

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Application starts locally from documented instructions | In progress | Backend services run under Compose; web container pending |
| 2 | Register and sign in securely | Verified (API) | `backend/tests/test_auth.py` |
| 3 | Create a private investigation | Verified (API) | `test_workflow.py`, `test_authorization.py` |
| 4 | Register a camera sensor | Verified (API) | `test_workflow.py` |
| 5 | Upload multiple reference images | Verified (API) | `test_workflow.py`, `test_uploads.py` |
| 6 | Genuine, reusable PRNU fingerprint | Verified | Engine tests; real images in evaluation enrolment; `test_fingerprint_is_created_and_reusable` |
| 7 | Upload a questioned photograph | Verified (API) | `test_workflow.py` |
| 8 | Real matching measurements | Verified | Engine tests, reference cross-check, real-image runs |
| 9 | Results distinguish match, non-match, inconclusive | Verified | `test_decision_pipeline.py`, `test_workflow.py` |
| 10 | Inspect measurements and limitations | In progress | API verified; UI pending |
| 11 | Accurate PDF reports | Verified (API) | `test_full_investigation_workflow` parses the PDF and checks hashes, numbers and caveats |
| 12 | Data persists correctly | Verified (API) | Fresh-session checks in `test_workflow.py`; migration test |
| 13 | Core APIs work and are documented | Verified | `test_jobs_contract.py::test_openapi_document_covers_the_public_surface`, `docs/api/` |
| 14 | Automated tests and CI pass | In progress | Local suites pass; CI not yet run on GitHub |
| 15 | Evaluation framework runs reproducibly | In progress | Running on VISION subset |
| 16 | Security and privacy controls tested | Verified (API) | See SECURITY.md "Testing performed" |
| 17 | Operable through Docker Compose | In progress | API, worker, scheduler, database, Redis, object store verified; web pending |
| 18 | Responsive, accessible, coherent UI | In progress | |
| 19 | Documentation matches implementation | In progress | |
| 20 | No known release-blocking defects | In progress | |

*This file is rewritten at the end of each phase; see the bottom for the detailed checklist.*
