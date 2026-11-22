# Documentation index

Where each document lives and what it is for. Dated working notes go in [`notes/`](notes/), not in this
folder's root.

## Start here

| Document | What it covers |
|---|---|
| [README.md](../README.md) | What SensorTrace is, how to run it, commands and project structure |
| [PRODUCT.md](../PRODUCT.md) | Purpose, users, tone and brand rules |
| [PROJECT_STATUS.md](../PROJECT_STATUS.md) | Every requirement with its verification status, open items and next priorities |
| [CHANGELOG.md](../CHANGELOG.md) | Changes by release |

## Science and validation

| Document | What it covers |
|---|---|
| [SCIENTIFIC_METHODOLOGY.md](../SCIENTIFIC_METHODOLOGY.md) | The mathematics, parameters, provenance, decision policy and limitations |
| [VALIDATION.md](../VALIDATION.md) | Evaluation protocol and measured results on real images |
| [validation/](validation/) | Machine output of the recorded evaluation runs: `vision_subset_v1` and `floreview_subset_v1` reports, results and plots |
| [research/literature-notes.md](research/literature-notes.md) | Literature notes on PRNU camera sensor fingerprinting |
| [research/datasets-and-licences.md](research/datasets-and-licences.md) | Reference implementations, dependency licences and evaluation datasets, as researched on 2026-11-12 |

## Architecture and decisions

| Document | What it covers |
|---|---|
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Components, data model, storage, jobs and workflows, with diagrams |
| [decisions/0001-architecture-and-stack.md](decisions/0001-architecture-and-stack.md) | ADR 0001: architecture and technology stack |
| [decisions/0002-forensic-method-and-decision-policy.md](decisions/0002-forensic-method-and-decision-policy.md) | ADR 0002: forensic method and conservative decision policy |
| [api/README.md](api/README.md) | API guide; the machine-readable description is [`api/openapi.json`](api/openapi.json) |

## Running and securing it

| Document | What it covers |
|---|---|
| [DEPLOYMENT.md](../DEPLOYMENT.md) | Running locally and in production, configuration, Vercel, operations |
| [SECURITY.md](../SECURITY.md) | Reporting a vulnerability, controls, testing performed, operator responsibilities, known gaps |

## Licences

| Document | What it covers |
|---|---|
| [LICENSE](../LICENSE), [NOTICE](../NOTICE) | Apache License 2.0 and attribution |
| [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) | Where the full third-party notices are and the obligations beyond a notice |
| [LICENSE_DECISIONS.md](../LICENSE_DECISIONS.md) | Dependency, dataset and reference-code licence decisions |

## Verification and audit records

| Location | What it holds |
|---|---|
| [audit/RELEASE_READINESS.md](../audit/RELEASE_READINESS.md) | Independent audit of 2026-11-12: summary and release readiness. Read this first |
| [audit/](../audit/) | The audit's scientific, security, licence, benchmark, reproducibility and traceability reports, the SBOM and the experiment scripts |
| [PROJECT_STATUS.md](../PROJECT_STATUS.md) | Test evidence for the current revision |

The audit records are dated snapshots and are not edited after the fact.

## Contributing and media

| Location | What it holds |
|---|---|
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Ground rules, checks and where each kind of change goes |
| [CLAUDE.md](../CLAUDE.md) | The working rules in short, for people and agents |
| [frontend/CONVENTIONS.md](../frontend/CONVENTIONS.md) | Conventions for the web application |
| [media/](media/) | The launch video and its poster frame, and what in them is illustrative |
| [notes/](notes/) | Dated working notes |
