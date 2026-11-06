# Verify: prove the screen is right

## Run the checks

`node <plugin>/scripts/run-verify.mjs` runs every check in `.ui-verify/config.json` and records the
result from real exit codes. Logs and screenshots land in the printed run folder.

| Check | Passes when |
| --- | --- |
| raw-styles | no palette classes, arbitrary values or literal colours in UI source |
| types, functional | the project's typecheck passes; its e2e suite or the `verify-<app>` journeys pass |
| look | every page in `ui-pages.json` at 390, 768 and 1280: no sideways scroll, no serious axe issue, screenshot matches its baseline |
| inspect | taste-skill `inspect.mjs` reports 0 FAIL (only design.md's allowances passed with `--allow`) |
| native (if any) | Maestro or the platform's runner captures each changed screen |

A check that cannot run here (no browser, server will not start, simulator missing): fix the setup
if you can; otherwise stop and tell the user exactly which check did not run. Never mark it passed.

## New pages

A page without a baseline fails its first `look` run. Add it to `ui-pages.json`, run the look tests
for that page with `--update-snapshots`, show the screenshots to the user, and keep them as the
baseline once they agree. Then run `run-verify.mjs` in full.

## Review the screenshots: someone else judges

The agent that built the change does not review it. Dispatch a fresh subagent (a different model
when one is available) with exactly this brief, and nothing about how the change was made:

```text
Review UI screenshots. Follow <skill>/design-review.md exactly.
Read: docs/design.md, .ui-verify/last-run.json (runDir), <web app>/e2e/ui-look/ui-pages.json.
Scope: <pages and widths the change touched, plus pages sharing a changed part>.
Deferred Should-fixes (record as "- [-]" follow-ups if still present): <list with reasons, or none>.
Baselines updated in this change (copy into the review): <page-width: what and why, or none>.
Write .ui-verify/review.md as design-review.md step 5 shows, with "Reviewer: <your model>" under
the title. Do not edit any other file. Reply with the verdict and the Blocker lines.
```

Then:

1. Read its review. You may disagree in your final message to the user; you may not edit its
   findings or its verdict.
2. Fix Blockers and the Should-fixes you take on, rerun `run-verify.mjs`, and dispatch a new fresh
   reviewer with the same brief. Never resume the previous reviewer; it would grade its own advice.
3. Defer a Should-fix only with a reason the user would accept; every deferral appears in your final
   message. Blockers are never deferred.
4. After three review rounds without `approved`, stop and give the user the open findings and the
   screenshots instead of starting a fourth.
5. No subagent tool here: review it yourself with `design-review.md` and write
   "Reviewer: same agent, no independent review available" under the title, and tell the user.

The Stop gate blocks your first attempt to stop until `.ui-verify/review.md` is newer than the run,
has no open `- [ ]` line, and says `Verdict: approved`. It lets the second attempt through so a turn
cannot loop forever; ending that way means your final message must say the UI is not verified.

## Evidence pack and merge tier

People read evidence instead of code. After the review, run
`node <plugin>/scripts/make-evidence.mjs --pr`. It writes `<runDir>/evidence.md`: the merge tier,
the checks, before/after screenshots per page and width, recordings, the verdict, open and deferred
findings and what was not checked. The Stop gate requires it and requires it newer than the review.

| Tier | When | Who must look |
| --- | --- | --- |
| 1 | checks pass, review approved, no baseline, shared part or design change | a glance at evidence.md is enough to merge |
| 2 | baselines updated or a shared part changed (`shared` in config) | the user looks at every before/after pair |
| 3 | `docs/design.md` or a token file changed (`tokens` in config) | the user confirms the design change before merge |
| not ready | checks failed or review not approved | nobody merges |

The tier is computed, never chosen. When you open a pull request, put the `--pr` output at the top
of its body, and attach the screenshots and recordings (or link the CI artifact of the run folder).
Your final message gives the evidence.md path and the tier in its first line. The user may later
decide that a tier needs less attention; that is their call, recorded in design.md, not yours.

## Baseline rules

A screenshot diff is a question, not an error to silence.

1. Open the expected, actual and diff images for every failing page.
2. Each diff is either caused by the intended change, or it is a defect. A defect is fixed in code.
3. Only for intended diffs: update those baselines (`--update-snapshots` for those tests only), on
   the OS or container recorded in setup, each listed under "Baselines updated" with its reason. When
   you commit, they go in a commit of their own.
4. Never loosen a threshold, add a mask, add an `--allow` id or edit a test to get a pass. Those
   change the contract; propose them to the user.
5. The final message names every updated baseline, so the user can look before merging.

Adapted from pstack (Lauren Tan, MIT): create-verification-skill and the visual-parity playbook.
