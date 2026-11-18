# 5. dx-workflow, with frontend and backend

Date: 2026-11-18 · Status: accepted

## Context

The plugin was called `ui-workflow` and its halves `building-consistent-ui` and
`building-reliable-backend`, with lanes `ui` and `api`. It had outgrown the name: half of it is
backend, and most of it is verification, review and the ratchet. The front half was named for the
look, but a front end is also state, requests and accessibility in code, and nobody reviewed that
code: the frontend reviewer only judged screenshots. "UI" also suggested web only, while the front
end includes mobile clients.

## Decision

- The plugin is `dx-workflow`; its skills are `frontend` and `backend` (shown as
  `dx-workflow:frontend`, `dx-workflow:backend`). Lane kinds are `frontend` and `backend`; lanes are
  named per app or service (`web`, `app`, `api`) with a `kind`.
- UI stays inside frontend: `docs/design.md`, tokens, the look screenshots and `design-review.md`
  keep their names. It is not a lane of its own, because the same files are both look and logic.
- The frontend review is the design review plus a frontend `code-review.md` (state, requests and
  races, forms, security, accessibility in code, performance, the backend contract, tests), in one
  review file.
- Mobile is frontend: a lane with `"platform": "react-native"` (React Native, Expo) gets default
  files, `rn-look.mjs` screenshots (simulators through Maestro; default, dark and large-text
  variants; a dependency-free PNG diff), a React Native mode of `check-raw-styles.mjs`, Maestro
  journeys, mobile review lenses and adverse cases. Native changes (`native` globs, or a new native
  module in `package.json`) are merge tier 3 and a one-way door, because they ship only in a store
  build. Checks that need a simulator can be `"ci": false`.
- No compatibility with earlier names: the 0.1 `.ui-verify/` migration, `UI_VERIFY_RUN_DIR` and the
  upgrade notes are gone. The Stop gate variable is `DX_WORKFLOW_GATE`.

## Consequences

Projects set up before this rename key their config by `ui`/`api` and must rename lanes or add
`kind`. Only React Native / Expo is covered among mobile stacks; native iOS, Android and Flutter
would each need their own defaults, screenshot tool and lenses. `rn-look.mjs` is tested with
recorded screenshots and a dry run, not against a live simulator in CI.
