# Setup: a design contract for this project

Do this once per project. The output is `docs/design.md`, one token file, and the checks. The user
makes the taste decisions; you prepare them and write them down.

## 1. Inventory

Write down, from the repo and the user:

- Stack: framework, styling (Tailwind version, CSS modules), component library, native apps.
- Existing tokens: a CSS file with `--name: value` variables, a `tailwind.config`, a theme object.
- Fixed brand: colours, fonts, logo the product must keep. If any, the draw keeps them.
- Reference system (optional): a brand to follow, or a product the user admires. Follow a brand's
  values. From an admired product take only density, type mood and layout ideas, never its values or
  logo. Record either in the Direction section.
- Kinds of screens: marketing pages, app screens (lists, forms, dashboards, settings), or both.

## 2. One token file

If none exists and the stack has Tailwind, run `npx shadcn@latest init`. Its CSS variables are the
token file. Keep it importable by baoyu-design and readable by agents:

- every colour, radius and shadow is a CSS variable under `:root` and `.dark` (or `@theme`);
- semantic names (`--primary`, `--muted-foreground`), never `--orange-500`;
- one comment per variable saying what it is for (shadcn writes none; add them);
- a status colour for success if the product shows success states (shadcn has only `--destructive`);
- no `calc()` or `color-mix()` in colour values;
- fonts through `@font-face` or `next/font`, logos as SVG in a `brand/` folder.

A native app that cannot read the CSS gets a generated copy plus a test that fails when it drifts.

## 3. Direction (the user picks)

1. `node <tasteDraw> --list sectors`, pick the closest sector.
2. `node <tasteDraw> --sector <s> --brief "<one line>" --options 3`, adding
   `--keep palette,type` when step 1 found a fixed brand.
3. Show the three summaries to the user with your recommendation and one line each on why. They
   choose. If they are unreachable, choose, and write "chosen by agent, unconfirmed" in design.md.
4. Deal the full sheet with `--direction <id>`. For app screens deal once more with `--app --kind
   <kind> --keep palette,type` (`--app --list kinds` lists them) so both kinds share colours and type.

No taste-skill: offer two or three palettes and type pairs built from the shadcn defaults instead.

## 4. UX rules

Run 4 to 6 `search.py "<one outcome>" --domain ux` queries (contrast, touch targets, forms, empty
states, tables, navigation). Copy the numbers into design.md's UX rules. Ignore its styles and palettes.

## 5. Write the contract

1. Copy `<skill>/templates/design.md` to `docs/design.md` and fill every section. Map the dealt
   palette onto the token roles; put the values in the token file, not in design.md.
2. Add one line to `CLAUDE.md` (create it if missing; also `AGENTS.md` if the project has one):
   "Before any UI work read docs/design.md and use the building-consistent-ui skill."
3. Optional, recommended when the user is not a designer: import the token file with baoyu-design's
   `claude-design-system` (from a code repository) into a sibling folder such as
   `../<project>-designs/`, never inside the repo. The user tunes
   colours and type against swatches and live parts; you write the final values back to the token
   file. The token file stays the source of truth.

## 6. Wire the checks

1. The project must be a git repository (the Stop gate reads `git status` and is off without one).
   If it is not, ask the user before running `git init`.
2. Copy `<plugin>/scripts/check-raw-styles.mjs` to `scripts/ui/` in the project. In its check
   command pass `--allow <component library folder>` (shadcn's `components/ui`): that folder is where
   tokens are turned into parts, and its stock classes (`ring-[3px]`, `text-white`) are expected.
   Every other folder stays strict.
3. Copy `<skill>/templates/ui-look.e2e.ts` and `ui-pages.json` to `<web app>/e2e/ui-look/`, replace
   the example routes with real ones (empty list until a page exists), and add `@playwright/test` and
   `@axe-core/playwright`. No `playwright.config.ts` yet: create it with `npm init playwright@latest`. In `playwright.config.ts` set `webServer` to the
   app's dev command with `reuseExistingServer: true`, so the check starts the app itself.
   Hide framework overlays in screenshots (Next.js: `devIndicators: false` in `next.config`), and keep
   the test's viewport widths exactly 390, 768 and 1280. Record evidence for people: in `use` set
   `video: "on"` and `trace: "retain-on-failure"`, and set
   `outputDir: process.env.VERIFY_RUN_DIR ? join(process.env.VERIFY_RUN_DIR, "playwright") : "test-results"`.
4. Screens must show the same data on every run: point them at seed data, or with no backend yet
   at a fixture module in the repo (`src/fixtures/<thing>.ts`). List any clock, random or live value
   under `mask` in `ui-pages.json`.
5. Copy `<plugin>/shared/verify.config.json` to `.verify/config.json` (or, when it exists because the
   api lane is set up, add its `ui` lane). Delete the `api` lane until the backend is set up with the
   building-reliable-backend skill. Set the ui lane's `files` to the web app's UI source, `tokens` to
   the token file (`docs/design.md` is always included), and `shared` to the folders of parts many
   pages use; the merge tier reads both. Fill each check with the project's real command. Optional
   checks the project may want: property tests for pure helpers such as money or date formatting, and
   `{ "name": "negative", "negative": { "test": "<unit test command>" } }` when the UI has logic with
   unit tests. A check with no command yet (a new repo has no e2e) is left out, not
   invented; add it when the project gets one. Add one `inspect` check per page group, each on one
   representative URL, with the dev server started by the same command
   (`npx start-server-and-test dev <url> "node <tasteInspect> <url> --out \"$VERIFY_RUN_DIR/inspect\""`).
   No taste-skill: leave `inspect` out and write "inspect not run: taste-skill missing" under
   Not checked in every review. Add `.verify/*` and `!.verify/config.json` to `.gitignore`.
6. Functional checks: if the project has an e2e suite that drives its main journeys, put its command
   in the `functional` check. If it has none, or it skips the journeys this product depends on,
   follow `<plugin>/shared/ctl.md`. A project with no user-facing journey yet leaves `functional` out
   (step 5) and follows `ctl.md` when the first journey is built.
7. Make sure `CLAUDE.md` exists (create it if not) and holds the line from step 5.2.
8. If pages exist, generate their first screenshot baselines (`--update-snapshots`), show them to the
   user and commit them only when they agree and have asked for commits. If no page exists yet, the
   first page you build creates its baseline the same way (verify.md, New pages). Write the OS or
   container used in design.md's Baselines line; Playwright adds it to snapshot names
   (`-linux`, `-darwin`), so later updates must run there too.
9. If pages exist, run `node <plugin>/scripts/run-verify.mjs` and follow `verify.md` once end to
   end. If none exist, the first build does this.

## Asking a user who is not a designer

Ask few, concrete questions. Each one comes with your recommendation and a picture (screenshot or
the draw's summary), so the user can answer "yes" or "the second one". If they say "you pick",
pick, and write "chosen by agent" next to the decision in design.md so it can be revisited.
