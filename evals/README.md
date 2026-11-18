# Reviewer evals

`code-review.md` is the prompt every project's backend review runs on. Changing it, the brief
(`review-brief.mjs`) or the reviewer's model changes what gets caught, so every such change is
scored here first: known bugs it must find, and clean changes it must approve without inventing
Blockers.

```bash
node evals/run.mjs all --reviewer "claude -p --permission-mode acceptEdits"   # prepare, review, score
node evals/run.mjs all                                                          # prepare only, print briefs
node evals/run.mjs score <project dir> <case>                                   # score one review
```

Each case becomes a small git project: `before/` committed on `main`, `after/` on a branch, the
acceptance criteria written, `run-verify` run, and the brief written by `review-brief.mjs`, exactly as
in a real change. The reviewer gets only the brief.

| Metric | Means |
| --- | --- |
| recall | bug cases where an open Blocker or Should-fix line matches every `match` regex |
| as Blocker | the same, counting only Blockers |
| clean approved | clean cases approved with no open Blocker |
| false Blockers | open Blockers across clean cases |

Results go to `evals/results/`. Compare with the last run before you merge a change to the
reviewer; a drop in recall or a rise in false Blockers is a regression.

## Adding a case

Every incident a review should have caught becomes a case (`shared/ratchet.md`). Keep the code as
small as the bug allows, write the `answer` as one sentence, and make `match` specific enough that a
vague finding does not count ("orders" and "not scoped|owner|IDOR", not just "security"). Add a
clean case for every two bug cases, so tuning for recall cannot pass by flagging everything. Keep
cases used to tune the prompt apart from a few held back for a final check.
