# Ratchet: turn each mistake into something that catches it next time

A reviewer finding, a revert or a correction from the user is a mistake the environment let
through. Fixing the code fixes this change; the ratchet fixes the next hundred. Agents copy what the
codebase and its checks allow, so a rule in prose is the weakest fix and a check that fails is the
strongest.

## When to run it

- After an approved review: every Blocker, and every finding the reviewer called a class.
- After a revert, an incident, or a bug the user found in merged work.
- When the user corrects the agent ("no, we never do X here").
- Once a week: read `.verify/gate.log` for blocks that were wrong (`decision: block` on work that
  was fine) and for `let-through-unverified`.

## 1. Classify, then pick the strongest fix that fits

| The mistake is | Fix it with | Examples |
| --- | --- | --- |
| Mechanical: a fixed pattern, an API, an import, a file location | a deterministic check that fails, whose message says how to fix it | an ESLint `no-restricted-syntax` / `no-restricted-imports` rule, a dependency-cruiser or eslint-plugin-boundaries rule, a type that makes the wrong call impossible, a small script like `check-raw-styles.mjs`, a database constraint |
| Visible only from the diff, needs judgement | a `docs/checklist.md` item with a trigger | "a new field in a stored message → load an old one" |
| A project decision the agent did not know | a line in `docs/backend.md` or `docs/design.md` (a contract change) | "money is integer cents" |
| A gap in how the app is driven or observed | the `verify-<app>` skill, `ctl`, a journey or a page in `ui-pages.json` | "the empty state was never captured" |
| An incident | a checklist item, and an eval case for the reviewer (`evals/README.md`) | |

Prefer the first row whenever it can work. Prose is for what no check can see.

## 2. Admit a rule only with evidence

- It happened in at least two changes, or once with real damage (an incident, data loss, a security hole).
- It can be seen from a diff (checklist) or from the code (check). "Be careful with X" is neither.
- Try to break it before adding it: run the new check over the whole repository. Every hit is either
  a real instance (fix them in the same change, or list them in an allowlist that only shrinks) or a
  false positive (narrow the rule). A checklist trigger that would fire on most changes is too wide.
- The error message or the check line names the fix, not only the problem.

## 3. Ship it as its own change

The rule goes in its own change, with the incident or pull request that motivated it in the
checklist item's `source`, or in a comment above the lint rule. Changing `.verify/config.json`, a lint
config or `docs/checklist.md` is a guarded change: merge tier 3, the owner approves it. Run it with
`run-verify.mjs --config working`.

Remove old instances of the pattern too, not only new ones: an agent reads the old code as an
example.

## 4. Prune

Rules and checklist items pile up. Once a month remove or merge:

- items whose code no longer exists, or that a newer check already covers;
- checklist items that never triggered in three months, unless they guard something rare and costly;
- prose in `CLAUDE.md` or the contract files that no change has needed.

## The checklist format: `docs/checklist.md`

```markdown
# Reliability checklist

Items the reviewer checks when their trigger matches the diff. Add with evidence (shared/ratchet.md).

## C1 A retried create does not create twice
- when: diff `/router\.post|@Post\(|app\.post/` or path `src/**/handlers/create*.ts`
- lanes: backend
- check: POST the same body twice with the same Idempotency-Key; one row, the same id both times.
- source: incident 2026-09-14 (double orders), PR #311

## C2 Old saved sessions still load
- when: path `src/session/**` or diff `/schemaVersion|MessageType/`
- check: load a transcript written by the previous release; every new field has a default.
- source: PR #412 (revert)
```

`when` takes `path \`glob\`` and `diff \`/regex/flags\`` terms joined by `or`; `lanes` is optional.
`review-brief.mjs` reads the file from the base commit and gives the reviewer only the items whose
trigger matches, usually a handful.
