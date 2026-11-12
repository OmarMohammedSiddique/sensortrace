# Contributing

## Ground rules

1. **Scientific honesty is release-blocking.** Never fabricate or hard-code a result, a threshold or an
   error rate. Never present a statistic as a probability of origin. A capability without empirical
   validation is labelled experimental in code, UI and documentation.
2. **Do not change an algorithm to make a test pass.** If a test disagrees with the algorithm, find out
   which one is wrong and record why.
3. **Any change to numerical output bumps `ALGORITHM_VERSION`** (`engine/src/sensortrace_engine/version.py`),
   adds or updates regression tests, and requires re-running the evaluation. Changes to decision logic
   bump `DECISION_POLICY_VERSION`.
4. **No new dependency without a licence check.** Record it in `LICENSE_DECISIONS.md`. GPL, AGPL and
   non-commercial licences are not accepted in shipped code.
5. **No third-party PRNU source code.** Implement from published descriptions; cite them.
6. **Security controls are not optional.** New endpoints use `owned()` for every object they touch and
   come with an authorisation test from a second account.
7. **Never commit** secrets, `.env` files, evidence, datasets or fingerprints.

## Setup

```bash
make install
```

```bash
make migrate
```

## Checks before you commit

```bash
make lint
```

```bash
make test
```

With the stack running (`make up`):

```bash
make test-e2e
```

## Where things go

| Change | Location | Also update |
|---|---|---|
| Algorithm, statistic, decision rule | `engine/src/sensortrace_engine/` | Version constant, engine tests, `SCIENTIFIC_METHODOLOGY.md`, evaluation |
| API endpoint or schema | `backend/app/routers/`, `schemas.py` | Integration and authorisation tests, `make openapi` |
| Database model | `backend/app/models.py` | `cd backend && uv run alembic revision --autogenerate -m "..."`; review the generated migration |
| UI | `frontend/src/` | Playwright tests for workflow changes; follow `frontend/CONVENTIONS.md` |
| Limits, configuration | `backend/app/config.py` | `.env.example`, `DEPLOYMENT.md` |

## Tests

- Engine tests use synthetic sensors for determinism. Synthetic data must never be used to claim
  real-world accuracy; that comes only from `make evaluate`.
- Backend tests run against real PostgreSQL, Redis and object storage (`make services`). Do not mock the
  thing under test.
- The reference cross-check needs the oracle: `make reference-oracle`. It is skipped when absent.

## Commits

Small, coherent, working changes with an imperative subject line. Update `CHANGELOG.md` and
`PROJECT_STATUS.md` when behaviour or status changes.

## Wording in UI and reports

Use the four outcome labels exactly. Avoid "identified", "proven", "certain", "confidence" and any
percentage of likelihood. Distinguish camera model from physical sensor. State limitations next to
results, not on a separate page only.
