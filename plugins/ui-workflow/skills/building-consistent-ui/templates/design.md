# Design

The contract for how this product looks. Every screen follows it. Change it on purpose, in its own
commit, and say which screens the change touches.

## Direction

- Chosen: <direction id and name from draw.mjs, or "brand-fixed">, on <YYYY-MM-DD>, by <who>.
- In one sentence: <what the product should feel like, tied to something only this product has>.
- Reference systems: <none | name + what we take from it (density, type mood), never its values or logo>.
- Locked. Later draws pass `--keep palette,type`.

## Where the tokens live

- Source of truth: `<path to the one CSS file with the variables>`.
- Generated copies: `<path, and the script that writes it>` (never edit by hand).

| Role | Variable | Use it for |
| --- | --- | --- |
| Page ground | `--background` / `--foreground` | |
| Surface | `--card` / `--card-foreground` | |
| Action | `--primary` / `--primary-foreground` | one primary action per view |
| Quiet | `--muted` / `--muted-foreground` | secondary text, never body copy under 4.5:1 |
| Edges | `--border`, `--input`, `--ring` | |
| Status | `--destructive`, `--success` (add it if missing) | meaning only, never decoration |

## Type

- Families: <display>, <text>. Two at most.
- Scale (px, size/line-height): <e.g. 12/16, 14/20, 16/24, 20/28, 24/32, 32/40>. Body is 16 on phones.

## Space, radius, elevation

- Spacing steps: <4, 8, 12, 16, 24, 32, 48>. More space above a heading than below it.
- Radius: <--radius value and the 3 steps used>.
- Elevation: <tone step | one shadow token>. No other shadows.

## Parts

Use these before writing new markup. A third copy of the same markup becomes a part here.

| Part | Where | Use for |
| --- | --- | --- |
| | | |

## Page patterns

One structure per kind of page. Pages of the same kind share it; they differ in content only.

| Kind | Structure | Pages |
| --- | --- | --- |
| | | |

## What may vary

- Allowed per <business/tenant/module>: <logo, photos, one accent that overrides --primary after a 4.5:1 check>.
- Everything else is shared. A request for a different style is a change to this file, not to one page.

## UX rules

Numbers, not adjectives. From ui-ux-pro-max `--domain ux` and our own decisions.

- Contrast: body 4.5:1, large text 3:1.
- Touch targets: 44x44 px minimum.
- Widths checked: 390, 768, 1280. No sideways scroll.
- <forms, empty/loading/error states, motion, reduced motion>

## Baselines

- Screenshots are made on: <OS or container image>. Update them only there.

## Inspector allowances

`inspect.mjs --allow` ids this project accepts, each with its reason. Nothing else may be allowed.

| Rule id | Why |
| --- | --- |
