# ADR 0001: Architecture and technology stack

Status: accepted (2026-11-12)

## Context

SensorTrace needs a scientific engine that can be validated on its own, a web application with
authentication and private data, long-running image processing, and private file storage. It must run
locally on ARM64 macOS without paid cloud services, and be operable through Docker Compose.

## Decision

A modular monolith in three packages:

| Package | Role | Stack |
|---|---|---|
| `engine/` | PRNU algorithms, decision policy, evaluation, CLI. No web or database code. | Python 3.12, NumPy, SciPy, PyWavelets, Pillow, OpenCV (headless) |
| `backend/` | REST API, persistence, background jobs, storage, reports. Imports the engine as a library. | FastAPI, Pydantic 2, SQLAlchemy 2, Alembic, PostgreSQL, Redis + RQ, ReportLab |
| `frontend/` | Web application. Talks only to the REST API. | Next.js (App Router), TypeScript, Tailwind, shadcn/ui, TanStack Query |

Supporting services: PostgreSQL, Redis, and an S3-compatible object store.

## Choices and reasons

- **No microservices.** One API process, one worker process type and one scheduler loop share one
  codebase and image. The engine is separated at the package level, which is enough for it to power a CLI
  or another client later.
- **Synchronous SQLAlchemy with psycopg 3.** Request handlers are short and the worker is synchronous;
  async database access would add complexity without benefit.
- **RQ for jobs.** RQ forks a fresh process for every job. That gives per-job memory and crash isolation
  for media decoding without extra infrastructure, and makes time limits and retries simple. Celery was
  rejected as heavier than needed; arq was rejected because jobs are CPU-bound, not I/O-bound.
- **The `jobs` table is the source of truth** for status, progress and cancellation. Redis only carries
  the queue, so job history survives a Redis restart and is subject to the same access control as other data.
- **Object storage behind a small interface** with two implementations: local disk (tests, single-host
  development) and S3 (Compose and production). Three logical buckets separate raw evidence, derived
  artefacts and results.
- **SeaweedFS as the local S3 service.** MinIO was the first choice, but its community container image is
  no longer published on Docker Hub or Quay (checked 2026-11-12). SeaweedFS is Apache-2.0, actively
  maintained and S3-compatible. Production deployments can point at any S3-compatible service.
- **File access through the API with signed, expiring, user-bound tokens** rather than presigned S3 URLs.
  The object store is never exposed to browsers, authorisation is enforced in one place, and the same
  mechanism works for both storage backends.
- **Cookie sessions plus API tokens.** Browsers use an HttpOnly, SameSite=Lax session cookie with a CSRF
  header; programmatic clients use bearer tokens. Sessions and tokens are stored hashed and can be revoked.
- **ReportLab for PDFs.** Pure Python, BSD-licensed, no system libraries. WeasyPrint was rejected because
  it needs LGPL system libraries (Pango) in the image.
- **JPEG and PNG only.** HEIC/HEIF is deferred: the available Python wheels bundle GPLv2 code (x265), see
  `LICENSE_DECISIONS.md`.

## Consequences

- The worker needs enough memory for full-resolution accumulation (about 0.6 GB for a 12 MP sensor, more
  for larger sensors); limits are configurable.
- A single API process serves file downloads; for large deployments a reverse proxy cache or presigned
  URLs could be added behind the same token interface.
