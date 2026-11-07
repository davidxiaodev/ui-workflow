# Setup: a backend contract and checks for this project

Do this once per project, or once per service when a repo has several (each gets its own lane,
`api-<service>`, with `"kind": "api"`). The output is `docs/backend.md`, a contract file, the `api`
lane in `.verify/config.json`, and `ctl`. The user decides policy; you find what exists and write it down.

## 1. Inventory

From the repo, then the user for what the repo cannot tell you:

- Stack: language, framework, ORM or query layer, database, cache, queue, how it is deployed.
- API style and contract: REST with OpenAPI (generated from code or hand-written?), GraphQL schema,
  protobuf, or none.
- Migrations: tool, folder, whether down migrations exist, how they run in deploys.
- Tests: runner, what exists (unit, integration, e2e), whether any use a real database, how long they take.
- Clients: web app, phone apps (old versions stay installed), partners, webhooks consumers.
- Policies already in place: error format, auth model, pagination, idempotency, rate limits, logging.

## 2. Write `docs/backend.md`

Copy `<skill>/templates/backend.md` and fill every section from the inventory. Where the repo has no
policy yet, propose one with your reason and let the user agree; mark unconfirmed choices "chosen by
agent". Add one line to `CLAUDE.md` (create it if missing; also `AGENTS.md` if present):
"Before any backend work read docs/backend.md and use the building-reliable-backend skill."

## 3. The contract file

- OpenAPI: keep one spec file in the repo. If the framework generates it, add a script that writes
  it to the file, and a check that fails when the committed file differs from the generated one.
- GraphQL: the printed schema file, with `graphql-inspector diff` as the contract check.
- Protobuf: `buf breaking --against '.git#branch=main'`.
- None and the API has outside callers: propose adding one; until then the contract check is left
  out and every review says "contract not checked" under Not checked.

Contract check for OpenAPI: `oasdiff breaking <base spec> <spec> --fail-on ERR`, with the base spec
taken from the default branch (`git show origin/main:openapi.yaml > $VERIFY_RUN_DIR/base.yaml`).

## 4. Tests that can catch backend bugs

1. Integration tests run against a real database of the same engine and major version as production:
   `docker compose` with a test database, or testcontainers. Each test gets a clean state
   (transaction rollback or truncate), so tests can run in any order.
2. If the suite only has unit tests with mocked repositories, do not rewrite it now. Add the
   integration harness and one test through it for the most important flow, and tell the user what
   remains mocked.
3. Migrations check: on a fresh database, migrate up to head, down to the default branch's head, up
   again. For PostgreSQL add `squawk` on new migration files (locks, unsafe column changes).
4. Optional, only when the user wants it: property tests for parsers, money and date maths
   (fast-check, Hypothesis); `semgrep`, `gitleaks` and `osv-scanner` as a `security` check.

## 5. ctl and journeys

Follow `<plugin>/shared/ctl.md`: one control CLI with read and write subcommands, a `verify-<app>`
skill, and API journeys that call the running app and check the rows.

## 6. Wire `.verify/config.json`

1. The project must be a git repository (the Stop gate and the negative check read git). Ask before `git init`.
2. If `.verify/config.json` exists (the ui lane is set up), add the `api` lane from
   `<plugin>/shared/verify.config.json`; else copy that file and delete the `ui` lane.
3. `files`: everything a backend change touches, tests included (`<api dir>/**`, the migrations
   folder, the contract file). `contract` and `migrations`: their paths (a change there is tier 3).
   `shared`: modules many endpoints depend on (auth, db access, money) (a change there is tier 2).
4. Fill each check with the real command; leave a check out when the project has nothing for it yet,
   never invent one. `negative.test` runs the lane's unit and integration tests in one command, from
   the repo root. Set top-level `tests` if this repo's test files live elsewhere.
5. `.gitignore`: `.verify/*` and `!.verify/config.json`.
6. Run `node <plugin>/scripts/run-verify.mjs --lane api`. Every check must pass on the unchanged
   code; fix the setup, or tell the user which check is red before any change and why.
