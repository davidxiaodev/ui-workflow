---
name: building-reliable-backend
description: Use when building, changing, reviewing or debugging server-side code - HTTP, GraphQL or RPC endpoints, database schema and migrations, background jobs, queues, webhooks, auth and permissions; when setting up a project's backend checks; or when asked whether a backend change is safe to merge.
---

# Building a reliable backend

## Overview

A backend change is done when what a caller can observe was decided before building, the code was
built test first at agreed seams, `run-verify.mjs` passed for the `api` lane (including a negative
check proving the tests can fail), a reviewer who did not write it marked every acceptance criterion
from evidence, and the evidence pack says how much a person must look before merging.

`docs/backend.md` plus the contract file (OpenAPI, GraphQL schema, proto) and the migrations folder are
the contract. `<skill>` is this skill's folder; `<plugin>` is two levels up (it holds `scripts/` and `shared/`).

## Route by what exists

| Project state | Read |
| --- | --- |
| No `docs/backend.md` or no `api` lane in `.verify/config.json` | `setup.md`, then come back |
| Any change | `<plugin>/shared/acceptance.md` first: write `.verify/acceptance.md` |
| Building or changing endpoints, jobs, schema | `build.md`, then `verify.md` |
| Asked only to review a change | `verify.md` (dispatch), then `code-review.md` |
| No scripted way to start the app and drive requests | `<plugin>/shared/ctl.md` |
| The change also touches screens | the `building-consistent-ui` skill for the ui lane; both lanes must pass |

## Contract changes

A change that removes or renames a response field, changes a type or status code, adds a required
input, tightens auth, or changes stored data in a way old code cannot read is a contract change. Before
touching code, tell the user three things: who breaks (which clients, which versions), the
non-breaking way (add beside, deprecate, expand then contract), and their choice. Build the
non-breaking way unless they choose the break. It is tier 3 either way.

## Red flags

| Thought | Reality |
| --- | --- |
| "Acceptance is obvious, skip it" | Then it takes three lines. Write them |
| "I'll mock the database, it's faster" | Mocks hide the queries, constraints and transactions that break. Integration tests use a real database |
| "The test client hits the route, that is end to end" | It skips the server, middleware and serialisation. Journeys call the running app |
| "The tests pass" | Run the negative check: tests that pass without the change test nothing |
| "The failure says the database is down, I'll stub it" | Report the environment problem; never stub or skip around it |
| "Just skip this flaky test / raise the timeout" | That changes the contract; propose it to the user |
| "I'll review my own diff, it's faster" | The builder grades too kindly; dispatch a fresh reviewer |
| "It's backwards compatible" | oasdiff and the migrations check say so, or it is unproven |
| "Small migration, no need for the down step" | The migrations check runs up, down, up on a fresh database |

## Done means

`run-verify.mjs` printed `pass` for every lane the change touched; `.verify/review-api.md` (written
with `code-review.md` by a fresh reviewer) is newer than that run, has no open line, marks every
acceptance id and says `Verdict: approved`; `make-evidence.mjs` wrote the evidence pack after it;
and your final message starts with the evidence path and the merge tier, then lists the follow-ups,
the criteria not checked, and what could not run.
