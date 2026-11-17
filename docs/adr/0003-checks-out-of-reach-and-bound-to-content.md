# 3. Checks are out of the change's reach, and verification is bound to content

Date: 2026-11-18 · Status: accepted

## Context

Three holes let an agent's change pass verification it should not:

- The change could edit its own judge. `run-verify`, the Stop gate and the merge tier all read
  `.verify/config.json` from the working tree, and `make-evidence` left `.verify/` out of the change,
  so deleting a check or narrowing a lane's `files` left the tier at 1. Deleted files were invisible
  too (`workingChanges` drops them), so deleting a test raised nothing.
- Freshness was decided by file times. "Review newer than run, run newer than the files" breaks on
  `touch`, `checkout` and `rebase`, and says nothing about what content a review saw.
- The change was measured against the wrong thing. The Stop gate looked only at uncommitted files,
  so committing during a turn skipped it; `make-evidence` diffed against the upstream branch, so
  pushed commits stopped counting.

The Claude Code team's verification write-up states the rule plainly: a change must not be able to
modify its own checks, and a review applies to one specific commit.

## Decision

- **Base config.** The checks come from `.verify/config.json` on the base commit (merge-base with the
  default branch, or `VERIFY_BASE`). `run-verify --config working` uses the working copy, for a
  change that sets up or extends the checks.
- **Guarded changes.** A change to a guard file (`DEFAULT_GUARD` in `lib/verify-config.mjs`, plus the
  config's `guard`), a deleted test, or a test gaining a skip, focus, threshold or mask is merge tier
  3. A line anywhere that silences a type or lint check, or adds retries, is tier 2.
- **Content hash.** `run-verify` records a hash of the working tree (a `git write-tree` of a copy of
  the index after `add -A`, without `.verify/` and ignored files). Reviews name it on a `Tree:` line,
  the evidence pack prints it, and the Stop gate and the tier accept only runs and reviews of the tree
  now on disk. A check that changes the tree while it runs fails the run.
- **The change is everything since the base**, commits on the branch included, deletions included.
  A UserPromptSubmit hook records the tree when a turn starts, so the Stop gate checks only turns
  that changed content.
- **Gate modes.** `UI_WORKFLOW_GATE=enforce|observe|off`; every decision goes to `.verify/gate.log`.
- **The scripts have tests** (`test/`, `npm test`) and CI, because they are the judge.

## Consequences

A repository with no remote has no default branch to measure from, so the base is `HEAD` and a
committed edit to the config becomes the base; set `VERIFY_BASE` there. Setting up checks on a branch needs `--config working` until they reach the default branch. Reviews
written before 0.3 lack `Tree:` and must be redone. Hashing the tree costs one `git add -A` into a
temporary index per run and per stop. The guard patterns are a starting list and will need
project additions and pruning. Everything here still runs on the agent's machine, where the agent
can set `UI_WORKFLOW_GATE=off`; the authority for merges belongs in CI, which is the next step.
