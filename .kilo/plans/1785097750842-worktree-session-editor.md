# Worktree Session Editor — Split panel with per-worktree session list

## Goal

Replace the empty worktree editor (`WorktreeSessionEditorKind.createContent`, currently
`BorderLayoutPanel()`) with a left/right split:

- **Left (~25% width):** a session list for that worktree using `ActiveList`, with a standard
  toolbar (`+` / delete), a search bar, per-row delete buttons, and multi-selection.
- **Right (~75% width):** a container hosting the selected session's `SessionUi`, driven by a new
  **editor session manager** that shares the SessionUi lifecycle machinery with the sidebar.

Every worktree can add/delete sessions; all its sessions are listed and controllable from the left
list.

All work is in `packages/kilo-jetbrains/` (Kilo-owned — **no `kilocode_change` markers**). Swing on
EDT only (`@RequiresEdt`), light services, injected coroutine scopes, IntelliJ platform components +
theme colors, `KiloBundle` strings. No Kotlin UI DSL, Compose, or JCEF.

## Confirmed decisions

1. **Extraction:** abstract base class `SessionHost` in the `session` package holding the SessionUi
   cache/lifecycle. `SessionSidePanelManager` and the new `WorktreeSessionEditorManager` both extend
   it.
2. **Right-panel state:** always show a `SessionUi`. On open, show the most recent existing session;
   if none, a new blank session. After deleting the shown session, fall back to the next session or
   a new blank one (mirrors the sidebar's blank-session behavior).
3. **Left list data source:** a new lightweight `WorktreeSessionListController` backed by
   `KiloSessionService.list(worktreeDir)` (no cloud/history machinery).

## Key facts (verified in code)

- Editor content lifecycle: `KiloFileEditor.ui` is `by lazy { kind.createContent(project, kilo, this) }`
  (`vfs/KiloFileEditor.kt:14`); `parent` Disposable is the `KiloFileEditor`. The worktree path is in
  `file.path.params["path"]` (`worktree/WorktreeSessionEditorKind.kt:22,49`).
- `SessionSidePanelManager` (`session/SessionSidePanelManager.kt`) already implements the full
  SessionUi cache/lifecycle: `opened`/`all`/`activeTimers`/`current`/`latest`, `show`/`register`/
  `release`/`disposeUi`/`schedule`/`cancel`/`dispose`, plus `newSession`/`openSession`/`activity`/
  `titles`/`activityChanged`/`focusPrompt`. It presents by swapping content into `component`
  (BorderLayout CENTER). History logic (`showHistory`/`createHistory`/`back`) is sidebar-specific.
- `SessionUi` is created via `SessionUiFactory.create(project, workspace, manager, ref, timers)`
  (`session/SessionUiFactory.kt`) with `SessionUiFactory.scope()` for the coroutine scope. A blank
  `SessionUi` (`ref = null`) does not hit RPC until first prompt (lazy session creation).
- `ActiveList` (`ui/list/ActiveList.kt`) already provides a search field, per-row action cells
  (delete), and configurable selection. `ActiveListView` already exposes `selectedItems()`,
  `selectedKeys()`, and an internal `onSelect` hook (`ui/list/ActiveListView.kt:75,124,142-152`) —
  the public `ActiveList` wrapper does not surface these yet. `ActiveListConfig(selection = …)` sets
  the selection mode; `ActiveListConfig`/`ActiveListRowHeight`/`ActiveListCell`/`ActiveListItem` are
  `internal` in the same `frontend` module.
- Per-directory session ops on the project service `KiloSessionService`
  (`app/KiloSessionService.kt`): `list(dir): SessionListDto`, `create(dir): SessionDto`,
  `deleteSession(id, dir)`, `renameSession(id, dir, title)`. `HistoryController` already reads
  `sessions.list(workspace.directory)` this way. Note `list(dir)` also writes a global
  `_sessions` StateFlow — read the returned DTO directly, do not rely on the flow.
- Worktree workspace: `service<KiloWorkspaceService>().workspace(worktreePath)` returns a
  `Workspace` for any directory (`app/KiloWorkspaceService.kt:81`).
- Splitter: no `OnePixelSplitter`/`JBSplitter` used yet in the plugin. Use
  `OnePixelSplitter(false, 0.25f)` (vertical divider → left|right; first component = left = 25%).
- Progressive-load pattern already used: `SessionUi` (addNotify/doLayout) and `HistoryPanel`
  (`addHierarchyListener` on `SHOWING_CHANGED`) defer work until shown.

## Implementation tasks (ordered)

### 1. Extract `SessionHost` base class
**New** `frontend/.../session/SessionHost.kt` — abstract, implements `SessionManager`, `Disposable`.
Move the reusable machinery out of `SessionSidePanelManager`:
- Fields: `opened`, `all`, `activeTimers`, `current`, `latest`.
- Constructor params (shared): `project`, `root: Workspace` (default workspace for new sessions),
  `create` factory, `resolve`, `status`, `timers`, `request`.
- Methods: `newSession()`, `openSession(ref)`, `create(ref)`, `show(ui)`, `register`, `release`,
  `disposeUi`, `schedule`, `cancel`, `activity()`, `titles()`, `focusPrompt()`, base `dispose()`.
- Replace the inline `component.removeAll()/add(ui)` in `show()` with an abstract
  `present(ui: SessionUi?)` hook. `show(ui)` keeps: cancel/`all.add`/register/`latest =`/
  `if (current === ui) return`/`release(current)`/`current = ui`/`present(ui)`/focus.
- Add open hooks: `protected open fun onSessionsChanged() {}` (invoked after create/dispose so the
  editor list can refresh) and `open fun activityChanged() { current?.syncActivity() }`.
- Expose to subclasses: `protected fun currentUi(): SessionUi?` and a `currentKey(): String?`
  (`current?.id ?: current?.cacheKey`, or a `NEW` sentinel when `current?.blank == true`).

### 2. Refactor `SessionSidePanelManager` onto the base
**Edit** `session/SessionSidePanelManager.kt`:
- Extend `SessionHost(project, root, …)` passing the existing defaults.
- Keep sidebar-specific: `component` (DataProvider), `panel`, history (`showHistory`,
  `createHistory`, `back`), `history` injection, `defaultFocusedComponent`.
- Implement `present(ui)` by swapping into `component` (the current `show()` body).
- Override `activityChanged()` to call `super.activityChanged()` then
  `(panel as? HistoryPanel)?.syncActivity()`.
- Behavior must be unchanged — `SessionSidePanelManagerTest` should pass without edits.

### 3. `WorktreeSessionListController`
**New** `worktree/WorktreeSessionListController.kt`:
- Ctor: `service: KiloSessionService`, `dir: String`, `cs: CoroutineScope`, telemetry hook.
- Holds a `CollectionListModel<SessionDto>` (or an EDT-marshalled row list). `reload()` launches
  `service.list(dir)` and pushes rows to the model on the EDT (copy the `edt {}` helper from
  `WorktreeController.kt`/`HistoryController.kt`).
- `delete(ids: List<String>, onDone: () -> Unit)` → `service.deleteSession(id, dir)` per id, then
  `reload()`; marshal `onDone` to EDT.
- Telemetry: `"Worktree Session List Loaded"`, `"Worktree Session Deleted"`.

### 4. `WorktreeSessionEditorManager`
**New** `worktree/WorktreeSessionEditorManager.kt` — extends `SessionHost`, `Disposable`:
- Ctor: `parent: Disposable`, `project`, `worktree: Workspace` (root = worktree workspace),
  `list: WorktreeSessionListController`, factory/timers defaults matching the sidebar. Register
  under `parent`; obtain the SessionUi scope from `SessionUiFactory.scope()` and cancel on dispose.
- Holds `right: JPanel(BorderLayout)` as the presentation target; `val component get() = right`.
- `present(ui)`: `right.removeAll(); ui?.let { right.add(it, CENTER) }; revalidate/repaint`, then ask
  the panel to select the list row for `currentKey()`.
- `onSessionsChanged()` → `list.reload()`.
- Override `activityChanged()` → `super` + detect blank→id transition of `current` (track
  `lastCurrentId`); when the current session's id becomes newly non-null, call `list.reload()` so the
  persisted row appears; otherwise just repaint rows (titles/activity) without RPC to avoid chatty
  reloads during streaming.
- `deleteSessions(ids)`: confirm (`Messages.showYesNoDialog`, single vs multiple message); for each
  id dispose any open `SessionUi` (`opened[id]`); delegate RPC delete to `list.delete(ids)`; if the
  shown session was deleted, `openSession(next)` or `newSession()`.
- `start()` (called from the panel on first show): `list.reload()`, then show the most recent
  existing session or `newSession()`.

### 5. Left panel + splitter: `WorktreeSessionEditorPanel`
**New** `worktree/WorktreeSessionEditorPanel.kt` — `BorderLayoutPanel`, `Disposable`, `UiDataProvider`:
- Build shell **eagerly, defer data**: create `OnePixelSplitter(false, 0.25f)`, left panel, right =
  `manager.component`. Kick off `manager.start()` + `list.reload()` from an
  `addHierarchyListener`/`addNotify` on first `SHOWING_CHANGED` (keeps headless construction cheap and
  RPC-free, matching `SessionUi`/`HistoryPanel`).
- Left = `BorderLayoutPanel` with toolbar at NORTH and `ActiveList` at CENTER:
  - **Toolbar:** an `ActionToolbar` from a `DefaultActionGroup` of two `AnAction`s
    (`ActionUpdateThread.EDT`): New session (`AllIcons.General.Add` → `manager.newSession()`) and
    Delete (`AllIcons.Actions.GC`/`General.Remove` → `manager.deleteSessions(activeList.selectedKeys())`,
    enabled only when the selection is non-empty and deletable).
  - **ActiveList:** `ActiveList(empty, cfg = ActiveListConfig(EQUAL, selection = MULTIPLE_INTERVAL_SELECTION),
    placeholder = search hint, onCell = { key, id -> if (id == DELETE) manager.deleteSessions(listOf(key)) },
    onClick = { row -> open its session }, onSelect = { updateToolbarEnablement() })`. Rows are a
    `WorktreeSessionRow(ActiveListItem)`: `key = session.id` (or `NEW`), `title = session.title` or
    "New session"/"Untitled session", `cells = [ delete cell (AllIcons.Actions.GC, iconOnly) ]`
    (omit delete for the synthetic new row).
  - Rebuild rows from `list.model` on model changes (`ListDataListener` → `activeList.update(rows,
    PreserveNoScroll)`), prepending a synthetic "new session" row when `manager` current is blank.
    Select the row matching `manager.currentKey()` after `present`.
- Provide `SessionManager.KEY` = manager and `SessionManager.WORKSPACE_KEY` = worktree workspace via
  `uiDataSnapshot`.
- Bind theme via `LafManagerListener.TOPIC` (copy `AgentManagerPanel.bindTheme`).

### 6. `ActiveList` additive API
**Edit** `ui/list/ActiveList.kt`:
- Add ctor param `onSelect: (() -> Unit)? = null`; wire `view.onSelect = onSelect` in `init`.
- Add `@RequiresEdt fun selectedKeys(): List<String> = view.selectedKeys()` and
  `selectedItems(): List<ActiveListItem> = view.selectedItems()` passthroughs.
(No behavior change for existing `AgentManagerPanel` usage.)

### 7. Wire the editor kind
**Edit** `worktree/WorktreeSessionEditorKind.kt`:
- In `createContent`, read `params["path"]`, resolve `workspace = service<KiloWorkspaceService>()
  .workspace(path)`, build `WorktreeSessionListController` + `WorktreeSessionEditorManager` (parent =
  `parent`) + `WorktreeSessionEditorPanel`, and return it. Keep returning an empty
  `BorderLayoutPanel()` only when `path` is blank.
- Implement `preferredFocus(component)` to focus the left list's search/toolbar (optional).

### 8. i18n strings
**Edit** `frontend/src/main/resources/messages/KiloBundle.properties` (after the worktree block,
~line 323): `worktree.session.list.empty`, `worktree.session.list.search.placeholder`,
`worktree.session.new.action`, `worktree.session.delete.action`,
`worktree.session.delete.confirm.title`, `worktree.session.delete.confirm.message` (with `{0}`),
`worktree.session.delete.confirm.message.multiple` (with `{0}`), `worktree.session.new`,
`worktree.session.untitled`. Use `KiloBundle.message(...)` everywhere.

### 9. Tests (`frontend/src/test/.../agentManager/`, `BasePlatformTestCase`)
- **`WorktreeSessionEditorManagerTest`** (fakes: `FakeSessionRpcApi`, `KiloWorkspaceService` +
  `FakeWorkspaceRpcApi`, `KiloAppService` + `FakeAppRpcApi`, `TestUiTimers`, `TestCoroutines` — mirror
  `SessionSidePanelManagerTest` setup): `newSession()` shows a blank SessionUi on the right;
  `openSession(Local(id))` shows it; `deleteSessions` disposes the open UI, calls RPC delete, and
  re-presents the next/new session; list reflects `sessions.list(dir)`.
- **`WorktreeSessionEditorPanelTest`**: splitter proportion ≈ 0.25 and left/right children; left has
  toolbar (+ / delete) + search + list; right hosts `manager.component`; `+` creates a session;
  per-row delete cell and multi-select toolbar delete both trigger confirm/delete; provides
  `SessionManager.KEY`/`WORKSPACE_KEY`. Drive first-show work by attaching to a `JFrame` (triggers
  `addNotify`/`SHOWING_CHANGED`) rather than adding a test-only method.
- **`SessionSidePanelManagerTest`**: must still pass unchanged after the base extraction.
- **`AgentManagerPanelTest`**: the two cases that open the worktree editor via `KiloVfsManager` must
  still pass. Because `createContent` builds the shell eagerly but defers RPC/session creation to
  first show, headless construction stays cheap; verify `openFiles` assertions still hold and add
  session RPC fakes only if `FileEditorManager.openFile` forces `getComponent()` in the harness.

## Risks / notes

- **Headless RPC:** ensure no RPC or SessionUi creation happens at panel construction — defer to
  first show. `WorktreeSessionListController.reload()` must `try/catch` inside its `launch` so a
  failed `KiloSessionRpcApi.getInstance()` in tests is logged, not thrown.
- **Chatty reloads:** `activityChanged()` fires frequently during streaming; only call `list.reload()`
  on structural changes (new/deleted session, blank→id), and repaint rows for title/activity updates.
- **Global `_sessions` flow:** `KiloSessionService.list(dir)` overwrites a shared StateFlow; use the
  returned DTO directly (as `HistoryController` does) and accept that the sidebar's convenience flow
  may reflect the last-listed directory.
- **Worktree paths:** `WorktreeDto.path` comes from the backend git subprocess (real host path), so it
  is usable directly as the workspace directory without `resolveProjectDirectory`.
- **`SessionManager` slash actions:** `SessionUi` calls `manager.showHistory()` for the "sessions"
  slash command. In the editor, override it to focus/refresh the left list (no history stack).

## Validation

From `packages/kilo-jetbrains/`:
- `./gradlew typecheck`
- `./gradlew test` (or targeted: the new manager/panel tests plus `SessionSidePanelManagerTest`,
  `AgentManagerPanelTest`, `WorktreeSessionEditorKindTest`).
- Manual smoke (`./gradlew runIde`): open Agent Manager → click a worktree → editor shows a 25% list
  on the left and a session on the right; `+` adds a session; per-row and toolbar (multi-select)
  delete remove sessions; search filters; deleting the shown session falls back to another/new one.

## Out of scope

Cloud sessions, rename UI, session grouping/sections, drag-reorder, PR/setup-script integration, and
`.kilo/agent-manager.json` persistence.
