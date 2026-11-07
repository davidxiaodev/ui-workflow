# 1. Acceptance criteria are written first and reported apart from the checks

Date: 2026-11-07 · Status: accepted

## Context

Checks prove the code runs and the tests pass. They do not prove the change does what was asked: the
tests can test the wrong thing, and the builder writes both. Reviewing screenshots after the fact
also finds problems late, and only the ones that show on a screenshot (not double submit, slow
requests, another tenant's data).

## Decision

Every change starts with `.verify/acceptance.md`: observable criteria with ids, each naming its
proof, after going through a fixed list of adverse cases per lane. The builder never marks them. The
independent reviewer marks each id met, not met or not checked from evidence, and the evidence pack
shows the criteria and the machine checks in separate sections. A criterion not met blocks; one not
checked makes the merge tier at least 2.

## Consequences

Small changes pay a few lines; big ones pay an interview first. The Stop gate cannot tell a stale
acceptance file from a current one; the reviewer gets the user's request and flags a mismatch.
