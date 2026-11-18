# Tasks: split an agreed spec into pull requests

For size L, after `flow-check.mjs spec` passes. Each task is one pull request: small enough to review
and to revert alone, verified alone, and owning specific acceptance criteria, so its review marks
exactly those.

## How to split

- **Vertical slices.** A task delivers something a user or caller can observe (its criteria), across
  the layers it needs. Not "all the models", then "all the endpoints", then "all the screens".
- **Contract first when lanes meet.** When the frontend needs a new endpoint, the first task changes
  the contract (OpenAPI, schema) and the backend; frontend tasks depend on it. A migration that
  must run before code reads it is its own task, expand before contract (`backend/build.md`).
- **S or M only.** About 400 changed lines at most. A larger task hides its risk and its review
  stalls; split it again.
- **Risk up front.** Guess each task's merge tier now (1, 2 or 3, with the reason). A tier 3 task
  needs the owner's attention: put it early, so a "no" comes before the work that depends on it.
- **Independent where possible.** Tasks without dependencies between them can be built in parallel.

If one of these is installed, use it to draft the split (`shared/skill-packs.md`):
`agent-skills:planning-and-task-breakdown`, `superpowers:writing-plans`, `mattpocock-skills:to-tickets`.
The task list of record is the file below; their plans and tickets can link to it.

## The file: `docs/specs/<slug>.tasks.md`

```markdown
# Tasks: <spec title>

## T1 Orders API accepts an Idempotency-Key
- lanes: api
- acceptance: A1, A2
- depends: none
- size: M
- risk: 3 · contract change (openapi.yaml)

## T2 Checkout sends the key and shows the first order on retry
- lanes: web, app
- acceptance: A3
- depends: T1
- size: M
- risk: 2 · shared checkout button
- status: done · PR #123
```

`lanes` are lane names from `.verify/config.json`.

## The gate

```bash
node <plugin>/scripts/flow-check.mjs tasks docs/specs/<slug>.tasks.md
```

Open when the spec gate is open, every criterion belongs to a task, every task names lanes,
criteria, a size of S or M and a risk tier, its lanes exist, and no dependency is missing or circular.

## Working through them

```bash
node <plugin>/scripts/flow-check.mjs next docs/specs/<slug>.tasks.md --done T1      # what can start now
node <plugin>/scripts/flow-check.mjs acceptance docs/specs/<slug>.md T2 --write      # its .verify/acceptance.md
```

Then the lane's `build.md` and `verify.md` as for any M change. The generated acceptance file names
the spec and the task; the evidence pack and the pull request body carry both.
