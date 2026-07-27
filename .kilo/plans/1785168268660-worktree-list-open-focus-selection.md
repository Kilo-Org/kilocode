# Plan: IntelliJ-style open/focus + inactive selection for the worktree & session lists

## Goal

Make the Agent Manager **worktree list** and the **session list inside a worktree** behave like the IntelliJ Project view:

- **Single click** → open the target but **do not** move focus (focus stays on the list).
- **Double click** → open **and** move focus to the editor / session.
- **Enter** → open; focus is decided by the IntelliJ advanced-settings flag
  `edit.source.on.enter.key.request.focus.in.editor` (platform default `true`), exactly like the platform's `EditSourceOnEnterKeyHandler`.
- **F4** → open **and** move focus (mirrors `EditSource` = `BaseNavigateToSourceAction(true)`).
- A **selected-but-unfocused** row draws the standard platform **inactive (muted) selection background** (like the Project view), using platform colors.
- When the list is **not the focused/active selection**, **non-permanent action cells** (e.g. delete) are **hidden**. Permanent cells (`alwaysVisible`) stay. This must live in the shared base classes, not be duplicated per list.

## Scope / boundaries

- All edits are under `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/...` and its tests. This is Kilo-owned code (no upstream opencode presence), so **no `kilocode_change` markers are required**.
- Do **not** change the main sidebar session behavior (it keeps focus-on-open via the default `focus = true`).
- Do **not** introduce Kotlin UI DSL / Compose / JCEF. Use existing platform APIs and `UiStyle`.

## Key findings (verified in code)

- Both lists use the shared `ActiveList` component:
  - Worktree list: `frontend/.../agentManager/AgentManagerPanel.kt` (`onClick = open`, no `onActivate`).
  - Session list: `frontend/.../agentManager/worktree/WorktreeSessionEditorPanel.kt` (`onClick = open`).
- Shared list internals:
  - `frontend/.../ui/list/ActiveList.kt` (public wrapper, ctor `onClick`/`onActivate`/`onCell`).
  - `frontend/.../ui/list/ActiveListView.kt` (`JBList` host: mouse + Enter handling in `init`; `primary()`/`activate()`).
  - `frontend/.../ui/list/ActiveListRenderer.kt` (renderer; computes `active`, calls `wrap.update(...)` and `syncCells(...)`).
  - `frontend/.../session/ui/PickerRow.kt` (`SelectablePanel`; `update(list, selected, focused)` already sets `selectionColor = if (selected) UIUtil.getListBackground(true, focused) else null`).
- Renderer today (`ActiveListRenderer.getListCellRendererComponent`):
  - `active = selected && (focused || list.hasFocus() || (list as? ActiveListActive)?.active() == true)`
  - `wrap.update(list, active, active || focused)` → **no selection background at all when unfocused** (the bug behind the "no highlight" complaint).
  - `syncCells(value, active && list.isEnabled, list.isEnabled)` → non-permanent cells already hidden when unfocused (requirement already satisfied; must be preserved).
- Existing tests already lock in the cell-hiding contract: `SettingsListViewTest` → `test in-place action cells are hidden on unfocused selected row`, `test always visible action cells stay on unfocused row`, `test active popup paints selected row as active without focus`, `test unfocused selected row is not painted as active` (asserts `desc.foreground == UiStyle.Colors.weak()`).
- Session open focus path: `WorktreeSessionEditorPanel.open` → `WorktreeSessionEditorManager.openSession(ref)` → `SessionHost.openSession(ref)` → `show(ui)` → **always** `focus(ui.defaultFocusedComponent)`.
- Worktree open focus path: `AgentManagerPanel.open` → `KiloVfsManager.open(kind, params, focus = true)` (already supports a `focus` param → `FileEditorManager.openFile(file, focus)`).
- IntelliJ references (from `$INTELLIJ_REPO`):
  - `EditSourceAction` extends `BaseNavigateToSourceAction(true)`; keymap `$default.xml` binds `EditSource` → `F4` (focus = true).
  - `EditSourceOnEnterKeyHandler` reads `AdvancedSettings.getBoolean("edit.source.on.enter.key.request.focus.in.editor")`; `PlatformExtensions.xml` registers it with `default="true"`.

## Decisions

