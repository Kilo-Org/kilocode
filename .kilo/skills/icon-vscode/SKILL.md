---
name: icon-vscode
description: Create or review icons for Kilo's VS Code extension, webviews, and shared icon registry.
---

# VS Code Icons

Use this skill for icon work in `packages/kilo-vscode/`, `packages/kilo-ui/`, and the shared `packages/ui/` icon registry.

## Choose the icon system first

| Surface | Use | Source of truth | Theme handling |
|---|---|---|---|
| VS Code commands, menus, and editor actions | Codicon, for example `$(add)` | `packages/kilo-vscode/package.json` | VS Code themes it |
| Activity bar and extension branding | Packaged asset | `packages/kilo-vscode/assets/icons/` | Provide light/dark assets when the contribution point supports them |
| Webview buttons and UI | `Icon` or `IconButton` from `@kilocode/kilo-ui` | `packages/kilo-ui/src/components/icon.tsx`, then `packages/ui/src/components/icon.tsx` | `currentColor` and the VS Code theme bridge |

Do not draw a custom SVG when an appropriate Codicon or existing registry icon already exists. Do not use a webview icon directly in `package.json`, or a VS Code contribution icon directly in the webview.

## Existing repository conventions

- Search `packages/kilo-ui/src/components/icon.tsx` first for Kilo-only icons, then `packages/ui/src/components/icon.tsx` for shared icons. Use the existing kebab-case name and visual sibling before adding a new one.
- Webview icons are inline SVG path strings, not standalone files. They use `fill="currentColor"` or `stroke="currentColor"`; never add a light/dark duplicate or a literal palette for these icons.
- Standard registry icons use a `20 20` viewBox and render at 16px (`small`), 20px (`normal`), or 24px (`medium`/`large`). Use a `16 16` viewBox only when matching an existing small-grid sibling or a role that requires it. Do not paste a 16px path into a 20px canvas without rebalancing it.
- The extension's current brand assets are `kilo-light.svg`, `kilo-dark.svg`, `kilo-light.png`, `kilo-dark.png`, and `logo-outline-black.png`. The WOFF2 file is a packaged contribution font, not an editable icon source.
- Keep icon buttons accessible through their `label` or surrounding text. Registry icons are decorative by default.

## Geometry rules

1. Give each icon one clear semantic meaning. A small `+`, status mark, or active-state fill is an acceptable modifier.
2. Start from at least one existing sibling with the same role and match its `viewBox`, visual weight, caps, joins, and padding.
3. Keep meaningful geometry inside roughly `1..15` on a 16px canvas and `2..18` on a 20px canvas. Keep round-capped endpoints away from the edge so caps are not clipped.
4. Use path, rect, circle, line, polyline, and polygon geometry only. No raster images, gradients, filters, embedded fonts, or `<style>` blocks in registry icons.
5. When adapting a 24px or 16px source, scale coordinates and every stroke width together first. Then set the primary stroke to the sibling's effective weight and snap only where it improves 1x clarity without distorting curves.
6. Prefer round caps and joins for soft UI actions. Preserve square caps, hairlines, and geometry-coupled strokes when the sibling set uses them intentionally.
7. Keep geometry identical across light/dark packaged asset variants. Only theme-specific colors may change, unless the asset is an existing brand mark whose geometry is already established.

## Color and registration

- For webview registry icons, use `currentColor` for every painted shape. Apply semantic colors through the component or CSS token, not inside the SVG path data.
- For packaged contribution assets, follow the existing brand asset palette and explicit light/dark manifest fields. Do not invent a new brand color.
- Add Kilo-only registry entries to `packages/kilo-ui/src/components/icon.tsx` so the wrapper can fall back to the shared set. Add to `packages/ui/src/components/icon.tsx` only when the icon is intentionally shared outside Kilo.
- Register the icon in the appropriate gallery/story when one exists, then use it through `Icon` or `IconButton` rather than duplicating path data at a call site.

## Workflow

1. Search existing Codicons and registry names before designing anything.
2. Choose the target surface, canvas, and closest sibling.
3. Draw or rescale the geometry, preserving proportions and stroke relationships.
4. Register and consume the icon through the surface's normal API.
5. Check the icon at 1x and 2x, in light and dark VS Code themes, and in its real button/menu context. Verify that it is not clipped, too faint, or visually heavier than its siblings.

For webview changes, use the VS Code Storybook icon gallery or an affected story for visual review. For packaged assets, inspect the extension manifest contribution and both theme variants.
