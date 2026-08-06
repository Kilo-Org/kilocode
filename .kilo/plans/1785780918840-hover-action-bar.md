# Plan: Hover-revealed action bar for worktree & session lists

## Goal

In the Agent Manager JetBrains UI, make the `ActiveList` action-cell "button bar" appear
**only for the row the mouse is currently hovering**, instead of on the active focused
selection. Leaving the row (or the list) hides the bar again. Repaint must be scoped to the
affected row cell only — no full-list repaint.

Scope this new behavior to exactly two lists:
- Worktree list — `AgentManagerPanel` (`agentManager/AgentManagerPanel.kt:68`)
- Worktree-editor session list — `WorktreeSessionEditorPanel` (`agentManager/worktree/WorktreeSessionEditorPanel.kt:63`)

All other `ActiveList` consumers (settings pages, session history, pickers) keep the current
selection-based reveal unchanged.

## Confirmed decisions

- **Hover replaces selection reveal** in the two target lists. When hover mode is on, the bar
  shows only on the hovered row; the selected/focused row does not show the bar unless it is
  also the hovered row. `ActiveListCell.alwaysVisible` cells still always show.
- **"Cell" = whole list row.** Hovering anywhere on a row reveals that row's entire bar;
  repaint is scoped to that row's `getCellBounds(idx, idx)`.
- Row selection highlighting (`wrap.update(list, selected, active)`) is unchanged — only the
  action-cell visibility + pill visibility switch to hover-driven in hover mode.

## Key implementation facts

- Action-cell visibility is decided in `ActiveListRenderer.getListCellRendererComponent`
  (`ui/list/ActiveListRenderer.kt:164-167`) via `syncCells(value, active && list.isEnabled, ...)`,
  then `cellPane.isVisible`, `pill.isVisible`, `pill.background`.
- `active` derives from selection + focus + `(list as? ActiveListActive)?.active()`
  (renderer line 122).
- The `JBList` is created inside `ActiveListView` and already implements `ActiveListActive`
  (`ui/list/ActiveListView.kt:50`). Hover state can live in `ActiveListView` and be exposed to
  the renderer through that interface.
- Row height is precomputed with cells rendered (`syncCellHeight` renders with
  `selected/focused = true`, `bodyPreferredHeight` likewise), so showing/hiding cells on hover
  causes **no layout jump**. No height changes needed.
- Cell hit-testing (`activeListCellBounds`/`activeListCellAt` in `ui/list/ActiveListModel.kt`)
  already renders with `focused = true` to resolve click targets regardless of paint-time
  visibility, so clicking a hover-revealed cell already works with no change.

## Implementation tasks

1. **`ui/list/ActiveListModel.kt` — add config flag.**
   - Add `val hoverActions: Boolean = false` to `ActiveListConfig` (default false preserves all
     existing lists). Keep `Equal` / `Preferred` companion values as-is.

2. **`ui/list/ActiveListRenderer.kt` — expose hovered index + hover-driven visibility.**
   - Extend `ActiveListActive` with `fun hoveredIndex(): Int = -1` (default keeps other
     implementers, if any, working).
   - In `getListCellRendererComponent`, compute:
     ```
     val showCells = if (cfg.hoverActions)
         list.isEnabled && index == (list as? ActiveListActive)?.hoveredIndex()
     else
         active && list.isEnabled
     ```
   - Replace the `syncCells(value, active && list.isEnabled, list.isEnabled)` call and the
     `pill.background = if (active && list.isEnabled) ...` line to use `showCells`. `cellPane`
     and `pill` visibility already follow `cells.isVisible`, which `syncCells` sets from the
     passed flag — no further change there.
   - Do not change `active`/`fg`/`weak`/`wrap.update` (selection highlight stays as-is).

