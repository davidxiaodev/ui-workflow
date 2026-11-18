# Code review: the frontend change's code

`design-review.md` judges what the user sees. This judges what the screenshots cannot show: state
that goes stale, requests that race, errors that vanish, content that becomes markup, a control a
keyboard cannot reach. Do it in the same review, after the screenshots; its findings go into the
same `## Findings` list of `.verify/review-frontend.md` (or `review-<lane>.md`), tagged with the lens.
Fix nothing.

## 1. Read

- The diff from the base ref (the brief gives the command, and lists new files the diff does not show).
- `.verify/acceptance.md`: for each criterion the screenshots cannot prove (a request sent once, a
  retry, input kept after an error), find the test or journey that does, and open it. A criterion
  proved only by a screenshot of the happy state is at most "met (seen, not exercised)".
- The negative check in `.verify/last-run.json` when the lane runs one: changed tests must fail
  without the change.
- The backend contract (OpenAPI, GraphQL schema, generated client) when the change calls the API.

## 2. Lenses

Run each lens whose subject is in the diff; list the others once as "not applicable". Cite
`file:line`.

| Lens | Look for |
| --- | --- |
| State | state that copies props or server data and goes stale; values derived in an effect instead of during render; effects with missing or wrong dependencies; stale closures in handlers, timers and subscriptions; state set after unmount; two sources of truth for one value (URL and component state, cache and local copy) |
| Data and requests | loading, empty and error states all handled for every request in the diff; out-of-order responses (a slow earlier request overwriting a later one: abort it or ignore it); a mutation sendable twice (button not disabled while pending, no idempotency key where the backend takes one); cache not invalidated or updated after a mutation; optimistic updates without rollback; pagination or filters lost on navigation |
| Forms and input | server errors not shown next to the field or not at all; input lost after a failed submit; validation only on the client for a rule the server also enforces differently; submit on Enter missing or doubled |
| Security | user or server content rendered as HTML (`dangerouslySetInnerHTML`, `v-html`, `innerHTML`) without sanitising; tokens or personal data in `localStorage` or logs; secrets in the client bundle (any env var with a public prefix such as `NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_` that is not meant to be public); redirects to a URL taken from the query string; authorisation decided only by hiding a button |
| Accessibility in code | clickable `div`/`span` without role, focus and key handling; inputs without a label; focus not moved into a dialog or back after it closes; route changes that leave focus behind; async status (saved, failed) not announced (`aria-live`); images without `alt`, decorative ones without empty `alt` |
| Performance | list items without stable keys (index keys on lists that reorder); heavy work in render; long lists without virtualisation; a whole library imported for one function; images without size, causing layout shift |
| Contract with the backend | hand-written types that drift from the contract; a new error code or status not handled; fields assumed present that the contract marks optional; a request shape the contract does not accept |
| Tests | tests that assert implementation details (internal state, call counts on mocks of the module under test) instead of what the user sees; mocked network that returns shapes the real API does not; a criterion with no test; a test deleted, skipped or loosened |
| Standards | breaches of `docs/design.md`'s code rules and the repo's conventions (cite the rule); then only clear smells |

Name the one fact the riskiest part depends on ("the request is aborted when the filter changes",
"the button is disabled while the mutation is pending") and prove it: run the test, drive it with
`ctl` or the journey, or throttle the network in the browser and watch. Say whether you proved it,
pointed at the line, or only believe it.

## 3. Severity

Same scale as `design-review.md`. A Blocker here is a wrong result the user can hit: data shown for
the wrong item, a double charge or double submit, content injected as markup, a lost input, a flow a
keyboard or screen reader cannot finish, a criterion not met. Every finding names the concrete
failure (the steps or input → what goes wrong); drop what you cannot tie to one. A problem in code
this change did not touch is `Pre-existing`.

Add under `## Safety fact` in the review: `<the fact> · <proven by running: how | pointed at file:line | believed, not proven>`.

Adapted from the backend `code-review.md` in this plugin, gstack's `/review` (Garry Tan, MIT) and
mattpocock/skills `code-review` (MIT).
