## What

Describe the change.

## Why

Explain the problem it solves.

Fixes #

## Verification

How you checked it works. Paste the commands you ran and their results.

- [ ] `make lint`
- [ ] `make test`
- [ ] `make test-e2e` (stack running), if the change touches a workflow in the browser
- [ ] Screenshots or a recording, if the interface changed

## Checklist

- [ ] The change is focused and contains no unrelated edits
- [ ] No secrets, `.env` files, evidence, datasets or fingerprints committed
- [ ] New dependencies are recorded in `LICENSE_DECISIONS.md`
- [ ] If numerical output changed: `ALGORITHM_VERSION` bumped, regression tests updated, evaluation re-run
- [ ] If decision logic changed: `DECISION_POLICY_VERSION` bumped
- [ ] Documentation, `CHANGELOG.md` and `PROJECT_STATUS.md` updated where behaviour or status changed

By submitting this pull request I agree that my contribution is licensed under the Apache License 2.0.
