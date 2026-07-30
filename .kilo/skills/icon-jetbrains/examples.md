# Annotated New UI Icon Examples

Each example below is paired with a dark variant and a short note on the pattern it represents. Use these as templates when generating new icons.

The `expui/<role>/...` names below are the upstream IntelliJ Community source paths the examples were copied from (consult via `$INTELLIJ_REPO`, see `packages/kilo-jetbrains/AGENTS.md`) — they are not paths in this repo. In this repo, place generated icons flat into `packages/kilo-jetbrains/frontend/src/main/resources/icons/`.

---

## 1. Single-color action (16×16) — primary gray stroke + filled glyph

`expui/general/add.svg` — the most common action icon shape.

**Light:**
```svg
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M7.5 1C7.77614 1 8 1.22386 8 1.5V7H13.5C13.7761 7 14 7.22386 14 7.5C14 7.77614 13.7761 8 13.5 8H8V13.5C8 13.7761 7.77614 14 7.5 14C7.22386 14 7 13.7761 7 13.5V8H1.5C1.22386 8 1 7.77614 1 7.5C1 7.22386 1.22386 7 1.5 7H7V1.5C7 1.22386 7.22386 1 7.5 1Z" fill="#6C707E"/>
</svg>
```

**Dark:** swap `#6C707E` → `#CED0D6`.

Why it works: one filled path, primary gray. Drop in any glyph and you have a complete action icon.

---

## 2. Two-tone action (16×16) — neutral base + blue accent modifier

`expui/actions/addFile.svg` — base glyph in neutral gray, "+" sticker in primary blue.

**Light:**
```svg
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M12.5 9C12.7761 9 13 9.22386 13 9.5V12H15.5C15.7761 12 16 12.2239 16 12.5C16 12.7761 15.7761 13 15.5 13H13V15.5C13 15.7761 12.7761 16 12.5 16C12.2239 16 12 15.7761 12 15.5V13H9.5C9.22386 13 9 12.7761 9 12.5C9 12.2239 9.22386 12 9.5 12H12V9.5C12 9.22386 12.2239 9 12.5 9Z" fill="#3574F0"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M3 13V5.82843C3 5.29799 3.21071 4.78929 3.58579 4.41421L6.41421 1.58579C6.78929 1.21071 7.29799 1 7.82843 1H11C12.1046 1 13 1.89543 13 3V8H12V3C12 2.44772 11.5523 2 11 2H8V4C8 5.10457 7.10457 6 6 6H4V13C4 13.5523 4.44772 14 5 14H8V15H5C3.89543 15 3 14.1046 3 13ZM4.41421 5L7 2.41421V4C7 4.55228 6.55228 5 6 5H4.41421Z" fill="#6C707E"/>
</svg>
```

**Dark:** `#3574F0` → `#548AF7`, `#6C707E` → `#CED0D6`.

Pattern: stick the small modifier glyph in the bottom-right of the canvas (`(9..15, 9..15)` for 16×16) and let the base glyph occupy the top-left two-thirds.

---

## 3. Stroke-only action (16×16) — chevrons, refresh, edit

`expui/general/refresh.svg` — multiple stroked sub-paths sharing one color.

**Light:**
```svg
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M2.5 9V8C2.5 4.96243 4.96243 2.5 8 2.5C9.10679 2.5 10.1372 2.82692 11 3.38947" stroke="#6C707E" stroke-linecap="round"/>
<path d="M5 12.6105C5.86278 13.1731 6.89321 13.5 8 13.5C11.0376 13.5 13.5 11.0376 13.5 8V7" stroke="#6C707E" stroke-linecap="round"/>
<path d="M0.49997 7.50027L2.5 9.5L4.49998 7.50023" stroke="#6C707E" stroke-linecap="round"/>
<path d="M11.5 8.49982L13.5 6.5L15.5 8.49982" stroke="#6C707E" stroke-linecap="round"/>
</svg>
```

`stroke-width` defaults to `1`. `stroke-linecap="round"` softens path ends; pair it with `stroke-linejoin="round"` whenever paths bend.

For secondary glyphs (chevrons in popups, dropdown arrows) use `#818594` light / `#6F737A` dark instead of the primary gray.

---

## 4. Node icon (16×16) — tinted circle with stroke + glyph

`expui/nodes/class.svg` and `expui/nodes/method.svg` — the canonical PSI-node shape.

**Light (class — blue):**
```svg
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<circle cx="8" cy="8" r="6.5" fill="#E7EFFD" stroke="#3574F0"/>
<path d="M8.13295 11.5C9.61223 11.5 …" fill="#3574F0"/>
</svg>
```

**Dark (class):**
```svg
<circle cx="8" cy="8" r="6.5" fill="#25324D" stroke="#548AF7"/>
<path d="…" fill="#548AF7"/>
```

