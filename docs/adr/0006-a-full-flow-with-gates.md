# 6. A full flow with gates, delegating the steps

Date: 2026-11-18 · Status: accepted

## Context

The plugin proved a change right (acceptance, checks, independent review, evidence, tier) but said
nothing about the steps before and around that: when to write a spec, how to split work into pull
requests, what to do when a check keeps failing. Agents improvised between the pieces, and a
misunderstood requirement surfaced only at review. Matt Pocock's skills, superpowers and agent-skills
each cover the whole path and do several steps very well; each also has its own files, its own
definition of done, its own reviewers and, for some, its own merge.

## Decision

- A `flow` skill is the entry: it sizes a change (S, M, L) and runs it through define, acceptance,
  tasks, build, debug, verify and learn, with a gate between steps.
- The gates are commands. `flow-check.mjs spec` (agreed, no open question, every goal has a criterion
  with a proof), `tasks` (every criterion in a task, lanes exist, tasks S or M with a risk tier, no
  cycle), `next`, and `acceptance --write`, which generates a task's `.verify/acceptance.md` with
  `Spec:` and `Task:` lines that the evidence pack and pull request body carry. `run-verify.mjs`
  counts consecutive failures per check and sends the second to `shared/debug.md`; the root cause in
  `.verify/debug.md` appears in the evidence pack.
- Files of record: `docs/specs/<slug>.md` and `docs/specs/<slug>.tasks.md`.
- Other skill packs do the work inside steps when installed (`shared/skill-packs.md`); this plugin
  keeps the files of record, the definition of done, the independent review and the merge tier. Their
  versions are pinned under `routed` in `vendor.lock.json`; they are never vendored.
- Shipping (deploy, rollout, monitoring, rollback) is out of scope until the team's deployment
  setup is known; merging follows the tier.

## Consequences

Large changes take a spec and a task list before code, and the user agrees the spec. The routing
table depends on other packs' skill names; when one is renamed the step falls back to this plugin's
own text. The consecutive-failure trigger is advisory: it prints and records, it does not block.
