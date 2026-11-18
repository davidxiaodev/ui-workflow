# Define: a spec the user agrees before anything is built

For size L (`skills/flow/SKILL.md`). The spec says what problem this solves, what outcome counts as
success, what it will not do, and the observable criteria that prove it. It is a file in the repo,
`docs/specs/<slug>.md`, because tasks, acceptance files, reviews and evidence packs point back to it.

## 1. Get the answers

Interview the user until every goal and criterion can be written without guessing: who it is for,
what problem, what success looks like, what must never happen, what is out of scope, which failure
cases matter. One question at a time, each with your recommended answer. Look in the code before
asking what the code can tell you.

If one of these is installed, use it for the interview (`shared/skill-packs.md`):
`mattpocock-skills:grilling` (or `grill-with-docs` to also build the glossary),
`agent-skills:interview-me` or `agent-skills:spec-driven-development`, `superpowers:brainstorming`.
Whatever it writes, the spec of record is the file below; link theirs under `Sources:`.

## 2. Write the spec

```markdown
# Spec: <the change, one line>
Status: draft
Owner: <who decides the open questions>
Sources: <the issue, the conversation, a design doc another skill wrote>

## Problem
<who has it, when, what it costs them today>

## Goals
- S1 <an outcome you could observe or measure: "a returning customer reorders in two taps">
- S2 …

## Non-goals
- <what this does not do, so nobody builds it>

## Constraints
- <deadlines, platforms, compatibility (old app builds, old API clients), performance, data rules>

## Decisions
- D1 <what was decided> · <why> · <who decided>

## Open questions
- Q1 <question> · owner: <who>                      (open: blocks the gate)
- Q2 <question> → D3                                (answered: the decision records it)
- Q3 <question> · deferred: <why it is safe to build without the answer>

## Acceptance
- A1 <observable result for an input or action> (S1) · proof: <test, journey, screenshot page, query>
- A2 … (S1, S2) · proof: …
```

Criteria follow `shared/acceptance.md` (observable, one behaviour each, with a proof) and cite the
goals they prove. Go through its adverse cases for every lane the work touches; the ones that apply
become criteria here.

## 3. The gate

```bash
node <plugin>/scripts/flow-check.mjs spec docs/specs/<slug>.md
```

It stays shut until `Status: agreed`, every goal has a criterion, every criterion cites real goals
and names a proof, there are non-goals, and no question is open. Only the user sets `Status: agreed`:
show them the spec, ask, then write it. Commit the spec on its own (`docs(spec): <slug>`), before code.

When the work later shows the spec is wrong, change the spec first, set `Status: draft`, get it
agreed again, then change tasks and code.
