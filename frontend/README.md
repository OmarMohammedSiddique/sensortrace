# SensorTrace frontend

Next.js (App Router, TypeScript strict) web client for the SensorTrace API.
Engineers building pages: read [CONVENTIONS.md](./CONVENTIONS.md) first.

## Run

```bash
npm install
npm run dev          # http://localhost:3100  (expects the API at http://127.0.0.1:8100)
```

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server on port 3100 |
| `npm run build` / `npm run start` | Production build / serve on port 3100 |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run gen:api` | Regenerate `src/lib/api/schema.d.ts` from `../docs/api/openapi.json` |

## Configuration

| Variable | When read | Default | Meaning |
|---|---|---|---|
| `API_INTERNAL_URL` | **runtime**, per request | `http://127.0.0.1:8100` | Base URL of the backend, reachable from the Next.js server |
| `PORT`, `HOSTNAME` | runtime (standalone server) | `3100`, `0.0.0.0` in Docker | Listen address |

There are no `NEXT_PUBLIC_*` variables and no secrets in the client.

## How the browser reaches the API

The browser only calls same-origin `/api/v1/...`. The route handler
`src/app/api/v1/[...path]/route.ts` streams each request to `API_INTERNAL_URL` and streams the
response back (multipart uploads, `Set-Cookie`, binary downloads). It is a route handler rather than a
`rewrites()` entry because rewrites are resolved at build time, which would bake the backend address
into the image.

## Docker

```bash
docker build -t sensortrace-frontend .
docker run -p 3100:3100 -e API_INTERNAL_URL=http://api:8100 sensortrace-frontend
```

Multi-stage build on `node:22-alpine`, `output: "standalone"`, runs as a non-root user. The build needs
no network access beyond npm (fonts come from the `geist` package).

## Security notes

- Security headers, including a strict CSP with no third-party origins, are set in `next.config.ts`.
- The session cookie is HttpOnly; the CSRF token is held in memory only and sent as `X-CSRF-Token`.
- User-supplied text is always rendered as text. `dangerouslySetInnerHTML` is not used.
- No telemetry, analytics or third-party requests.
