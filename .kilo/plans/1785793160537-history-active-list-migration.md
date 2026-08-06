# Migrate History list + renderer to ActiveList (hover-reveal delete)

## Goal

Replace the bespoke `JBList` + `HistoryRenderer` in the session History panel with the shared
`ActiveList` framework (`ui/list/`), and adopt `ActiveListConfig(hoverActions = true)` so the local
delete button is revealed on hover (matching Agent Manager) and confirmed via the shared balloon
popup instead of a modal dialog.

All touched code is under `packages/kilo-jetbrains/` (a `kilo`-named path), so **no `kilocode_change`
markers are needed** anywhere in this work.

## Decisions (resolved)

- **Delete confirm:** use the ActiveList balloon (`ActiveListDeleteOptions` + `ActiveList.confirmDelete`),
  replacing `Messages.showYesNoDialog`. Multi-select local delete anchors the balloon to one selected
  row and confirms the whole batch.
- **Shell stays:** keep `HistoryPanel`'s tabs, per-tab `SearchTextField`, repo-only checkbox,
  Load-more footer, 3s activity timer, `DataProvider`, and context menu. Swap only the inner list +
  renderer.
- **Search stays server/paging-aware:** external search keeps driving `HistoryModel.setFilter`; the
  panel feeds already-filtered `model.visibleItems` into `activeList.update(...)`. `ActiveList` runs
  with `showSearch = false` and no client-side matcher filtering (filter query stays empty).
- **Hover semantic (document, do not change):** `ActiveListRenderer.kt:163` shows the action pill only
  when a row is `selected && hovered`. This is the "same effect" as Agent Manager. The delete button
  therefore appears when hovering the selected row, and the persistent trailing time is overlaid by
  the delete pill only then.

## Key existing references

- History: `session/history/HistoryPanel.kt`, `HistoryListRenderer.kt` (to delete),
  `HistoryModel.kt`/`CloudHistoryModel`, `HistoryController.kt`, `HistoryItem.kt`, `HistoryTime.kt`,
  `HistoryActivitySnapshot.kt`, `HistoryDataKeys.kt`, `HistoryListUi.kt`.
- ActiveList: `ui/list/ActiveList.kt`, `ActiveListModel.kt` (`ActiveListItem`, `ActiveListConfig`,
  `ActiveListCell`, `ActiveListBadge`), `ActiveListRenderer.kt`, `ActiveListView.kt`,
  `ActiveListDeletePopup.kt`.
- Reference consumer to mirror: `agentManager/AgentManagerPanel.kt` (`WorktreeRow`, `hoverActions`,
  `onCell`, `confirmDelete`, `showDeletePopup`, `WorktreeDeleteProvider`).

## Row mapping (new)

Create adapter rows built from live state (mirror `AgentManagerPanel.WorktreeRow`), not by making the
DTO `HistoryItem` implement `ActiveListItem` (badges/trailing/deleting/cells depend on runtime state:
activity snapshot, title overrides, `controller.deleting`).

New file `session/history/HistoryRows.kt`:

- `internal data class LocalRow(dto: LocalHistoryItem, title: String, kind: SessionActivityKind?, override val deleting: Boolean, section: String?) : ActiveListItem`
  - `key = dto.id`; `title` = override title (from snapshot) or `HistoryListUi.title(dto)`.
  - `trailing = HistoryTime.relative(dto)` (refreshed by the activity timer rebuild).
  - `badges = kind?.let { ActiveListBadge(it.label(), it.style()) }` (empty when `deleting`).
  - `section` = `HistoryTime.title(HistoryTime.section(dto))`.
  - `search = listOfNotNull(title, dto.id, dto.directory).joinToString(" ")` (only used if search is
    ever moved into ActiveList; currently filtering stays in `HistoryModel`).
  - `cells = if (deleting) emptyList() else listOf(ActiveListCell(DELETE_CELL, delete-label, icon = AllIcons.Actions.GC, iconOnly = true))`.
- `internal data class CloudRow(dto: CloudHistoryItem, title: String, kind: SessionActivityKind?, section: String?) : ActiveListItem`
  - Same as above but **no `cells`** (cloud is not deletable) and `trailing`/`badges`/`section` mapped
    identically.
- Pure builder functions (product-meaningful, directly unit-testable — avoids UI introspection):
  - `internal fun localRows(items: List<LocalHistoryItem>, snapshot: HistoryActivitySnapshot, deleting: (String) -> Boolean): List<LocalRow>`
  - `internal fun cloudRows(items: List<CloudHistoryItem>, snapshot: HistoryActivitySnapshot): List<CloudRow>`
  - Both compute `section` via adjacent-equality (only first item of a `HistorySection` bucket gets a
    non-null `section`), matching current `HistoryRenderer.section`.

## HistoryPanel changes

