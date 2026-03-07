# UI Assets Review — PR #6622 (OpenCode v1.2.16)

## Files Reviewed

| File                                                               | Status   | Additions | Deletions |
| ------------------------------------------------------------------ | -------- | --------- | --------- |
| `packages/ui/src/assets/icons/app/warp.png`                        | added    | 0         | 0         |
| `packages/ui/src/assets/icons/provider/302ai.svg`                  | added    | +7        | 0         |
| `packages/ui/src/assets/icons/provider/berget.svg`                 | added    | +3        | 0         |
| `packages/ui/src/assets/icons/provider/cloudferro-sherlock.svg`    | added    | +5        | 0         |
| `packages/ui/src/assets/icons/provider/evroc.svg`                  | added    | +3        | 0         |
| `packages/ui/src/assets/icons/provider/firmware.svg`               | added    | +18       | 0         |
| `packages/ui/src/assets/icons/provider/gitlab.svg`                 | added    | +3        | 0         |
| `packages/ui/src/assets/icons/provider/jiekou.svg`                 | added    | +4        | 0         |
| `packages/ui/src/assets/icons/provider/kilo.svg`                   | added    | +4        | 0         |
| `packages/ui/src/assets/icons/provider/kuae-cloud-coding-plan.svg` | added    | +3        | 0         |
| `packages/ui/src/assets/icons/provider/meganova.svg`               | added    | +3        | 0         |
| `packages/ui/src/assets/icons/provider/minimax-cn-coding-plan.svg` | added    | +24       | 0         |
| `packages/ui/src/assets/icons/provider/minimax-coding-plan.svg`    | added    | +24       | 0         |
| `packages/ui/src/assets/icons/provider/moark.svg`                  | added    | +3        | 0         |
| `packages/ui/src/assets/icons/provider/nova.svg`                   | added    | +3        | 0         |
| `packages/ui/src/assets/icons/provider/novita-ai.svg`              | added    | +10       | 0         |
| `packages/ui/src/assets/icons/provider/opencode-go.svg`            | added    | +3        | 0         |
| `packages/ui/src/assets/icons/provider/opencode.svg`               | modified | 0         | -1        |
| `packages/ui/src/assets/icons/provider/privatemode-ai.svg`         | added    | +5        | 0         |
| `packages/ui/src/assets/icons/provider/qihang-ai.svg`              | added    | +9        | 0         |
| `packages/ui/src/assets/icons/provider/qiniu-ai.svg`               | added    | +7        | 0         |
| `packages/ui/src/assets/icons/provider/stackit.svg`                | added    | +4        | 0         |
| `packages/ui/src/assets/icons/provider/stepfun.svg`                | added    | +24       | 0         |
| `packages/ui/src/assets/icons/provider/vivgrid.svg`                | added    | +4        | 0         |

**Total: 24 files (23 added, 1 modified)**

## Summary

This group adds 22 new provider icons (SVGs), 1 new app icon (`warp.png`), and modifies the existing `opencode.svg` icon. The provider icons are source assets consumed by the `vite-plugin-icons-spritesheet` build plugin, which automatically generates the `sprite.svg` and `types.ts` files at build time from the `src/assets/icons/provider/` directory (`packages/ui/vite.config.ts:10-24`). Because of this pipeline, adding raw SVG files to the input directory is the correct workflow — no manual sprite or types.ts edits are needed.

However, several icons have quality and consistency issues that will cause visual problems — particularly hardcoded colors that won't adapt to themes, duplicate icon content, and non-standard SVG attributes.

## Detailed Findings

### `packages/ui/src/assets/icons/app/warp.png` (added, binary)

New app icon for the Warp terminal. This follows the existing pattern of PNG app icons (`finder.png`, `terminal.png`, `textmate.png`, `xcode.png`). The current `app-icons/types.ts` (auto-generated) does not include `"warp"`, but the spritesheet generator only processes SVG files — PNG icons are handled separately via direct imports. The existing app icon set already mixes SVGs and PNGs, so this is consistent.

**No issues.**

### `packages/ui/src/assets/icons/provider/302ai.svg` (added, +7)

**Issues:**

