# Annotated New UI Icon Examples

Each example below is paired with a dark variant and a short note on the pattern it represents. Use these as templates when generating new icons. Place generated icons in `packages/kilo-jetbrains/frontend/src/main/resources/icons/` (or the `icons/views/` subfolder for in-view chat/session icons).

---

## 1. Single-color action (16×16) — primary gray stroke + filled glyph

Plus / add action — the most common action icon shape.

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

Add-file action — base glyph in neutral gray, "+" sticker in primary blue.

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

Refresh action — multiple stroked sub-paths sharing one color.

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

Class / method nodes — the canonical PSI-node shape.

**Light (class — blue):**
```svg
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<circle cx="8" cy="8" r="6.5" fill="#E7EFFD" stroke="#3574F0"/>
<path d="M8.13295 11.5C9.61223 11.5 10.8836 10.6105 11.2075 9.33909H10.2213C9.90229 10.0739 9.11914 10.6057 8.13295 10.6057C6.77936 10.6057 5.80284 9.51796 5.80284 8C5.80284 6.48204 6.77936 5.39434 8.13295 5.39434C9.11914 5.39434 9.90229 5.92611 10.2213 6.66091H11.2075C10.8836 5.3895 9.61223 4.5 8.13295 4.5C6.21859 4.5 4.79248 5.99378 4.79248 8C4.79248 10.0062 6.21859 11.5 8.13295 11.5Z" fill="#3574F0"/>
</svg>
```

**Dark (class):**
```svg
<circle cx="8" cy="8" r="6.5" fill="#25324D" stroke="#548AF7"/>
<path d="M8.13295 11.5C9.61223 11.5 10.8836 10.6105 11.2075 9.33909H10.2213C9.90229 10.0739 9.11914 10.6057 8.13295 10.6057C6.77936 10.6057 5.80284 9.51796 5.80284 8C5.80284 6.48204 6.77936 5.39434 8.13295 5.39434C9.11914 5.39434 9.90229 5.92611 10.2213 6.66091H11.2075C10.8836 5.3895 9.61223 4.5 8.13295 4.5C6.21859 4.5 4.79248 5.99378 4.79248 8C4.79248 10.0062 6.21859 11.5 8.13295 11.5Z" fill="#548AF7"/>
```

**Method (red) follows the same template** with `#FFF7F7`/`#DB3B4B` (light) → `#402929`/`#DB5C5C` (dark).

Rules:
- Circle is always `cx="8" cy="8" r="6.5"` (so the 1-px stroke is centered between pixels 1 and 15).
- Fill = soft background pair, stroke = accent.
- Glyph inside uses the same accent color filled — never stroked.

---

## 5. Status badge (16×16) — circle/triangle with white glyph

Error badge:
```svg
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<circle cx="8" cy="8" r="7" fill="#E55765"/>
<path d="M9 5C9 4.44772 8.55228 4 8 4C7.44772 4 7 4.44772 7 5V7.5C7 8.05229 7.44772 8.5 8 8.5C8.55229 8.5 9 8.05228 9 7.5L9 5Z" fill="white"/>
<path d="M8 12C8.55228 12 9 11.5523 9 11C9 10.4477 8.55228 10 8 10C7.44772 10 7 10.4477 7 11C7 11.5523 7.44772 12 8 12Z" fill="white"/>
</svg>
```

The warning badge is the same idea but with a rounded triangle filled `#FFAF0F` (light) / `#F2C55C` (dark). In the dark theme, the glyph inside the warning triangle uses `#5E4D33` instead of `white` (white on warm yellow is unreadable).

The success badge uses a 2-px stroked checkmark inside a `#55A76A` (light) / `#57965C` (dark) circle — `stroke="white"` and `stroke-width="2"`.

---

## 6. Tool window stripe (20×20) — single-tone glyph on a larger canvas

Build tool-window stripe:
```svg
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M4.25 1C4.44891 1 4.63962 1.07907 4.78027 1.21973L5.56055 2H6.43945L7.21973 1.21973L7.33398 1.12598C7.45628 1.04445 7.60085 1 7.75 1H13.125C14.9473 1 16.4277 1.87993 17.4346 3.08105C18.4322 4.27143 19 5.81492 19 7.25C19 7.51735 18.8572 7.76425 18.626 7.89844C18.3948 8.03247 18.11 8.0339 17.8779 7.90137L15.4258 6.5H14.0605L13 7.56055V18.25C13 18.6642 12.6642 19 12.25 19H7.75C7.33579 19 7 18.6642 7 18.25V7.56055L6.43945 7H5.56055L4.78027 7.78027C4.63962 7.92093 4.44891 8 4.25 8H1.75C1.33579 8 1 7.66421 1 7.25V1.75C1 1.33579 1.33579 1 1.75 1H4.25ZM8.5 17.5H11.5V8H8.5V17.5ZM2.5 6.5H3.93945L4.71973 5.71973L4.83398 5.62598C4.95628 5.54445 5.10085 5.5 5.25 5.5H6.75C6.94891 5.5 7.13962 5.57907 7.28027 5.71973L8.06055 6.5H11.9395L13.2197 5.21973L13.334 5.12598C13.4563 5.04445 13.6008 5 13.75 5H15.625C15.7555 5 15.8838 5.03392 15.9971 5.09863L17.2637 5.82227C17.0602 5.19249 16.7287 4.57423 16.2842 4.04395C15.5098 3.12029 14.4276 2.5 13.125 2.5H8.06055L7.28027 3.28027C7.13962 3.42093 6.94891 3.5 6.75 3.5H5.25C5.05109 3.5 4.86038 3.42093 4.71973 3.28027L3.93945 2.5H2.5V6.5Z" fill="#6C707E"/>
</svg>
```

