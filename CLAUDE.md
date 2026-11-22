# SensorTrace working rules

Rules for anyone, human or agent, changing this repository. `CONTRIBUTING.md` is the full version;
this file is the short list to keep in mind on every change.

## Before you start

- Check `git status` and `git remote -v`, then fetch `origin`. `main` is protected: every change goes
  through a pull request with the five CI checks passing, and only squash merges are allowed.
- Read `PROJECT_STATUS.md` for what is verified, experimental and open, and the GitHub issue you are
  working on for its acceptance criteria.
- The web application lives in `frontend/` and has its own `CLAUDE.md`, `AGENTS.md` and
  `CONVENTIONS.md`. Read them before touching the UI.

## Scientific honesty (release-blocking)

- Never fabricate or hard-code a result, threshold or error rate. Never present a statistic as a
  probability of origin.
- Do not change an algorithm to make a test pass. Find out which one is wrong and record why.
- Any change to numerical output bumps `ALGORITHM_VERSION` in
  `engine/src/sensortrace_engine/version.py`, adds or updates regression tests and needs the evaluation
  re-run. A change to decision logic bumps `DECISION_POLICY_VERSION`.
- Anything without empirical validation is labelled experimental in code, UI and documentation.
- Use the four outcome labels exactly. Avoid "identified", "proven", "certain", "confidence" and any
  percentage of likelihood. State limitations next to results.

## Security and data

- New endpoints use `owned()` for every object they touch and come with an authorisation test from a
  second account.
- Never commit secrets, `.env` files, evidence, datasets or fingerprints.
- No new dependency without a licence check recorded in `LICENSE_DECISIONS.md`. GPL, AGPL and
  non-commercial licences are not accepted in shipped code. No third-party PRNU source code.
- A database schema change needs its migration applied to the production database before the change
  reaches `main` (see `DEPLOYMENT.md`, Vercel section). Say so in the pull request.

## Workflow

- One GitHub issue per feature, bug, follow-up or known limitation, with at least one label, the
  current milestone, a Problem section and acceptance criteria. Post progress as dated comments.
- Branches: `feat/...`, `fix/...`, `docs/...`, `chore/...` or `test/...`.
- Commits: gitmoji plus a conventional type, for example `✨ feat: ...`, `🐛 fix: ...`,
  `📝 docs: ...`, `🔒 fix: ...`. One logical change per commit; never mix engine, API, UI and docs
  changes in one commit. Reference the issue.
- Run the checks that fit the change before committing: `make lint`, `make test`, and `make test-e2e`
  with the stack running for browser workflows. After an API change run `make openapi`; CI fails if
  `docs/api/openapi.json` is out of date.
- Pull requests: gitmoji title, What, Why and Verification sections, `Fixes #n`, green CI, then squash
  merge.
- Update `CHANGELOG.md` and `PROJECT_STATUS.md` when behaviour or status changes. Dated working notes go
  in `docs/notes/`, never the `docs/` root.

## Writing

- British English everywhere: code comments, UI copy, docs, commits and pull requests.
- No em dashes or double hyphens in prose. Use a comma, colon, full stop or brackets instead.
- No AI attribution of any kind in commits, pull requests, issues or code comments.
- Tone and brand rules for anything user-facing are in `PRODUCT.md`.
