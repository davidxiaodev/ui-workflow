# Verify: prove the backend change works

## Run the checks

`node <plugin>/scripts/run-verify.mjs --lane api` (or without `--lane` to run every lane) runs the
lane's checks from `.verify/config.json` and records the result from real exit codes.

| Check | Passes when |
| --- | --- |
| types, lint | the project's own commands pass |
| unit, integration | the suites pass; integration ran against a real database |
| negative | the tests pass on the current code, and fail with the lane's source changes taken back to the base commit |
| contract | no breaking change to the contract file against the default branch |
| migrations | up, down to base, up again on a fresh database; squawk finds nothing unsafe |
| functional | the ctl journeys pass against the running app and their row checks hold |
| security (optional) | the scanners report nothing at their failing level |

How to read a red result:

- **A check fails.** Fix the code under test. A changed source file breaking an untouched test is your
  bug, not a pre-existing one; call a red "pre-existing" only if it was red before your first edit.
- **The environment is missing** (no Docker, a service will not start, a secret or env var is absent).
  Report it with the log line. Do not stub the service, skip the test or point it at something else.
- **negative: "the changed tests still pass without the source change".** The new tests do not test
  the change. Strengthen them until they fail without it.
- **negative: "skipped: source changed but no test changed".** Fine for a pure refactor. For new
  behaviour, add the test; the reviewer will ask, and the tier becomes 2.
- **negative fails on a missing import only.** It proves little. Make the test reach the behaviour.
- **contract fails.** An intended break goes to the user (SKILL.md, Contract changes). Never edit the
  check, the base or the spec history to make it pass.
- **A run is interrupted during the negative check.** `run-verify.mjs --restore` puts the source back.

Rerun one check with `--only <name>` while fixing it, then the full lane before review. Stop after five
runs or when the same failure returns twice after a fix: report what is red and why.

Never weaken, skip, delete or edit a test, a check command or a threshold to get green. Those change the
contract; propose them to the user.

## Independent review

The agent that built the change does not review it. Dispatch a fresh subagent (a different model
when one is available) with exactly this brief, and nothing about how the change was made:

```text
Review a backend change. Follow <skill>/code-review.md exactly.
Read: docs/backend.md, .verify/acceptance.md, .verify/last-run.json (lanes.api), the diff from
<base ref> (git diff <base ref>), and the logs it names.
The user asked for: <the user's request, in their words>.
Deferred findings from earlier rounds (record as "- [-]" if still present): <list with reasons, or none>.
Write .verify/review-api.md as code-review.md shows, with "Reviewer: <your model>" under the title.
Do not edit any other file. Reply with the verdict and the Blocker lines.
```

Then:

1. Read its review. You may disagree in your final message; you may not edit its findings, its
   acceptance marks or its verdict.
2. Fix Blockers and the Should-fixes you take on, rerun `run-verify.mjs`, and dispatch a new fresh
   reviewer with the same brief. Never resume the previous reviewer.
3. Defer a Should-fix only with a reason the user would accept; every deferral is in your final message.
   Blockers and unmet criteria are never deferred.
4. After three rounds without `approved`, stop and give the user the open findings.
5. No subagent tool: review it yourself with code-review.md, write "Reviewer: same agent, no
   independent review available" under the title, and tell the user.

## Evidence pack and merge tier

After the review, `node <plugin>/scripts/make-evidence.mjs` (add `--pr` for a pull request body).

| Tier | When | Who must look |
| --- | --- | --- |
| 1 | checks pass, review approved, every criterion met, nothing below | a glance at evidence.md |
| 2 | a shared module changed, a criterion "not checked", source changed with no test change, baselines updated | the user reads the evidence and the flagged parts of the diff |
| 3 | `docs/backend.md`, the contract file or a migration changed | the user confirms before merge |
| not ready | a check failed, the review is not approved, a criterion not met or not reviewed | nobody merges |

The tier is computed, never chosen. Your final message is at least two lines: the evidence.md path and
the tier, then deferred follow-ups, criteria not checked, and checks that could not run (or "none").
