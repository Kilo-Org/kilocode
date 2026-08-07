# Worktree list row menu (kebab) + context menu

## Goal

Replace the two inline hover cells (pencil rename / trash delete) on the **worktree list**
and the **worktree session list** with a single hover-only "kebab" (⋮) button per row. The
button opens an **action-group popup** for that row. The same action group is also installed as
the right-click **context menu** on the list. Make the button a generic, opt-in capability of
`ActiveList` driven by a typed `DataKey<T>` for the row's element (matches the existing
`HistoryDataKeys` pattern).

## Scope

- In scope: worktree list (`AgentManagerPanel`) and worktree session list
  (`WorktreeSessionEditorPanel`).
- Out of scope: `HistoryPanel` (keeps its current pencil/trash + right-click menu unchanged).
- All files are under `packages/kilo-jetbrains/` (Kilo-owned; no `kilocode_change` markers).

## Key decisions (chosen defaults)

1. Generic capability lives on `ActiveList` via a self-contained `ActiveListMenu<T>` descriptor
   (typed element `DataKey<T>` + `ActionGroup` + `(ActiveListItem) -> T?` resolver). `ActiveList`
   stores it as `ActiveListMenu<*>?`; the generic type stays contained inside the descriptor (no
   `ActiveList<T>` refactor, no unchecked casts leaking to callers).
2. Kebab glyph: `AllIcons.Actions.More`, rendered as an `ActiveListActionCell` (`iconOnly = true`)
   appended at the trailing end of the existing overlay `cells` stack.
3. Kebab visibility: `list.isEnabled && hovered`, **independent of selection** (new rule, distinct
   from the current `selected && hovered` path used by regular cells).
4. Clicking the kebab must **not** change list selection. Achieved by overriding
   `processMouseEvent` on the `JBList` and returning before `super` for a `MOUSE_PRESSED` over the
   kebab (`MouseEvent.consume()` does not stop `BasicListUI`'s selection listener; skipping `super`
   does). Selecting "Rename" afterwards may select the row — that is fine; the no-select rule only
   applies to opening the menu.
5. Both entry points reuse one `ActionGroup` per list:
   - Kebab: `ActiveListMenu.context(anchor, item)` builds a `SimpleDataContext` with the hovered
     row's element under the typed key, parented to the list's `DataManager` context, then
     `JBPopupFactory.createActionGroupPopup(...)`.
   - Right-click: existing `ActiveList.installPopup(group)` (`PopupHandler.installPopupMenu`);
     `BasicListUI` selects the row on popup-trigger press, so the panel's data snapshot supplies
     the element from the current selection.
6. Actions are XML-registered and read the typed element key (idiomatic; mirrors History; testable
   via XML-id assertion). Row actions invoke the panel's existing balloon flows via a panel
   `DataKey` (`SidePanelKeys.WORKTREE_PANEL` already exists for the worktree list; add one for the
   session panel).
7. Menu-only actions carry no keyboard shortcut, to avoid conflicting with the worktree list's
   existing `DELETE_ELEMENT_PROVIDER`/`RenameElement` handling, which stays as-is.

## Architecture / API

New `ui/list/ActiveListMenu.kt`:

```kotlin
internal class ActiveListMenu<T : Any>(
    private val key: DataKey<T>,
    val group: ActionGroup,
    private val element: (ActiveListItem) -> T?,
    val place: String = ActionPlaces.POPUP,
) {
    fun context(anchor: JComponent, item: ActiveListItem): DataContext {
        val builder = SimpleDataContext.builder()
            .setParent(DataManager.getInstance().getDataContext(anchor))
        element(item)?.let { builder.add(key, it) }
        return builder.build()
    }
}
```

Data flow:

```
hover row -> kebab shown (hover only) -> press kebab
  -> processMouseEvent skips super (no selection change)
  -> ActiveListMenu.context(list, item) => SimpleDataContext[key = element(item)] + parent
  -> JBPopupFactory.createActionGroupPopup(group, ctx).show(at kebab)
  -> Action.actionPerformed: e.getData(key) -> element; e.getData(panelKey) -> panel
  -> Rename -> panel.beginRename(element)  (existing edit balloon)
  -> Delete -> panel.showDeletePopup(element) (existing confirm balloon)

right-click row -> BasicListUI selects row -> installPopup(group)
  -> DataContext from list's UiDataProvider snapshot (element from selection + panelKey)
  -> same actions
```

## Task list

### A. Generic `ActiveList` menu capability (`ui/list/`)

1. Add `ACTIVE_LIST_MENU_CELL = "__menu__"` + `activeListMenuCell()` factory
   (`AllIcons.Actions.More`, `iconOnly = true`) in `ActiveListActions.kt`.
