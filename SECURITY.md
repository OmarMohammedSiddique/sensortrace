# Security and privacy

Uploaded evidence and camera fingerprints are sensitive. A fingerprint can link photographs to a
physical device, and evidence may concern real people. This document states what protects them, what
has been tested, and what an operator must do.

## Reporting a vulnerability

Report privately to the repository owner (GitHub: private vulnerability report on the repository).
Do not open a public issue for a suspected vulnerability.

## Responsible use

SensorTrace is for analysing your own material or material you are authorised to investigate.

- There is **no public or shared directory of fingerprints**. A fingerprint is visible only to the
  account that created it.
- There is **no internet-wide matching** and no feature that searches images across accounts.
- **No third-party network calls**; fonts are self-hosted. A self-hosted installation collects no
  usage data. The hosted Vercel deployment records aggregate, cookieless page views and page-load
  performance (Vercel Web Analytics and Speed Insights), sent to the site's own address; it is enabled
  only when the `VERCEL` environment variable is present.
  Uploaded images and fingerprints never leave the deployment's own storage.
- Results are statistical indications with stated limitations (SCIENTIFIC_METHODOLOGY.md). The software
  makes no claim of forensic certification or courtroom admissibility.

## Controls

### Authentication and sessions

| Control | Implementation |
|---|---|
| Password storage | Argon2id (argon2-cffi defaults), automatic re-hash when parameters change |
| Password policy | 10–256 characters, not a common password, not the email address, at least 5 distinct characters |
| Account enumeration | Login returns one message for unknown account and wrong password; a dummy hash is verified for unknown accounts so timing is similar. Registration with an existing email returns a generic failure |
| Sessions | Opaque random token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production), stored only as a SHA-256 hash, 12-hour lifetime, listable and revocable. A password change revokes every other session |
| CSRF | State-changing requests authenticated by cookie must carry the session's CSRF token in `X-CSRF-Token` (constant-time comparison). CORS allows only configured origins |
| API tokens | `Bearer st_…`, shown once, stored hashed, revocable, optional expiry. Cannot create tokens, change the password or delete the account |
| Rate limiting | Redis counters: authentication per IP and per email (fails closed if Redis is unavailable), API requests and uploads per account |
| Roles | The first registered account is the administrator. Administrator endpoints expose configuration and aggregate counts only, never other users' content |

There is no email-based password reset (the product sends no email). An operator can reset a password
with `python -m app.cli reset-password <email>`, which also revokes the account's sessions and tokens.

### Authorisation

- Investigations, evidence, sensors, fingerprints, analyses, reports, jobs and exports are private to
  their owner. There is no sharing feature.
- Every row carries `user_id`, and every access goes through one function that returns the same
  `404 Not Found` for a missing object and for another user's object (no existence leak).
- Cross-references are checked too: evidence cannot be attached to, or analysed against, another user's
  investigation, sensor or fingerprint.

### Files

- **Content validation.** File type comes from magic bytes and a real decode. Only JPEG and PNG are
  accepted. Client-declared types and extensions are ignored.
- **Limits.** 64 MB per file, 512 MB per request (a declared `Content-Length` is required), 60 files per
  request, 80 megapixels per image checked from the header before decoding, 300 reference images per
  sensor, a per-account storage quota (5 GB by default) and a cap on concurrent jobs.
- **Filenames** are kept only as sanitised display text. Storage keys are server-generated.
- **Private storage.** No bucket is public. Files are served only by the API through signed tokens that
  expire after five minutes and are bound to one object and one user; the request must also be
  authenticated as that user.
- **No active content.** Uploaded originals are always returned as attachments with
  `application/octet-stream`, `X-Content-Type-Options: nosniff` and a sandboxing Content-Security-Policy.
  Only server-generated previews and visualisations are displayed inline. Previews carry no metadata.
- **Evidence integrity.** Original bytes are stored unmodified with their SHA-256.

### Processing isolation

- Image decoding and analysis run only in the worker, which has no listening port.
- RQ forks a new process for each job, with a time limit. A crash or memory exhaustion in one job cannot
  affect another user's job.
- In the Compose deployment the API, worker and scheduler run as a non-root user with a read-only root
  filesystem, all Linux capabilities dropped, `no-new-privileges`, and (worker) memory, CPU and process
  limits. An optional per-job address-space limit is available (`ST_WORKER_MEMORY_LIMIT_MB`).