3. **`ui/list/ActiveListView.kt` — track hover, repaint only the affected rows.**
   - Add `private var hovered = -1`. Override `hoveredIndex(): Int = hovered` on the inline
     `JBList` `ActiveListActive` implementation.
   - Convert the existing inline `MouseAdapter` (added at `ActiveListView.kt:109`) into a named
     local `val`, add `mouseMoved` and `mouseExited` overrides, and register it with
     `list.addMouseMotionListener(...)` **only when `cfg.hoverActions`** (avoid overhead for
     other lists). Keep `list.addMouseListener(...)` for all lists as today.
     - `mouseMoved`: resolve row via `list.locationToIndex(e.point)`, keep it only if
       `>= 0` and `getCellBounds(i,i)?.contains(e.point) == true`, else `-1`; call
       `setHovered(idx)`.
     - `mouseExited`: `setHovered(-1)`.
   - Add helpers:
     ```
     private fun setHovered(idx: Int) {
         if (hovered == idx) return
         val old = hovered
         hovered = idx
         repaintRow(old); repaintRow(idx)
     }
     private fun repaintRow(idx: Int) {
         if (idx < 0) return
         list.getCellBounds(idx, idx)?.let { list.repaint(it) }
     }
     ```
   - In `sync(...)` (model replace) reset `hovered = -1` before/after `model.replaceAll(rows)`
     so a stale index can't point at a shifted row. `setBusy(true)` path: also clear hover
     (call `setHovered(-1)`), so a disabled list shows no bar.
   - All new methods run on EDT (list mouse events + `sync` already are); annotate helpers
     consistent with surrounding code (`sync` is already `@RequiresEdt`).

4. **`agentManager/AgentManagerPanel.kt` — enable hover mode.**
   - Pass `cfg = ActiveListConfig(hoverActions = true)` to the `ActiveList(...)` constructor
     (line 68). It currently relies on the default `ActiveListConfig.Equal`; the new value keeps
     `Equal` defaults (height EQUAL, description true, single selection) plus `hoverActions`.

5. **`agentManager/worktree/WorktreeSessionEditorPanel.kt` — enable hover mode.**
   - Add `hoverActions = true` to the existing `ActiveListConfig(...)` at line 65 (keep
     `ActiveListRowHeight.EQUAL`, `description = false`,
     `selection = MULTIPLE_INTERVAL_SELECTION`).

## Tests

Add coverage exercising the real component tree (extend the existing
`BasePlatformTestCase`-style setups in `AgentManagerPanelTest` and
`WorktreeSessionEditorPanelTest`). Reuse the existing `fire(list, MouseEvent(...))` pattern
(AgentManagerPanelTest.kt:135) and `getCellBounds` to position events.

Assertions (render via `list.cellRenderer.getListCellRendererComponent(...)` and walk for
visible `ActiveListActionCell` instances, mirroring `activeListActionCells` traversal, or check
`cellPane`/`pill` visibility):

- Hover-mode list with no hover: no row shows action cells even when a row is selected + list
  focused (verifies selection reveal is replaced).
- After a `MOUSE_MOVED` over row N: only row N renders its action cells; other rows do not.
- After `MOUSE_EXITED`: no row shows action cells.
- Moving hover from row A to row B repaints only A and B (assert observable: B shows cells, A
  hidden; a full-repaint assertion is not required — scope is validated by `repaintRow` using
  cell bounds).
- `alwaysVisible` cells still render on non-hovered rows (if any target row defines one).
- Regression: a non-hover list (e.g. an existing settings list or a plain `ActiveListConfig`)
  still reveals cells on active focused selection.
- `setBusy(true)` clears hover so no bar shows.

## Validation

From `packages/kilo-jetbrains/`:
- `./gradlew typecheck`
- `./gradlew test` (or target the two panel test classes / the list test package)

Requires Java 21; only check Java if Gradle reports a Java error.

## Risks / notes

- Confine all changes to `ui/list/` + the two `agentManager/` panels. No RPC, shared-opencode,
  or CLI changes — no `kilocode_change` markers involved (all Kilo-owned JetBrains frontend).
- No row-height recompute is needed because height already accounts for the bar; if a future
  change makes cells taller than the row, revisit `syncCellHeight`.
- Keep single-word naming per repo style (`hovered`, `idx`, `old`, `cfg`).

## Out of scope

- Changing selection highlight behavior.
- Hover behavior for any list other than the two named ones.
- Per-individual-button hover granularity (explicitly rejected — whole-row reveal).
