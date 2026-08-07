# Plan: Overlay ActiveList action button row on a layered pane

## Goal

Refactor `ActiveListRenderer` so its **action button row** (`cellPane` of `ActiveListActionCell`s) is
drawn **on top of** the row via a `JLayeredPane` instead of consuming horizontal layout space in
`BorderLayout.EAST`. The buttons keep their current right-aligned position and internal layout, but
float on a top layer. A small padding of the **same background color** wraps the button bar so it
blends into the row ("empty" surface, not a separate color). Because every ActiveList-based list
(settings lists, autoapprove, rules, providers, MCP, skills, agents, worktree editor, agent manager)
shares this single renderer, they all get the behavior automatically.

## Target and scope

- **File:** `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/ui/list/ActiveListRenderer.kt`
- **In scope:** only the action buttons (`cellPane`). Trailing text (`trailPane`), leading icon
  (`mark`), title/description (`textPane`), and the section header (`top`) stay in normal layout.
- **Out of scope:** `PickerListRenderer<T>`, `HistoryRenderer`, `AccountPickerRenderer` (they share the
  `PickerRow` wrapper but are not the "active renderer" and are not part of this change).
- Kilo-owned path (`ui/list/`), no upstream `kilocode_change` markers needed.

## Current structure (for reference)

- Root: `JPanel(BorderLayout)` → `top` (NORTH, section separator) + `wrap: PickerRow` (CENTER).
- `wrap.setContent(row)`; `row: JPanel(BorderLayout)` = `mark` (WEST) + `textPane` (CENTER) +
  `actions` (EAST). `actions = Stack.horizontal(md).next(trailPane).next(cellPane)`.
- `cellPane = cells.align(RIGHT, CENTER)`; `cells: Stack.horizontal` holds `ActiveListActionCell`s.
- Visibility: cells shown only for the active focused selection or `alwaysVisible` cells
  (`syncCells(value, active && list.isEnabled, ...)`).
- Clicks/tooltips/balloon anchors resolve via `activeListCellBounds()` /
  `activeListCellAt()` (`ActiveListModel.kt`), which re-render the cell, recursively `doLayout` it
  (`activeListLayout`), find every visible `ActiveListActionCell`, and convert its coordinates to the
  root component. **Geometry is read back from the live tree, so click targets follow wherever the
  cells are drawn — no separate coordinate math to keep in sync.**

## Key design decisions

1. **Layer host:** reuse the existing `LayeredOverlayPanel`
   (`ui/LayeredOverlayPanel.kt`) as the content of `wrap`, instead of hand-rolling a new
   `JLayeredPane`. It already provides content (`DEFAULT_LAYER`) + overlay (`PALETTE_LAYER`) layers,
   a `doLayout` that sizes every layer to full bounds and re-lays children, an `addOverlay(child) {}`
   bounds hook, and `getPreferredSize = max(content, overlay)`. The unused `blocker` layer stays
   hidden and inert (a paint-only rubber-stamp renderer never receives events, so its `contains`
   override is irrelevant). Only one renderer instance exists per list, so the extra layer is cheap.
   - If reuse proves awkward, fall back to a minimal private `JLayeredPane` in this file mirroring
     `LayeredOverlayPanel.doLayout` (content + overlay only). Prefer reuse.

2. **Content layer** = the existing `row`, with `cellPane` **removed** from `actions`:
   - `row` = `mark` (WEST) + `textPane` (CENTER) + `trailPane` (EAST). Keep the row border/padding.
   - `textPane` now reclaims the horizontal space the buttons used to reserve (full width minus
     leading icon and trailing text).

3. **Overlay layer** = a new opaque **pill** panel containing `cellPane`:
   - Pill = a `JPanel` (BorderLayout/Align) wrapping `cellPane`, `isOpaque = true`, with a small
     uniform padding border around the buttons (`JBUI.Borders.empty(UiStyle.Gap.sm())`; tune to
     `xs()` if `sm()` looks too large). This is the "small padding of the same color".
   - Register with `layers.addOverlay(pill) { host, child -> rightAlignedRect }`: right edge aligned
     to the row content's right inset (`UiStyle.Gap.pad()`, matching where cells sat before),
     vertically centered, sized to `child.preferredSize`.
   - Pill visibility mirrors current cell visibility (hidden when there are no visible cells).

4. **Background = same color as the row (blend):** on each `getListCellRendererComponent`, set the
   pill background to the row's **effective** surface so it reads as empty space:
   - selection color when the row is the active focused selection
     (`UIUtil.getListBackground(true, focused)` — the same value `PickerRow.update` uses as
     `selectionColor`), otherwise `list.background` (covers `alwaysVisible` cells on unselected rows,
     and the tool-window surface via `list.background`).
   - The `LayeredOverlayPanel` itself and the content `row` remain non-opaque/transparent so the
     `PickerRow` selection highlight still paints through beneath the content.

5. **Preferred size / row height:** rely on `LayeredOverlayPanel.getPreferredSize = max(content,
   overlay)` so rows never clip the button pill even if a row's content is shorter than the buttons.
   `ActiveListView.syncCellHeight` / `renderer.bodyPreferredHeight` measure with `selected=true,
   focused=true` (pill visible), so equal-height mode stays consistent across rows.

6. **Hit-testing stays correct for free:** `activeListCellBounds` calls `activeListLayout(comp)` which
   recursively `doLayout`s the tree, including `LayeredOverlayPanel.doLayout` (positions the pill) and
   the pill/`cellPane`. It then finds the `ActiveListActionCell`s and converts coordinates to the
   root. Since it renders with `focused=true`, the pill is visible during measurement. `point(key,
   cell)` (balloon anchors for delete/edit/level popups) reads the same bounds, so anchors follow the
   overlaid buttons automatically. **No changes required in `ActiveListModel.kt`; verify only.**

