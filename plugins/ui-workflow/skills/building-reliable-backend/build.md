# Build: changing the backend

1. Read `docs/backend.md`, the contract file and `.verify/acceptance.md`. No acceptance file yet:
   write it now with `<plugin>/shared/acceptance.md`, going through the API and data adverse cases.
2. Find who depends on what you will change: callers of the functions, clients of the endpoints, readers
   of the tables and of the events or jobs. Grep stops at the code; also check the contract file,
   the web app's API client, queue consumers, reports and other services reading the same tables.
   Name them in your reply.
3. Contract first. If an endpoint, event or table changes shape, change the contract file (or the
   migration) first, and check it against SKILL.md's "Contract changes" before any implementation.
4. Agree the seams. Write down where the tests will sit (an HTTP route, a service's public function,
   a job handler) and confirm them with the user when the change is a new feature. Test behaviour
   through those seams, never private functions or a mocked internal collaborator.
5. Build in vertical slices, one acceptance criterion at a time:
   1. Write one failing test for the criterion at its seam. Run it and see it fail for the reason
      you expect (an assertion, not an import error or a typo).
   2. Write the least code that makes it pass. Run it and see it pass, with the rest of the suite.
   3. Next criterion. Refactor only when all are green, and rerun.
   Expected values come from the criterion or a worked example, never recomputed the way the code does it.
6. Data and migrations:
   - expand, then contract: add the new column or table, write to both, backfill in batches, read
     from the new one, and drop the old one only in a later change once no deployed code reads it;
   - new `NOT NULL` columns get a default or a backfill first; indexes on large PostgreSQL tables use
     `CONCURRENTLY`; every up has a down that really undoes it;
   - a migration and the code that needs it must both work with the previous release running
     beside them during a deploy.
7. Write paths: make retried requests and jobs safe (idempotency key, a unique constraint plus
   handling the duplicate, or an atomic `UPDATE … WHERE state = old`), never check-then-insert.
   Errors use the format in `docs/backend.md`; never swallow an exception or return success on
   failure; log with the request id, never secrets or personal data.
8. Run the lane's fast checks while you work (`run-verify.mjs --lane api --only types,unit`), then go to `verify.md`.

Debugging a failure on the way: reproduce it in one focused test, find the cause, fix the cause, keep
the test. Two fixes that did not hold mean you have not found the cause; stop guessing and trace it.

Adapted from mattpocock/skills `tdd` (MIT) and gstack's data-migration checklist (Garry Tan, MIT).
