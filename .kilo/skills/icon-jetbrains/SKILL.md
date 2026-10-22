---
name: icon-jetbrains
description: Create or review IntelliJ New UI SVG icons, theme variants, sizes, and palette.
---

# IntelliJ Platform New UI Icons

Guidance for authoring SVG icons for the JetBrains plugin. This skill is the single source of truth for icon sizing, palette, dark variants, composition rules, and placement. Other docs (including `packages/kilo-jetbrains/AGENTS.md`) defer here for SVG authoring details.

Icons follow IntelliJ New UI conventions: a fixed canvas per role, a strict light/dark palette, and explicit per-shape colors (the IntelliJ SVG loader recolors by matching literal hex values, so `currentColor` and CSS do not work). The plugin loads icons directly from its resource folder — see [Where the SVGs live](#where-the-svgs-live).

## Golden rules

1. **Always ship two SVGs** — one for the light theme (e.g. `add-file.svg`) and one for the dark theme with the `_dark` suffix (`add-file_dark.svg`). Geometry must be identical between them; only the palette swaps.
   - **Tool-window icons ship as a quartet, not a pair.** When a tool window has both a 16×16 base (`name.svg` / `name_dark.svg`) and a 20×20 stripe variant (`name@20x20.svg` / `name@20x20_dark.svg`), they must share the same metaphor. The stripe is only one surface — the 16×16 base also appears in **Search Everywhere**, **Find Action**, context menus, the Services tool window, recent locations, and the View ▸ Tool Windows menu. Changing only the @20x20 leaves users seeing two different icons for the same tool window depending on where they encounter it. Always update all four files together (this repo's tool-window quartet is `kilo.svg` / `kilo_dark.svg` + `kilo@20x20.svg` / `kilo@20x20_dark.svg`).
2. **Only use colors from the canonical palette.** See [palette.md](./palette.md). Picking a one-off color breaks theming and contrast.
3. **One canvas size per icon role.** See [Icon roles](#icon-roles). Do not invent new sizes or pad with empty space — IntelliJ scales the canvas as a single unit.
4. **No raster, no gradients, no filters, no embedded fonts.** Path geometry only (`<path>`, `<rect>`, `<circle>`, `<line>`, `<polyline>`, `<polygon>`). Text must be converted to outlines.
5. **Use `fill="none"` on the root `<svg>`** and set `fill` / `stroke` explicitly per shape — never rely on CSS or `currentColor`.
6. **Strokes use `stroke-width="1"`, `stroke-linecap="round"`, `stroke-linejoin="round"`** (or `stroke-miterlimit="10"` for hard joins). Heavier strokes are reserved for hero glyphs inside a circle badge (e.g. status checkmarks) and use `stroke-width="1.5"` or `"2"`. The `1` applies to the **primary glyph stroke** — do not force *every* stroke to 1. Hairline/decorative strokes (e.g. a thin stroke used to fatten a filled dot) and strokes whose width is coupled to geometry (e.g. a badge ring meant to sit flush with a fill edge) must keep their intended weight (scale with the artwork), or they fatten and misalign.
7. **Pixel-grid align**: keep stroke axes on half-pixel centers (`x.5`) and fills on whole pixels so the icon stays crisp at 1× rendering. Getting the base grid right also keeps it crisp on HiDPI/Retina; fine sub-pixel detail blurs at fractional scales (125%/150%), so keep geometry simple rather than chasing detail that won't survive scaling. SVGs are resolution-independent — ship one vector per theme, never `@2x` raster variants.
8. **File names use kebab-case and stay ASCII-only** (e.g. `arrow-down-to-line.svg`, `book-open-check.svg`, `kilo@20x20.svg`), matching every existing icon in `packages/kilo-jetbrains/frontend/src/main/resources/icons/`.

## Icon roles

Pick the canvas size from the role, not the other way around. All icons land in this repo's `packages/kilo-jetbrains/frontend/src/main/resources/icons/` (with a `views/` subfolder for in-view icons — see [Where the SVGs live](#where-the-svgs-live)).

| Role | Canvas | Filename pattern |
|---|---|---|
| Action icons (menus, popups, toolbars) | **16×16** | `name.svg` + `name_dark.svg` |
| Tree node icons (PSI, structure view) | **16×16** | `name.svg` + `name_dark.svg` |
| Tool-window stripe icons (compact/16) | **16×16** | `name.svg` + `name_dark.svg` |
| Tool-window stripe icons (New UI) | **20×20** | `name@20x20.svg` + `name@20x20_dark.svg` |
| Main toolbar (New UI) | **20×20** | `name@20x20.svg` + `name@20x20_dark.svg` |
| Editor gutter icons | **14×14** (small marks **12×12**, **9×9**) | `name.svg` + `name_dark.svg` |
| Status bar / inline status | **16×16** | `name.svg` + `name_dark.svg` |
| Breakpoint marks | **14×14** (12×12 for sub-marks) | `name.svg` + `name_dark.svg` |
| Run-config tags & disclosure chevrons | **16×16** (`chevron*.svg` may be 9×9 to 16×16) | `name.svg` + `name_dark.svg` |
| Welcome/onboarding & logos | **16, 20, 28, 48** (per surface) | `name.svg` + `name_dark.svg` |

When in doubt, find a sibling icon of the same role already in the icons folder and copy its `width` / `height` / `viewBox`.

## Where the SVGs live

Plugin icons go into `packages/kilo-jetbrains/frontend/src/main/resources/icons/` (action icons, tool-window icons) or the `icons/views/` subfolder (in-view icons used by the chat/session UI). Icons are loaded directly via `IconLoader` — there is no role-based subfolder structure and no mapping file. Place both the light SVG and its `_dark` sibling in the folder and reference them from the plugin's icon-holder class.

## SVG skeleton

```svg
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- shapes, ordered back-to-front -->
</svg>
```

The dark variant is the same file with light-palette colors swapped for their dark-theme partner — see [palette.md](./palette.md). Never change geometry between the two.

## Composition rules

- **One semantic meaning per icon.** A status badge, an accent dot, or a "+" overlay is fine; two unrelated glyphs in one icon is not.
- **Optical centering, not geometric.** Plus/arrow/refresh glyphs sit slightly above center; round badges (class, method, status) are centered on `(cx=8, cy=8)` for 16×16 and `(cx=10, cy=10)` for 20×20.
- **Outer keep-out**: leave at least **1 px** of empty padding on each side of a 16×16 icon (so meaningful geometry lives within `1..15`). For 20×20 use **2 px** of padding. Stripe icons must stay visually balanced inside their 20×20 cell.
- **Round caps overshoot the endpoint.** A round `stroke-linecap`/`stroke-linejoin` extends **half the stroke width past the endpoint**, so a 1px round-capped stroke ending at `0` or `16` is clipped by the canvas. Keep stroke endpoints within `0.5..15.5` (this is stricter than the fill keep-out).
- **Stroke + fill pairing for node-style icons** (class/method nodes): a light-tinted fill at radius 6.5 with a stroke in the accent color, plus a glyph filled with the same accent.
  - Light: `<circle cx="8" cy="8" r="6.5" fill="<accent-bg-light>" stroke="<accent-light>"/>` then glyph `fill="<accent-light>"`.
  - Dark: same circle with `fill="<accent-bg-dark>" stroke="<accent-dark>"` and glyph filled with `<accent-dark>`.
- **Stroke-only icons** (chevrons, refresh, edit pencil): a single-color path using the neutral stroke (`#6C707E` light / `#CED0D6` dark) at `stroke-width="1"`. Use `#818594` (light) / `#6F737A` (dark) for "secondary" stroke glyphs like dropdown chevrons.
- **Status badges** (error/warning/success/info) follow this template:
  - Light: filled circle/triangle in the *accent* color, glyph painted in `white`.
  - Dark: filled circle/triangle in the *dark accent* color, glyph painted in the matching *muted dark fill* (e.g. `#5E4D33` inside `#F2C55C` warning) — never plain white.
- **Two-tone action icons** (a base glyph plus a small modifier): the base glyph uses the neutral gray, and the small modifier (`+`, ✕, ↻, gear) uses the primary blue accent. Light gray + blue accent → dark gray + blue accent in the dark variant.
- **Disabled / stroke-only variants** (e.g. `*-stroke.svg`): outline-only, same neutral stroke color, no fills.

## Palette quick reference

The full lookup is in [palette.md](./palette.md). Most icons only need:

| Role | Light | Dark |
|---|---|---|
| Primary stroke / fill | `#6C707E` | `#CED0D6` |
| Secondary stroke | `#818594` | `#6F737A` |
| Disabled / faint fill | `#EBECF0` | `#43454A` |
| Accent — Blue | `#3574F0` | `#548AF7` |
| Accent — Blue (bg) | `#EDF3FF` / `#E7EFFD` | `#25324D` |
| Accent — Red | `#DB3B4B` | `#DB5C5C` |
| Accent — Red (bg) | `#FFF7F7` | `#402929` |
| Status — Error fill | `#E55765` | `#DB5C5C` |
| Status — Warning fill | `#FFAF0F` | `#F2C55C` |
| Status — Success fill | `#55A76A` | `#57965C` |
| Accent — Green | `#208A3C` | `#57965C` |
| Accent — Green (bg) | `#F2FCF3` | `#253627` |
| Accent — Orange | `#E66D17` | `#C77D55` |
| Accent — Orange (bg) | `#FFF4EB` | `#45322B` |
| Accent — Yellow/Gold | `#FFAF0F` / `#C27D04` | `#F2C55C` / `#D6AE58` |
| Accent — Purple | `#834DF0` | `#B589EC` |
| Accent — Purple (bg) | `#FAF5FF` | `#2F2936` |
| White on dark badge | `white` | matching muted-dark fill (e.g. `#5E4D33`) |

Do not use plain `#000000` or off-the-palette grays.

## Generation workflow

1. **Pick the role and canvas size** from the table above. Find at least two visually similar sibling icons already in the icons folder and mirror their stroke/fill mix.
2. **Lay out geometry on the pixel grid** (whole-pixel fills, half-pixel stroke centers). Optical-center the glyph.
3. **Apply the canonical light palette** from [palette.md](./palette.md). Never invent colors.
4. **Save the light SVG** with `width`/`height`/`viewBox` matching the role and `fill="none"` on `<svg>`.
5. **Duplicate to the `_dark` filename** and swap each color for its dark-theme partner from the palette mapping. Keep paths byte-identical otherwise.
6. **Place and wire the file** → drop both files into `packages/kilo-jetbrains/frontend/src/main/resources/icons/` (action icons, tool-window icons) or `icons/views/` (in-view chat/session icons), then reference the icon from the plugin's icon-holder class.
7. **Verify visually** in both themes via the image preview in the IDE, or run the IDE and toggle *View ▸ Appearance ▸ New UI* to compare. Check selection states for stripe icons.

## Adapting or rescaling an existing icon

Importing a Lucide/Codicon-style icon (often drawn on a 20- or 24-unit grid) or moving one onto the 16×16 grid is not a blanket "set everything to the 16 defaults" operation:

1. **Scale geometry *and* every `stroke-width`** by the same factor (`16 ÷ source size`). This keeps the render faithful before you change anything intentionally.
2. **Only then re-weight the primary glyph stroke** to `1` if it wasn't already ~1px effective. Leave hairlines and geometry-coupled strokes at their scaled value (see rule 6).
3. **Re-check what scaling breaks:**
   - Round caps clipping at the edge → nudge stroke endpoints into `0.5..15.5`.
   - Strokes that were flush with a fill edge (e.g. a badge ring around a status dot) → the stroke must still straddle the fill boundary after scaling; scale its width too.
4. **Crispness is a separate pass.** Scaling rarely lands coordinates on the pixel grid, so the result is faithful but not automatically crisp; the pixel-grid snap (rule 7) is manual and per-icon.

## Common mistakes

- Off-palette colors (e.g. importing from Figma without remapping). They will not theme correctly and reviewers will reject the PR.
- Different geometry between light and dark variants — selection animations and HiDPI overlays will glitch.
- A 16-px glyph saved into a 20×20 canvas without re-balancing. Tool-window/main-toolbar icons need geometry tuned for 20×20, not a 16×16 reused with extra whitespace.
- Using `currentColor`, CSS, or `<style>` blocks. The IntelliJ icon loader requires explicit colors on every shape so it can do palette-based recoloring.
- Forgetting the `_dark` variant. The icon will look fine in Light theme then turn invisible in Dark.
- Pure-black (`#000`) or pure-white (`#FFF`) fills outside the status-badge glyph pattern. They break under accent recoloring.
- Blanket-setting every `stroke-width` to `1` when rescaling. Only the primary glyph stroke is 1px; hairlines and fill-coupled/ring strokes must scale with the geometry or they fatten and misalign.
- Round caps at the canvas edge. A round cap overshoots its endpoint by half the stroke width, so an endpoint at `0` or `16` clips — keep stroke endpoints within `0.5..15.5`.

## References

- [palette.md](./palette.md) — full color palette with light↔dark mapping.
- [examples.md](./examples.md) — annotated SVG snippets for each icon role.
- `packages/kilo-jetbrains/AGENTS.md` — repository-specific JetBrains plugin constraints; use it together with this skill for icon work.
- `packages/kilo-jetbrains/frontend/src/main/resources/icons/` (with its `views/` subfolder) — where plugin icons live; this is the ground truth for placement.