1. **Keyboard mapping matches IntelliJ exactly.** Enter uses the advanced-settings flag `edit.source.on.enter.key.request.focus.in.editor` (default true) to decide focus. F4 always focuses. (Confirmed with user.)
2. **Add an explicit navigation handler** `onOpen: ((ActiveListItem, focus: Boolean) -> Unit)?` to `ActiveList`/`ActiveListView`, distinct from the settings "primary/cell" model. When `onOpen` is set it drives click / double-click / Enter / F4. When it's null (settings lists), current behavior is unchanged. This avoids overloading `primary()` (which for the worktree row would wrongly fall through to the delete cell).
3. **Inactive selection + cell gating are fixed once in the shared renderer** (`ActiveListRenderer` + `PickerRow`), benefiting every `ActiveList` consumer (settings, history, worktree, session).
4. No `SessionManager` interface signature churn: add the focus-aware open as a new method on `SessionHost` (Kilo-owned); the existing 1-arg `openSession(ref)` delegates with `focus = true`.

## Implementation tasks (ordered)

### 1. Shared renderer: paint inactive selection; keep cells focus-gated
File: `frontend/src/main/kotlin/ai/kilocode/client/ui/list/ActiveListRenderer.kt`
- In `getListCellRendererComponent`, keep computing `active` as today.
- Change the selection painting so the background is drawn whenever the row is `selected`, muted when not active:
  - Replace `wrap.update(list, active, active || focused)` with `wrap.update(list, selected, active)`.
    - `PickerRow.update(list, selected=true, focused=false)` → `UIUtil.getListBackground(true, false)` (muted).
    - `PickerRow.update(list, selected=true, focused=true)` → `UIUtil.getListBackground(true, true)` (bright).
