# Build: changing a screen

1. Read `docs/design.md` and the token file it names. Note the page kind of each screen you touch.
2. List who else renders every shared part you will change (grep the imports). Name those screens
   in your reply; a change to a shared part lands on all of them.
3. Decide whether the structure is open:
   - the user asked "what should this look like", or a new page has no sibling of the same kind in
     design.md's Page patterns → prototype (below);
   - a new page of a kind that already has a pattern → reuse the pattern, no prototype;
   - otherwise → build directly.
4. Build with the contract only: token classes and variables, parts listed in design.md, the
   structure of the page's kind. No palette classes, arbitrary values or literal colours; if the scale
   lacks something, add a token and a line in design.md in the same change.
5. A third copy of the same markup becomes a part in the shared component folder and a row in
   design.md's Parts table.
6. Run `node scripts/ui/check-raw-styles.mjs <dirs you touched>` and fix every finding.
7. Go to `verify.md`.

## Prototype: three structures, one style

1. On the real route, render 3 variants behind `?variant=A|B|C`, keeping the page's data loading.
   Use a throwaway route only when no page can host them.
2. Variants differ in structure: layout, information order, primary action. They share the
   contract's colours, type and parts. Variants that differ only in colour are one variant.
3. Add a small fixed switcher bar (arrows plus label, keyboard left/right, hidden in production).
4. Give the user the URLs. Screenshot each variant so they can compare without running the app:
   `npx playwright screenshot --full-page --viewport-size "390,900" "<url>?variant=A" .ui-verify/proto/A-390.png`,
   and again at `1280,900`.
5. Waiting for the user's choice is not done work. The Stop gate reminds you once; end the turn by
   saying the prototypes are unverified and you are waiting for their pick.
6. Recommend one variant and say why, so the user can just agree.
7. After they choose: fold the winner into the real code properly (tests, states), add its structure
   to design.md's Page patterns, and record the choice and why. Keep the variants on a throwaway
   branch when the user allows git changes; otherwise delete them and say so.

Adapted from mattpocock/skills `prototype` (MIT).
