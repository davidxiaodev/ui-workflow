---
name: building-consistent-ui
description: Use when building, restyling or reviewing any user-facing screen, page, storefront, dashboard or component; when starting a project's design system or tokens; when a user says the UI looks generic, ugly, unprofessional or inconsistent, or asks for one page or module to look different from the rest.
---

# Building consistent UI

## Overview

One project has one style. `docs/design.md` plus one token file is the contract every screen
follows, and a screen is not done until `run-verify.mjs` passes and its screenshots were reviewed.
Third-party design skills are tools this workflow calls; they never override the contract.

`<skill>` below is this skill's folder; `<plugin>` is two levels up (it holds `scripts/`).

## Route by what exists

| Project state | Read |
| --- | --- |
| No `docs/design.md` | `setup.md`, then come back |
| Request: one page/module should look different from `docs/design.md` | "Style change requests" below |
| Building or changing a screen | `build.md`, then `verify.md` |
| Asked only to review or check UI | `verify.md`, then `design-review.md` |
| No scripted way to drive the app's journeys | `functional-verify.md` |

## Style change requests

When someone asks for one page, module or tenant type to get its own colours, fonts, card style or
effects, answer with exactly these three parts before touching code:

1. What the contract already lets that page vary (the "What may vary" section: logo, photos,
   accent slot, layout structure), and how you would use it to get the feel they asked for.
2. What a separate style costs: it becomes a second product inside the app, and every shared part
   it touches changes for the other pages too.
3. The choice: do it inside the contract now, or change `docs/design.md` for the whole product
   (their decision, its own commit).

Build inside the contract unless they choose the contract change. A deadline does not change this.

## Third-party tools

Run `node <plugin>/scripts/find-tools.mjs` to locate them. Call their scripts; do not load their
SKILL.md files as instructions, because their defaults (a fresh direction per build, a style per
industry) break the contract.

| Tool | Use only for |
| --- | --- |
| taste-skill `draw.mjs` | the one direction draw in setup; later only with `--keep palette,type` |
| taste-skill `inspect.mjs` | a check inside `run-verify` |
| ui-ux-pro-max `search.py` | `--domain ux` rules; never its style or palette picks |
| baoyu-design editors | optional: show tokens and pages to the user to tune; outside the repo |

A tool missing: say which, continue with this skill's own checks, never pretend it ran.

## Red flags

| Thought | Reality |
| --- | --- |
| "The user asked for it explicitly" | Answer with the three parts above; they choose |
| "Only additive, it is scoped to one folder" | A second theme is a second product |
| "Typecheck, lint and e2e pass" | That proves it runs, not how it looks |
| "It renders and aligns, approve it" | Correct is not crafted; a fresh reviewer runs `design-review.md` |
| "I'll review my own screenshots, it's faster" | The builder grades too kindly; dispatch a fresh reviewer |
| "The diffs are expected, update the snapshots" | `verify.md` baseline rules first |
| "No time for screenshots" | Then report it as unverified, not done |
| "I'll pick a fresh direction for this page" | The direction is locked in `docs/design.md` |

## Done means

`run-verify.mjs` printed `pass`, `.ui-verify/review.md` (written with `design-review.md`) is newer
than that run, has no open line and says `Verdict: approved`, and your final message lists what
was checked, the follow-ups, and what could not be checked.