1. **Hardcoded RGB colors** — Uses `fill="rgb(156,155,155)"`, `fill="rgb(117,116,116)"`, and `fill="rgb(254,254,254)"`. Every other well-behaved provider icon uses `fill="currentColor"` so the icon adapts to light/dark themes. This icon will render as fixed grays regardless of the current theme, breaking visual consistency and potentially being invisible on certain backgrounds.
2. **`preserveAspectRatio="none"`** — This will distort the icon if the container aspect ratio doesn't match. Most icons omit this attribute (defaulting to `xMidYMid meet`) or don't set it to `none`.
3. **Mismatched width/height vs viewBox** — `width="1046" height="1046"` with `viewBox="0 0 2048 2048"`. While the viewBox is square and the explicit dimensions are square so no actual distortion occurs, the non-standard explicit dimensions (1046) are inconsistent with the convention of `width="24" height="24"` used by most icons.
4. **Uses `style="display: block;"`** — Inline styles that may conflict with the spritesheet rendering context.
5. **Missing newline at end of file.**

**Severity: High** — Hardcoded colors will break theme support.

### `packages/ui/src/assets/icons/provider/berget.svg` (added, +3)

Clean SVG using `fill="currentColor"`. viewBox is non-square (`0 0 463 419`), which is slightly unusual but acceptable as the sprite generator handles varying viewBoxes. Explicit dimensions are `24x24` per convention.

**Missing newline at end of file.** Minor.

**No functional issues.**

### `packages/ui/src/assets/icons/provider/cloudferro-sherlock.svg` (added, +5)

Uses `fill="currentColor"` and `stroke="currentColor"` for theming. Standard `24x24` viewBox. Has one path with `opacity="0.01"` — effectively invisible, likely a hit-area or alignment element.

**Missing newline at end of file.** Minor.

**No functional issues.**

### `packages/ui/src/assets/icons/provider/evroc.svg` (added, +3)

**Issues:**

1. **`fill="inherit"` on root `<svg>`** — Unlike `currentColor` which resolves to the current CSS color, `inherit` inherits from the parent element's `fill` property. Inside a `<use>` spritesheet reference (as used by `ProviderIcon` at `provider-icon.tsx:21`), `inherit` may not resolve correctly since the sprite symbol is rendered in a shadow-like context. The convention is `fill="currentColor"`.
2. **Non-square viewBox** — `viewBox="0 0 100 25"` is a wide landscape aspect ratio (4:1). When rendered in a square icon slot, this will have significant vertical padding. Most icons use square or near-square viewBoxes.
3. **No explicit `width`/`height`** — Missing explicit dimensions. Not critical since the consuming component controls sizing, but inconsistent with other icons.
4. **No `xmlns` attribute** — Missing `xmlns="http://www.w3.org/2000/svg"`. While browsers tolerate this in inline SVG, the sprite generator may or may not handle this correctly.
5. **Missing newline at end of file.**

**Severity: Medium** — `fill="inherit"` and extreme aspect ratio may cause rendering issues.

### `packages/ui/src/assets/icons/provider/firmware.svg` (added, +18)

Uses `fill-rule="evenodd"` and `clip-rule="evenodd"` which is fine. All paths use `fill="currentColor"` (implied by absence of fill, inheriting from context). No hardcoded colors detected.

Complex path data — this is a detailed logo. The `transform="matrix(1.149971,0,0,1.149971,-166.19831,2.0845471)"` on the inner `<g>` element applies scaling/translation which is fine for SVG.

**No issues.**

### `packages/ui/src/assets/icons/provider/gitlab.svg` (added, +3)

Clean SVG. Uses `fill="currentColor"`, standard `24x24` explicit dimensions, `viewBox="0 0 380 380"`. Follows conventions properly.

**No issues.**

### `packages/ui/src/assets/icons/provider/jiekou.svg` (added, +4)

Uses `fill="currentColor"`. No explicit `width`/`height` but has proper `viewBox="0 0 24 24"`. Paths are clean.

**No issues.**

### `packages/ui/src/assets/icons/provider/kilo.svg` (added, +4)

Uses `stroke="currentColor"` (not fill) with `stroke-width="2.4"` and `stroke-linecap="round"`. This is a stroke-based icon design (a "K" shape), which is perfectly valid. `viewBox="0 0 24 24"`, `fill="none"` on root.

**No issues.** This is the Kilo brand icon — appropriate for inclusion.

### `packages/ui/src/assets/icons/provider/kuae-cloud-coding-plan.svg` (added, +3)

Uses `fill="currentColor"`. Standard `24x24` dimensions. `viewBox="0 0 40 40"`. Clean.

**No issues.**

### `packages/ui/src/assets/icons/provider/meganova.svg` (added, +3)

Uses `fill="currentColor"` for paths, `fill="none"` on root. `viewBox="0 0 1000 1000"` — large coordinate space but square, which is fine. Standard `24x24` dimensions. Very complex constellation-like path data with many coordinates.

