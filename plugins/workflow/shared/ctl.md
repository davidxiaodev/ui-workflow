# ctl: give the agent hands and eyes on this app

Use this when the project has no scripted way to start the app, put it in a known state, drive what
a user or caller does, and look at the result (no e2e suite, no API journeys, or ones that skip the
paths you change). The output is a small control CLI in the repo, a project skill that teaches it,
journeys that use it, and a `functional` check per lane in `.verify/config.json`. Both lanes use the
same `ctl`: the ui lane drives screens, the api lane drives requests, and both read the same data.

You write it for the next agent, who will read it cold, mid-task.

## 1. Read the repo, ask the user only what you cannot see

- **Surfaces:** web UI, phone app, HTTP or GraphQL API, workers and queues, CLI. List each one.
- **Run:** the repo's own dev command, ports, env vars, services (database, cache, queue), seed data, sign-in.
- **Drive:** existing harnesses first (Playwright, Maestro, an HTTP client, a test factory); else
  Playwright for web, Maestro for phone, plain HTTP (`curl`, `hurl`, `fetch`) for APIs, a PTY for CLIs.
- **Observe:** screenshots, response bodies and status codes, rows in the database, queued jobs,
  sent mail (a local catcher such as Mailpit), logs, exit codes.
- **Isolate:** can two instances run side by side (ports, database names, data folders)? If not, the skill says so.

If the app does not start as checked out, fix that first or report exactly why.

## 2. Write the CLI: `scripts/ctl` (any language the repo already uses)

One entry point, subcommands split into reads and writes. Reads may run freely and in batches; every
write acts on one named thing, says what it changed, and refuses anything that looks like production.

| Kind | Subcommand | Does |
| --- | --- | --- |
| read | `doctor` | process up, right build, port owned by us, database migrated, sign-in works; exit non-zero with the reason |
| read | `status` | what is running, on which ports, against which database |
| read | `get <path>` / `query <name>` | one HTTP call or one named, read-only SQL query; prints the result as JSON |
| read | `screenshot <route> [--width 390]` | one screenshot into `$VERIFY_RUN_DIR` |
| write | `start` / `stop` | start or stop only what ctl started (record the PIDs); `start` waits until `doctor` passes |
| write | `reset` | empty test database, migrations, seed; refuses unless the database name or URL is a local or test one |
| write | `seed <fixture>` | load one named fixture |
| write | `login-as <role>` | create or reuse a session for a seeded user of that role; prints a token or a storage-state path |
| write | `call <METHOD> <path> [--json body]` | one non-GET request, printed with status, headers and body |

Rules:

- Writes take one target per call; there is no "reset everything" across environments and no
  wildcard delete. Every write prints what it changed.
- Writes refuse when `DATABASE_URL` or the base URL is not local or a known test host.
- Never kill by process name; stop only what `start` recorded.
- Evidence goes to `$VERIFY_RUN_DIR` when set (run-verify sets it), else `./.verify/scratch/`.

Suggest to the user (their decision, in `.claude/settings.json`): allow `scripts/ctl doctor|status|get|query|screenshot`
without asking, and leave the write subcommands to ask. Reads and writes in separate subcommands are
what make that possible.

## 3. Write the project skill `.claude/skills/verify-<app>/SKILL.md`

Frontmatter `name: verify-<app>` and a description naming the app, its surfaces and when to use it.
Sections, each from what step 1 found, no placeholders:

- **Launch:** `scripts/ctl reset && scripts/ctl start`, and how to tell it is usable (`ctl doctor`). From
  an empty database, including migrations and seed. Include teardown (`ctl stop`).
- **Doctor:** run `ctl doctor` first whenever anything looks off.
- **Drive:** real selectors from this repo (labels, roles, test ids), real routes and payloads,
  never coordinates. For APIs: the request with its auth, and what a correct response looks like.
- **Evidence:** what each journey captures. Prove the user's real path, not test-only endpoints or
  internal setters; capture the action and the resulting state; check side effects (rows written,
  jobs queued, mail sent) beside what is visible or returned. Mocks only where a production boundary
  already isolates a third party (payment provider, SMS), and say which.
- **Cleanup:** `ctl stop`; never delete the evidence.

## 4. Map the features

`.claude/skills/verify-<app>/features/README.md` plus one file per user-facing feature (start with 3
to 5): what it is, how a user or caller reaches it, how to drive it with ctl, the end state that proves
it works (screen, response and rows), gotchas. When seed data lacks a precondition, the journey fails
and the reason goes in Gotchas. Never weaken a journey to pass.

## 5. Script the journeys and wire them in

- Web: `e2e/journeys/<feature>.e2e.ts` (Playwright, signing in through `ctl login-as`).
- Phone: a Maestro flow, wrapped in `startRecording` / `stopRecording`, saving under `$VERIFY_RUN_DIR`.
- API: `journeys/api/<feature>.<test|hurl>` that calls the running app over HTTP and then checks the
  rows or jobs through `ctl query`. Not the framework's in-process test client: that skips the server,
  middleware and serialisation a real caller goes through.

Add one `functional` check to each lane in `.verify/config.json` that runs `ctl reset`, `ctl start`,
its journeys, and `ctl stop` (also on failure).

## 6. Prove it before handing over

Run Launch, Doctor, one journey per surface, Evidence, Cleanup end to end. Confirm the evidence
still exists after cleanup. A verify skill that never ran is a draft.

When a later change adds or changes a feature, update its file in `features/` and its journey in the
same change.

Adapted from pstack's `create-verification-skill` (Lauren Tan, MIT).
