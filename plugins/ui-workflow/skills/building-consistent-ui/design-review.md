# Design review: judge the screenshots

The question is not "does it render" but "would a design lead put their name on this, and does
it look like the rest of this product?" Review the screenshots from the last run, against
`docs/design.md`. Report findings and a verdict; fix only after the review is written.

## 1. Scope and intent

- Under review: the pages and widths this change touched, plus every page sharing a changed part.
- Intent: read `docs/design.md` (direction, page patterns, what may vary). You judge against the
  product's own decisions, not a generic ideal. A dense back-office table is not failing for being dense.

## 2. See the whole first

Open each screenshot (390 and 1280 at least) before reading any code. Ask:

- What is the focal point? Does it win, or does everything compete equally?
- Squint: does the hierarchy survive blurred eyes? Does anything jump out harshly?
- Does it breathe, or is it a monotone grid of identical boxes?
- Does it look like this product, or like any app?

Compositional problems live in the whole and are invisible in any one line of CSS.

## 3. Lenses, one at a time

For each lens ask: did someone decide, or did it default?

| Lens | Look for |
| --- | --- |
| A. Hierarchy | One focal element that wins on size, weight, contrast or space; secondary actions and metadata visibly demoted; tiers readable without reading words |
| B. Type and colour | Hierarchy from size + weight + colour, not size alone; the design.md type scale; one accent used for meaning (status, action), not decoration; secondary text tinted, contrast met |
| C. Surfaces | One depth strategy from design.md; quiet borders and elevation; nested radii consistent |
| D. Composition | Rhythm (dense zones and open zones), proportions that say something, a considered content width; matches the page kind's pattern in design.md |
| E. States and polish | Empty, loading, error, disabled, focus present; 44px touch targets; text not clipped or wrapping badly at 390 |
| F. Structure and content | Shared parts reused, no hand-rolled control where a part exists, no tokens bypassed; every visible string tells one coherent story |
| G. Consistency | Put every page of the same group side by side at one width: same header, spacing, type roles, parts. Content may differ; style may not |

Three quick tests while you look:

- **Swap test:** imagine the most common font and a stock template in place of ours. Where nothing would change, the design defaulted.
- **Squint test:** blur the screenshot; the focal point and the tiers must still read.
- **Signature test:** point to the places where design.md's direction shows. "The overall feel" does not count.

## 4. Score, then filter

| Severity | Meaning | Must |
| --- | --- | --- |
| Blocker | Reads as generic or broken: no focal point, flat or size-only hierarchy, monotone layout, competing accents, harsh or mixed surfaces, missing states, a page that breaks the group's consistency, a hand-rolled control without keyboard or focus | fix before approval |
| Should-fix | A real craft gap a design lead would call out; the screen still works | fix now, or list as a follow-up the user can see |
| Note | Minor | one line |

Drop false positives:

- Taste, not defect: a coherent choice you would have made differently.
- Decided in `docs/design.md`: a decision, not a finding. If you think the decision is wrong, say so
  once as a Note addressed to the user; never "fix" it.
- Outside the scope set in step 1.
- Lint, type or test problems: owned by the other checks.

If you cannot say how a finding costs the user or makes the screen look generated, it is taste. A few
high-conviction findings beat a long list.

## 5. Write `.ui-verify/review.md`

```markdown
# Review <run folder name>
Scope: <pages and widths>
Focal point: <page>: <element>; …

## Findings
- [ ] Blocker · <page> <width> · <lens>: <what defaulted> → <why it costs the user> → <the decision that fixes it>
- [x] Should-fix · … (fixed in this change)
- [-] Should-fix · … (follow-up, not fixed: <why>)
- Note · …

## Consistency
- Group <group> at 390: <pages>: <same | differences found, each listed above>

Baselines updated: <none | page-width: what changed and why it was intended>
Not checked: <dark mode, real device, …>
Verdict: <approved | changes required>
```

Approve only when no Blocker is open and every Should-fix is fixed or listed as a follow-up. Any
`- [ ]` line, a `FAIL` line, or a verdict other than `approved` keeps the Stop gate closed.

## 6. Fix from the decision

Fix Blockers first. Rebuild the flagged part from the decision (re-derive the focal point or the type
tiers from design.md) rather than nudging values until the screenshot looks less wrong. Rerun
`run-verify.mjs`, look again, and rewrite the review. A fix that needs a design.md change goes to the
user as a proposal.

Adapted from interface-design's `design-review` (Damola Akinleye, MIT).