2. Add `ActiveListMenu.kt` (descriptor above).
3. `ActiveList` + `ActiveListView`: add optional `menu: ActiveListMenu<*>? = null` ctor param.
   Treat `menu != null` like `hoverActions` for installing the mouse-motion listener and hover
   repaints (so `hovered` tracks without requiring selection).
4. `ActiveListRenderer.syncCells`: when `menu != null`, append the kebab cell at the end; show it
   when `list.isEnabled && hovered` regardless of `selected`. Keep the existing rule for any
   item-provided `cells`.
5. `ActiveListModel.kt`: make the reserved menu id hittable in `activeListCellAt` even though it is
   not part of `item.cells` (the geometry from `activeListCellBounds` already includes the rendered
   kebab; add the menu id to the id set considered by `activeListCellAt` and the tooltip resolver in
   `ActiveListView.getToolTipText`).
6. `ActiveListView`: in the anonymous `JBList`, override `processMouseEvent` to intercept
   `MOUSE_PRESSED` over the kebab: build `menu.context(list, item)`, show
   `createActionGroupPopup` anchored at the kebab rect (reuse `activeListCellBounds` /
   `point(key, cell)`), track the popup via existing `trackPopup` for the active-selection paint,
   and return before `super` (no selection). Because the added `MouseListener.mousePressed` never
   runs, the existing release/click cell dispatch no-ops for the kebab automatically.

### B. Worktree list (`AgentManagerPanel`)

7. New `agentManager/worktree/WorktreeDataKeys.kt`:
   `WORKTREE: DataKey<WorktreeDto> = DataKey.create("ai.kilocode.client.agentManager.worktree.Worktree")`.
8. `AgentManagerPanel`:
   - Make `beginRename(WorktreeDto)` and `showDeletePopup(WorktreeDto)` `internal` (they already
     exist as private, anchoring balloons via `list.point(id, cell)`).
   - Extend `uiDataSnapshot` to also emit `sink[WorktreeDataKeys.WORKTREE] = selectedRow()?.dto`.
   - Build the `ActiveListMenu` with `WorktreeDataKeys.WORKTREE`, the XML group, and
     `element = { (it as? WorktreeRow)?.dto }`; pass to the `ActiveList` ctor. Call
     `list.installPopup(group)` for the right-click menu.
   - Remove `WorktreeRow.cells` (the rename/delete cells) and the `ACTIVE_LIST_RENAME_CELL` /
     `ACTIVE_LIST_DELETE_CELL` routing in `onCell` (the `onCell` lambda becomes empty/removed).
   - Keep `RenameAction` inner class + `RenameElement` shortcut and `DELETE_ELEMENT_PROVIDER`.
9. New actions `actions/RenameWorktreeAction.kt`, `actions/DeleteWorktreeAction.kt`:
   `update` enabled when `e.getData(WORKTREE)` renameable/deletable and
   `e.getData(SidePanelKeys.WORKTREE_PANEL) != null`; `actionPerformed` calls
   `panel.beginRename(worktree)` / `panel.showDeletePopup(worktree)`. `ActionUpdateThread.EDT`.

### C. Worktree session list (`WorktreeSessionEditorPanel`)

10. New `agentManager/worktree/WorktreeSessionDataKeys.kt`:
    `SESSION: DataKey<SessionDto>` and `PANEL: DataKey<WorktreeSessionEditorPanel>`.
11. `WorktreeSessionEditorPanel`:
    - Make `beginRename(key)` and `confirmDelete(ids, cell)` reachable from actions via narrow
      `internal` wrappers that accept a `SessionDto`/id.
    - Extend `uiDataSnapshot` to emit `sink[PANEL] = this` and
      `sink[SESSION] = <single selected SessionDto>` (lead selection; multi-select stays served by
      the existing toolbar `delete`/`rename`).
    - Build `ActiveListMenu(SESSION, group, element = { (it as? SessionRow)?.session })`; pass to
      the `ActiveList`; call `list.installPopup(group)`.
    - Remove `SessionRow.cells` and the `ACTIVE_LIST_RENAME_CELL`/`ACTIVE_LIST_DELETE_CELL` routing
      in `onCell`. Keep toolbar `NewAction`/`RenameAction`/`DeleteAction` and keyboard shortcut.
12. New actions `actions/RenameWorktreeSessionAction.kt`, `actions/DeleteWorktreeSessionAction.kt`
    reading `SESSION` + `PANEL`, calling the panel wrappers. `ActionUpdateThread.EDT`.

### D. XML + strings

