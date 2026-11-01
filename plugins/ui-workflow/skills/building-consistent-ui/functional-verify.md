# Functional verify: drive the app the way a user does

Use this when the project has no scripted way to drive its UI (no e2e suite, or one that skips the
journeys you change). The output is a project skill, `.claude/skills/verify-<app>/`, plus one command
in `.ui-verify/config.json` that runs its journeys. You write it for the next agent, who will read it
cold, mid-task.

## 1. Read the repo, ask the user only what you cannot see

- **Surface:** what a user touches: web UI, phone app, CLI, API. Pick the primary one; list the rest.
- **Run:** the repo's own dev command, ports, env vars, seed data, sign-in.
- **Drive:** existing harnesses first (Playwright, Maestro, curl-able routes); else Playwright for web,
  Maestro for phone, a PTY for CLI.
- **Observe:** screenshots, response bodies, logs, exit codes, rows in the database.
- **Isolate:** can two instances run side by side? If not, the skill says so.

If the app does not start as checked out, fix that first or report exactly why.

## 2. Write `.claude/skills/verify-<app>/SKILL.md`

Frontmatter `name: verify-<app>` and a description naming the app, its surface and when to use it.
Sections, each from what step 1 found, no placeholders:

- **Launch:** the exact command, and how to tell it is usable (a log line, a page that answers with
  data), from an empty data folder including migrations and seed. Include teardown.
- **Doctor:** one read-only check: process up, right build, port owned by us, sign-in works.
- **Drive:** real selectors from this repo (labels, roles, test ids, routes), never coordinates.
- **Evidence:** what each journey captures and where (`$UI_VERIFY_RUN_DIR` when run by run-verify).
  Prove the user's real path, not test-only endpoints; capture the action and the resulting state;
  check side effects (rows written, emails queued) beside what is visible.
- **Cleanup:** stop only what you started; never delete the evidence.

## 3. Map the features

`features/README.md` plus one file per user-facing feature (start with 3 to 5): what it is, how a user
reaches it, how to drive it, the end state that proves it works, gotchas. When seed data lacks a
precondition, the journey fails and the reason goes in Gotchas. Never weaken a journey to pass.

## 4. Script the journeys

Write each mapped journey as a runnable test (`e2e/journeys/<feature>.e2e.ts` for web, a Maestro flow
for phone) and add one `functional` check to `.ui-verify/config.json` that runs them.

## 5. Prove it before handing over

Run Launch, Doctor, one journey, Evidence, Cleanup end to end. Confirm the evidence still exists after
cleanup. A verify skill that never ran is a draft.

When a later change adds or changes a feature, update its file in `features/` and its journey in the
same change.

Adapted from pstack's `create-verification-skill` (Lauren Tan, MIT).
