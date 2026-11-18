# Mobile: React Native and Expo

The frontend workflow is the same on a phone: one design contract, acceptance first, checks that
exit for real, screenshots a fresh reviewer judges, code a fresh reviewer reads. What changes is how
the app is driven and photographed, what a phone adds to "done", and that native changes ship only
in a store build. Read this alongside `setup.md`, `build.md` and `verify.md`; where they say
Playwright, the web or 390 px, use what this file says instead.

## Setup (once per app)

1. **The lane.** In `.verify/config.json` copy the `app` lane from
   `<plugin>/shared/verify.config.json`: `"kind": "frontend"`, `"platform": "react-native"`. Fill
   `files` and `native` with the app's folder. `native` lists what only a store build can ship
   (`app.json`, `app.config.*`, `eas.json`, `ios/`, `android/`); a change there, or a new native
   module in `package.json`, is merge tier 3 and a one-way door. A web app in the same repo is a
   second lane (`web`).
2. **The contract.** `docs/design.md` as `setup.md` writes it, with the token file being the theme
   (`src/theme.ts`, or the NativeWind/Tailwind config). Add a "Mobile" section: type scale in points
   and how it scales with the system text size (which text may grow, the largest size you support),
   touch targets (44 pt iOS, 48 dp Android), safe areas, what differs between iOS and Android on
   purpose (navigation, sheets, haptics), dark mode.
3. **Raw styles.** `check-raw-styles.mjs <dirs> --platform react-native --spacing-scale <scale>`:
   colour literals in style keys and props, font literals, off-scale spacing. Copy the script into
   `scripts/ui/` as on the web.
4. **Accessibility lint.** `eslint-plugin-react-native-a11y` in the project's lint config: labels and
   roles on touchables, no `accessible={false}` on interactive views.
5. **Every screen reachable by link, with fixed data.** The look check and the journeys open screens
   by deep link (expo-router routes are links already). Give each state a link: `?fixture=empty`,
   `?fixture=error`, a signed-in fixture user. Fixtures live in the repo; no clock, random or live
   value on screen, or mask it.
6. **testIDs** on every control a journey taps or asserts. Text selectors break when copy changes.
7. **Screenshots.** Copy `<skill>/templates/rn-look.json` to `e2e/rn-look/screens.json`, `<plugin>/scripts/rn-look.mjs` to `scripts/ui/rn-look.mjs` and
   `<plugin>/scripts/lib/png.mjs` to `scripts/ui/lib/png.mjs` (the first imports the second). Devices: the
   smallest phone you support and the largest (375 and 440 on iOS), plus one Android. Variants:
   default, dark, large-text. Run it once with `--update`, look at every image, commit the baselines.
8. **Journeys.** Maestro flows in `.maestro/journeys/`, one per acceptance-level user journey,
   from `<skill>/templates/maestro-journey.yaml`. `ctl` (`<plugin>/shared/ctl.md`) starts Metro and
   the backend, seeds data, and opens the app.
9. **CI.** Simulators need macOS (iOS) or an emulator runner (Android). Either run the `look` and
   `functional` checks on such a runner, or mark them `"ci": false`: they then run locally only,
   and a CI run lists them as not run.

## Build

- Use the theme for every colour, text style and space; `<Text variant>`-style components over raw
  `fontSize`.
- Respect the safe area on every screen (`SafeAreaView` or insets), the keyboard on every form
  (`KeyboardAvoidingView` or a scroll view that moves the focused field into view), and Android's
  back button and gesture on every screen that is not the root.
- Text must survive the large-text variant: no fixed heights on text containers, no
  `numberOfLines` that hides content the user needs, `allowFontScaling` left on.
- Touchables: 44 pt / 48 dp, `accessibilityRole`, `accessibilityLabel` when the content is an icon,
  `accessibilityState` for selected or disabled.
- Platform differences go through `Platform.select` or `.ios.tsx`/`.android.tsx` files, and only
  where `docs/design.md` says they differ.
- A native change (a new module, a permission, `app.json`): say so to the user before building;
  it needs a new store build, and users on the old build keep the old native code.

## Verify

`run-verify.mjs` runs the lane as everywhere. The look check is `rn-look.mjs`; it writes screenshots
named `<screen>-<variant>-<platform>-<width>.png`, which the evidence pack shows next to the
baselines. A baseline change is merge tier 2: review the images before `--update`.

What a phone adds to acceptance (`<plugin>/shared/acceptance.md`, Mobile):

- large text (the large-text variant), dark mode, the smallest supported phone;
- offline and slow network: the request fails, the screen says so, the user can retry, input is kept;
- the app goes to the background and comes back mid-flow; it is killed and reopened on a deep link;
- a permission is denied (camera, location, notifications) and the screen still works;
- Android back on every screen of the flow; the keyboard never covers the focused field;
- VoiceOver / TalkBack can finish the flow (at least by reading the labels and roles in code).

## Over-the-air updates

With `expo-updates` (EAS Update), JavaScript ships to installed builds without a store release. A
JavaScript change must therefore keep working on every build still in use: do not call a native
module the oldest supported build lacks, and keep `runtimeVersion` honest (a native change bumps
it). The backend contract has the same constraint: old app builds live for months, so the API must
keep answering them (`docs/backend.md`, Clients).
