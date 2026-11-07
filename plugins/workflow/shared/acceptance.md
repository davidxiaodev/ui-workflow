# Acceptance: decide what "done" looks like before building

Every change gets `.verify/acceptance.md` before any product code is written. It lists what a user
or a caller can observe when the change works, each item with the proof that will show it. The
builder writes it; an independent reviewer later marks each item met, not met or not checked; the
evidence pack shows those marks apart from the machine checks, because tests passing is not the same
as the requirement being met.

## Size it to the change

| Change | Acceptance |
| --- | --- |
| Copy, a colour, a one-line fix | 1 to 3 criteria, no interview |
| A feature inside one lane, no contract change | the criteria plus the adverse cases below that apply |
| A new flow, an API or data contract change, a migration, auth | interview the user first (below), then the full list |

## Interview first when the change is big

Ask before writing criteria when the request leaves real decisions open: who uses it, what happens
on each failure, what must never happen, what is out of scope. One question at a time, each with
your recommended answer, so the user can just say yes. Stop when every criterion below can be written
without guessing. (mattpocock/skills `grilling` does this well when it is installed.)

## Write criteria a stranger could check

- Observable: what the user sees, what the API returns, which rows exist, which message was sent.
  Not "uses a transaction", not "the code is clean".
- One behaviour per line, with the input and the result: "POST /orders twice with the same
  Idempotency-Key → one order, the second call returns the first order's id with 200".
- Each names its proof: a test, a journey (`ctl` or Playwright), a screenshot page, a query. A
  criterion with no possible proof goes under "Not testable here" with the reason.
- Numbered `A1`, `A2`, … ; the Stop gate and the evidence pack match reviews to these ids.

## Adverse cases: decide each one

Go through the list for every lane the change touches. Each case becomes a criterion, or gets one line
under "Considered, not applicable" with the reason. Silently skipping one is the failure this list exists
to prevent.

**UI**

- invalid input and its message; required fields; very long text and empty text
- keyboard only: reach, operate and leave every control; visible focus
- slow request (loading state), failed request (error state with a way out), empty data
- double click or double submit; navigating away mid-request; back button
- 390px wide; long words and translations; dark mode if the product has one
- signed out, no permission, expired session

**API and data**

- boundaries: zero, one, maximum, just past maximum; empty and missing fields; wrong types
- auth: no token, expired token, another tenant's or user's resource (expect 403 or 404, never data)
- the same request twice (idempotency); two writers at once on the same row (last write, conflict or lock?)
- a downstream call fails, times out or is slow: what is retried, what the caller sees, what is left half done
- partial failure in a multi-step write: what state remains, how it recovers
- pagination and ordering stay stable while rows are inserted
- old clients: responses keep every field they read; old and new code both run against the migrated schema

## Template

```markdown
# Acceptance: <the change, one line>
Request: <the user's words, or a link to the issue>
Lanes: <ui, api>

## Criteria
- A1 <observable result for a given input or action> · proof: <test name, journey, page, query>
- A2 …

## Considered, not applicable
- double submit: the form has no submit (read-only page)

## Not testable here
- <criterion>: <why, and who checks it instead>
```

## Who marks the criteria

Not the builder. The independent reviewer (design-review.md for ui, code-review.md for api) copies
every id into the review's `## Acceptance` section and marks it from evidence they saw or re-ran:

```markdown
## Acceptance
- [x] A1 met · journeys/orders.e2e.ts "same key twice" passed; DB shows 1 row (log: api-functional.log)
- [ ] A2 not met · 429 is returned without Retry-After
- [-] A3 not checked · needs a real phone; the 390px screenshot is the stand-in
```

`- [ ]` blocks the Stop gate. `- [-]` (not checked) is allowed but makes the merge tier at least 2,
so a person looks. Every id must appear in some review, or the Stop gate stays closed.

When the request changes during the work, change acceptance.md first and say so to the user.
