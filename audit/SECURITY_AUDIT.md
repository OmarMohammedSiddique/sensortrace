# SensorTrace: independent application security audit

Date: 2026-11-12. Branch: `audit/independent-review` (working tree, nothing committed).

## 1. Scope, method and environment

**In scope.** FastAPI backend (`backend/app`), Next.js frontend (`frontend/src`, including the API proxy
`frontend/src/app/api/v1/[...path]/route.ts` and `next.config.ts`), background jobs, object storage, PDF
reports, the Vercel mode (`ST_JOB_DISPATCH=http`, `routers/internal.py`, `VercelBlobStorage`, `vercel.json`)
and the operator command in `backend/app/cli.py`. `engine/` was read only (decoder safety in `ingest.py`);
nothing under it was changed by this audit. `docker-compose.yml` was not changed.

**Method.** Code review of every backend module and every router, then black-box attack of the running
stack with accounts created for the audit (`*@audit-sensortrace.dev`), using `httpx`, raw sockets, `boto3`
and a real browser. OWASP Top 10 / ASVS used as the checklist. Every finding below was reproduced before it
was written down; each fix has a test that failed before the change and passes after it.

**Environments.**

| Environment | Use |
|---|---|
| Local Docker stack: web `localhost:3100`, API `127.0.0.1:8100`, Postgres, Redis, SeaweedFS S3 `127.0.0.1:9100` | All attacks and reproductions. |
| Current source run locally (`uvicorn` on `127.0.0.1:8111`, `next dev` on `localhost:3111`) against the same database, Redis and object store | Confirming fixes with live requests. |
| `https://sensortrace.vercel.app` | Read-only GETs of public pages and unauthenticated endpoints, one unsigned POST to the internal job endpoint. No account, no brute force, no load, no other Vercel resource. |

**Limits of the test environment that matter for reading this report.**

- The running Docker images were built **before** the Vercel-mode changes: `routers/internal.py` is not in
  the running API image, and `config.py`, `jobs.py`, `main.py`, `storage.py`, `policies.py`,
  `routers/analyses.py`, `routers/auth.py`, `routers/meta.py` differ from the working tree (compared by
  SHA-256 of each file inside the container). Everything about the internal job endpoint, the cron endpoint
  and http dispatch was therefore tested in-process (pytest `TestClient`), not against the container.
- The stack was not rebuilt. Fixes were verified by the test suite, and additionally by running the current
  source next to the stack (ports 8111 / 3111). Which is which is stated per finding.
- `VercelBlobStorage` was reviewed but not exercised: there is no local Vercel Blob, and the public store
  was out of bounds.
- After the audit the local stack was returned to zero users and zero stored objects (every audit account
  was deleted through the API). 198 anonymous `audit_log` rows remain (failed sign-ins for unknown addresses,
  account deletions).

## 2. Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| F-01 | High | One small upload freezes the whole API for 20-37 s (image decoding on the event loop) | Fixed |
| F-02 | High | Request bodies of hundreds of MB are read before authentication; no limit on JSON or DELETE bodies | Fixed |
| F-03 | Medium | 100 concurrent requests from one account deadlock the connection pool: 60 s outage, 500s | Fixed |
| F-04 | Medium | Export archives keep the original files of deleted and retention-purged investigations | Fixed (behaviour change, see finding) |
| F-05 | Medium | Open redirect through `?next=` on the sign-in page | Fixed |
| F-13 | Medium | Sign-in rate limiter: one client locks everybody out (default), or is bypassed (trusted header) | Not fixed: deployment decision |
| F-06 | Low | Hosted analytics receives record identifiers and query strings | Fixed |
| F-07 | Low | Behind the web proxy, API and file responses lose their strict Content-Security-Policy | Fixed |
| F-08 | Low | NUL byte in the sign-in email or in search filters gives 500 | Fixed |
| F-09 | Low | Non-ASCII CSRF / internal / cron header gives 500 | Fixed |
| F-10 | Low | File tokens are not bound to the owner's key prefix (cross-account read with a leaked or default key) | Fixed |
| F-11 | Low | http dispatch: a repeated or concurrent internal call runs the same job twice | Fixed |
| F-14 | Low | The published development secret is in use unless `ST_ENVIRONMENT=production` is set | Not fixed: Compose file / operator decision |
| F-15 | Low | Active-job limit can be exceeded by concurrent requests | Not fixed: reported |
| F-16 | Low | Report generation fails with 500 on long (valid) text fields | Not fixed: report-content decision |
| F-17 | Low | API tokens survive a password change and can revoke sessions and start exports | Not fixed: product decision |
| F-18 | Low | Password blocklist has 11 entries | Not fixed: product decision |
| F-19 | Low | Downloads are not audited; the audit log is never purged | Not fixed: product decision |
| F-20 | Low | `npm audit --omit=dev`: 6 advisories through the `shadcn` runtime dependency | Not fixed: dependency decision |
| F-12 | Info | Export deletion not audited; the anonymous account-deletion record keeps the source address | Fixed |
| F-21 | Info | Documentation and configuration inaccuracies | Reported |

No authorisation defect (IDOR), no CSRF gap, no injection (SQL, PDF markup, XSS, header) and no
unauthenticated access to storage was found. The defects found are in availability, deletion, the sign-in
redirect and telemetry privacy.

## 3. Route-by-route authorisation matrix