1. **Replace the two `HistoryList<T>` (JBList) + renderers with two `ActiveList` instances.**
   - `localList = ActiveList(emptyText, cfg = ActiveListConfig(selection = MULTIPLE_INTERVAL_SELECTION, hoverActions = true), surface = ActiveListSurface.Default, showSearch = false, onCell = ..., onOpen = ..., onSelect = ...)`.
   - `cloudList = ActiveList(emptyText, cfg = ActiveListConfig(selection = SINGLE_SELECTION), surface = ActiveListSurface.Default, showSearch = false, onOpen = ...)`.
   - Keep `panel(search, activeList, footer?)` layout: external `SearchTextField` in NORTH (+ repoOnly
     under it for cloud), `activeList` in CENTER, Load-more in SOUTH. `ActiveList` is a
     `BorderLayoutPanel`, so it drops into CENTER directly (remove the manual `JBScrollPane` — ActiveList
     owns its own scroll).
2. **onCell (local):** `{ key, id -> if (id == DELETE_CELL) showDeletePopup(key) }`.
   - `showDeletePopup(key)` builds `ActiveListDeleteOptions(message = history.delete.confirm.message(title))`
     and calls `localList.confirmDelete(localList.point(key, DELETE_CELL), opts) { _ -> controller.delete(dto) }`.
     Add `controller.requestDelete(1)` / `cancelDelete` telemetry parity as today.
3. **onOpen:** `{ row, _ -> activate((row as LocalRow).dto or (CloudRow).dto) }` → `controller.open(...)`.
   Double-click and Enter route through ActiveList's `onOpen` (drop the manual `MouseAdapter` +
   `isDeleteClick` hit-testing and the `registerKeyboardAction` Enter handlers on the list).
4. **Feeding rows:** on `HistoryModel` `ListDataListener` changes (`bind`) and on tab switch, rebuild:
   - `localList.update(localRows(controller.local.visibleItems, snapshot, controller::deleting), ActiveListSelection.PreserveNoScroll)`
   - `cloudList.update(cloudRows(controller.cloud.visibleItems, snapshot), ActiveListSelection.PreserveNoScroll)`
   - Keep `sync()` responsibilities: Load-more `isEnabled/isVisible`, repoOnly visibility, card
     `load` vs `tabs`, empty/loading/error text via `activeList` empty text (`setBusy` for loading).
5. **Activity timer (`syncActivity`):** replace selective `repaintRows` with a full rebuild + `update`
   (`PreserveNoScroll`) of the affected tab(s). Lists are small; `update` diffs height and preserves
   selection/scroll. Update snapshot first, then rebuild only when `snapshot.changed(next)` is
   non-empty (keep the existing early-out to avoid churn).
6. **Search wiring:** keep `search(model)` forwarding text to `model.setFilter` (unchanged). Rewire the
   up/down/enter keyboard actions on the search editor to ActiveList:
   - up/down → `activeList.selectIndex((activeList.selectedIndex() + step).coerceIn(...))`.
   - enter → `activeList.selected()?.let(::activate)`.
7. **Loading/empty/error text:** call `activeList.setBusy(model.loading)` and set empty text through a
   new `ActiveList` passthrough (see API additions) reflecting loading/error/empty like `syncList`.
8. **DataProvider (`getData` / `HistoryDataKeys.SELECTION`):** read selection from ActiveList:
   `localList.selectedItems().map { (it as LocalRow).dto }` and the cloud equivalent. `selectedSource()`
   still keyed off the selected tab.
9. **Context menu:** install `Kilo.History.ContextMenu` on the ActiveList's inner list via a new
   `ActiveList.installPopup(group)` (see API additions), replacing `PopupHandler.installPopupMenu` on
   the old `JBList`.
10. **Delete-element provider / Delete key / RenameElement:** keep existing action wiring; route the
    interactive delete path through `showDeletePopup`. Keep `clickDelete()` batch behavior for the
    Delete action but confirm via balloon anchored to the first selected row (parity with `confirmDelete`).
11. **Theme (`updateTheme`):** `SwingUtilities.updateComponentTreeUI` on each `ActiveList`
    (BorderLayoutPanel) instead of `updateRenderer` reaching into the old renderer.

## ActiveList API additions (small, shared but kilo-owned)

Add to `ui/list/ActiveList.kt` (delegating to `ActiveListView`):

- `fun installPopup(group: ActionGroup)` → `PopupHandler.installPopupMenu(view.list, group, ActionPlaces.POPUP)`.
  (Add matching `ActiveListView.installPopup` or expose `view.list` narrowly. Prefer the delegating
  method over widening `preferredFocus()` usage.)
- `fun setEmptyText(text: String)` → `view.setEmptyText(text)` (method already exists on the view;
  just surface it) for loading/error/empty messages.

