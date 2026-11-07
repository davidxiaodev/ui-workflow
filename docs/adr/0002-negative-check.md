# 2. A negative check proves the tests can fail

Date: 2026-11-07 · Status: accepted

## Context

An agent can write tests that pass whatever the code does: asserting on mocks, recomputing the
expected value the way the code does, or asserting too little. "Tests pass" then means nothing, and
reading the tests is exactly the review a busy person skips.

## Decision

`run-verify.mjs` has a built-in `negative` check. It runs the lane's tests on the current code (must
pass), then takes only the lane's source changes back to the base commit, keeps the changed tests,
and runs them again (must fail). Source changes with no test change are allowed (refactors) but
reported, and make the merge tier at least 2.

It edits the working tree in place, because a separate worktree would need its own dependencies and
services. Every file is backed up first and restored in a `finally` block; a crashed run leaves a
backup that blocks further runs until `run-verify.mjs --restore`.

## Consequences

The lane's tests run twice. A failure caused only by a missing import or a compile error proves less
than an assertion failure; the reviewer reads the log. Mutation testing per changed line is stronger
and left as an optional check.