**No issues.** The path complexity is high but this is purely a file size concern, not a correctness issue.

### `packages/ui/src/assets/icons/provider/minimax-cn-coding-plan.svg` (added, +24)

**Issue:**

1. **Identical content to `minimax-coding-plan.svg` and `stepfun.svg`** — All three files contain the exact same SVG sparkle/star pattern. This is almost certainly a bug in the upstream icon-fetching pipeline (`fetchProviderIcons()` in `vite.config.ts:47-58`), where the `models.dev` API may be returning the same placeholder SVG for multiple providers. The stepfun provider should have its own distinct icon (the Step Fun "star" logo), not the same sparkle pattern as MiniMax coding plans.

Uses `stroke="currentColor"`, well-formed sparkle pattern with three star shapes. The SVG itself is well-constructed.

**Severity: Medium** — Three providers will display the same icon, causing user confusion. The `stepfun.svg` content is almost certainly wrong.

### `packages/ui/src/assets/icons/provider/minimax-coding-plan.svg` (added, +24)

**Identical to `minimax-cn-coding-plan.svg` and `stepfun.svg`.** See above. The MiniMax "coding plan" variants using a sparkle icon (distinct from the base `minimax.svg` wave pattern) may be intentional — coding-plan variants could reasonably share a "sparkle/AI" motif — but sharing the same icon with `stepfun` is wrong.

**Severity: Medium** — See `minimax-cn-coding-plan.svg` finding above.

### `packages/ui/src/assets/icons/provider/moark.svg` (added, +3)

Uses `fill="currentColor"` via `fill-rule="evenodd"`. `viewBox="0 0 40 40"`. Clean paths.

**Minor:** Explicit `width="40" height="40"` differs from the `24x24` convention used by most icons. Not a functional problem since the consuming component sets sizing, but inconsistent.

**No functional issues.**

### `packages/ui/src/assets/icons/provider/nova.svg` (added, +3)

Uses `fill="currentColor"`. `viewBox="0 0 24 24"`. Clean compass-star pattern.

**No issues.**

### `packages/ui/src/assets/icons/provider/novita-ai.svg` (added, +10)

**Issues:**

1. **Hardcoded colors** — Uses `fill="black"` on the main path and `fill="white"` inside a `<clipPath>` rect. The `fill="black"` means this icon will be invisible on dark theme backgrounds.
2. **Uses `<clipPath>` with element ID `clip0_3135_1230`** — Inside a spritesheet, IDs must be unique across all symbols. If any other icon in the sprite uses the same ID, the clip-path reference will break. The ID `clip0_3135_1230` appears auto-generated (likely from Figma export), so collision risk is low but not zero. The spritesheet generator may or may not namespace these IDs.
3. **Explicit `width="40" height="40"`** — Inconsistent with the `24x24` convention.

**Severity: High** — `fill="black"` breaks dark theme rendering.

### `packages/ui/src/assets/icons/provider/opencode-go.svg` (added, +3)

Uses `fill="currentColor"`. `viewBox="0 0 24 24"`, `24x24` dimensions. A stylized "G" shaped logo. Clean.

**No issues.**

### `packages/ui/src/assets/icons/provider/opencode.svg` (modified, -1 line)

Removes the semi-transparent decorative path: `<path opacity="0.2" d="..." fill="currentColor"/>`. The remaining path is the solid version of the OpenCode logo. This simplifies the icon to a single solid shape, removing the subtle depth effect.

**No issues.** This is a clean simplification.

### `packages/ui/src/assets/icons/provider/privatemode-ai.svg` (added, +5)

Uses `fill="currentColor"`. `viewBox="0 0 61 63"` — slightly non-square but close enough. Explicit dimensions `width="61" height="63"` are non-standard (not `24x24`).

**Missing newline at end of file.** Minor.

**No functional issues.**

### `packages/ui/src/assets/icons/provider/qihang-ai.svg` (added, +9)

Uses `stroke="currentColor"` with `stroke-width="3"`. Stroke-based hexagonal wireframe design. `fill="none"` implicitly (not set, paths use stroke only via compound `M`/`L` commands). `viewBox="0 0 40 40"`, `24x24` explicit dims.

**Missing newline at end of file.** Minor.

**No issues.**

### `packages/ui/src/assets/icons/provider/qiniu-ai.svg` (added, +7)

Uses `fill="currentColor"` via `<g fill="currentColor" fill-rule="nonzero">`. Proper `viewBox="0 0 24 24"`. Uses nested `<g>` elements which is fine.

**No issues.**

### `packages/ui/src/assets/icons/provider/stackit.svg` (added, +4)