- Leave `fg`, `weak`, and `syncCells(value, active && list.isEnabled, list.isEnabled)` unchanged so:
  - description foreground stays `UiStyle.Colors.weak()` on an unfocused selected row (keeps `test unfocused selected row is not painted as active` green), and
  - non-permanent action cells stay hidden unless the row is the active focused selection (requirement #5, already covered by `SettingsListViewTest`).
- No change needed in `PickerRow.kt` (it already supports muted vs bright).

### 2. Shared list: add focus-aware `onOpen` and IntelliJ key bindings
Files: `frontend/src/main/kotlin/ai/kilocode/client/ui/list/ActiveList.kt`, `ActiveListView.kt`
- Add ctor param `onOpen: ((ActiveListItem, focus: Boolean) -> Unit)? = null` to both `ActiveList` and `ActiveListView`; pass through.
- In `ActiveListView.init` mouse handler (`mouseClicked`):
  - `clickCount == 1` and not a cell hit (`hit.id == null`): if `onOpen != null` call `onOpen(item, false)`, else fall back to existing `onClick`.
  - `clickCount == 2` and not a cell hit: if `onOpen != null` call `onOpen(item, true)`, else existing `activate(item)`.
- Enter key registration (currently `{ primary() }`): route through a small helper — if `onOpen != null`, `list.selectedValue?.let { onOpen(it, enterRequestsFocus()) }`, else `primary()`.
  - `enterRequestsFocus()` = `AdvancedSettings.getBoolean("edit.source.on.enter.key.request.focus.in.editor")` (`com.intellij.openapi.options.advanced.AdvancedSettings`).
- Add a new F4 key binding on `list` (`KeyStroke.getKeyStroke(KeyEvent.VK_F4, 0)`, `WHEN_FOCUSED`): if `onOpen != null`, `list.selectedValue?.let { onOpen(it, true) }`; otherwise no-op (leave platform default for non-navigation lists).
- Keep `mousePressed` requesting focus on the list (it focuses the list, not the editor — correct for single-click "open without focus").
- Optional cleanup: `onActivate` ctor param is never set by any caller; leave as-is to minimize risk (or remove in a follow-up).

### 3. Thread focus through the session open path
File: `frontend/src/main/kotlin/ai/kilocode/client/session/SessionHost.kt`
- Add `show(ui: SessionUi, focus: Boolean = true)`; only call `focus(ui.defaultFocusedComponent)` when `focus`. Update the single existing `show(ui)` call site in `newSession()` to keep `focus = true` (default).
- Refactor `openSession`: move the current body into a new open method `open fun openSession(ref: SessionRef, focus: Boolean)`, ending in `show(ui, focus)`. Keep `override fun openSession(ref: SessionRef) = openSession(ref, focus = true)` (satisfies `SessionManager`). Internal callers that use the 1-arg keep focus = true.

### 4. Session list panel: pass focus from gestures
File: `frontend/src/main/kotlin/ai/kilocode/client/agentManager/worktree/WorktreeSessionEditorPanel.kt`
- Change `open(row)` → `open(row, focus: Boolean)`; the NEW row branch still calls `manager.newSession()` (focus = true), otherwise `manager.openSession(SessionRef.Local(item), focus)`.
- Replace `onClick = { row -> open(row) }` with `onOpen = { row, focus -> open(row, focus) }`.

### 5. Worktree list panel: pass focus from gestures
File: `frontend/src/main/kotlin/ai/kilocode/client/agentManager/AgentManagerPanel.kt`
- Change `open(item)` → `open(item, focus: Boolean)` calling `KiloVfsManager.open(WorktreeSessionEditorKind.ID, worktreeSessionParams(item), focus)`.
- Replace `onClick = { row -> ... open(item) }` with `onOpen = { row, focus -> (row as? WorktreeRow)?.dto?.let { open(it, focus) } }`.
- Leave the delete-cell `onCell` handler and the `onSelect`/`focusList()` create-flow untouched.

### 6. Tests
- `frontend/src/test/.../settings/base/SettingsListViewTest.kt` (or a new `ActiveListViewTest` in the same package):
  - Add: unfocused selected row paints muted selection — assert the `PickerRow`'s `selectionColor == UIUtil.getListBackground(true, false)` after `getListCellRendererComponent(list, row, 0, true, false)`.
  - Add: focused selected row paints bright — `... == UIUtil.getListBackground(true, true)` (rendered with `focused = true` or `ActiveListActive.active() == true`).
  - Keep existing cell-visibility tests (they already assert requirement #5).
- `frontend/src/test/.../agentManager/worktree/WorktreeSessionEditorPanelTest.kt`:
  - Update `FakeManager` to override the new `openSession(ref: SessionRef, focus: Boolean)` (record `focus`) instead of `openSession(ref)`.
  - Update `test row click opens session` to also assert `focus == false`.
  - Add a double-click test (`clickCount = 2`) asserting `focus == true`.
  - Add Enter and F4 key tests: invoke the list's registered action via `list.getActionForKeyStroke(KeyStroke...)` (or dispatch `KeyEvent`s) after selecting a row; assert F4 → `focus == true`, Enter → `focus == AdvancedSettings.getBoolean("edit.source.on.enter.key.request.focus.in.editor")`.
- Add a new `AgentManagerPanel` open/focus test (new file) or an `ActiveListView`-level test proving `onOpen` receives `focus = false` on single-click / `true` on double-click / `true` on F4 / flag-driven on Enter. Prefer the `ActiveListView`-level test since it covers the shared behavior for both lists in one place and avoids the `KiloVfsManager` project-service seam.

## Risks / edge cases

- **Blast radius of the renderer change**: `ActiveListRenderer` is shared by settings and history lists. After the change they will show a muted selection when unfocused (previously nothing). This is the platform-standard behavior and matches the UI guidelines; verify `SettingsListViewTest` / history tests still pass and adjust assertions only if they specifically asserted "no background when unfocused" (none currently do). `PickerPopup` uses its own renderer, so it is unaffected.
- **`primary()` fallback bug**: today Enter on a worktree row falls through `primary()` to the first enabled cell (delete) and would pop the delete confirmation. Routing Enter through `onOpen` for navigation lists removes this; confirm no navigation list relies on Enter→cell.
- **F4 binding in settings dialogs**: F4 is only bound when `onOpen != null` (navigation lists), so settings/dialog `EditSource` behavior is unchanged.
- **`openFile(file, false)`** opens/selects the worktree tab without transferring focus; confirm the tab still becomes visible (expected) while focus remains on the Agent Manager list.
- **New-session / delete-next-session flows** keep `focus = true` (creating or auto-opening a session should focus its prompt) — verify this matches desired UX.

## Validation

From `packages/kilo-jetbrains/`:
- `./gradlew typecheck`
- `./gradlew test` (or targeted: `SettingsListViewTest`, `WorktreeSessionEditorPanelTest`, and the new `ActiveListView`/renderer tests)
- Manual (optional) `./gradlew runIde`: in Agent Manager, single-click a worktree (tab opens, list keeps focus + bright selection), double-click (editor focuses, list shows muted selection), Enter (focus per advanced setting), F4 (focus). Repeat for the session list inside a worktree. Confirm the delete icon is absent whenever the list is unfocused and the muted selection is visible.

## Out of scope

- Main sidebar session list behavior (unchanged).
- Preview-tab semantics; we only toggle focus, not preview tabs.
- Removing the now-unused `onActivate`/`onClick` params (optional later cleanup).