Generated from the application's real route table (`app.routes`, walking FastAPI's included routers, so
routes hidden from OpenAPI are included): 74 routes. For each route the script checked whether `get_auth`
is in the dependency tree, sent the request with no credentials to the running API, and then repeated every
route that takes an object id as a second ordinary user ("Other user") and as the administrator, using the
ids of a fully populated account (devices, sensors, 40 reference images, fingerprints, investigation,
evidence, analyses, notes, two reports, an export, a session and an API token). 76 cross-account attempts:
76 x `404`, and the victim's data was verified intact afterwards.

Result: 68 routes require authentication; the 6 that do not are the intended ones (`/health`, `/meta`,
`/auth/register`, `/auth/login`, and the two `/internal/*` routes, which require a server secret).

| Method | Path | Auth dependency | Anonymous | Object-level rule | Other user | Admin on other user's object |
|---|---|---|---|---|---|---|
| DELETE | `/account` | get_auth | 401 not_authenticated | caller only; session + password + typed confirmation | n/a | n/a |
| GET | `/account/audit` | get_auth | 401 not_authenticated | `user_id` filter | n/a | n/a |
| POST | `/account/export` | get_auth | 401 not_authenticated | caller's data only (job re-reads by `user_id`) | n/a | n/a |
| GET | `/account/exports` | get_auth | 401 not_authenticated | `user_id` filter | n/a | n/a |
| DELETE | `/account/exports/{export_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/account/usage` | get_auth | 401 not_authenticated | `user_id` filter | n/a | n/a |
| GET | `/admin/config` | get_auth | 401 not_authenticated | admin role (user: 403); configuration only | n/a | n/a |
| GET | `/admin/stats` | get_auth | 401 not_authenticated | admin role (user: 403); aggregate counts only | n/a | n/a |
| GET | `/analyses` | get_auth | 401 not_authenticated | `user_id` filter; foreign filters return 0 rows | n/a | n/a |
| POST | `/analyses` | get_auth | 401 not_authenticated | body `evidence_ids`, `sensor_ids`, `fingerprint_ids`, `investigation_id` each checked with owned() (foreign: 404) | n/a | n/a |
| DELETE | `/analyses/{analysis_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/analyses/{analysis_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| PATCH | `/analyses/{analysis_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches; body `investigation_id` also owned() | 404 | 404 |
| POST | `/analyses/{analysis_id}/reports` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| POST | `/auth/login` | none (public) | 422 validation_error | public by design; auth rate limit (IP + email) | n/a | n/a |
| POST | `/auth/logout` | get_auth | 401 not_authenticated | acts on the caller's session only | n/a | n/a |
| GET | `/auth/me` | get_auth | 401 not_authenticated | caller only | n/a | n/a |
| PATCH | `/auth/me` | get_auth | 401 not_authenticated | caller only; role/email/quota not settable (422) | n/a | n/a |
| POST | `/auth/password` | get_auth | 401 not_authenticated | caller only; session required (token: 403); current password | n/a | n/a |
| POST | `/auth/register` | none (public) | 422 validation_error | public by design; auth rate limit | n/a | n/a |
| GET | `/auth/sessions` | get_auth | 401 not_authenticated | `user_id` filter | n/a | n/a |
| DELETE | `/auth/sessions/{session_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/auth/tokens` | get_auth | 401 not_authenticated | `user_id` filter | n/a | n/a |
| POST | `/auth/tokens` | get_auth | 401 not_authenticated | session required (token: 403) | n/a | n/a |
| DELETE | `/auth/tokens/{token_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/dashboard` | get_auth | 401 not_authenticated | every query filtered by `user_id` | n/a | n/a |
| DELETE | `/demo` | get_auth | 401 not_authenticated | `user_id` + `is_demo` filter | n/a | n/a |
| POST | `/demo` | get_auth | 401 not_authenticated | creates rows for caller | n/a | n/a |
| GET | `/devices` | get_auth | 401 not_authenticated | `user_id` filter | n/a | n/a |
| POST | `/devices` | get_auth | 401 not_authenticated | creates for caller | n/a | n/a |
| DELETE | `/devices/{device_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/devices/{device_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| PATCH | `/devices/{device_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| POST | `/devices/{device_id}/sensors` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/evidence` | get_auth | 401 not_authenticated | `user_id` filter; foreign `investigation_id` filter returns 0 rows | n/a | n/a |
| POST | `/evidence` | get_auth | 401 not_authenticated | form `investigation_id` checked with owned() (foreign: 404) | n/a | n/a |
| DELETE | `/evidence/{evidence_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/evidence/{evidence_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| PATCH | `/evidence/{evidence_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches; body `investigation_id` also owned() | 404 | 404 |
| GET | `/files/{token}` | get_auth | 401 not_authenticated | signed token bound to user id; now also to the owner's key prefix (F-10) | n/a | n/a |
| DELETE | `/fingerprints/{fingerprint_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/fingerprints/{fingerprint_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| POST | `/fingerprints/{fingerprint_id}/activate` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/health` | none (public) | 200 | public by design; dependency booleans only | n/a | n/a |
| POST | `/internal/jobs/{job_id}/run` | none (secret header) | 404 (in-process test; route absent from the running image) | per-job HMAC of the server secret; a user session is not sufficient | n/a | n/a |
| GET | `/internal/maintenance` | none (secret header) | 404 (in-process test; route absent from the running image) | `CRON_SECRET` bearer; 404 when unset | n/a | n/a |
| GET | `/investigations` | get_auth | 401 not_authenticated | `user_id` filter | n/a | n/a |
| POST | `/investigations` | get_auth | 401 not_authenticated | creates for caller | n/a | n/a |
| DELETE | `/investigations/{investigation_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/investigations/{investigation_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| PATCH | `/investigations/{investigation_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| POST | `/investigations/{investigation_id}/export` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/investigations/{investigation_id}/history` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/investigations/{investigation_id}/notes` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| POST | `/investigations/{investigation_id}/notes` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| POST | `/investigations/{investigation_id}/reports` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/jobs` | get_auth | 401 not_authenticated | `user_id` filter | n/a | n/a |
| GET | `/jobs/{job_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| POST | `/jobs/{job_id}/cancel` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/meta` | none (public) | 200 | public by design; versions, limits, guidance | n/a | n/a |
| DELETE | `/notes/{note_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/policies` | get_auth | 401 not_authenticated | global, non-sensitive | n/a | n/a |
| DELETE | `/references/{reference_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/reports` | get_auth | 401 not_authenticated | `user_id` filter; foreign filters return 0 rows | n/a | n/a |
| DELETE | `/reports/{report_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/reports/{report_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/sensors` | get_auth | 401 not_authenticated | `user_id` filter | n/a | n/a |
| DELETE | `/sensors/{sensor_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/sensors/{sensor_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| PATCH | `/sensors/{sensor_id}` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/sensors/{sensor_id}/fingerprints` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| POST | `/sensors/{sensor_id}/fingerprints` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| GET | `/sensors/{sensor_id}/references` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |
| POST | `/sensors/{sensor_id}/references` | get_auth | 401 not_authenticated | owned(): row loaded only if `user_id` matches | 404 | 404 |

Cross-referenced ids were tested separately as the second user, each returning `404` (or an error that
reveals nothing about the foreign object): evidence upload with a foreign `investigation_id` form field;
`PATCH /evidence/{id}` with a foreign `investigation_id`; `POST /analyses` with a foreign `sensor_ids`,
`fingerprint_ids`, `evidence_ids` or `investigation_id`; list filters `?investigation_id=`, `?evidence_id=`,
`?analysis_id=` with foreign ids (0 rows). The administrator endpoints return configuration and four
aggregate numbers only. Mass assignment was tested on `PATCH /auth/me` (`role`, `email`,
`storage_quota_bytes`, `is_active`, `settings`), `PATCH /evidence/{id}` (`sha256`, `filename`,
`size_bytes`, `user_id`, `is_demo`, `object_key`, `provenance`, `image_metadata`) and
`PATCH /analyses/{id}` (`status`, `summary`, `candidates`, `policy`): all `422`.

## 4. Findings

Reproductions are the actual requests and responses observed on the local stack unless stated otherwise.
Tests are in `backend/tests/test_audit_security.py` and `frontend/e2e/audit-security.spec.ts`.

### F-01 (High) One small upload freezes the whole API

*Severity: any signed-in account can make the API unresponsive for every user with one request of a few
hundred kilobytes, and repeat it at will.*

**Component.** `routers/investigations.py::upload_evidence`, `routers/devices.py::upload_references`,
`services.py`.

**Cause.** Both upload handlers are `async def` and called `ingest_upload()` and `store_image()` directly.
Decoding, quality assessment and preview scaling of a large image are tens of seconds of CPU, executed on
the event loop, so no other request is served meanwhile. SECURITY.md states that "image decoding and
analysis run only in the worker"; that is not what the code does.

**Reproduction.** A valid 8900 x 8900 PNG of zeros (79 megapixels, under the 80 MP limit) is 231,048
bytes. One file per request, while a second client polls the public `GET /api/v1/meta`:

```
POST /api/v1/evidence  (1 file, 231 048 bytes, 8-bit RGB PNG)    -> 200 after 21.6 s
  concurrent GET /api/v1/meta from another client: max latency 21.57 s
POST /api/v1/evidence  (1 file, 615 982 bytes, 16-bit RGBA PNG)  -> 200 after 36.7 s
  concurrent GET /api/v1/meta from another client: max latency 36.71 s
baseline small JPEG: 0.2 s
```

A request may carry 60 files, so one request is roughly half an hour of outage.

**Fix.** Decoding and preview generation run in a worker thread, at most two at a time
(`services.run_heavy`); each account may have at most three upload requests in progress
(`deps.upload_slot`, `429 too_many_uploads`; the web client uploads its batches one after another).
Tests: `test_f01_evidence_decoding_runs_off_the_event_loop`,
`test_f01_reference_decoding_runs_off_the_event_loop`, `test_f01_parallel_uploads_per_account_are_bounded`.
Live check on the fixed source (port 8111): the same 79 MP upload completes in 9.2 s while `/meta` stays at
0.17 s maximum over 34 probes.

**Residual.** Decoding still happens inside the API process (up to about 640 MB for one 16-bit RGBA image at
the pixel limit, two at a time). Moving validation to the worker, or a lower pixel limit for the API, is a
design change and was not made.

### F-02 (High) Request bodies are consumed before authentication

*Severity: unauthenticated; a handful of parallel requests exhaust the API's memory or its 1 GB `/tmp`
(a tmpfs, so also memory).*

**Component.** `main.py::guard`.

**Cause.** FastAPI reads and parses the body (JSON, or multipart spooled to `/tmp`) before it resolves the
route's dependencies, which is where authentication happens. The only limit was `ST_MAX_REQUEST_BYTES`
(512 MB), applied to every POST/PUT/PATCH including JSON routes, and not applied to DELETE at all.

**Reproduction** (raw sockets, no credentials):

```
POST /api/v1/auth/login   Content-Type: application/json   Content-Length: 314572802
  -> whole 300 MB body accepted, then 422 validation_error (9.4 s)
POST /api/v1/evidence     Content-Type: multipart/form-data   Content-Length: 419430513
  -> whole 400 MB body read and spooled, then 401 (10.4 s); container memory 286 MB -> 691 MB
DELETE /api/v1/account    Content-Type: application/json   Content-Length: 314572802
  -> whole 300 MB body accepted, then 401 (9.1 s); no size limit applies to DELETE
```

Checked and sound in the same area: chunked body without a length `411`; both `Content-Length` and
`Transfer-Encoding` `400`; negative length `400`; 1100 parts `400`; a 2 MB form field `400`.

**Fix.** Bodies that are not multipart are limited to `ST_MAX_JSON_BYTES` (new setting, 1 MiB); DELETE is
covered; multipart requests are authenticated (session and CSRF token, or API token) in the middleware
before any of the body is read. Tests: `test_f02_json_bodies_are_capped_far_below_the_upload_limit`,
`test_f02_anonymous_upload_is_refused_before_the_body_is_read` (asserts zero body reads). Live check on the
fixed source: the three requests above return `413`, `413` and `401` with 0 MB sent.

**Residual.** A signed-in account can still send 512 MB upload requests, which are spooled to `/tmp`
(1 GB). Uvicorn has no body read timeout, so slow-body connections are a matter for the reverse proxy.

### F-03 (Medium) Concurrent requests deadlock the connection pool

*Severity: one ordinary account, 100 cheap requests (well inside the 600/minute limit), a 60 s outage for
all users, repeatable.*

**Component.** `db.py` (pool of 10 + 10 connections) against the 40-thread pool that runs synchronous
dependencies and endpoints.

**Cause.** A request holds its database connection between thread-pool steps (dependency, endpoint,
session close). When more requests are in flight than there are connections, every worker thread is taken
by a request waiting for a connection, and the requests that hold the connections wait for a thread.
Nothing moves until the 30 s pool timeout.

**Reproduction.**

```
100 concurrent GET /api/v1/dashboard as one user -> {200: 20, 500: 80}, max latency 63.6 s
  another user's POST /api/v1/auth/login sent 0.5 s later -> 200 after 62.8 s
API log: sqlalchemy.exc.TimeoutError: QueuePool limit of size 10 overflow 10 reached
(45 concurrent: all 200 in 4.5 s; 100 anonymous requests with a random cookie: all 401 in 1.5 s)
```

**Fix.** The number of requests that may hold a database session is bounded below the pool size by a
semaphore taken in an async dependency (`db._db_slot`, `DB_CONCURRENCY = 16`); excess requests wait on the
event loop, using neither a thread nor a connection. Test:
`test_f03_concurrent_requests_do_not_deadlock_the_connection_pool` (before: `{200: 40, 500: 80}`).
Live check on the fixed source: 100 concurrent requests all `200`, slowest 3.6 s.

### F-04 (Medium) Export archives outlive the evidence they contain

*Severity: original evidence files stay downloadable after "permanent" deletion and after the retention
date; contradicts SECURITY.md and the privacy page.*

**Component.** `services.py::purge_*`, `jobs.py::purge_expired`, `routers/account.py::export_out`.

**Reproduction.** Account with an investigation of three evidence images, one investigation export and one
account export, then `DELETE /api/v1/investigations/{id}` -> `204`:

```
object store after deletion: evidence 0, derived 0, results 2      <- the two archives
GET /api/v1/account/exports -> [account, ready, 9 985 030 bytes], [investigation, ready, 896 990 bytes]
both links download; each ZIP still contains evidence/<id>_<sha>.jpg for all three deleted images
```

The retention purge calls the same function, so an investigation removed at its retention date leaves its
archive behind as well. The seven-day expiry of an archive was enforced only by the hourly purge; the
download link itself ignored `expires_at`.

**Fix.** `services.purge_exports`: permanently deleting evidence, an investigation, a reference image, a
fingerprint, a sensor, a device, an analysis or a report also deletes the account's archives that contain
it (that investigation's archives and whole-account archives), including archives still being built.
An expired archive no longer gets a download link. Tests:
`test_f04_deleting_an_investigation_removes_archives_that_contain_it`,
`test_f04_deleting_evidence_and_retention_purge_remove_archives`,
`test_f04_an_expired_export_has_no_download_link`. Verified by test only.

**Decision needed.** This changes behaviour: someone who exports, deletes data and only then tries to
download finds the archive gone. If "export, then delete" should keep the archive, the alternative is to
keep it and say so in the interface and in the privacy text; the retention purge should remove archives in
either case.

### F-05 (Medium) Open redirect on the sign-in page

*Severity: a link to the real site sends a signed-in user (or a user who has just signed in) to an
attacker's page; credible phishing for a product without second factor.*

**Component.** `frontend/src/lib/auth.tsx::safeNextPath`, used by `auth-forms.tsx`.

**Cause.** The check accepted anything starting with `/` but not `//`. URL parsers drop tab and newline
characters, so `/<TAB>/example.com` is `//example.com`.

**Reproduction** (browser, signed in as an audit account):

```
http://localhost:3100/sign-in?next=/%09/example.com/owned
-> the browser ends on https://example.com/owned
```

**Fix.** `frontend/src/lib/navigation-safety.ts`: control characters are rejected and the value must
resolve to the same origin with a path that does not start with `//`. Check: `F-05` in
`frontend/e2e/audit-security.spec.ts` (13 hostile values, 3 legitimate ones). Live check on the fixed
source (port 3111): the same URL lands on `/app`; `?next=/app/settings%3Ftab%3Ddata` still works.

### F-06 (Low) Hosted analytics receives record identifiers and query strings

*Severity: identifiers of investigations, analyses, sensors and cameras leave the application for a
measurement service; no content, but contrary to the stated intent.*

**Component.** `frontend/src/app/layout.tsx` (`<Analytics />`, `<SpeedInsights />` without `beforeSend`).

**Evidence.** The script served at `https://sensortrace.vercel.app/_vercel/insights/script.js` builds its
page-view payload as `{o: <location.href>, sv, sdkn, sdkv, dp: <route pattern>, ...}`. `o` is the full
address, so `/app/investigations/<uuid>?tab=evidence` and `/sign-in?next=...` are reported as they are.
No pageview was sent by this audit; this is from the script and the library source
(`@vercel/analytics` 2.0.1, `@vercel/speed-insights` 2.1.0).

**Fix.** `frontend/src/components/telemetry.tsx` passes every reported address through
`lib/telemetry.ts::redactUrl`, which replaces identifier path segments with `[id]` and drops the query
string and fragment. One sentence added to the privacy page says so. Check: `F-06` in
`frontend/e2e/audit-security.spec.ts`. Not verified against the hosted service (needs a deployment).

The rest of the telemetry text on the privacy page was checked and is accurate: no third-party origin is
contacted (CSP `connect-src 'self'`, and the public HTML references no external URL), telemetry is only
rendered when `VERCEL` is set, and no image content, file name or account identifier is passed to it.

### F-07 (Low) The web proxy replaces the API's Content-Security-Policy

*Severity: defence in depth only; originals are still attachments with `nosniff`.*

**Component.** `frontend/next.config.ts` (`headers()` applied to `/:path*`).

**Reproduction.**

```
GET http://127.0.0.1:8100/api/v1/files/<token>   -> Content-Security-Policy: default-src 'none'; sandbox
GET http://localhost:3100/api/v1/files/<token>   -> Content-Security-Policy: default-src 'self'; ... script-src 'self' 'unsafe-inline'; ...
```

The "sandboxing Content-Security-Policy" on file downloads claimed in SECURITY.md therefore never reached
a browser in the Compose deployment. On the Vercel deployment `/api/v1` is routed straight to the API and
the strict policy is present (verified on the public site).

**Fix.** The page policy is no longer applied to `/api/*`, so proxied responses keep the backend's policy.
Live check on the fixed source: `default-src 'none'; sandbox` on a download through port 3111; pages keep
the page policy.

### F-08 (Low) NUL bytes cause internal errors

*Severity: unauthenticated 500 and stack traces in the log; no data exposure.*

```
POST /api/v1/auth/login {"email":"a\u0000@b.c","password":"x"}  -> 500 internal_error
GET  /api/v1/investigations?q=a%00b                             -> 500
GET  /api/v1/account/audit?action=a%00b                         -> 500
(psycopg.DataError: PostgreSQL text fields cannot contain NUL (0x00) bytes)
```

**Fix.** The three inputs that reach SQL without passing the `Str` schema base are stripped of NUL
(`routers/auth.py`, `routers/investigations.py`, `routers/account.py`). Test:
`test_f08_nul_bytes_are_handled_as_ordinary_bad_input`. Live check: `401`.

### F-09 (Low) Non-ASCII secret headers cause internal errors

*Severity: fails closed, but as an unhandled exception.*

```
POST /api/v1/auth/logout  Cookie: st_session=<valid>  X-CSRF-Token: \xff\xfe  -> 500 internal_error
```

`hmac.compare_digest` raises `TypeError` for non-ASCII `str`. The same call guards the internal job
endpoint and the cron endpoint (in-process: `TypeError`).

**Fix.** `deps.same_secret` compares bytes; used for the CSRF token, `X-ST-Internal` and the cron bearer.
Test: `test_f09_non_ascii_csrf_and_internal_headers_fail_closed_without_error`. Live check: `403`.

### F-10 (Low) File tokens are not bound to the owner's key prefix

*Severity: needs the signing key and a victim's object key (random, not exposed by the API); the local
stack does run with the published key (F-14).*

**Reproduction.** With the development key from `config.py`, a token naming another account's object and
the attacker's own user id:

```
GET /api/v1/files/<forged: b=evidence, k=<victim id>/evidence/<uuid>.jpg, u=<attacker id>>  as attacker
-> 200, 110 723 bytes, identical to the victim's original
```

**Fix.** `routers/files.py` also requires the key to start with the requesting user's id, so a validly
signed token cannot cross accounts. Test:
`test_f10_a_token_for_another_accounts_object_is_refused_even_when_validly_signed`. Live check: `404`,
owner's own link `200`.

### F-11 (Low) http dispatch can run a job twice

*Severity: needs a repeated or replayed signed call (platform retry, or an attacker holding the secret);
effect is duplicated candidates in an analysis and duplicated work.*

**Component.** `jobs.py::execute`. The per-job signature is `HMAC(secret, "run-job:<id>")` with no nonce or
expiry, and `execute` accepted a job in state `running` and read the row without a lock.

**Reproduction** (in-process): `execute()` on a job already `running` under http dispatch runs the handler
again; four concurrent calls on a queued job could each start it.

**Fix.** The job row is claimed under `SELECT ... FOR UPDATE`, and under http dispatch a job that is
already running is not started again. The queue worker's behaviour is unchanged. Test:
`test_f11_replayed_internal_call_does_not_run_a_job_twice`. Verified by test only.

Checked and sound for the same endpoints: no signature, a wrong signature, another job's signature and a
signed-in user without signature all give `404` (also on the public deployment); the endpoints are absent
from OpenAPI; `internal_base_url` comes only from configuration or Vercel's own variables, never from a
request, so it is not an SSRF vector; the cron endpoint is `404` when `CRON_SECRET` is unset.

### F-12 (Info) Audit trail details

`DELETE /account/exports/{id}` wrote no audit record. The `account.deleted` record, described in the code
as "detached from any personal data", stored the source address (`172.22.0.1` observed). Both fixed in
`routers/account.py`. Test: `test_f12_export_deletion_is_audited_and_account_deletion_keeps_no_address`.

### F-13 (Medium, not fixed) Sign-in rate limiting: global lockout or bypass

*Severity: unauthenticated; four requests a minute keep every user out of sign-in, registration, password
change and account deletion (default configuration).*

**Reproduction** (limit 60 per 15 minutes locally; the default is 20).

```
60 x POST http://localhost:3100/api/v1/auth/login with wrong credentials and a different
     X-Forwarded-For each time -> 60 x 401, then 429; Redis has one key: rl:auth-ip:172.22.0.8 (the web container)
then, from another client, POST /auth/login for a real account with the correct password
     -> 429 {"code":"rate_limited","details":{"retry_after":892}}
then POST /auth/register -> 429
```

- With `ST_TRUST_FORWARDED_FOR=false` (default) every browser shares the web proxy's address, so the
  per-address limit is a global one that any client can exhaust. It also fails closed.
- With `ST_TRUST_FORWARDED_FOR=true` and no proxy that overwrites the header, the limit is bypassed: the
  Next proxy forwards a client-supplied `X-Forwarded-For` unchanged and the API takes its first entry.
  (Spoofing has no effect in the default configuration: verified, the key stays the proxy's address.)
- Independently, the per-email limit lets anyone lock a known account out:
  `61 x POST /auth/login {"email": "<victim>"}` -> the victim's correct password gets `429` for 15 minutes.

**Why not fixed.** A Next.js route handler cannot see the peer address, so the application cannot repair
this by itself; it needs a reverse proxy that overwrites `X-Forwarded-For` (as DEPLOYMENT.md describes) and
`ST_TRUST_FORWARDED_FOR=true`, or a different limiter design (for example counting failures only, with a
delay instead of a hard block per account). On Vercel the header is set by the platform, so
`ST_TRUST_FORWARDED_FOR=true` is the right setting there; whether the public deployment has it could not
be checked without sending a burst of sign-ins, which was out of bounds.

### F-14 (Low, not fixed) The published development secret is used unless the environment says production

The production guards in `config.py` are sound but run only when `ST_ENVIRONMENT=production`. The Compose
file defaults to `development` with `ST_SECRET_KEY=dev-only-secret-change-me-...`, and nothing warns at
start-up. The local stack runs with that key (F-10 was reproduced with it). With the key an account can
forge file tokens (limited to its own objects after F-10) and the internal job signature. The public
deployment is in production mode (`/api/v1/docs` is `404`, HSTS is set), so the guard applied there.
Recommended: make Compose require the variable (`${ST_SECRET_KEY:?}`) or refuse the development key
whenever the API is not bound to loopback. Not changed: the Compose file was out of bounds.

### F-15 (Low, not fixed) Active-job limit race

`jobs.enqueue` counts and then inserts without a lock. 60 simultaneous `POST /account/export` created 10
jobs against a limit of 8. Each job can run for up to an hour on a single FIFO worker, so the limit is what
protects other users' queue time. Recommended: lock the user row (`SELECT ... FOR UPDATE`) before counting.
Not applied because a deterministic test needs the real queue; it is a one-line change.

### F-16 (Low, not fixed) Report generation fails on long text

```
PATCH acquisition notes to 4 100 characters (limit 5 000) -> POST /analyses/{id}/reports -> 500
investigation with a 3 700-character description (limit 20 000) and a 15 000-character note (limit 20 000)
  -> POST /investigations/{id}/reports -> 500
reportlab.platypus.doctemplate.LayoutError: Flowable <Table ... (tallest row 1334.5)> too large on page 2
```

A table cell cannot be split across pages. The fix is either to truncate long values in the report with a
visible marker or to lay them out outside the table; what a report may omit is the owner's decision.

### F-17 (Low, not fixed) API tokens and password changes

A password change revokes other sessions but not API tokens (`token alive after password change: 200`),
while the operator reset revokes both. A token can also revoke interactive sessions
(`DELETE /auth/sessions/{id}` -> `204`) and start a full account export. Tokens cannot create tokens,
change the password or delete the account (all `403`, verified). Whether a password change should revoke
tokens, and whether tokens should be able to act on sessions, are product decisions.

### F-18 (Low, not fixed) Password blocklist

`Password1234`, `1234567890ab` and `qwertyuiop12` are accepted. The blocklist has 11 entries; the length
(10) and distinct-character rules are enforced. ASVS 2.1.7 expects a check against a breached-password
list.

### F-19 (Low, not fixed) Audit coverage and retention

Recorded: registration, sign-in and failures, sign-out, password change and operator reset, session and
token changes, uploads with SHA-256, updates, deletions, fingerprint and analysis jobs, reports, exports,
demo data. No secret, password, token or image content was found in 198 rows or in the code paths.
Not recorded: downloads of originals, fingerprints, reports and export archives; detaching an analysis.
The log is never purged: failed sign-ins for unknown addresses accumulate with source address and no
owner.

### F-20 (Low, not fixed) Frontend dependency advisories

`shadcn` is listed under `dependencies` although only its stylesheet is imported
(`src/app/globals.css`). Its CLI dependencies carry the advisories in section 6. None of that code is
shipped to browsers. Moving `shadcn` to `devDependencies` would clear `npm audit --omit=dev`; it changes
the lockfile and was left to the owner.

### F-21 (Info) Documentation and configuration inaccuracies

- SECURITY.md: "Image decoding and analysis run only in the worker" is false (F-01).
- SECURITY.md: the sandbox policy on downloads did not apply behind the web proxy (F-07, fixed).
- SECURITY.md: "Internal storage keys ... are excluded": true for exports, but the body of every file token
  is readable base64 JSON containing the storage key (visible only to the owner).
- `ST_DB_POOL=null`, recommended in DEPLOYMENT.md for Vercel, is read by `config.py` and used nowhere.
- `/api/v1/openapi.json` is served in production (the interactive page is not).
- The first account to register becomes administrator; two simultaneous first registrations would both be.
- Uvicorn access logs contain file tokens (five-minute, account-bound, useless without the session).

## 5. Checked and found sound

| Area | What was tested | Evidence |
|---|---|---|
| Authentication dependency | 74 routes from the real route table | 68 require `get_auth`; anonymous request to each: `401 not_authenticated` |
| IDOR | 76 requests by a second user and by the administrator against every id-taking route; nested ids in bodies, form fields and query filters | 76 x `404`; cross-references `404`; victim data intact |
| Administrator | `/admin/config`, `/admin/stats` | user `403`; admin sees limits and four aggregate counts only |
| Session cookie | Flags, storage, expiry, revocation | `HttpOnly; Max-Age=43200; Path=/; SameSite=lax`; only SHA-256 in `sessions.token_hash`; expired row `401`; sign-out then reuse `401`; new token on every sign-in (no fixation) |
| Password change | Other sessions | other session `401`, current one `200` |
| CSRF | Every state-changing authenticated route (38) x {no token, wrong token, multipart, urlencoded, text/plain} with a valid cookie | all `403 csrf_failed`; token of another session of the same user `403` |
| Login CSRF | JSON as `text/plain`, urlencoded, multipart, no content type | all `422`; cross-origin preflight from a foreign origin `400` without allow-origin |
| CORS | Foreign and configured origins, local and public | only the configured origin is allowed with credentials |
| User enumeration | Message and timing of sign-in | identical message; median 0.132 s (existing) vs 0.126 s (unknown). Registration of an existing address returns `409`: inherent without email verification |
| Password storage and policy | Database, weak passwords | `$argon2id$v=19$m=65536,t=3,p=4`; short, low-variety and listed passwords refused |
| API tokens | Storage, scope, revocation | hash only in the database; create token / change password / delete account `403`; revoked token `401`; invalid bearer with a valid cookie `401` |
| Operator reset (`cli.py`) | Run against the local database | sessions and tokens revoked, old password `401`, new `200`; weak, mismatched and unknown refused; audited |
| Signed file URLs | Tampered payload, truncated/empty/padded signature, wrong key, other user, anonymous, expiry, NaN expiry, traversal keys, unknown bucket, inline flag on an original, HTML content type, header injection in the file name | all refused, or served as `application/octet-stream` attachment; file name reduced to `[A-Za-z0-9._-]`; `Cache-Control: private, no-store`, `nosniff`, `Referrer-Policy: no-referrer`; only `derived` PNG/JPEG can be inline |
| Uploads | HTML, SVG, GIF, truncated JPEG, JPEG+HTML polyglot, hostile file names (traversal, markup, NUL, CRLF, 400 characters), 61 and 1100 files, 2 MB field, extra acquisition fields, bad category, PNG with a 60000 x 60000 header | rejected, or stored byte-identical and served as attachment; names sanitised |
| Decoder (`engine/ingest.py`, read only) | Order of checks | magic bytes, Pillow bomb warning as error, pixel count from the header before decoding, PNG CRC verification, EXIF strings stripped of NUL and cut to 256 characters |
| Evidence integrity | Stored bytes against the recorded hash | SHA-256 of the object in the store equals the database value for every evidence item; download equals upload; the hash printed in the PDF equals the stored one; export file names carry the hash and matched |
| Object store | Anonymous and wrong-secret S3 calls to `127.0.0.1:9100` | list buckets, list objects, get, put, delete: `AccessDenied`; wrong secret: `SignatureDoesNotMatch` |
| Deletion | Report, analysis, evidence, reference, fingerprint, sensor, device, investigation, account; objects counted in all three buckets after each step | counts fall exactly (43/52/4 down to 0/0/0); after account deletion zero rows in all 15 tables and zero objects (archives: see F-04) |
| Export contents | Both scopes | no `object_key`, `password_hash`, `token_hash`, `csrf_token`; no sessions or tokens |
| Jobs | Cancel queued and running, cancel finished, sequential limit, failure without detail | `200`, `409`, limit 8 enforced sequentially, generic error text (race: F-15) |
| SQL injection | `q`, `action`, id filters, ordering | bound parameters; `%`, `_`, quotes treated as data; ordering is not user-controlled |
| PDF injection | ReportLab markup, links and images in file name, EXIF Make/Model/Software, device and sensor fields, notes, acquisition fields, investigation fields, display name | rendered as literal text; 0 link annotations; no `/URI` in the file |
| XSS | `dangerouslySetInnerHTML`, `href` from data, URL-derived values | one use (chart colours, static); links are built from fixed prefixes and UUIDs; download links come from the API; React escapes all user text |
| Proxy route | Path traversal, host confusion, header handling | segments are percent-encoded (`/api/v1/..%2f..%2fhealth` -> `404`); upstream host from configuration only; cookies forwarded one per header |
| Security headers | Local web and API, public web and API | CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `no-store` on API; HSTS on the public site (2 years, preload) |
| Error responses | Validation, unknown routes, unhandled errors | one error shape, no stack traces, no input echoed |
| Public deployment | Unauthenticated reachability | `/health` and `/meta` `200`; `/auth/me`, `/dashboard`, `/evidence`, `/jobs`, `/admin/*`, `/files/x` `401`; `/internal/maintenance` and an unsigned `/internal/jobs/<id>/run` `404`; `/docs` `404`; registration closed; no external URL in the page source |

## 6. Dependency audit output

Backend, `uv run --with pip-audit pip-audit`:

```
No known vulnerabilities found
Name               Skip Reason
------------------ ---------------------------------------------------------------------------------
sensortrace-api    Dependency not found on PyPI and could not be audited: sensortrace-api (0.1.0)
sensortrace-engine Dependency not found on PyPI and could not be audited: sensortrace-engine (0.1.0)
```

Frontend, `npm audit --omit=dev` (exit 1):

```
deepmerge  >=4.2.0
deepmerge mergeObject() allows prototype poisoning of returned objects - GHSA-gcqx-w48m-w2h4
  node_modules/deepmerge <- @shadcn/registry <- shadcn
minimatch  7.0.0 - 11.0.0   Severity: moderate
minimatch has potential denial of service via globparts amplification - GHSA-g3hv-75wg-m249
  node_modules/@ts-morph/common/node_modules/minimatch <- @ts-morph/common <- ts-morph <- shadcn
6 vulnerabilities (2 low, 4 moderate)
fix available via `npm audit fix --force`: will install shadcn@1.0.0, which is a breaking change
```

All six are in the `shadcn` command-line tool's dependency tree (F-20).

## 7. Residual risks

- **Heavy work inside the API.** After F-01 to F-03, image decoding still runs in the API process and the
  bounds are per process and per account. Several accounts uploading maximum-size images in parallel can
  still occupy the two decode slots and slow uploads for others. `POST /demo` (about 7 s of CPU per call)
  and report generation are synchronous and have no concurrency bound of their own.
- **Whole objects in memory.** Downloads (`routers/files.py`) and export building (`jobs._run_export`) hold
  the entire object in memory; an export may be as large as the 5 GB quota.
- **Single FIFO worker.** One account can queue 8 jobs of up to an hour each (more with F-15); other
  accounts wait.
- **Sign-in limiter** (F-13) and **development secret** (F-14) remain as found.
- **Content-Security-Policy of the pages** allows inline scripts (`script-src 'self' 'unsafe-inline'`),
  so it does not contain an HTML injection should one be introduced later.
- **No second factor, no email verification, no self-service reset**: as listed in SECURITY.md.
- **Not tested:** `VercelBlobStorage` against a real store; the http-dispatch and cron endpoints on a
  deployed instance (in-process only); the hosted analytics payload after F-06; rate limiting on the public
  deployment; the Docker images rebuilt from the fixed source.

## 8. Changes made

Backend: `app/config.py` (`max_json_bytes`), `app/db.py` (session concurrency bound), `app/deps.py`
(`authenticate` made public, `same_secret`, `upload_slot`), `app/main.py` (body limits and early
authentication of uploads), `app/services.py` (`run_heavy`, `purge_exports`), `app/jobs.py` (job claim),
`app/routers/{account,auth,devices,files,internal,investigations}.py`, new
`tests/test_audit_security.py` (14 tests).

Frontend: `next.config.ts`, `src/app/layout.tsx`, `src/lib/auth.tsx`, new `src/lib/navigation-safety.ts`,
`src/lib/telemetry.ts`, `src/components/telemetry.tsx`, one sentence in
`src/app/(marketing)/privacy/page.tsx`, new `e2e/audit-security.spec.ts` (2 checks, no browser or stack
needed).

## 9. Final results

```
backend   uv run pytest -q                      126 passed (112 existing + 14 new)
backend   uv run ruff check app tests           All checks passed!
backend   uv run ruff format app tests          35 files left unchanged
frontend  npm run lint                          no findings
frontend  npx tsc --noEmit                      exit 0
frontend  npx playwright test e2e/audit-security.spec.ts    2 passed
```

Before the fixes, all 13 backend tests written at that point failed for the reason each one names
(for example `{200: 40, 500: 80}` for F-03 and `(400, 2) == (401, 0)` for F-02); the fourteenth
(`test_f01_parallel_uploads_per_account_are_bounded`) covers a bound that was added with the F-01 fix.
