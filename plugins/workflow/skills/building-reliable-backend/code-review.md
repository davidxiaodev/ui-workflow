# Code review: an independent check of a backend change

You did not write this change. Your job is to find out whether it does what was asked, and what it
breaks, from evidence you can see or re-run, not from how convincing the code reads. Report findings,
acceptance marks and a verdict; fix nothing.

## 1. Read the inputs

- `.verify/acceptance.md` and the user's request from your brief. If they disagree, that is a Blocker.
- `docs/backend.md`: the project's own decisions. Judge against them, not a generic ideal.
- The diff from the base ref, and `.verify/last-run.json` → `lanes.api`: which checks ran, their
  notes, their logs. A check missing from the run is "not checked", never "passed".

## 2. Acceptance: verify each criterion yourself

For every id in acceptance.md decide from evidence:

1. Find the proof it names (a test, a journey, a query). Open the test: does it assert the
   criterion's observable result for that input, or something weaker (status only, a mocked call, a
   snapshot of whatever the code returned)?
2. Re-run the cheapest proof yourself when you can (`scripts/ctl get …`, the one test, `ctl query`).
   A criterion you only read about is at most "met (read, not run)".
3. Read the negative check's log for the tests behind this criterion: they must fail without the
   change, on an assertion.

Mark it `- [x] A<n> met · <the evidence>`, `- [ ] A<n> not met · <what you saw>`, or
`- [-] A<n> not checked · <why>`. Also check the adverse cases acceptance.md marked not applicable:
a wrong "not applicable" is a finding.

## 3. Standards and the diff, by lens

Run each lens whose subject is in the diff; list the others once as "not applicable". For each lens,
cite `file:line`.

| Lens | Look for |
| --- | --- |
| Data and migrations | reversible down; data loss (drops, narrowing types, NOT NULL without backfill); long locks (index without CONCURRENTLY, table rewrite); old code against new schema during deploy; backfills in one statement |
| Contract | removed or renamed fields, changed types or status codes, new required inputs, auth tightened, error format different from docs/backend.md, contract file not updated, webhook payload changed |
| Concurrency and idempotency | check-then-insert without a unique constraint; status changes without `WHERE state = old`; retried jobs or requests that double-apply; work after commit that can be lost; locks held across network calls |
| Auth and security | a new route without the auth middleware; object access not scoped to the caller's tenant or user (IDOR); input reaching SQL, shell, file paths, URLs (SSRF) or templates unescaped; secrets or personal data in logs or errors; LLM output written or fetched without validation |
| Errors and failure | swallowed exceptions; success returned after a failure; missing timeouts on outbound calls; retries without backoff or limit; partial writes with no transaction or recovery |
| Performance | N+1 queries; unbounded queries or result sets; missing index for a new filter or foreign key; work inside a loop that belongs outside it |
| Tests | mocks standing in for the database or the module under test; tests of private functions; expected values recomputed the way the code does; criteria with no test; a test deleted, skipped or loosened (`.skip`, `xit`, `@pytest.mark.skip`, raised timeouts, wider tolerances) without a reason in the diff |
| Standards | breaches of docs/backend.md or the repo's documented conventions (cite the rule); then only clear smells: duplicated logic, an abstraction with one use the spec did not ask for, a misleading name |

For the riskiest finding or the riskiest part of the change, name the one fact its safety depends on
("this only runs inside the request's transaction", "the unique index exists in production") and
prove it by running something: a script, a test, a query. Say whether you proved it, pointed at the
line, or only believe it.

## 4. Score, then filter

| Severity | Meaning | Must |
| --- | --- | --- |
| Blocker | wrong result, data loss or corruption, a security hole, a breaking contract change not approved, a criterion not met, a test that cannot fail | fix before approval |
| Should-fix | a real gap with a contained cost: a missing negative-path test, a missing timeout, an N+1 on a small table | fix now, or a follow-up the user can see |
| Note | minor | one line |

Drop what you cannot tie to a concrete failure (input → wrong output, crash, leak, lost row); that is
taste. Drop what docs/backend.md decided, what tooling already enforces, and what the diff did not
touch. A few findings you are sure of beat a long list; say how sure you are when you are not.

## 5. Write `.verify/review-api.md`

```markdown
# Review <runDir of lanes.api in last-run.json>
Reviewer: <model, or "same agent, no independent review available">
Scope: <base ref>..<working tree>; <files or areas>

## Acceptance
- [x] A1 met · <evidence>
- [ ] A2 not met · <what you saw>
- [-] A3 not checked · <why>

## Findings
- [ ] Blocker · <file:line> · <lens>: <what is wrong> → <the input that shows it> → <the fix>
- [ ] Should-fix · …
- [-] Should-fix · … (follow-up, deferred: <reason from the brief>)
- Note · …

## Safety fact
<the one fact> · <proven by running: how | pointed at file:line | believed, not proven>

Lenses not applicable: <list>
Not checked: <what could not be checked and why, or "none">
Verdict: <approved | changes required>
```

Approve only when no Blocker or Should-fix is open (`- [ ]`) and every acceptance id is marked met or
not checked. Any `- [ ]` line or a verdict other than `approved` keeps the Stop gate closed.

Adapted from gstack's `/review` checklists and specialists (Garry Tan, MIT), pstack's `blast-radius`
(Lauren Tan, MIT) and mattpocock/skills `code-review` (MIT).
