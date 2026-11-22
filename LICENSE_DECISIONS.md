# Licence decisions

Engineering due diligence, checked against primary sources on 2026-11-12. This is not legal advice;
have counsel review it before commercial distribution. Full research notes:
`docs/research/datasets-and-licences.md`.

## SensorTrace's own licence

SensorTrace is licensed under the Apache License 2.0 (decided 2026-11-22; see `LICENSE` and `NOTICE`).
Apache 2.0 was chosen over MIT for its explicit patent grant from contributors. It grants rights in this
code only and does not license any third-party patent (see Patents below).

## Decisions

| Item | Licence | Decision | Reason |
|---|---|---|---|
| PRNU algorithms | Published papers | **Implemented independently** from the published descriptions | Algorithms and mathematics are not copyrightable; no third-party PRNU code is included |
| Binghamton "Camera Fingerprint" toolbox | CC BY-NC 4.0 | **Not used in any form** | Non-commercial only; not even run as a test oracle |
| polimi-ispl/prnu-python | MIT (port of the Binghamton code) | **Development-only test oracle**, fetched by script, never imported by the product, never redistributed | MIT permits use, but its derivation from NC-licensed code is unresolved, so no code is copied |
| IPOL 662 code | No licence stated; article CC BY-NC-SA | **Not used.** Paper read for understanding only | Unlicensed code; optional BM3D dependency is non-commercial |
| PyPI package `prnu` | GPL-3.0-only | **Not used** | Unrelated GPL project |
| `bm3d` | Non-commercial | **Not used** | Licence |
| `pillow-heif` / libheif wheels | Source BSD-3, **binary wheels GPLv2** (bundled x265) | **Not used; HEIC/HEIF not supported** | GPLv2 in a potentially proprietary product. Revisit with a build that excludes x265 (decode only) plus tests |
| WeasyPrint | BSD-3, needs LGPL Pango at runtime | **Not used**; ReportLab chosen | Avoids bundling LGPL system libraries |
| VISION dataset | CC BY-SA 4.0 | **Used for evaluation only.** Downloaded by script at evaluation time; images are never committed or redistributed. Published metrics carry attribution | Internal evaluation and publishing metrics are permitted with attribution. Share-alike would apply to redistributed images or adaptations |
| FODB, RAISE, SOCRatES | Non-commercial or signed agreement | **Not used** | Licence |

## Runtime dependencies (all permissive)

| Component | Licence | Note |
|---|---|---|
| NumPy, SciPy | BSD-3-Clause (and bundled permissive notices) | Wheels bundle OpenBLAS and GCC runtime libraries; keep the wheels' licence files when redistributing |
| PyWavelets | MIT | |
| Pillow | MIT-CMU (HPND) | Bundles libjpeg-turbo, zlib and other permissive libraries |
| opencv-python-headless | Apache-2.0 (package scripts MIT) | **Wheels bundle FFmpeg under LGPL-2.1.** SensorTrace does not use video functions. When distributing images or installers, keep the notices and do not prevent replacement of the library |
| FastAPI, Starlette, Pydantic, Uvicorn | MIT / BSD | |
| SQLAlchemy, Alembic | MIT | |
| psycopg 3 | LGPL-3.0 | Used as an unmodified dynamically imported library; comply with LGPL notices on redistribution |
| redis-py, RQ | MIT / BSD-2-Clause | |
| boto3 / botocore | Apache-2.0 | |
| argon2-cffi | MIT | |
| zxcvbn (Python port) | MIT | Offline password strength estimate; bundles frequency lists derived from public breach data |
| pyotp | MIT | TOTP codes for two-step verification |
| cryptography | Apache-2.0 or BSD-3-Clause | Encrypts stored TOTP secrets (AES-GCM) |
| qrcode (npm) | MIT | Draws the authenticator setup QR code in the browser |
| ReportLab (open-source edition) | BSD | |
| Next.js, React, Tailwind CSS, shadcn/ui, Radix, TanStack Query, Recharts, lucide | MIT / ISC | Front-end; see `frontend/package.json` |
| Geist typeface | SIL OFL 1.1 | Self-hosted through `next/font` |

## Services used through Docker (not linked into the product)

| Service | Licence | Note |
|---|---|---|
| PostgreSQL | PostgreSQL Licence | |
| Redis 7 | RSALv2 / SSPLv1 (7.4+) | Used unmodified as a separate service. Valkey (BSD) is a drop-in alternative if these terms are unsuitable |
| SeaweedFS | Apache-2.0 | Local S3-compatible storage only; production may use any S3 service |

## Patents

PRNU-based camera identification was the subject of United States patents assigned to the Research
Foundation of the State University of New York (Binghamton), filed in the mid-2000s. Their status and
scope in the jurisdictions where SensorTrace would be sold **have not been checked**. This needs a
freedom-to-operate review by a patent attorney before commercial release.

## Open items for counsel

1. Patent freedom-to-operate (above).
2. Whether using an MIT-licensed port of NC-licensed code as a development-only oracle carries any risk.
3. LGPL compliance checklist for the distributed container images (FFmpeg in OpenCV wheels, psycopg).
4. ~~Choice of licence for SensorTrace itself.~~ Decided: Apache 2.0.