13. `resources/kilo.jetbrains.frontend.xml`: register the 4 actions and two groups
    `Kilo.Worktree.RowMenu` (Rename, separator, Delete) and `Kilo.WorktreeSession.RowMenu`
    (Rename, Delete). No `<keyboard-shortcut>` / `use-shortcut-of` on these.
14. `resources/messages/KiloBundle.properties`: add `action.*.text` (and optional `.description`)
    for the new actions/groups. Other locale files fall back to the base bundle.

### E. Tests (real Swing / `BasePlatformTestCase`; no EDT mocking)

15. `ui/list` (extend `SettingsListViewTest` or add `ActiveListMenuTest`): kebab renders only when
    `menu != null`; visible on hover with **no** selection; pressing the kebab does **not** change
    `selectedIndex`; `ActiveListMenu.context(...)` returns the element under the key.
16. Action tests mirroring `HistorySessionActionsTest`: assert the two group ids exist in the XML,
    and `update`/`actionPerformed` behavior against a fake `DataContext` providing the element +
    panel keys.
17. Update `WorktreeSessionEditorPanelTest` / any test asserting `WorktreeRow`/`SessionRow.cells`
    (e.g. remove/adjust cell-id expectations). `HistoryControllerTest` stays untouched.

## Files to touch

| File | Change |
|---|---|
| `ui/list/ActiveListMenu.kt` | new descriptor |
| `ui/list/ActiveListActions.kt` | add menu cell id + factory |
| `ui/list/ActiveList.kt` | `menu` ctor param; pass through |
| `ui/list/ActiveListView.kt` | hover plumbing for `menu`; `processMouseEvent` kebab intercept + popup |
| `ui/list/ActiveListRenderer.kt` | append kebab; hover-only visibility |
| `ui/list/ActiveListModel.kt` | menu id hit-testing |
| `agentManager/worktree/WorktreeDataKeys.kt` | new `WORKTREE` key |
| `agentManager/worktree/WorktreeSessionDataKeys.kt` | new `SESSION` + `PANEL` keys |
| `agentManager/AgentManagerPanel.kt` | menu wiring; remove cells; expose rename/delete; snapshot |
| `agentManager/worktree/WorktreeSessionEditorPanel.kt` | menu wiring; remove cells; expose rename/delete; snapshot |
| `actions/RenameWorktreeAction.kt`, `actions/DeleteWorktreeAction.kt` | new |
| `actions/RenameWorktreeSessionAction.kt`, `actions/DeleteWorktreeSessionAction.kt` | new |
| `resources/kilo.jetbrains.frontend.xml` | actions + 2 groups |
| `resources/messages/KiloBundle.properties` | action strings |
| tests | as in section E |

## Removals

- `WorktreeRow.cells` and `SessionRow.cells` (rename/delete).
- `ACTIVE_LIST_RENAME_CELL` / `ACTIVE_LIST_DELETE_CELL` routing in both panels' `onCell`.
- Keep `activeListRenameCell` / `activeListDeleteCell` (still used by `HistoryPanel`).
- Keep `ActiveList.confirmDelete` / `editName` / `rename` balloons — the menu actions call them.

## Risks / edge cases

- Selection suppression relies on skipping `super.processMouseEvent`; verify keyboard nav, tooltip,
  and existing single-click open still work (they use separate `MouseListener` paths).
- Kebab hit rect is read from the rendered component tree; confirm it stays correct with the
  overlay `pill` and New-UI selection insets (same mechanism as current cells).
- Right-click on the session list with a multi-selection provides a single element to the row menu;
  multi-delete remains available via toolbar + `$Delete`. Confirm this is acceptable.
- New XML Delete action must not double-bind `$Delete` on the worktree list (kept shortcut-less).
- `AllIcons.Actions.More` is the standard overflow glyph; confirm it reads well at row scale (icon
  guidance covered by the `icon-jetbrains` skill if a custom glyph is later desired).

## Validation

- From `packages/kilo-jetbrains/`: `./gradlew typecheck` and `./gradlew test` (Java 21).
- Run inspection `Plugin DevKit | Code | Frontend and Backend API Usage` (new actions/keys).
- Manual: `./gradlew runIde` — hover a worktree row shows only the kebab; clicking it opens the
  menu without changing selection; right-click shows the same menu; Rename/Delete open the existing
  balloons; repeat on the worktree session list.

## Open questions (low risk; defaults chosen above)

1. Session list right-click acting on a single (lead) element vs the full multi-selection —
   recommend single element for parity with the kebab; keep toolbar for multi. Confirm.
2. XML-registered actions + typed keys (recommended, matches History) vs a code-built
   `DefaultActionGroup` per panel (fewer files). Recommend XML.
</content>
</invoke>
