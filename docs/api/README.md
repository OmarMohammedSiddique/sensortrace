# API guide

SensorTrace exposes a versioned REST API under `/api/v1`. The complete machine-readable description is
[`openapi.json`](openapi.json) (regenerate with `make openapi`). When the server runs outside production
mode, interactive documentation is served at `/api/v1/docs`.

Everything the web application does goes through this API, so anything visible in the UI can be
scripted.

## Conventions

- **Base URL:** `http://127.0.0.1:8100/api/v1` for the local stack (or `https://<host>/api/v1` through
  the web application's proxy).
- **Authentication:** `Authorization: Bearer st_...`. Create a token in the web application under
  *Settings → Security*, or with `POST /auth/tokens` from a browser session. Tokens are shown once.
- **Errors:** every error is `{"error": {"code": "...", "message": "...", "details": ...}}` with a
  matching HTTP status. Codes are stable; messages are for people.
- **Lists:** `{"items": [...], "total": n, "limit": n, "offset": n}`; use `limit` (max 200) and `offset`.
- **Long work** returns `202` with a `job`. Poll `GET /jobs/{id}` until `status` is `succeeded`,
  `failed` or `cancelled`. Cancel with `POST /jobs/{id}/cancel`.
- **Files:** objects carry short-lived relative URLs (`preview_url`, `download_url`, ...). Fetch them
  with the same credentials within five minutes; re-read the object for a fresh URL.
- **Uploads:** `multipart/form-data` with repeated `files` parts, JPEG or PNG, at most 64 MB each, 60
  files and 512 MB per request. Each file gets its own result.
- **Rate limits:** `429` with a `Retry-After` header.
- **Privacy:** every object is private to the account. Another account's identifier returns `404`.

## Endpoint groups

| Group | Endpoints |
|---|---|
| Service | `GET /health`, `GET /meta` (versions, limits, guidance text; public) |
| Authentication and accounts | `POST /auth/register`, `/auth/login`, `/auth/logout`; `GET,PATCH /auth/me`; `POST /auth/password`; `GET,DELETE /auth/sessions`; `GET,POST,DELETE /auth/tokens` |
| Cameras and sensors | `/devices`, `/devices/{id}/sensors`, `/sensors`, `/sensors/{id}/references`, `/references/{id}`, `/sensors/{id}/fingerprints`, `/fingerprints/{id}`, `/fingerprints/{id}/activate` |
| Investigations and evidence | `/investigations`, `/investigations/{id}/notes`, `/investigations/{id}/history`, `/investigations/{id}/export`, `/evidence`, `/notes/{id}` |
| Comparisons | `GET /policies`, `/analyses`, `/analyses/{id}` |
| Background jobs | `/jobs`, `/jobs/{id}`, `/jobs/{id}/cancel` |
| Reports | `POST /analyses/{id}/reports`, `POST /investigations/{id}/reports`, `/reports`, `/reports/{id}` |
| Account data | `GET /dashboard`, `GET /account/usage`, `GET /account/audit`, `POST /account/export`, `GET /account/exports`, `DELETE /account` |
| Onboarding | `POST,DELETE /demo` (clearly labelled synthetic data) |
| Administration | `GET /admin/config`, `GET /admin/stats` (administrator only; aggregate figures) |

## Worked example

Set up once:

```bash
export API=http://127.0.0.1:8100/api/v1
export TOKEN=st_your_token_here
```

Create a camera and a sensor:

```bash
curl -s -X POST "$API/devices" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Lab camera","make":"Canon","model":"EOS 80D","device_type":"dedicated_camera","pipeline_class":"conventional"}'
```

```bash
curl -s -X POST "$API/devices/$DEVICE_ID/sensors" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Main sensor"}'
```

Upload reference images (repeat `-F files=@...` for each file) and build the fingerprint:

```bash
curl -s -X POST "$API/sensors/$SENSOR_ID/references" -H "Authorization: Bearer $TOKEN" \
  -F files=@flat_001.jpg -F files=@flat_002.jpg -F files=@flat_003.jpg
```

```bash
curl -s -X POST "$API/sensors/$SENSOR_ID/fingerprints" -H "Authorization: Bearer $TOKEN"
```

Poll the job from the response until it finishes:

```bash
curl -s "$API/jobs/$JOB_ID" -H "Authorization: Bearer $TOKEN"
```

Upload a questioned image and compare it:

```bash
curl -s -X POST "$API/evidence" -H "Authorization: Bearer $TOKEN" -F files=@questioned.jpg \
  -F 'acquisition={"source":"Email attachment","acquired_by":"J. Doe"}'
```

```bash
curl -s -X POST "$API/analyses" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"evidence_ids\":[\"$EVIDENCE_ID\"],\"sensor_ids\":[\"$SENSOR_ID\"]}"
```

Read the result and generate the report:

```bash
curl -s "$API/analyses/$ANALYSIS_ID" -H "Authorization: Bearer $TOKEN"
```

```bash
curl -s -X POST "$API/analyses/$ANALYSIS_ID/reports" -H "Authorization: Bearer $TOKEN"
```

Download the PDF with the `download_url` from the response:

```bash
curl -s -o report.pdf "http://127.0.0.1:8100$DOWNLOAD_URL" -H "Authorization: Bearer $TOKEN"
```

## Reading a comparison result

`GET /analyses/{id}` returns `candidates`, ranked by adjusted statistic. For each:

| Field | Meaning |
|---|---|
| `verdict` | `match_supported`, `non_match_supported`, `inconclusive` or `insufficient_or_unsupported` |
| `pce` | Signed peak-to-correlation energy at the best tested alignment |
| `effective_pce` | The statistic adjusted for the number of alignments and candidates tested; thresholds apply to this |
| `ncc` | Normalised correlation at that alignment |
| `measurement` | Geometry (`native`, `rotated`, `cropped`, `unsupported`), rotation, offset, trials, usable pixels, per-rotation values, idealised-model reference figures, a 33×33 window of the correlation surface |
| `decision.reasons` | Why this outcome was reached |
| `decision.caveats` | Limitations that apply to this result |
| `decision.policy` | Thresholds, whether they are calibrated, and their basis |
| `decision.nua` | How the same-model alternative was treated |
| `experimental` | Delta-sPCE against same-model controls, when present. Information only |
| `snapshot` | Sensor, device and fingerprint details at the time of the comparison |

`summary.text` gives the open-set reading across all candidates. An outcome is a statistical indication
under the stated policy, never a probability of origin. `p_value_gaussian` and
`p_false_alarm_gaussian` are reference values under an idealised noise model that real images violate;
do not report them as error rates.