**Method (red) follows the same template** with `#FFF7F7`/`#DB3B4B` (light) → `#402929`/`#DB5C5C` (dark).

Rules:
- Circle is always `cx="8" cy="8" r="6.5"` (so the 1-px stroke is centered between pixels 1 and 15).
- Fill = soft background pair, stroke = accent.
- Glyph inside uses the same accent color filled — never stroked.

---

## 5. Status badge (16×16) — circle/triangle with white glyph

`expui/status/error.svg`:
```svg
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<circle cx="8" cy="8" r="7" fill="#E55765"/>
<path d="M9 5C9 4.44772 8.55228 4 8 4C7.44772 4 7 4.44772 7 5V7.5C…" fill="white"/>
<path d="M8 12C8.55228 12 9 11.5523 9 11C9 10.4477 8.55228 10 8 10C7.44772 10 7 10.4477 7 11C7 11.5523 7.44772 12 8 12Z" fill="white"/>
</svg>
```

`expui/status/warning.svg` is the same idea but with a rounded triangle filled `#FFAF0F` (light) / `#F2C55C` (dark). In the dark theme, the glyph inside the warning triangle uses `#5E4D33` instead of `white` (white on warm yellow is unreadable).

`expui/status/success.svg` uses a 2-px stroked checkmark inside a `#55A76A` (light) / `#57965C` (dark) circle — `stroke="white"` and `stroke-width="2"`.

---

## 6. Tool window stripe (20×20) — single-tone glyph on a larger canvas

`expui/toolwindows/build@20x20.svg` (excerpt):
```svg
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M4.25 1C4.44891 1 …" fill="#6C707E"/>
</svg>
```

Notes:
- 20×20 canvas with **at least 2 px** breathing room on each edge (geometry lives in `2..18`).
- Re-balance vs. a 16×16 sibling — do not just paste a 16×16 path into a 20×20 viewBox.
- For the 16×16 stripe (legacy / compact mode), keep a sibling `build.svg`; New UI uses the `@20x20` variant by default.

---

## 7. Main toolbar action (20×20) — same template as tool window

`expui/general/add@20x20.svg`:
```svg
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M9.75586 17.25C9.34165 17.25 9.00586 16.9142 9.00586 16.5V10.5059H3C…" fill="#6C707E"/>
</svg>
```

Main-toolbar icons reuse the 20×20 conventions of tool window stripes — the canvas size and stroke weights are identical, only the visual semantics differ.

---

## 8. Gutter icon (14×14) — thin stroke, no padding

`expui/gutter/javadocEdit.svg`:
```svg
<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M10.5973 6.65471L12.6882 4.56049C…" stroke="#6C707E" stroke-miterlimit="10"/>
</svg>
```

Gutter icons:
- Canvas is 14×14 (not 16×16). Glyph extends to the edge — there is *no* outer padding margin in the gutter.
- Prefer `stroke-miterlimit="10"` for hard-pointed glyphs (pencil tip), `stroke-linecap="round"` for chevrons / arrows.
- Compound gutter glyphs (e.g. implemented + override marker) layer two badges; keep each badge ≤ 9 px so the composition stays legible.

---

## 9. Breakpoint mark (14×14) — solid filled circle

`expui/breakpoints/breakpoint.svg`:
```svg
<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M7 13C10.3137 13 13 10.3137 13 7C13 3.68629 10.3137 1 7 1C3.68629 1 1 3.68629 1 7C1 10.3137 3.68629 13 7 13Z" fill="#E55765"/>
</svg>
```

Breakpoint marks read at a glance — a single solid fill in the status-error red. Variants (disabled, conditional, log) layer a small overlay in the bottom-right corner.

---

## 10. Dark-variant gotcha — white-on-warm vs. muted-dark

`expui/status/warning_dark.svg` shows the only common case where a literal find-and-replace from the light SVG would produce a broken icon:

```svg
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M1.27603 10.8634L6.3028 1.98903C7.04977 0.670323 8.94893 0.670326 9.69589 1.98903L14.7227 10.8634C15.516 12.2639 14.5047 14 12.8956 14H3.10308C1.494 14 0.482737 12.2639 1.27603 10.8634Z" fill="#F2C55C"/>
<path d="…" fill="#5E4D33"/>
<path d="…" fill="#5E4D33"/>
</svg>
```

`white` → `#5E4D33` inside the warning triangle. Apply the same swap whenever a light icon paints a glyph as `white` over a warm fill (`#FFAF0F`, `#E66D17`, etc.). For cool fills (`#3574F0`, `#208A3C`, `#DB3B4B`), the dark-theme glyph stays `white` because contrast is still sufficient.