No changes to `ActiveListRenderer`/hover logic are required — `hoverActions` already implements the
requested reveal.

## Files

- **Edit:** `session/history/HistoryPanel.kt` (major rewiring; keep public constructor signature
  `HistoryPanel(parent, controller, nav, manager, timers)` so `SessionSidePanelManager.kt:92` and tests
  compile unchanged).
- **New:** `session/history/HistoryRows.kt` (rows + `localRows`/`cloudRows`).
- **Delete:** `session/history/HistoryListRenderer.kt` (`HistoryRenderer`, `Local/CloudHistoryRenderer`,
  `BadgeLabel`, `isDeleteClick`, `DELETE_AREA_WIDTH`). `HistoryRenderer.section` logic moves into
  `HistoryRows` builders.
- **Edit:** `ui/list/ActiveList.kt` (+ `ActiveListView.kt` if needed) for `installPopup` / `setEmptyText`.
- **Keep unchanged:** `HistoryItem.kt`, `HistoryModel.kt`, `HistoryController.kt`, `HistoryTime.kt`,
  `HistoryActivitySnapshot.kt`, `HistoryDataKeys.kt`, `HistoryListUi.kt`.

## Test impact

Existing UI-introspection accessors on `HistoryPanel` used by `HistoryControllerTest.kt` must be
re-pointed at observable state (per plugin AGENTS.md: assert observable UI/behavior, don't add
test-only seams into internals):

- `groupTitles()` → derive from built rows' `section` values (use `localRows`/`cloudRows` +
  `activeListSectionTitle`, or expose a small `sections(): List<String>` computed from the current rows).
- `runningBadgeVisible(i)` / `badgeText(i)` / `titleText(i)` → assert against `localRows(...)`/`cloudRows(...)`
  output (row `badges`/`title`) directly in unit tests, instead of rendering `HistoryRenderer`.
- `select`, `selectIndices`, `selectedIndex`, `listSelectionMode` → use `ActiveList.selectIndex`/
  `selectedIndex`/`selectedItems`; `selectionMode` is asserted via multi-select behavior, not a getter.
- `listFocusable` / `listCursor` / `loadMoreFocusable` → drop or replace with behavior assertions;
  ActiveList manages focus/cursor internally.
- `backText`/`backCursor`/`clickBack`, `clickCloud`/`clickLocal`, `clickMore`, `setSearch`,
  `repoOnlyVisible`/`repoOnlySelected`/`clickRepoOnly`, `itemCount` → unchanged (shell-level), keep.

New/updated tests (`BasePlatformTestCase`, real EDT, no mocks):

1. `HistoryRowsTest` (pure): `localRows`/`cloudRows` produce expected `title` (override precedence),
   `trailing` (relative time), `badges` (activity kind), `section` (adjacent-equality bucketing),
   `deleting` clears cells/badges, and local rows carry the delete cell while cloud rows do not.
2. Panel test: local row exposes a `DELETE_CELL`; hovering the selected row reveals it
   (`activeListCellBounds` non-empty for the selected+hovered row via the view), clicking it opens the
   balloon (`ActiveListDeleteOptions`) and confirming calls `controller.delete`. Cloud rows expose no
   delete cell.
3. Panel test: double-click / Enter opens via `controller.open`; selection feeds `HistorySelection`
   through `getData`.
4. Keep `HistoryControllerTest` cloud paging, repo-only, activity, and error/empty coverage passing
   against the new rendering path.
5. `SessionSidePanelManagerTest` and `HistorySessionActionsTest` continue to pass (constructor + data
   provider unchanged).

## Validation

From `packages/kilo-jetbrains/`:

- `./gradlew typecheck`
- `./gradlew test` (or targeted: `HistoryControllerTest`, new `HistoryRowsTest`, `HistorySessionActionsTest`,
  `SessionSidePanelManagerTest`).

Manual smoke (monolith sandbox `./gradlew runIde`): open History panel → local rows show relative time;
hover the selected local row → delete icon overlays the time; click → balloon confirm → row shows
"Deleting…" then disappears; cloud tab has no delete; section headers, search, repo-only, Load-more,
and running-activity badges still behave.

## Risks / notes

- `ActiveList.update` reselects/scrolls; always pass `PreserveNoScroll` on timer/model rebuilds to
  avoid selection or scroll jumps (matches `AgentManagerPanel.sync`).
- Multi-select local delete: the balloon anchors to a single row; confirm applies to all selected
  (parity with existing `confirmDelete(items)`).
- `HistoryPanel` currently exposes many `internal` accessors purely for tests; migration is a good
  point to prune the ones that only inspected `JBList` internals rather than adding equivalents on
  `ActiveList`.
- Requires an implementation-capable agent (source edits + Gradle); this plan performs no code changes.
