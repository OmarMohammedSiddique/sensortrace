# Architecture

SensorTrace is a modular monolith: a standalone scientific engine, an API with background workers, and a
web application. Decisions and their reasons are recorded in `docs/decisions/`.

## System overview

```mermaid
flowchart LR
    user([Investigator's browser])
    client([API client / script])

    subgraph compose[Docker Compose or equivalent]
        web[Web application<br/>Next.js]
        api[API<br/>FastAPI]
        worker[Worker<br/>RQ + engine]
        sched[Scheduler<br/>retention purge]
        db[(PostgreSQL)]
        redis[(Redis<br/>queue + rate limits)]
        s3[(Object storage<br/>S3-compatible)]
    end

    user -- HTTPS --> web
    web -- "/api/v1 proxy (same origin)" --> api
    client -- "Bearer token" --> api
    api --> db
    api --> redis
    api --> s3
    worker --> db
    worker --> redis
    worker --> s3
    sched --> db
    sched --> s3
```

Only the web application (and optionally the API) is reachable from outside. The worker has no listening
port. The object store is reachable only from the API, the worker and the scheduler.

## Repository layout

| Path | Contents |
|---|---|
| `engine/` | `sensortrace_engine` Python package: algorithms, decision policy, evaluation, CLI, tests |
| `engine/evaluation/` | Evaluation manifests (which devices, which split) |
| `backend/app/` | API: `routers/`, `models.py`, `schemas.py`, `jobs.py`, `storage.py`, `reports.py`, `security.py`, `deps.py` |
| `backend/alembic/` | Database migrations |
| `backend/policies/` | Optional calibrated decision policies (JSON) loaded at start |
| `backend/tests/` | Integration tests against real PostgreSQL, Redis and object storage |
| `frontend/` | Next.js web application and Playwright end-to-end tests |
| `docs/` | ADRs, research notes, OpenAPI document |
| `scripts/` | Dataset and reference-implementation fetch scripts |
| `data/`, `storage/` | Local datasets, evaluation output and development storage. Never committed |

## Engine

The engine has no knowledge of users, databases or HTTP. Everything is plain functions and data classes.

```mermaid
flowchart TD
    bytes[File bytes] --> ingest[ingest.py<br/>verify, hash, decode, metadata]
    ingest --> quality[quality.py<br/>quality and processing flags]
    ingest --> residual[residual.py + denoise.py<br/>noise residual]

    subgraph enrolment
        refs[Reference images] --> screen[enrol.py<br/>screen and group]
        screen --> acc[fingerprint.py<br/>ML estimator, diagnostics]
        acc --> fp[(Fingerprint<br/>.npz + digest)]
    end

    residual --> match[matching.py<br/>NCC, signed PCE, geometry]
    fp --> match
    match --> decide[decision.py<br/>policy, same-model alternative]
    quality --> decide
    decide --> result[pipeline.py<br/>ranked candidates + summary]

    eval[evaluation.py + stats.py<br/>calibration, ROC, intervals] -. produces .-> policy[Calibrated policy JSON]
    policy -. optional .-> decide
```

Stable entry points: `ingest_image`, `enrol`, `analyse_questioned`, `Fingerprint.to_bytes/from_bytes`,
`DecisionPolicy`, and the `sensortrace` CLI (`enrol`, `compare`, `evaluate`). Every artefact records
`ALGORITHM_VERSION`; the version must change when numerical output changes.

## Data model

```mermaid
erDiagram
    USER ||--o{ SESSION : has
    USER ||--o{ API_TOKEN : has
    USER ||--o{ DEVICE : owns
    DEVICE ||--o{ SENSOR : contains
    SENSOR ||--o{ REFERENCE_IMAGE : has
    SENSOR ||--o{ FINGERPRINT : "has versions"
    USER ||--o{ INVESTIGATION : owns
    INVESTIGATION ||--o{ EVIDENCE : contains
    INVESTIGATION ||--o{ NOTE : has
    EVIDENCE ||--o{ ANALYSIS : "is compared in"
    INVESTIGATION ||--o{ ANALYSIS : "may hold"
    ANALYSIS ||--o{ ANALYSIS_CANDIDATE : "ranks"
    FINGERPRINT ||--o{ ANALYSIS_CANDIDATE : "compared as"
    ANALYSIS ||--o{ REPORT : "documented by"
    INVESTIGATION ||--o{ REPORT : "summarised by"
    USER ||--o{ JOB : runs
    USER ||--o{ DATA_EXPORT : requests
    USER ||--o{ AUDIT_LOG : generates

    DEVICE { uuid id string make string model string pipeline_class bool is_demo }
    SENSOR { uuid id string name uuid active_fingerprint_id }
    REFERENCE_IMAGE { uuid id string sha256 json quality string object_key }
    FINGERPRINT { uuid id int version string status string digest string algorithm_version json diagnostics }
    INVESTIGATION { uuid id string title string status datetime retention_until }
    EVIDENCE { uuid id string sha256 string category json acquisition json provenance string object_key }
    ANALYSIS { uuid id string status json policy json summary json provenance }
    ANALYSIS_CANDIDATE { uuid id int rank string verdict float pce float effective_pce json measurement json decision json snapshot }
    JOB { uuid id string kind string status float progress bool cancel_requested int attempts }
    REPORT { uuid id string sha256 string object_key }
    AUDIT_LOG { bigint id string action string entity_type json details }
```