- Unexpected errors are logged in the worker; users see a generic message.

### Web

- API responses: `Content-Security-Policy: default-src 'none'`, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and HSTS
  when secure cookies are enabled.
- The web application sets its own strict Content-Security-Policy and renders all user-supplied text as
  text.
- Database access uses SQLAlchemy with bound parameters throughout; search inputs are escaped for `LIKE`.
- Request bodies reject unknown fields, so privileged attributes cannot be set by mass assignment.
- The interactive API documentation page is disabled in production (it loads assets from a CDN).

### Audit, retention, export and deletion

- **Audit log.** Sign-ins and failures, uploads, fingerprint and analysis jobs, report generation,
  exports, deletions and security changes are recorded with time and source address. Secrets, passwords
  and image content are never written to it.
- **Retention.** Each investigation can carry a retention date (with a per-account default). The
  scheduler permanently deletes expired investigations, expired exports and old sessions.
- **Export.** An account or a single investigation can be exported as a ZIP of records (JSON) and
  original files. Internal storage keys and credential hashes are excluded. The archive link expires
  after seven days.
- **Deletion.** Deleting evidence, a sensor, a device, an investigation or the account removes the rows
  and the stored objects (originals, previews, fingerprints, visualisations, reports). Account deletion
  requires the password and a typed confirmation and is irreversible. Backups made by the operator are
  outside the application's control.

### Secrets and configuration

- All configuration is by environment variable (`.env.example`). `.env` files are git-ignored.
- In production the API refuses to start with the development secret key, a short key, insecure cookies
  or inline job execution.
- The secret key signs file tokens; rotating it invalidates outstanding file links only.

## Testing performed

Automated, in `backend/tests/` (run against real PostgreSQL, Redis and object storage):

| Area | Tests |
|---|---|
| Authentication | Registration, login, logout, weak and duplicate passwords, cookie flags, CSRF enforcement, session revocation, password change, API tokens, login rate limiting, closed registration, admin restriction |
| Authorisation (IDOR) | 12 read endpoints and 25 write endpoints attempted by a second user against every object type; list isolation; cross-tenant references; owner data verified intact afterwards |
| Signed file access | Wrong user, anonymous, tampered payload, tampered signature, forged key, expiry; originals never inline |
| Upload abuse | Scripts, executables, HTML, SVG, GIF, PDF, ZIP, HEIC, empty, truncated, decompression bombs, undersized images, polyglot JPEG, hostile filenames (traversal, markup, NUL, over-long), size, count, request and quota limits, missing length |
| Injection | SQL metacharacters and `LIKE` wildcards treated as data |
| Jobs | Real queue execution, cancellation (queued and running), retry and failure without leaking internal details, concurrency limit |
| Deletion and export | Stored objects verified removed; export contents verified; account deletion verified in database and storage |
| Storage | Path traversal refused; S3 round-trip; unauthenticated bucket access refused |

Dependency audits (`pip-audit`, `npm audit`), a static scan (`bandit`) and a container image scan (Trivy)
are part of CI or the release checklist. Results at the time of writing are in PROJECT_STATUS.md.

## Operator responsibilities

1. Serve the application over HTTPS behind a reverse proxy; set `ST_COOKIE_SECURE=true` and a random
   `ST_SECRET_KEY`.
2. Change every default credential in `.env` (database, object store).
3. `ST_TRUST_FORWARDED_FOR` is off by default, so all browsers share one per-address rate-limit
   bucket (the web proxy's address) and the per-account limit does the real work. Turn it on only
   behind a reverse proxy that overwrites `X-Forwarded-For`: the web application passes a
   client-supplied header through, so trusting it without such a proxy lets a client evade the
   per-address limit (verified in testing).
4. Set `ST_ALLOW_REGISTRATION=false` once the intended accounts exist.
5. Encrypt the database and object-store volumes at rest and back them up; restrict who can read them.
6. Keep images and dependencies patched; run the CI security job.

## Known gaps

- No multi-factor authentication and no single sign-on.
- No email verification or self-service password reset.
- No per-organisation sharing or roles beyond user and administrator.
- Storage is not encrypted by the application; encryption at rest is left to the storage layer.
- No malware scanning of uploads (files are decoded as images and never executed or served inline).
- The object store and database credentials in the development Compose file are defaults and must be
  changed for any shared deployment.
- No independent penetration test has been performed.