## Failure modes / risks

- **Overlay not on top:** confirm cells land on `PALETTE_LAYER` (above `DEFAULT_LAYER`). The JList
  rubber stamp validates the renderer before paint (`BasicListUI` calls
  `rendererPane.paintComponent(..., shouldValidate = true)`), so custom `doLayout` runs and layer
  z-order paints overlay last. Existing `LayeredOverlayPanelTest` / `SessionRootPanelTest` already
  assert this layer assignment.
- **Content bleeding past the pill:** the pill is a single opaque panel behind all buttons, so text
  behind it is masked; title text to the left of the pill remains visible (intended float look).
- **Pill clipping when row is short:** mitigated by `max(content, overlay)` preferred height.
- **Right-edge alignment drift:** balloons and clicks read back live geometry, so they self-align;
  only the *visual* right inset must look right — match the previous `UiStyle.Gap.pad()` right inset.
- **New UI vs classic:** `PickerRow.update` adjusts selection insets in New UI. Keep the pill's
  right inset independent of that; verify visually in both UIs is not required, but keep the inset a
  `JBUI`/`UiStyle.Gap` value (DPI-aware).

## Implementation tasks (ordered)

1. In `ActiveListRenderer`, remove `cellPane` from the `actions` stack so `actions` (or the row EAST)
   holds only `trailPane` (trailing text). Keep `trail`/`trailPane` behavior and the
   `actions.isVisible = trail.isVisible || cellPane.isVisible` logic re-expressed for the new layout
   (trailing-text visibility drives the EAST slot; pill visibility is handled on the overlay).
2. Introduce the opaque `pill` panel wrapping `cellPane` with `JBUI.Borders.empty(UiStyle.Gap.sm())`
   padding and `isOpaque = true`. Do **not** run it through `UiStyle.Components.transparent(...)`
   (it must paint the blend background); keep `cellPane`/`cells` transparent as today.
3. Replace `wrap.setContent(row)` with `wrap.setContent(layers)` where
   `layers = LayeredOverlayPanel(content = row)` and `layers.addOverlay(pill) { host, child -> ... }`
   computes a right-aligned, vertically-centered rectangle inset by `UiStyle.Gap.pad()` on the right.
4. In `getListCellRendererComponent`:
   - keep populating `cells` via `syncCells(...)` exactly as now;
   - set `pill.isVisible = cells.isVisible`;
   - set `pill.background` to `if (active && list.isEnabled) UIUtil.getListBackground(true, focused/active) else list.background` (match `PickerRow.update`'s selection color);
   - drop the old `cellPane.isVisible` / `actions.isVisible`-with-cells coupling in favor of the pill.
5. Ensure `LayeredOverlayPanel` and `row` remain non-opaque so the `PickerRow` selection highlight
   still shows through; only the pill is opaque.
6. Confirm `ActiveListModel.activeListCellBounds` / `activeListCellAt` need no change (the traversal
   already recurses into the layered pane). Add a code comment noting the cells now live in the
   overlay layer.

## Tests

Add/adjust in `packages/kilo-jetbrains/frontend/src/test/...`:

1. New assertions in `ui/list` (or extend `SettingsListViewTest`):
   - action cells resolve onto the overlay/`PALETTE_LAYER` above the content layer;
   - the pill background equals the row's selection background when selected/active, and
     `list.background` for an `alwaysVisible` cell on an unselected row;
   - `textPane`/title occupies the reclaimed full width (cells no longer reserve EAST space);
   - `activeListCellBounds(...)` still returns a non-empty rect for a visible cell and
     `activeListCellAt(center)` maps to it; a click at that point routes through `onCell`.
2. Run and fix the existing geometry/round-trip tests that exercise action cells:
   `SettingsListViewTest`, `ProvidersSettingsUiTest`, `AutoApproveSettingsUiTest`,
   `SettingsInlineListTest`, `RulesSettingsUiTest`, `SkillsSettingsUiTest`, `McpSettingsUiTest`,
   `AgentsSettingsUiTest`, `WorktreeSessionEditorPanelTest`. Most use get-bounds → click-center →
   assert-callback and should pass unchanged; fix any that assert the old EAST layout specifics
   (e.g. exact non-action visible-component counts or that the title is not overlapped).
3. Follow the retained-Swing test guidance in the JetBrains `AGENTS.md`: assert no per-render
   component growth and that the same `ActiveListActionCell` instances are reused across updates.

## Validation

From `packages/kilo-jetbrains/`:
- `./gradlew typecheck`
- `./gradlew test` (or targeted: the test classes listed above)
- Optional manual check: `./gradlew runIde`, open a settings list (e.g. Rules or Providers) and the
  Agent Manager worktree list; confirm action buttons float on top on selection/hover, blend into the
  row background with a small pad, and that click/edit/delete balloons anchor correctly in both New UI
  and classic UI, light and dark themes.

## Notes for the implementer

- This is a frontend-only Swing change on the EDT; annotate any touched UI methods per existing
  `@RequiresEdt` usage and keep all mutation on the EDT.
- Use `UiStyle.Gap.*` / `JBUI` for all spacing and `UIUtil.getListBackground(...)` for the blend
  color — no raw `Color`, `Insets`, or pixel literals (see `AGENTS.md` UI rules).
- No SDK/server changes; no CLI pin impact.
