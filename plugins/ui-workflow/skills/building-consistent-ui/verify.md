# Verify: prove the screen is right

## Run the checks

`node <plugin>/scripts/run-verify.mjs` runs every check in `.ui-verify/config.json` and records the
result from real exit codes. Logs and screenshots land in the printed run folder.

| Check | Passes when |
| --- | --- |
| raw-styles | no palette classes, arbitrary values or literal colours in UI source |
| types, functional | the project's own typecheck and e2e pass |
| look | every page in `ui-pages.json` at 390, 768 and 1280: no sideways scroll, no serious axe issue, screenshot matches its baseline |
| inspect | taste-skill `inspect.mjs` reports 0 FAIL (only design.md's allowances passed with `--allow`) |
| native (if any) | Maestro or the platform's runner captures each changed screen |

A check that cannot run here (no browser, server will not start, simulator missing): fix the setup
if you can; otherwise stop and tell the user exactly which check did not run. Never mark it passed.

## New pages

A page without a baseline fails its first `look` run. Add it to `ui-pages.json`, run the look tests
for that page with `--update-snapshots`, show the screenshots to the user, and keep them as the
baseline once they agree. Then run `run-verify.mjs` in full.

## Review the screenshots

Open the screenshots in the run folder and look at them. Then write `.ui-verify/review.md`:

```markdown
# Review <run folder name>
- [x] <page> 390/768/1280: matches design.md <sections checked>
- [x] Consistency, group <group>: <pages> side by side at 390: same header, spacing, parts
- [ ] <anything still wrong, with the file to fix>
Baselines updated: <none | page-width: what changed and why it was intended>
Not checked: <dark mode, real device, …>
```

For consistency, put every page of the same `group` side by side at one width and ask: would a
user think these come from the same app? Differences in content are fine; differences in type,
spacing, colour roles or parts are findings.

Any `- [ ]` or `FAIL` line keeps the Stop gate closed. Fix, rerun, rewrite the review.

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
