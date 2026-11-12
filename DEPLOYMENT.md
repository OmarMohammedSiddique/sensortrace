# Deployment

SensorTrace runs as six containers: web application, API, worker, scheduler, PostgreSQL, Redis, plus an
S3-compatible object store. Everything needed to run it locally is free and open source. No public
deployment has been made and none is required to use the product.

## Requirements

- Docker with Compose v2 (Docker Desktop on macOS, including Apple Silicon; all images are multi-arch).
- 8 GB of memory available to Docker. A 12-megapixel fingerprint job needs about 1.5 GB in the worker;
  48-megapixel sensors need about 5 GB.
- Disk for evidence and fingerprints (a fingerprint is roughly 4 bytes per pixel before compression).

## Run the complete stack locally

```bash
cp .env.example .env
```

```bash
docker compose --profile app up --build -d --wait
```

Then open `http://localhost:3100`. The first account you register becomes the administrator.

| Service | Address | Notes |
|---|---|---|
| Web application | `http://localhost:3100` | Change with `WEB_PORT` |
| API and interactive docs | `http://127.0.0.1:8100/api/v1/docs` | Bound to loopback; docs are disabled in production |
| PostgreSQL | `127.0.0.1:54329` | Loopback only |
| Redis | `127.0.0.1:63799` | Loopback only |
| Object store (S3 API) | `127.0.0.1:9100` | Loopback only |

Use `127.0.0.1` rather than `localhost` for the API port: the ports are published on IPv4 only.

Stop it (data is kept in Docker volumes):

```bash
docker compose --profile app down
```

Remove it including all data:

```bash
docker compose --profile app down --volumes
```

Database migrations run automatically (`migrate` service) before the API starts.

## Development on the host

Run only the backing services in Docker and the application processes on the host:

```bash
make install
```

```bash
make migrate
```

```bash
make dev-api
```

```bash
make dev-worker
```

```bash
make dev-web
```

With no `.env`, the API on the host uses local-disk storage in `./storage`. To use the Compose object
store instead, set `ST_STORAGE_BACKEND=s3`, `ST_S3_ENDPOINT_URL=http://127.0.0.1:9100`,
`ST_S3_ACCESS_KEY` and `ST_S3_SECRET_KEY` in `backend/.env`.

## Configuration

All settings are environment variables with the prefix `ST_` (see `backend/app/config.py` for the full
list and defaults).

| Variable | Purpose | Production |
|---|---|---|
| `ST_ENVIRONMENT` | `development` or `production` | `production` |
| `ST_SECRET_KEY` | Signs file-access tokens | Required, random, at least 32 characters |
| `ST_COOKIE_SECURE` | Send the session cookie over HTTPS only | `true` (the API refuses to start otherwise) |
| `ST_DATABASE_URL` | PostgreSQL connection | Set by Compose |
| `ST_REDIS_URL` | Redis connection | Set by Compose |
| `ST_STORAGE_BACKEND` | `s3` or `local` | `s3` |
| `ST_S3_ENDPOINT_URL`, `ST_S3_ACCESS_KEY`, `ST_S3_SECRET_KEY`, `ST_S3_BUCKET_*` | Object storage | Your S3-compatible service |
| `ST_ALLOWED_ORIGINS` | JSON list of browser origins allowed by CORS | Your public URL |
| `ST_ALLOW_REGISTRATION` | Allow new accounts | `false` after creating accounts |
| `ST_TRUST_FORWARDED_FOR` | Use `X-Forwarded-For` for rate limiting and audit | `true` only behind a proxy that overwrites the header |
| `ST_USER_STORAGE_QUOTA_BYTES`, `ST_MAX_UPLOAD_BYTES`, `ST_MAX_REQUEST_BYTES`, `ST_MAX_IMAGE_PIXELS` | Limits | As needed |
| `ST_JOB_TIMEOUT_SECONDS`, `ST_MAX_ACTIVE_JOBS_PER_USER` | Job limits | As needed |
| `ST_DEFAULT_RETENTION_DAYS` | Default retention for new investigations (0 = keep) | Per policy |
| `ST_WORKER_MEMORY_LIMIT_MB` | Per-job address-space cap (Linux) | Optional |
| `WORKER_MEM_LIMIT`, `WORKER_CPUS` | Worker container limits | Size to your sensors |
| `SENSORTRACE_FFT_WORKERS` | FFT threads per job | Match `WORKER_CPUS` |

