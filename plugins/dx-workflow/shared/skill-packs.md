# Working with other skill packs

Matt Pocock's skills, superpowers and agent-skills each cover the whole path from idea to merge, and
do several steps very well. Inside this plugin's flow they do the work of a step; this plugin keeps the
files of record and the gates. Use a skill below only when it appears in your available skills
(installed as a plugin they show as `mattpocock-skills:<name>`, `superpowers:<name>`,
`agent-skills:<name>`); otherwise follow this plugin's own instructions for the step.

## Who does which step

| Step | Use, if installed (first match) | This plugin's file of record and gate |
| --- | --- | --- |
| Define: interview, spec | `mattpocock-skills:grilling` · `grill-with-docs`; `agent-skills:interview-me` · `spec-driven-development`; `superpowers:brainstorming` | `docs/specs/<slug>.md`, `flow-check.mjs spec` (`shared/spec.md`) |
| Domain language | `mattpocock-skills:domain-modeling` · `grill-with-docs` | `GLOSSARY.md` |
| Tasks | `agent-skills:planning-and-task-breakdown`; `superpowers:writing-plans`; `mattpocock-skills:to-tickets` | `docs/specs/<slug>.tasks.md`, `flow-check.mjs tasks` (`shared/tasks.md`) |
| Test first | `mattpocock-skills:tdd`; `superpowers:test-driven-development`; `agent-skills:test-driven-development` | the negative check in `run-verify.mjs` |
| Parallel tasks | `superpowers:using-git-worktrees` · `dispatching-parallel-agents` | one task, one worktree, one `.verify/`, one pull request |
| Debug | `mattpocock-skills:diagnosing-bugs`; `superpowers:systematic-debugging`; `agent-skills:debugging-and-error-recovery` | `.verify/debug.md` (`shared/debug.md`) |
| Browser inspection | `agent-skills:browser-testing-with-devtools` (console errors, failed requests, performance) | findings go into the frontend review |
| Architecture, cleanup | `mattpocock-skills:improve-codebase-architecture` · `codebase-design`; `agent-skills:code-simplification` | its own change; old patterns removed (`shared/ratchet.md`) |
| Security, performance depth | `agent-skills:security-and-hardening` · `performance-optimization` | findings feed the review lenses and `docs/checklist.md` |
| Retro | `mattpocock-skills:retro` | `shared/ratchet.md` |

## Where they disagree with this plugin, this plugin wins

- **Files of record.** Specs live in `docs/specs/<slug>.md` and tasks in `docs/specs/<slug>.tasks.md`,
  in the formats `flow-check.mjs` reads. A pack that writes elsewhere (`docs/superpowers/specs/`,
  `SPEC.md`, `tasks/todo.md`, `.scratch/`, issue tracker tickets) is a draft or a mirror: carry the
  content over and link it under `Sources:`.
- **Done.** A change is done when this plugin's Stop gate lets it end: `run-verify.mjs` passed on the
  tree on disk, an independent review of that tree approved it from `review-brief.mjs`, and the evidence
  pack has a merge tier. "Tests pass" (`superpowers:verification-before-completion`) or a pack's own
  definition of done is part of that, not a replacement for it.
- **Review.** The independent review comes from `review-brief.mjs`. A pack's reviewers
  (`superpowers:requesting-code-review`, `agent-skills:code-review-and-quality`,
  `mattpocock-skills:code-review`, the task reviewer in `superpowers:subagent-driven-development`) may
  run as extra passes while building; their verdicts do not replace it and are not "Verdict: approved".
- **Merge.** The merge tier decides who must look. Do not merge locally or open a ready pull request
  before the evidence pack exists (`superpowers:finishing-a-development-branch` options "merge locally"
  and "push and create a PR" wait for it). A pack's `/ship` checklist adds to the tier; it cannot lower it.
- **Commits.** Plans that commit after each step are fine on the task's branch; the commit stamp
  (`stamp.mjs`) records whether each was verified.
- **Session start.** Meta-skills that route every message (`superpowers:using-superpowers`,
  `agent-skills:using-agent-skills`) may stay on; when one routes work in a project with
  `.verify/config.json`, start from this plugin's `flow` skill.
- **Never weaken a check** to satisfy a pack's step: a skipped test, a loosened threshold or an
  edited `.verify/config.json` is a guarded change whatever skill asked for it.

## Versions

The table was written against the commits in `vendor.lock.json` ("routed"). When a pack renames or
removes a skill, the step falls back to this plugin's own instructions; update the table in its own change.