**Issues:**

1. **XML declaration `<?xml version="1.0" encoding="UTF-8"?>`** — No other provider icon includes this. It's unnecessary for SVG assets embedded in a spritesheet and may cause issues depending on how the sprite generator parses the file.
2. **Element ID `id="STACKIT"`** — A top-level ID on the `<svg>` element. In a spritesheet context, this ID will be on a `<symbol>` element and could conflict with the spritesheet generator's own ID assignment (which uses the filename as the symbol ID).
3. **Non-square viewBox with decimal dimensions** — `viewBox="0 0 41.536063 41.536063"`. Decimal viewBox values are valid SVG but unusual. Square aspect ratio is fine.

**Severity: Low** — The XML declaration is the main concern; sprite generators typically handle it but it's non-standard for this codebase.

### `packages/ui/src/assets/icons/provider/stepfun.svg` (added, +24)

**Issue:**

1. **Identical content to `minimax-cn-coding-plan.svg` and `minimax-coding-plan.svg`** — This is a sparkle/star pattern that appears to be a MiniMax variant icon, not the Step Fun logo. Step Fun (Jieyue Xingchen) has a distinctive stepped-star logo that this SVG does not represent. This is almost certainly a data error from the upstream icon source (`models.dev`).

**Severity: High** — Incorrect icon for the Step Fun provider. Users will see a MiniMax sparkle icon instead of the actual Step Fun branding.

### `packages/ui/src/assets/icons/provider/vivgrid.svg` (added, +4)

Uses `fill="currentColor"` and `stroke="currentColor"` on paths. `viewBox="0 0 24 24"`. Two interlocking ribbon paths.

**Minor:** Uses `width="24px" height="24px"` with `px` units — all other icons that specify dimensions use bare numbers (e.g., `width="24" height="24"`). The `px` suffix is valid SVG but inconsistent with the codebase convention.

**No functional issues.**

## Risk to VS Code Extension

**Low.** The VS Code extension (`packages/kilo-vscode/`) consumes the `@kilocode/kilo-ui` package, which builds the provider icon spritesheet at compile time. These asset files flow through `packages/ui/` build pipeline only. The extension does not directly reference individual SVG files from `packages/ui/src/assets/`.

The primary user-facing risks are:

1. **Theme-breaking icons** — `302ai.svg` and `novita-ai.svg` use hardcoded colors and will render incorrectly in light or dark themes within the extension's webview. The `302ai` icon shows fixed grays; `novita-ai` uses `fill="black"` which is invisible on dark backgrounds.
2. **Incorrect branding** — `stepfun.svg` displays the wrong icon (MiniMax sparkle instead of Step Fun logo), which could confuse users selecting the Step Fun provider.
3. **Potential render glitch for `evroc`** — The `fill="inherit"` combined with 4:1 landscape aspect ratio may render unexpectedly in the extension's icon slots.

None of these issues pose a crash risk or data integrity concern. They are purely visual/cosmetic.

## Overall Risk

**Low-Medium.**

This is a straightforward batch addition of provider icon assets that feeds into an automated sprite generation pipeline. The pipeline itself (`vite-plugin-icons-spritesheet` configured in `vite.config.ts`) handles sprite and type generation automatically, so no manual wiring is needed.

**Key issues requiring attention:**

| Issue                                      | Files Affected                                                                                           | Severity |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- | -------- |
| Hardcoded colors (won't adapt to themes)   | `302ai.svg`, `novita-ai.svg`                                                                             | High     |
| Identical/wrong icon content               | `stepfun.svg` (= `minimax-cn-coding-plan.svg` = `minimax-coding-plan.svg`)                               | High     |
| `fill="inherit"` instead of `currentColor` | `evroc.svg`                                                                                              | Medium   |
| Extreme landscape aspect ratio (4:1)       | `evroc.svg`                                                                                              | Medium   |
| XML declaration in SVG                     | `stackit.svg`                                                                                            | Low      |
| `preserveAspectRatio="none"`               | `302ai.svg`                                                                                              | Low      |
| Missing newline at EOF                     | `302ai.svg`, `berget.svg`, `cloudferro-sherlock.svg`, `evroc.svg`, `privatemode-ai.svg`, `qihang-ai.svg` | Trivial  |

The majority of icons (17 of 23 new SVGs) are well-formed and follow conventions. The two high-severity issues (hardcoded colors and duplicate/wrong icon) should be flagged but are unlikely to block the merge since these icons are fetched dynamically from the upstream `models.dev` service and will auto-correct when the source data is fixed and the sprite is regenerated.
