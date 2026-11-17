# Verify: prove the screen is right

## Run the checks

`node <plugin>/scripts/run-verify.mjs --lane ui` runs the ui lane's checks in `.verify/config.json`
(without `--lane`, every lane) and records the result from real exit codes. Logs and screenshots land
in the printed run folder. When the change also touched the api lane, both lanes must pass.

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

The agent that built the change does not review it. Write the brief with

```bash
node <plugin>/scripts/review-brief.mjs --lane ui --request "<the user's request, in their words>" \
  --scope "<pages and widths the change touched, plus pages sharing a changed part>" \
  --baselines "<page-width: what and why, or none>"
```

and dispatch a fresh subagent (a different model when one is available) with exactly its output,
and nothing about how the change was made. The brief names the tree under review, sets the depth,
lists the `docs/checklist.md` items the diff triggers, and from the second round on gives the
reviewer the previous findings and only the diff since then. Put deferred Should-fixes, one per line
with the reason, in `.verify/deferred-ui.md` before writing the brief.

Then:

1. Read its review. You may disagree in your final message to the user; you may not edit its
   findings or its verdict.
2. Fix Blockers and the Should-fixes you take on, rerun `run-verify.mjs`, write a new brief, and
   dispatch a new fresh reviewer. Never resume the previous reviewer; it would grade its own advice.
3. Defer a Should-fix only with a reason the user would accept; every deferral appears in your final
   message. Blockers are never deferred.
4. After three review rounds without `approved`, `review-brief.mjs` refuses a fourth (exit 3): stop
   and give the user the open findings and the screenshots.
5. After an approved review, go through `<plugin>/shared/ratchet.md` for every Blocker: a visual
   mistake that a script could catch (a raw colour, a missing state page, a clipped label) becomes a
   check, not a reminder.
6. No subagent tool here: review it yourself with `design-review.md` and write
   "Reviewer: same agent, no independent review available" under the title, and tell the user.

The Stop gate blocks your first attempt to stop until the run and `.verify/review-ui.md` both name
the tree now on disk (a content hash, not file times), the review has no open `- [ ]` line,
accounts for every acceptance id, and says `Verdict: approved`. It lets the second attempt through so a turn
cannot loop forever; ending that way means your final message must say the UI is not verified.

## Evidence pack and merge tier

People read evidence instead of code. After the review, run
`node <plugin>/scripts/make-evidence.mjs` (add `--pr` when you will open a pull request). It writes `<runDir>/evidence.md`: the merge tier,
the checks, before/after screenshots per page and width, recordings, the verdict, open and deferred
findings, what was not checked, and the merge danger (door, blast radius, how to revert). The Stop
gate requires it for the tree on disk, written after the review.

| Tier | When | Who must look |
| --- | --- | --- |
| 1 | checks pass, review approved, every criterion met, nothing below | a glance at evidence.md is enough to merge |
| 2 | baselines updated, a shared part changed (`shared` in config), a criterion "not checked", or a check silenced in the code (`@ts-ignore`, `eslint-disable`) | the user looks at every before/after pair and the unchecked criteria |
| 3 | `docs/design.md` or a token file changed (`tokens` in config), or an api contract or migration; or the checks themselves changed: `.verify/config.json`, `playwright.config.*`, the look tests, lint or CI config, a deleted test, a test that skips, masks or loosens a comparison | the user confirms before merge |
| not ready | checks failed, review not approved, a criterion not met or not reviewed, or the run or the review is of a different tree than the one on disk | nobody merges |

The tier is computed, never chosen. When you open a pull request, put the `--pr` output at the top
of its body, and attach the screenshots and recordings (or link the CI artifact of the run folder).
Your final message is at least two lines, however short the user asks for: first the evidence.md
path and the tier, then the deferred follow-ups and what was not checked (or "none").

The user may decide that some tier-2 changes need less attention. That is their call, written by
them or with their approval in design.md's Merge policy, in its own commit. It changes who must look
from the next change on; it never changes the computed tier, and never applies to the change in
progress.

## Baseline rules

A screenshot diff is a question, not an error to silence.

1. Open the expected, actual and diff images for every failing page.
2. Each diff is either caused by the intended change, or it is a defect. A defect is fixed in code.
3. Only for intended diffs: update those baselines (`--update-snapshots` for those tests only), on
   the OS or container recorded in setup, each listed under "Baselines updated" with its reason. When
   you commit, they go in a commit of their own.
4. Never loosen a threshold, add a mask, add an `--allow` id or edit a test to get a pass. Those
   change the contract; propose them to the user.
5. After updating baselines, rerun `run-verify.mjs` in full; the review and the evidence pack always
   come after the last run.
6. The final message names every updated baseline, so the user can look before merging.

Adapted from pstack (Lauren Tan, MIT): create-verification-skill and the visual-parity playbook.