Generate a secret:

```bash
openssl rand -base64 48
```

## Production checklist

No production deployment has been performed as part of this project; the steps below are the intended
procedure and have been exercised only as far as the local Compose stack.

1. **Host.** A Linux host or VM with Docker, sized per the requirements above. Restrict SSH.
2. **Secrets.** Create `.env` with `ST_ENVIRONMENT=production`, a random `ST_SECRET_KEY`,
   `ST_COOKIE_SECURE=true`, and new values for `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
   Keep `.env` out of version control and readable only by the deploy user.
3. **TLS and reverse proxy.** Terminate HTTPS in front of the web container and forward to it. The proxy
   must overwrite `X-Forwarded-For`. Only the proxy should be reachable from the internet; every Compose
   port is bound to loopback. Example with Caddy:

   ```
   sensortrace.example.org {
       encode zstd gzip
       request_body {
           max_size 520MB
       }
       reverse_proxy 127.0.0.1:3100 {
           header_up X-Forwarded-For {remote_host}
       }
   }
   ```

4. **Origins.** Set `ST_ALLOWED_ORIGINS='["https://sensortrace.example.org"]'`.
5. **Start.** `docker compose --profile app up --build -d --wait`.
6. **First account.** Register the administrator, then set `ST_ALLOW_REGISTRATION=false` and restart the
   API if the instance is not meant to be open.
7. **Storage.** For durability, point `ST_S3_*` at a managed S3-compatible service with encryption at
   rest and versioning, and remove the `objectstore` service. Otherwise back up the `object-data` volume.
8. **Backups.** Back up PostgreSQL (`pg_dump`) and the object store together; a database without its
   objects, or the reverse, is incomplete. Test a restore.
9. **Monitoring.** `GET /api/v1/health` reports database, Redis and storage status (HTTP 503 when
   degraded). Container logs are plain text on stdout.
10. **Updates.** Pull, rebuild and `up -d`; migrations run automatically. Read CHANGELOG.md first: a new
    algorithm version does not alter stored results but new fingerprints and analyses will use it.

## Operations

| Task | Command |
|---|---|
| Logs | `docker compose --profile app logs -f --tail=100` |
| Add workers | `docker compose --profile app up -d --scale worker=3` |
| Run the retention purge now | `docker compose --profile app exec scheduler python -m app.cli purge` |
| Reset a user's password | `docker compose --profile app exec api python -m app.cli reset-password user@example.org` |
| Apply migrations manually | `docker compose --profile app run --rm migrate` |
| Database shell | `docker compose exec db psql -U sensortrace` |
| Install a calibrated decision policy | Copy `policy.json` from an evaluation run into `backend/policies/` and rebuild |

### Scaling notes

- The worker is the bottleneck. Each worker processes one job at a time; scale the `worker` service and
  set `SENSORTRACE_FFT_WORKERS` so that workers × threads does not exceed the CPUs available.
- The API is stateless and can be replicated behind the proxy.
- Redis holds only the queue and rate-limit counters; losing it loses queued (not finished) jobs, which
  remain visible as queued in the database and can be restarted by the user.

## Platform notes

- **Apple Silicon.** All images build and run natively on ARM64. On the host, the worker needs
  `OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES` (set by `make dev-worker`) because RQ forks.
- **Object store image.** The local stack uses SeaweedFS because the MinIO community image is no longer
  published (ADR 0001). Any S3-compatible service works.
