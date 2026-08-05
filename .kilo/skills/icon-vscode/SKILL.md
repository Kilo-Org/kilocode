---
name: icon-vscode
description: Create or review icons for Kilo's VS Code extension, webviews, and shared icon registry.
---

# VS Code Icons

Use this skill for icon work in `packages/kilo-vscode/`, `packages/kilo-ui/`, and the shared `packages/ui/` icon registry. Keep official VS Code workbench rules separate from Kilo's webview design system.

## Choose the icon system first

| Surface | Use | Source of truth | Theme handling |
|---|---|---|---|
| VS Code commands, menus, and editor actions | Codicon, for example `$(add)`, or a 16x16 single-color SVG only when needed | `packages/kilo-vscode/package.json` records usages; [VS Code command icons](https://code.visualstudio.com/api/references/contribution-points#contributes.commands) defines the contract | VS Code themes Codicons; SVGs use light/dark contribution fields |
| Activity bar and view containers | 24x24 centered single-color icon by the VS Code convention; existing Kilo branding is an intentional asset exception | `packages/kilo-vscode/package.json`, `packages/kilo-vscode/assets/icons/` | Follow the contribution point; do not redesign the existing brand mark |
| Marketplace and extension branding | Packaged brand asset | `packages/kilo-vscode/package.json`, `packages/kilo-vscode/assets/icons/` | Existing Kilo assets define their own palette and variants |
| Webview buttons and UI | `Icon` or `IconButton` from `@kilocode/kilo-ui` | `packages/kilo-ui/src/components/icon.tsx`, then `packages/ui/src/components/icon.tsx` | `currentColor` and the VS Code theme bridge |
| Extension-contributed product icon | Existing WOFF2 font entry, for example `$(kilo-logo)` | `contributes.icons` in `packages/kilo-vscode/package.json` and its usages | VS Code product-icon theming |

Do not draw a custom SVG when an appropriate Codicon or existing registry icon already exists. Do not use a webview icon directly in `package.json`, or a VS Code contribution icon directly in the webview.

## Existing repository conventions

- Search `packages/kilo-ui/src/components/icon.tsx` first for Kilo-only icons, then `packages/ui/src/components/icon.tsx` for shared icons. Preserve the existing key spelling, which is mostly kebab-case, and match a visual sibling before adding a new one.
- Webview registry icons are inline SVG path strings, not standalone files. They use `fill="currentColor"` or `stroke="currentColor"`; do not add theme duplicates or literal palettes to registry entries. Standalone brand artwork may use light/dark variants.
- Match the closest registry sibling's `viewBox`. The shared set is mostly `20 20`, with existing `16 16` entries; Kilo-only entries also intentionally use `24 24`. Icons render at 16px (`small`), 20px (`normal`), or 24px (`medium`/`large`). Never paste a path onto a different canvas without rebalancing it.
- The extension's current brand assets are `kilo-light.svg`, `kilo-dark.svg`, `kilo-light.png`, `kilo-dark.png`, and `logo-outline-black.png`. The WOFF2 file is a packaged contribution font, not an editable icon source.
- Registry icons are decorative by default. Icon buttons need an `aria-label` or visible button text; a tooltip or arbitrary `label` attribute is not sufficient unless the wrapper maps it to an accessible name.

## Geometry rules

1. Give each icon one clear semantic meaning. A small `+`, status mark, or active-state fill is an acceptable modifier.
2. Start from at least one existing sibling with the same role and match its `viewBox`, visual weight, caps, joins, and padding. Official command SVGs use a 16x16 canvas with 1px padding; official view-container icons use a centered 24x24 canvas.
3. Keep round-capped endpoints away from the edge so caps are not clipped. For registry icons, use the sibling's bounds rather than imposing a new universal padding rule.
4. Use static SVG geometry such as `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, and `g`. No raster images, external resources, gradients, filters, embedded fonts, or `<style>` blocks in registry icons.
5. When adapting a 24px or 16px source, scale coordinates and every stroke width together first. Then set the primary stroke to the sibling's effective weight and snap only where it improves 1x clarity without distorting curves.
6. Match the closest sibling's cap and join style. The shared set intentionally mixes square caps, round caps, hairlines, and geometry-coupled strokes.
7. Keep geometry identical across light/dark packaged asset variants. Only theme-specific colors may change, unless the asset is an existing brand mark whose geometry is already established.

## Color and registration

- For webview registry icons, use `currentColor` for every painted shape. Apply semantic colors through the component or CSS token, not inside the SVG path data.
- For official command contribution assets, use one color and the documented 16x16/1px-padding contract. For packaged Kilo brand assets, follow the existing brand palette and explicit light/dark manifest fields instead of applying generic command-icon rules.
- Add Kilo-only registry entries to `packages/kilo-ui/src/components/icon.tsx` so the wrapper can fall back to the shared set. Add to `packages/ui/src/components/icon.tsx` only when the icon is intentionally shared outside Kilo.
- For shared icons, update the shared gallery when appropriate. For Kilo-only icons, use a story importing `@kilocode/kilo-ui/icon` or an affected extension story; the existing Kilo story imports `@opencode-ai/ui/icon` and does not exercise Kilo-only entries. Use the icon through `Icon` or `IconButton` rather than duplicating path data at a call site.

## Workflow

1. Search existing Codicons and registry names before designing anything.
2. Choose the target surface, canvas, and closest sibling.
3. Draw or rescale the geometry, preserving proportions and stroke relationships.
4. Register and consume the icon through the surface's normal API.
5. Check the icon at 1x and 2x in light, dark, high-contrast light, and high-contrast dark VS Code themes, and in its real button/menu context. Verify that it is not clipped, too faint, or visually heavier than its siblings.

For webview changes, use an affected extension Storybook story or a story importing `@kilocode/kilo-ui/icon`; the VS Code Storybook discovers `webview-ui/src/stories` rather than a dedicated icon gallery. For packaged assets, inspect the extension manifest contribution and all applicable theme variants.

## References

- [VS Code command icon specifications](https://code.visualstudio.com/api/references/contribution-points#contributes.commands)
- [VS Code product icon reference](https://code.visualstudio.com/api/references/icons-in-labels)
- `packages/kilo-vscode/package.json` — contribution-point usages and asset paths
- `packages/kilo-ui/src/components/icon.tsx` — Kilo-only registry entries
- `packages/ui/src/components/icon.tsx` — shared registry and viewBox selection
