# Backend contract

Every backend change follows this file. Changing it is a contract change (merge tier 3): the owner
decides, in its own commit. Mark choices nobody confirmed with "chosen by agent".

## Shape

- Services and where they live: <name: folder, what it owns>
- Contract file: <openapi.yaml | schema.graphql | proto/ | none, and why>
- Clients and how long old versions live: <web (deploys with us), iOS/Android (old versions for N months), partners>

## Errors

- Format: <e.g. RFC 9457 problem+json: type, title, status, detail, request_id>
- Status codes: 400 invalid input, 401 no or bad credentials, 403 not allowed, 404 not found or not
  yours, 409 conflict, 422 <if used>, 429 rate limited with Retry-After, 5xx never for caller mistakes.
- Never in a response or a log: stack traces, SQL, secrets, tokens, <personal data fields>.

## Auth

- How a caller authenticates: <session cookie | bearer JWT | API key>
- Where it is enforced: <middleware, decorator>; routes without it: <list, or "none">
- Ownership: every object read or write is scoped by <tenant_id / user_id> in the query, not after it.

## Writes

- Idempotency: <Idempotency-Key header on POSTs that create | natural keys with unique constraints>
- Concurrency: <optimistic version column | atomic WHERE state = old | row locks>, and which applies where.
- Transactions: <what must be in one transaction>; no network calls inside one.
- Outbound calls: timeout <n s>, retries <n with backoff, only idempotent calls>.

## Data and migrations

- Database and version: <PostgreSQL 16>; migrations tool: <…>; folder: <…>
- Rules: every migration has a working down; expand then contract for renames and drops; backfills in
  batches of <n>; indexes on tables over <n> rows `CONCURRENTLY`; code and schema stay compatible with
  the previous release during a deploy.

## Lists

- Pagination: <cursor | offset>, default <n>, maximum <n>; stable order by <created_at, id>.

## Tests

- Seams: <HTTP routes through the running app for journeys; service functions for logic>
- Integration tests use: <docker compose db | testcontainers>, reset by <transaction rollback | truncate>
- Mocked only at: <payment provider, SMS, email (Mailpit locally)>

## Observability

- Every request logs: <request_id, route, status, duration, user or tenant id>
- Metrics or traces: <…>

## Merge policy

<Owner-approved exceptions to the merge tiers, e.g. "tier 2 for shared changes in src/db needs only the evidence page". Empty by default.>
