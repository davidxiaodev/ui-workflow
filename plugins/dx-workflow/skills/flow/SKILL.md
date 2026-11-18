---
name: flow
description: Use at the start of any feature, fix or change request bigger than a one-line edit, and whenever unsure what comes next. Sizes the change and runs it through define, acceptance, tasks, build, debug, verify and learn, with a gate between each step; routes each step to the frontend or backend skill, or to an installed skill pack (Matt Pocock's skills, superpowers, agent-skills) where one does that step well.
---

# Flow: from request to merged, with a gate between every step

## Overview

The `frontend` and `backend` skills prove a change is right. This skill decides which steps a change
needs before that, in what order, and what must be true before the next step starts. Each step leaves
a file the next step reads, so a review's marks trace back to the goals the user agreed:

```text
request → spec (S goals, A criteria) → tasks (T, each owning some A) → .verify/acceptance.md
        → tests and code → run-verify → independent review → evidence pack + merge tier → ratchet
```

`<plugin>` is two levels up from this skill (it holds `scripts/` and `shared/`). Other skill packs
may do a step's work; the gates and the files of record stay this plugin's
(`<plugin>/shared/skill-packs.md`).

## 1. Size the change

| Size | When | Steps |
| --- | --- | --- |
| S | copy, a colour, a one-line fix, a config value; no contract, no migration, no auth, no native change | acceptance (1 to 3 criteria) → build → verify |
| M | one feature or fix inside one or two lanes that fits one pull request (about 400 changed lines), no contract change | acceptance with the adverse cases → build → verify |
| L | a new flow; an API, data or design contract change; a migration; auth or payments; a native change; more than one pull request; or the user cannot yet say what done looks like | define → acceptance in the spec → tasks → per task as M → verify each |

When unsure between two sizes, take the larger. Tell the user the size and the steps in one line
before starting, so they can say "smaller".

## 2. The steps and their gates

| Step | Produces | Gate to the next step | How |
| --- | --- | --- | --- |
| Define (L) | `docs/specs/<slug>.md`: problem, goals `S1…`, non-goals, constraints, decisions `D1…`, open questions `Q1…` | `node <plugin>/scripts/flow-check.mjs spec docs/specs/<slug>.md` exits 0: the user agreed it, no question is open, every goal has a criterion | `<plugin>/shared/spec.md` |
| Acceptance | L: the spec's `## Acceptance` (`A1 … (S1) · proof: …`). S and M: `.verify/acceptance.md` | every criterion observable, with a proof; adverse cases decided | `<plugin>/shared/acceptance.md` |
| Tasks (L) | `docs/specs/<slug>.tasks.md`: `T1…`, each with lanes, the criteria it delivers, dependencies, size S or M, a risk tier guess | `flow-check.mjs tasks docs/specs/<slug>.tasks.md` exits 0: every criterion in a task, no cycle, nothing larger than M | `<plugin>/shared/tasks.md` |
| Start a task | `.verify/acceptance.md` for that task, traced to the spec | `flow-check.mjs acceptance docs/specs/<slug>.md T<n> --write`, then add the adverse cases for its lanes | below |
| Build | tests first, then code, at the seams `docs/backend.md` and `docs/design.md` name | the new tests fail without the code (the negative check proves it later) | the lane's skill: `frontend` or `backend`, `build.md` |
| Debug | the root cause in `.verify/debug.md`, and a test that reproduces it | `run-verify.mjs` reports the same check failing two runs in a row: stop and diagnose before the next fix | `<plugin>/shared/debug.md` |
| Verify | `run-verify.mjs` pass, an independent review of the same tree, the evidence pack with a merge tier | the Stop gate; the tier says who must look | the lane's skill, `verify.md` |
| Learn | a check, a checklist item or a contract line for every Blocker, revert and correction | admitted with evidence, in its own change | `<plugin>/shared/ratchet.md` |
| Ship | the merge, by tier | tier 1: merge; 2: a person looks at what the pack flags; 3: the owner approves | your team's process; this plugin does not deploy |

A step's gate is a command or a file, not a feeling. If a gate is shut, the next step does not start;
say which gate and why.

## 3. Several tasks

- Take the tasks `flow-check.mjs next docs/specs/<slug>.tasks.md --done <ids>` lists; independent
  ones can run in parallel, each on its own branch and worktree (superpowers `using-git-worktrees`
  does this well). Every worktree has its own `.verify/`, so each task is verified alone.
- One task, one pull request, one evidence pack. Mark a task done in the tasks file
  (`- status: done · PR #123`) when its pull request merges, not when its code is written.
- When a task shows the spec was wrong, change the spec first (the user agrees again), then the
  tasks, then the code. Never let code and spec drift apart silently.

## 4. Size S and M

No spec file: write `.verify/acceptance.md` straight from the request with `shared/acceptance.md`
(for M, with the adverse cases), then the lane's `build.md` and `verify.md`. The steps are the same;
the define and tasks steps are empty.

## 5. When another skill pack is installed

Use it for the work inside a step, never for the gates. The table of which skill does which step,
and the rules when they disagree with this plugin, is `<plugin>/shared/skill-packs.md`. Read it
before invoking one of them inside this flow.
