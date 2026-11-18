# 4. Reviews that converge, a project checklist, and a ratchet

Date: 2026-11-18 · Status: accepted

## Context

Each review round dispatched a fresh reviewer with the same hand-written brief. Fresh reviewers
re-read everything, re-flag old code, and phrase old findings anew, so rounds do not converge (the
Claude Code team saw one change run fifty rounds overnight, mostly on code from before the first
pass). The adverse-case list in `acceptance.md` is generic; nothing turned a project's own incidents
into something the next review checks. Nothing measured whether a change to `code-review.md` made
reviews better or worse. And a finding fixed in code was fixed once: no check stopped it recurring.

## Decision

- `review-brief.mjs` writes every brief: the tree, a depth (quick, standard, deep; deep for
  contracts, migrations, `sensitive` paths and changed checks, where a Blocker must survive an
  attempt to disprove it), the `docs/checklist.md` items the diff triggers, and from round 2 the
  previous findings plus only the diff since the reviewed tree. It refuses a fourth round.
  The reviewer stays fresh each round (independence from the builder), but no longer starts blind.
- Findings in untouched code are `Pre-existing` and do not block. A finding that is one of a class
  lists every instance.
- `docs/checklist.md`: items with a diff-readable trigger, a check, and a source incident. Read from
  the base commit; changing it is a guarded change (tier 3).
- `shared/ratchet.md`: every Blocker, revert and user correction becomes, in order of preference, a
  deterministic check, a checklist item, or a contract line; admitted with evidence, shipped as its
  own change, pruned monthly.
- `evals/`: known-bug cases and clean controls, built and briefed the way real changes are; score
  recall and false Blockers before changing the reviewer.
- Also: `sensitive` paths are tier 3; `run-verify` stops a lane at the first failing check; commits
  carry a `Verified:` trailer; evidence and PR bodies state the door, blast radius and how to revert;
  a CI template reruns the checks from the base branch's config and computes a checks-only tier.

## Consequences

Briefs are generated, so changing what reviewers get means changing a script with tests. Round state
lives in `.verify/rounds-<lane>.json` and resets when `acceptance.md` changes. The eval set is small
and backend-only; it grows with real incidents, and UI cases need screenshots that are not built yet.
CI does not run the independent review; how it should (committed reviews, or a reviewer in CI) is
still open.
