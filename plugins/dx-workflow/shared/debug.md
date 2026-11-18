# Debug: find the cause before the next fix

`run-verify.mjs` prints "failed again" when the same check has failed two runs in a row. From then
on, another change made to see if it helps is guessing: it costs a run, can pass by luck, and leaves
the real cause in the code. Stop, and diagnose. The same applies to any bug the user reports.

If one of these is installed, follow it for the loop below (`shared/skill-packs.md`):
`mattpocock-skills:diagnosing-bugs`, `superpowers:systematic-debugging`,
`agent-skills:debugging-and-error-recovery`. Whichever you use, the result goes in `.verify/debug.md`.

## The loop

1. **Reproduce it on demand.** The smallest command that fails every time: one test, one request, one
   journey step, with the log. If it does not fail every time, the first job is to find what makes it
   fail (order, timing, data, environment), not to fix it.
2. **Read the evidence.** The full error and stack, the log around it, the screenshot or trace, the
   diff since it last passed (`git diff <last passing tree> <current tree>`). Write down what you see,
   not what you expect.
3. **List causes and test the cheapest first.** Two or three hypotheses, each with the observation
   that would rule it out. Add logging or a breakpoint, change one thing, rerun the reproduction.
4. **Narrow mechanically when stuck.** Bisect the diff (revert half, rerun), bisect the input, or
   compare with the last passing run's logs line by line.
5. **Fix the cause, once.** Keep the reproduction as a test (it must fail before the fix and pass
   after). Remove the temporary logging.
6. **Record it** in `.verify/debug.md` (the evidence pack shows it):

```markdown
# Debug
- check: backend/integration · failed 3 runs in a row
- symptom: POST /orders returns 500 on the second call with the same Idempotency-Key
- cause: the unique index is on (key) but the lookup filters by (key, user_id), so a retry by the same user misses and inserts
- proof: test "same key twice returns the first order" failed before, passes after
- ratchet: checklist item C4 (shared/ratchet.md)
```

## Never

- rerun until it passes, add a sleep or a retry, raise a timeout, loosen an assertion or a screenshot
  threshold, skip or delete the test (each of these is also a guarded change: merge tier 2 or 3);
- fix two things at once, so you cannot tell which one mattered;
- call it flaky without the reproduction that shows the race or the shared state.

A cause that a check could have caught goes through `shared/ratchet.md`.