Notes:
- 20×20 canvas with **at least 2 px** breathing room on each edge (geometry lives in `2..18`).
- Re-balance vs. a 16×16 sibling — do not just paste a 16×16 path into a 20×20 viewBox.
- Keep a 16×16 sibling (`name.svg`) for compact mode; the `@20x20` variant is used by default.

---

## 7. Main toolbar action (20×20) — same template as tool window

Add action (20×20):
```svg
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M9.75586 17.25C9.34165 17.25 9.00586 16.9142 9.00586 16.5V10.5059H3C2.58594 10.5059 2.25025 10.1699 2.25 9.75586C2.25 9.34165 2.58579 9.00586 3 9.00586H9.00586V3C9.00607 2.58597 9.34178 2.25 9.75586 2.25C10.1699 2.25 10.5056 2.58597 10.5059 3V9.00586H16.5C16.9142 9.00586 17.25 9.34165 17.25 9.75586C17.2498 10.1699 16.9141 10.5059 16.5 10.5059H10.5059V16.5C10.5059 16.9142 10.1701 17.25 9.75586 17.25Z" fill="#6C707E"/>
</svg>
```

Main-toolbar icons reuse the 20×20 conventions of tool window stripes — the canvas size and stroke weights are identical, only the visual semantics differ.

---

## 8. Gutter icon (14×14) — thin stroke, no padding

Edit-doc gutter mark:
```svg
<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M10.5973 6.65471L12.6882 4.56049C13.1053 4.15406 13.1003 3.49602 12.6948 3.08627L11.0267 1.3136L11.0224 1.30932C10.6123 0.900035 9.94199 0.893268 9.53311 1.31079L7.3867 3.44406M10.5973 6.65471L7.3867 3.44406M10.5973 6.65471L4.74041 12.5H1.50036L1.5 9.32001L7.3867 3.44406" stroke="#6C707E" stroke-miterlimit="10"/>
</svg>
```

Gutter icons:
- Canvas is 14×14 (not 16×16). Glyph extends to the edge — there is *no* outer padding margin in the gutter.
- Prefer `stroke-miterlimit="10"` for hard-pointed glyphs (pencil tip), `stroke-linecap="round"` for chevrons / arrows.
- Compound gutter glyphs (e.g. implemented + override marker) layer two badges; keep each badge ≤ 9 px so the composition stays legible.

---

## 9. Breakpoint mark (14×14) — solid filled circle

Breakpoint mark:
```svg
<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M7 13C10.3137 13 13 10.3137 13 7C13 3.68629 10.3137 1 7 1C3.68629 1 1 3.68629 1 7C1 10.3137 3.68629 13 7 13Z" fill="#E55765"/>
</svg>
```

Breakpoint marks read at a glance — a single solid fill in the status-error red. Variants (disabled, conditional, log) layer a small overlay in the bottom-right corner.

---

## 10. Dark-variant gotcha — white-on-warm vs. muted-dark

The warning badge dark variant shows the only common case where a literal find-and-replace from the light SVG would produce a broken icon:

```svg
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M1.27603 10.8634L6.3028 1.98903C7.04977 0.670323 8.94893 0.670326 9.69589 1.98903L14.7227 10.8634C15.516 12.2639 14.5047 14 12.8956 14H3.10308C1.494 14 0.482737 12.2639 1.27603 10.8634Z" fill="#F2C55C"/>
<path d="M9 5C9 4.44772 8.55228 4 8 4C7.44772 4 7 4.44772 7 5V7.5C7 8.05229 7.44772 8.5 8 8.5C8.55229 8.5 9 8.05228 9 7.5L9 5Z" fill="#5E4D33"/>
<path d="M8 12C8.55228 12 9 11.5523 9 11C9 10.4477 8.55228 10 8 10C7.44772 10 7 10.4477 7 11C7 11.5523 7.44772 12 8 12Z" fill="#5E4D33"/>
</svg>
```

`white` → `#5E4D33` inside the warning triangle. Apply the same swap whenever a light icon paints a glyph as `white` over a warm fill (`#FFAF0F`, `#E66D17`, etc.). For cool fills (`#3574F0`, `#208A3C`, `#DB3B4B`), the dark-theme glyph stays `white` because contrast is still sufficient.
