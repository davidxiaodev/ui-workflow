# Setup: a backend contract and checks for this project

Do this once per project, or once per service when a repo has several (each gets its own lane,
`backend-<service>`, with `"kind": "backend"`). The output is `docs/backend.md`, a contract file, the `backend`
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
"Before any backend work read docs/backend.md and use the backend skill."

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

## 5. Guardrails the agent cannot ignore

Agents copy what the code already does, so encode the rules from `docs/backend.md` as checks, not
only prose (`<plugin>/shared/ratchet.md`, row one):

1. For every rule in `docs/backend.md` that is a pattern, add a lint rule whose message says the fix:
   for example `no-restricted-syntax` on SQL built with template strings, `no-restricted-imports` on
   the HTTP client outside the wrapper that sets timeouts, a rule against `console.log` of request
   bodies. Use the linter the repo already has; for Python, ruff's banned-api; for Go, forbidigo.
2. Module boundaries as a check (dependency-cruiser, eslint-plugin-boundaries, import-linter): which
   layers may import which.
3. Run the new rules over the whole repo. Fix what they find or allowlist it with a count that may only shrink.
4. Create `docs/checklist.md` with the header from `ratchet.md` and no items; items come from real
   mistakes. In `.verify/config.json`, fill the lane's `sensitive` paths (auth, billing, permissions,
   data deletion) with the user: changes there are always merge tier 3.
5. Optional: a `GLOSSARY.md` of the domain's terms (mattpocock/skills `grill-with-docs` builds one);
   names in code then follow it, and reviews and briefs get shorter.

## 6. ctl and journeys

Follow `<plugin>/shared/ctl.md`: one control CLI with read and write subcommands, a `verify-<app>`
skill, and API journeys that call the running app and check the rows.

## 7. Wire `.verify/config.json`

1. The project must be a git repository (the Stop gate and the negative check read git). Ask before `git init`.
2. If `.verify/config.json` exists (the frontend lane is set up), add the `backend` lane from
   `<plugin>/shared/verify.config.json`; else copy that file and delete the `frontend` lane.
3. `files`: everything a backend change touches, tests included (`<api dir>/**`, the migrations
   folder, the contract file). `contract` and `migrations`: their paths (a change there is tier 3).
   `shared`: modules many endpoints depend on (auth, db access, money) (a change there is tier 2).
4. Fill each check with the real command; leave a check out when the project has nothing for it yet,
   never invent one. `negative.test` runs the lane's unit and integration tests in one command, from
   the repo root. Set top-level `tests` if this repo's test files live elsewhere.
5. `.gitignore`: `.verify/*` and `!.verify/config.json`.
6. Run `node <plugin>/scripts/run-verify.mjs --lane backend --config working`. Every check must pass on
   the unchanged code; fix the setup, or tell the user which check is red before any change and why.
   (`--config working` because the checks are not on the default branch yet. Once they are, every run
   reads them from the base commit, so a later change cannot edit the checks that judge it; a change
   to the checks themselves runs with `--config working` and is merge tier 3.)