Notes:

- Every user-owned table carries `user_id`. Every read and write goes through `deps.owned()`, which
  returns the same 404 for a missing row and for another user's row.
- `ANALYSIS_CANDIDATE.snapshot` copies the sensor, device and fingerprint details at the time of the
  comparison, so a result stays interpretable if the sensor is later renamed or deleted.
- A fingerprint is immutable once ready. Rebuilding creates a new version; one version is active.
- Evidence may exist without an investigation (uploaded in the comparison laboratory) and be saved into
  one later.
- `AUDIT_LOG` is append-only and is not a foreign key to users, so the fact of an account deletion can
  be recorded after the account is gone. Personal audit entries are removed with the account.

## Storage

| Bucket | Contents | Written | Key pattern |
|---|---|---|---|
| `evidence` | Original uploaded bytes (evidence and reference images) | Once, never modified | `<user>/<kind>/<uuid>.<ext>` |
| `derived` | Previews, fingerprints (`.npz`), visualisations | By the API and the worker | `<user>/<kind>/<uuid>` |
| `results` | PDF reports, data exports | By the API and the worker | `<user>/<kind>/<uuid>` |

Keys are generated by the server. User-supplied filenames are stored only as sanitised display text.
Nothing is publicly readable. Files are served by `GET /api/v1/files/{token}`: the token is an
HMAC-signed, five-minute grant bound to one object and one user, and the request must also be
authenticated as that user. Uploaded originals are always sent as attachments with a generic content
type; only server-generated previews and visualisations render inline.

## Background jobs

```mermaid
sequenceDiagram
    participant W as Web app
    participant A as API
    participant D as PostgreSQL
    participant Q as Redis queue
    participant K as Worker (forked per job)
    participant S as Object storage

    W->>A: POST /sensors/{id}/fingerprints
    A->>D: insert fingerprint (pending) + job (queued)
    A->>Q: enqueue job id
    A-->>W: 202 {fingerprint, job}
    K->>Q: dequeue
    K->>D: job running
    loop each reference image
        K->>S: read original bytes
        K->>D: progress, check cancel flag
    end
    K->>S: write fingerprint + visualisations
    K->>D: fingerprint ready, job succeeded, audit entry
    W->>A: GET /jobs/{id} (poll)
    A-->>W: status, stage, progress
```

- Job kinds: `fingerprint`, `analysis`, `export`.
- The `jobs` table is the source of truth; Redis only carries the queue.
- Cancellation sets a flag that the engine checks between images. A queued job is cancelled immediately.
- Engine errors (bad input) fail at once with a readable message. Unexpected errors are retried twice
  with back-off, then fail with a generic message; details go to the worker log only.
- Each job runs in a freshly forked process with a time limit; the worker container has memory, CPU and
  process limits, a read-only filesystem and no capabilities.

## Request path and authentication

- Browser: the web application proxies `/api/v1/*` to the API, so the browser sees one origin. The
  session is an HttpOnly, SameSite=Lax cookie holding an opaque token (stored hashed). State-changing
  requests must carry the session's CSRF token in `X-CSRF-Token`.
- Programmatic: `Authorization: Bearer st_…` API tokens (stored hashed, revocable, optional expiry). No
  CSRF header is needed; session-only actions (creating tokens, changing the password, deleting the
  account) are refused.
- Rate limits (Redis counters) apply per IP and per account to authentication, and per account to the
  API and to uploads.

## End-to-end workflows

**Enrol a sensor.** Create a device (declaring its processing pipeline) → add a sensor → upload reference
images (each validated, hashed, quality-assessed, previewed) → start a fingerprint job → review accepted
and rejected references, diagnostics and visualisations → the new version becomes active.

**Investigate an image.** Create an investigation → upload evidence with acquisition details → choose
sensors to compare against (include same-model control devices where they exist) → start the comparison
→ review ranked candidates, measurements, reasons, caveats and quality flags → generate the PDF report →
add notes → export or delete.

**Evaluate and calibrate.** Download an evaluation dataset → run `sensortrace evaluate` → review
`report.md` → optionally install the generated `policy.json` in `backend/policies/` to make the
calibrated policy selectable, within its stated scope.

## Extending

- **New algorithm or parameter:** change the engine, bump `ALGORITHM_VERSION`, add regression tests,
  re-run the evaluation. Old results keep their recorded version.
- **New image format:** add a decoder path in `ingest.py` with tests and a licence review.
- **New client (CLI, desktop):** use the engine directly or the REST API (`docs/api/openapi.json`).
- **Future modules** (video, manipulation localisation, scale search) belong in the engine as separate
  modules with their own validation; none exists yet.
