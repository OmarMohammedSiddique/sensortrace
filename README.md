# SensorTrace

Camera sensor fingerprinting and image source comparison.

SensorTrace tests whether a photograph is consistent with the noise fingerprint of a specific physical
camera sensor. It uses photo-response non-uniformity (PRNU): tiny, fixed pixel-to-pixel differences in
sensitivity that every sensor imprints on its images.

You enrol a sensor from reference photographs, then compare questioned images against it. For each
comparison SensorTrace reports the measurements, a conservative outcome (match supported, non-match
supported, inconclusive, or insufficient quality), the reasons, and the limitations that apply.

**What it is not.** It does not identify an unknown camera from a single image. It does not output a
probability of origin. It is not certified forensic software and makes no claim of courtroom
admissibility. Read [SCIENTIFIC_METHODOLOGY.md](SCIENTIFIC_METHODOLOGY.md) and
[VALIDATION.md](VALIDATION.md) before relying on a result.

## Status

Release candidate. [PROJECT_STATUS.md](PROJECT_STATUS.md) lists every requirement with its verification
status, what is experimental, and what is not done.

## Quick start

Requirements: Docker with Compose v2 and about 8 GB of memory available to Docker.

```bash
cp .env.example .env
```

```bash
docker compose --profile app up --build -d --wait
```

Open **http://localhost:3100**, register (the first account becomes the administrator) and follow the
guided onboarding, which creates clearly labelled synthetic demo cameras so you can try a comparison
before enrolling your own.

Stop the stack (data is kept):

```bash
docker compose --profile app down
```

More detail, configuration and production notes: [DEPLOYMENT.md](DEPLOYMENT.md).

## Using it

1. **Register a camera** in the camera laboratory. Declare whether it has a conventional or a
   computational (modern smartphone) processing pipeline. Add one sensor per lens and capture mode.
2. **Upload reference images**: 30 or more bright, evenly lit, featureless photographs taken at 1x with
   no zoom, HDR, portrait or night mode, uploaded as the camera wrote them.
3. **Create the fingerprint.** Review which references were accepted or rejected and why.
4. **Create an investigation** and upload the questioned images with acquisition details.
5. **Compare.** Select the sensors to test against. For smartphones, also enrol and select at least one
   other device of the same model as a control.
6. **Review** the measurements, outcome, reasons and limitations, then generate the PDF report.

## Repository

| Path | What |
|---|---|
| [`engine/`](engine) | Scientific engine (Python package and CLI). Independent of the web application |
| [`backend/`](backend) | REST API, background jobs, storage, reports (FastAPI) |
| [`frontend/`](frontend) | Web application (Next.js) |
| [`docs/`](docs) | Decision records, research notes, API description |
| [`scripts/`](scripts) | Dataset and reference-implementation fetch scripts |

## Documentation

| Document | Contents |
|---|---|
| [SCIENTIFIC_METHODOLOGY.md](SCIENTIFIC_METHODOLOGY.md) | The mathematics, parameters, provenance, decision policy and limitations |
| [VALIDATION.md](VALIDATION.md) | Evaluation protocol and measured results on real images |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, data model, storage, jobs, workflows (with diagrams) |
| [SECURITY.md](SECURITY.md) | Controls, testing performed, operator responsibilities, known gaps |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Running locally and in production, configuration, operations |
| [docs/api/README.md](docs/api/README.md) | API guide; machine-readable description in `docs/api/openapi.json` |
| [LICENSE_DECISIONS.md](LICENSE_DECISIONS.md) | Dependency, dataset and reference-code licence decisions |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Rules and workflow for changes |
| [CHANGELOG.md](CHANGELOG.md) | Changes |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | Requirement checklist, test evidence, open issues |

## Development

```bash
make help
```

| Task | Command |
|---|---|
| Install dependencies | `make install` |
| Start PostgreSQL, Redis, object store | `make services` |
| Apply migrations | `make migrate` |
| Run API, worker, web on the host | `make dev-api`, `make dev-worker`, `make dev-web` |
| Lint and type-check | `make lint` |
| Engine tests | `make test-engine` |
| Backend integration tests | `make test-backend` |
| Browser end-to-end tests (stack running) | `make test-e2e` |
| Production web build | `make build-web` |
| Dependency audit | `make audit` |

## The engine on its own

```bash
cd engine && uv sync
```

```bash
uv run sensortrace enrol --out sensor.npz reference_images/*.jpg
```

```bash
uv run sensortrace compare --fingerprint sensor.npz questioned.jpg
```

## Reproducing the scientific evaluation

The evaluation uses a subset of the VISION dataset (Shullani et al. 2017, CC BY-SA 4.0), downloaded on
demand and never redistributed.

```bash
make eval-data
```

```bash
make evaluate
```

Results are written to `data/eval/vision_subset_v1/` (`report.md`, `results.json`, `scores.csv`,
`evaluation.png`, and `policy.json` when a calibrated policy is supported by the data). See
[VALIDATION.md](VALIDATION.md).

## Responsible use

Analyse only your own material or material you are authorised to investigate. SensorTrace has no public
fingerprint directory, no cross-account matching and no telemetry. See [SECURITY.md](SECURITY.md).

## Licence

No licence has been chosen yet; all rights reserved. See [LICENSE_DECISIONS.md](LICENSE_DECISIONS.md).
