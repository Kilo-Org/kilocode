# JetBrains Agent Manager — In-place rename (worktrees + sessions)

## Goal

Add in-place renaming to the JetBrains Agent Manager for:

1. **Worktree names** — the display name shown as the worktree list row title and the opened editor-tab title (NOT the git branch).
2. **Sessions** — the session title in the worktree session list.

Both use a **reusable rename popover** modeled on the existing delete popover: a small balloon anchored to the row, containing a text field prefilled with the current name, an OK button and the balloon's built-in X (close). The new name is written into the list **immediately (optimistic)**, then a "heavy" request runs; on failure the row reverts and a notification is shown.

## Key decisions (resolved with user)

- **Worktree name persistence:** backend RPC + repo state file. Store is a **separate JetBrains-owned file** `<mainRepoRoot>/.kilo/worktree-names.json` mapping absolute worktree path → custom name. (Cross-client sync with VS Code's `.kilo/agent-manager.json` is **out of scope**.)
- **Renamed name surfaces:** both the Agent Manager list row **and** the opened editor tab title.
- **Trigger:** the standard IntelliJ rename action (Shift+F6 / `RenameElement`) **plus** a per-row pencil action cell (shown when exactly one row is selected, next to delete).
- **Multi-select (session list only, which is `MULTIPLE_INTERVAL_SELECTION`):** rename resets the selection to the first eligible selected row, then opens the popover on it. The worktree list is single-selection, so this rule is a no-op there.
- **Division of responsibility:** the `ActiveList` UI owns the reusable popover + trigger orchestration and stays worktree/session-agnostic (parameterized by `current`/`commit` closures). Optimistic model update + heavy request + revert + notification live in the per-list controllers/managers, mirroring how delete is structured today.

## Constraints / invariants

- All Swing/model mutation on EDT (`@RequiresEdt`); RPC off EDT via existing coroutine scopes and `durable {}` / injected RPC pattern.
- No new Kotlin UI DSL / Compose / JCEF. Use `JBTextField`, theme APIs, `JBUI` spacing, `KiloBundle` strings.
- `packages/kilo-jetbrains/` is entirely Kilo-owned: **no `kilocode_change` markers** needed.
- **No CLI/SDK change required.** Worktree ops use the JetBrains backend git subprocess (`KiloWorktreeRpcApiImpl`), not `kilo serve`. Session rename uses the already-existing `renameSession` CLI PATCH path. So no CLI pin bump / `script/generate.ts`.
- Follow single-word naming, early returns, no empty catch, avoid `let` reassignment.

## Reference points in current code

- Delete popover: `ui/list/ActiveListDeletePopup.kt` (`ActiveListDeleteOptions`, `activeListDeleteContent`, `showActiveListDeletePopup`), `ActiveList.confirmDelete()`, `ActiveListView.point()/trackBalloon()`.
- Worktree list UI: `agentManager/AgentManagerPanel.kt` (`WorktreeRow`, `onCell`, `WorktreeDeleteProvider`).
- Worktree data flow: `agentManager/worktree/WorktreeController.kt`, `KiloWorktreeService.kt`, shared `rpc/KiloWorktreeRpcApi.kt`, backend `rpc/KiloWorktreeRpcApiImpl.kt`, `rpc/dto/WorktreeDto.kt`.
- Session list UI: `agentManager/worktree/WorktreeSessionEditorPanel.kt` (`SessionRow`, `confirmDelete`, `confirm` test seam).
- Session data flow: `WorktreeSessionListController.kt` (`delete`), `WorktreeSessionEditorManager.kt` (`deleteSessions`, `notify`), `app/KiloSessionService.kt` (`renameSession` already exists), shared `rpc/KiloSessionRpcApi.kt` (`rename`).
- Editor tab title: `agentManager/worktree/WorktreeSessionEditorKind.kt` (`title()`), refresh via `vfs/KiloVfsManager.updatePresentation(kind, params)`.
- Test patterns: `ui/list/ActiveListDeletePopupTest.kt`, `agentManager/WorktreeControllerTest.kt`, `agentManager/worktree/WorktreeSessionEditorManagerTest.kt`, `agentManager/worktree/WorktreeSessionEditorPanelTest.kt`.

---

## Implementation tasks (ordered)

### 1. Reusable rename popover (the shared "common class") — `ui/list/`

Create `ui/list/ActiveListEditPopup.kt` mirroring `ActiveListDeletePopup.kt`:

- `data class ActiveListEditOptions(val value: String, val label: String? = null, val button: String = KiloBundle.message("common.rename"))`.
- `internal fun activeListEditContent(opts, hide: () -> Unit, commit: (String) -> Unit): JComponent`:
  - Vertical `Stack` (same border/gaps as delete content). Optional `label` line (`JBLabel`, context-help foreground). A `JBTextField` prefilled with `opts.value`, all text selected, reasonable `columns`. Right-aligned OK button built from an `AbstractAction(opts.button)` marked `DEFAULT_ACTION`.
  - Enable OK only when the trimmed field text is non-blank **and** differs from `opts.value.trim()`. Wire a `DocumentListener` to re-sync enablement. Enter triggers OK (default action); blank/unchanged → OK disabled so Enter no-ops.
  - OK → `hide(); commit(text.trim())`.
- `internal fun showActiveListEditPopup(anchor: RelativePoint, opts, commit): Balloon`: same balloon builder as delete (`setCloseButtonEnabled(true)` gives the X, `setRequestFocus(true)`, hide-on-click-outside/key-outside), show `below`, set default button, and request focus into the text field.

Extend `ui/list/ActiveList.kt` (keep agnostic — no worktree/session types):

- `fun editName(anchor: RelativePoint, opts: ActiveListEditOptions, commit: (String) -> Unit)` → `trackBalloon(showActiveListEditPopup(anchor, opts, commit))`.
- `fun rename(key: String, cell: String? = null, current: (String) -> String?, commit: (String, String) -> Unit)`:
  - `select(key)` (resets a multi-selection down to this single row),
  - `val value = current(key) ?: return`,
  - `editName(point(key, cell), ActiveListEditOptions(value)) { name -> commit(key, name) }`.
- `fun renameSelected(current: (String) -> String?, commit: (String, String) -> Unit): Boolean`:
  - `val key = selectedKeys().firstOrNull() ?: return false; rename(key, null, current, commit); return true`.
  - (Callers pass a `current` that returns `null` for ineligible rows, e.g. the pending "New" session, so those are skipped.)

Strings — add to `frontend/.../resources/messages/KiloBundle.properties` (English; other locales fall back):

- `common.rename=Rename`
- `worktree.rename.action=Rename worktree`
- `worktree.rename.failed.title=Failed to rename worktree "{0}"`
- `worktree.session.rename.action=Rename session`
- `worktree.session.rename.failed.title=Failed to rename session "{0}"`

### 2. Shared RPC contract + DTO

- `shared/.../rpc/dto/WorktreeDto.kt`: add
  `@Serializable data class RenameWorktreeResultDto(val worktree: WorktreeDto? = null, val error: String? = null)`.
  (`WorktreeDto.name` is unchanged — the backend overlays the custom name into it.)
- `shared/.../rpc/KiloWorktreeRpcApi.kt`: add
  `suspend fun rename(directory: String, path: String, name: String): RenameWorktreeResultDto`.

### 3. Backend worktree label store — `backend/.../rpc/KiloWorktreeRpcApiImpl.kt`

- Add pure, testable helpers (mirror existing `internal` `parseWorktreeList`/`managedWorktrees`):
  - `internal fun overlayWorktreeNames(items: List<WorktreeDto>, names: Map<String, String>): List<WorktreeDto>` — for each non-main item, if `names[path]` is present and non-blank, return `copy(name = names[path])`.
  - `internal fun readWorktreeNames(file: Path): Map<String, String>` / `internal fun writeWorktreeNames(file: Path, map: Map<String, String>)` — kotlinx.serialization `Json` over `Map<String,String>` (or a small `@Serializable` wrapper). Read tolerates missing/corrupt file (return empty; log). Write is atomic (temp file + `Files.move` `ATOMIC_MOVE`, creating `.kilo/`).
- Store location: resolve the **main** worktree root from `git worktree list --porcelain` (the first/`main==true` entry) and use `<mainRoot>/.kilo/worktree-names.json`. Keep it consistent regardless of which worktree `directory` the request came from.
- `list(directory)`: after `managedWorktrees(...)`, apply `overlayWorktreeNames(items, readWorktreeNames(store))`.
- `rename(directory, path, name)`:
  - Trim `name`; empty → `RenameWorktreeResultDto(error = "Name is required")`.
  - Resolve main root + store; read map; set `path -> name` (or remove entry when name equals derived path-segment name — optional normalization); atomic write.
  - Return `RenameWorktreeResultDto(worktree = <derived dto for path>.copy(name = name))`. On IO error return `error`.

### 4. Frontend worktree service + name cache

- `agentManager/worktree/KiloWorktreeService.kt`: add
  `suspend fun rename(directory: String, path: String, name: String): RenameWorktreeResultDto` (try/catch → `RenameWorktreeResultDto(error = ...)` on exception, matching `remove`).
- New light service `agentManager/worktree/WorktreeNameCache.kt` (`@Service(Service.Level.APP)`): in-memory `Map<String,String>` path→name with `get(path)`, `put(path, name)`, `remove(path)`, `putAll(items: List<WorktreeDto>)`. Used only to feed the editor-tab title synchronously.

### 5. Worktree rename wiring — `WorktreeController.kt` + `AgentManagerPanel.kt`

`WorktreeController`:

- On `reload()` success, `service<WorktreeNameCache>().putAll(rows)` so the cache tracks current names.
- Add `fun rename(dto: WorktreeDto, name: String, onFailure: (String?) -> Unit = {}, onSuccess: (WorktreeDto) -> Unit = {})`:
  - `idx = model.getElementIndex(dto)`; if `< 0` return.
  - **Optimistic:** `val row = dto.copy(name = name); model.setElementAt(row, idx)`; update cache.
  - `cs.launch { val res = service.rename(directory, dto.path, name) ... }`:
    - success (`res.worktree != null`): `model.setElementAt(res.worktree, idxOf)`, cache put, telemetry `Worktree Renamed`, `onSuccess(res.worktree)`.
    - failure: revert element to `dto`, cache put(old), telemetry `Worktree Rename Failed`, `onFailure(res.error)`, then `reload()` to reconcile.

`AgentManagerPanel`:

- Add a pencil cell to `WorktreeRow.cells` (e.g. `AllIcons.Actions.Edit`, `iconOnly = true`, id `RENAME_CELL`) for non-main/non-pending rows.
- `onCell`: `RENAME_CELL` → `beginRename(item)`.
- `beginRename(item: WorktreeDto)`: `list.rename(item.id, RENAME_CELL, current = { key -> item(key)?.name }, commit = { key, name -> item(key)?.let { renameWorktree(it, name) } })`.
- `renameWorktree(dto, name)`: `controller.rename(dto, name, onFailure = { err -> KiloNotifications.error(project, KiloBundle.message("worktree.rename.failed.title", name), err) }, onSuccess = { updated -> project?.service<KiloVfsManager>()?.updatePresentation(WorktreeSessionEditorKind.ID, worktreeSessionParams(updated)) })`.
- Standard rename action: inner `RenameAction : AnAction` whose `update` enables when a single non-main/non-pending row is selected and `actionPerformed` calls `selectedRow()?.let { beginRename(it.dto) }`. In `init`, `renameAction.registerCustomShortcutSet(ActionManager.getInstance().getAction("RenameElement").shortcutSet, list, this)` so Shift+F6 works inside the list. (No global `renameHandler` EP.)

`WorktreeSessionEditorKind`:

- `title(params)`: `params[PATH]?.let { service<WorktreeNameCache>().get(it) ?: name(it) } ?: <fallback>`.
- (Best-effort startup reopen: optionally in `createContent`, launch a coroutine to `KiloWorktreeService.list(path)` / populate cache and `updatePresentation` if the persisted tab opened before the panel loaded. Mark optional; cache is normally warm because worktree editors are only opened from the panel.)

### 6. Session rename wiring — `WorktreeSessionListController.kt` + `WorktreeSessionEditorManager.kt` + `WorktreeSessionEditorPanel.kt`

`WorktreeSessionListController`:

- Add `fun rename(id: String, title: String, done: (Boolean, String?) -> Unit)`:
  - find `SessionDto` in `model`; capture `prior`.
  - **Optimistic:** `model.setElementAt(prior.copy(title = title), idx)`.
  - `cs.launch { runCatching { service.renameSession(id, dir, title) } ... }`:
    - success: `model.setElementAt(updated, idxOf)`, telemetry `Worktree Session Renamed`, `done(true, null)`.
    - failure: revert to `prior`, `done(false, err?.message)`, then `reload()`.

`WorktreeSessionEditorManager`:

- Add `open fun renameSession(id: String, title: String)`:
  - `list.rename(id, title) { ok, err -> onListChanged?.invoke(); if (!ok) notify(KiloBundle.message("worktree.session.rename.failed.title", title), err) }`.
  - (`onListChanged` re-syncs the panel rows so the optimistic title shows immediately.)

`WorktreeSessionEditorPanel`:

- Add a test seam parallel to `confirm`: `edit: ((RelativePoint, ActiveListEditOptions, (String) -> Unit) -> Unit)? = null`, defaulting to `list.editName`.
- Add pencil cell to `SessionRow.cells` (id `RENAME_CELL`, shown together with delete when `selectedKeys().size == 1`).
- `onCell`: `RENAME_CELL` → `beginRename(key)`.
- `beginRename(key)`: skip `SessionHost.NEW`; `renameVia(key, RENAME_CELL)`.
- `renameSelected()` (for the action/keyboard path): pick `first = selectedKeys().firstOrNull { it != SessionHost.NEW && it !in manager.deleting() } ?: return`; `renameVia(first, null)` — `list.rename` will reset the multi-selection to `first`.
- `renameVia(key, cell)`: build `current = { k -> item(k)?.title?.takeIf { it.isNotBlank() } ?: KiloBundle.message("worktree.session.untitled") }` and `commit = { k, name -> manager.renameSession(k, name) }`; call `edit`-seam-aware equivalent of `list.rename(key, cell, current, commit)` (route the popover through the `edit` seam like delete routes through `confirm`).
- Toolbar + shortcut: add a `RenameAction` (icon `AllIcons.Actions.Edit`) to the toolbar group `[add, rename, delete]`; enable when ≥1 eligible row selected; `actionPerformed` → `renameSelected()`. Register `RenameElement` shortcut set on the list as in the worktree panel.

### 7. Test doubles

- `frontend/.../testing/FakeWorktreeRpcApi.kt` (or the fake used by `WorktreeControllerTest`): implement `rename(directory, path, name)`; add call tracking + configurable failure (`renameThrows`/`renameGate`) mirroring `deletes`/`deleteGate`.
- `frontend/.../testing/FakeSessionRpcApi.kt` already implements `rename`; add title/gate tracking if needed for the new controller test.

---

## Tests to add

- `ui/list/ActiveListEditPopupTest` (mirror `ActiveListDeletePopupTest`): OK disabled for blank/unchanged; enabled + `commit(trimmed)` + `hide` on OK; Enter path.
- `WorktreeControllerTest`: rename optimistic set → success replace; failure reverts + `onFailure(err)` + reconcile `reload()`; cache updated.
- Backend `KiloWorktreeRpcApiImplTest` (new or extend): `overlayWorktreeNames` overlays only non-main present entries; `readWorktreeNames`/`writeWorktreeNames` round-trip + missing/corrupt file tolerated + atomic write; `rename` persists and a subsequent `list` overlay reflects it (drive store helpers directly against a temp dir to avoid needing a real git repo).
- `WorktreeSessionEditorManagerTest`: rename marks optimistic title then keeps on success; failure reverts row and calls `notify` with `worktree.session.rename.failed.title`.
- `WorktreeSessionEditorPanelTest`: pencil cell present when exactly one selected; multi-select rename via `edit` seam resets selection to the first eligible row and opens with its current title; `NEW` row is never renamable.
- `AgentManagerPanel`/worktree UI test: pencil cell present for non-main rows; `RenameAction` enabled only for a single non-main/non-pending selection; commit path calls `controller.rename` and refreshes tab presentation on success.
- `KiloWorktreeServiceTest`: `rename` success maps result; exception → `RenameWorktreeResultDto(error=...)`.

## Failure modes to cover

- Backend store write failure → `RenameWorktreeResultDto(error)` → row reverts + notification; list reconciles via `reload()`.
- Session rename RPC failure → optimistic title reverts + notification; `reload()` reconciles.
- Blank or unchanged input → popover OK disabled, no request fired (no-op cancel).
- Rename while a row is `deleting` / pending `NEW` session → excluded (not eligible).
- Multi-select session rename → selection collapses to first eligible row before the popover opens.
- Editor tab for a renamed worktree that isn't currently open → nothing to refresh; next open reads the (now warm) cache. Persisted-tab-before-panel-load shows derived name until panel reload triggers `updatePresentation` (best-effort refresh optional).

## Validation

From `packages/kilo-jetbrains/`:

- `bun run typecheck` (or `./gradlew typecheck`).
- `./gradlew test` (targeted new/updated test classes first, then module suite).
- Run inspection `Plugin DevKit | Code | Frontend and Backend API Usage` since split-mode backend/shared/frontend code changes (new RPC method touches all three).
- Manual smoke in `runIde` / `runIdeSplitMode`: rename a worktree via pencil and via Shift+F6; confirm list row + open tab title update, and that the name survives an Agent Manager reload (persisted to `.kilo/worktree-names.json`). Rename a session via pencil and Shift+F6; force a failure (e.g. stop backend) to confirm revert + notification.

## Out of scope

- Cross-client name sync with VS Code's `.kilo/agent-manager.json`.
- Converting the sidebar History `RenameSessionAction` modal (`actions/RenameSessionAction.kt`) to the popover — the reusable popover makes this a straightforward follow-up but it is not part of this change.
- Renaming the main worktree or the git branch.

## Notes for implementer

- This requires editing source across `shared/`, `backend/`, and `frontend/` Kotlin modules plus a `.properties` bundle — switch to an implementation-capable agent.
- No `kilocode_change` markers (package is fully Kilo-owned). No CLI pin bump or SDK regeneration (worktree RPC is JetBrains-internal; session rename endpoint already exists).
