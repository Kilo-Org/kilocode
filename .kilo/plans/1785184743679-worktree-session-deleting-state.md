# Worktree session "deleting…" state + delete-failure notification + session logging

## Goal

In the worktree editor session list, give a session that is being deleted an explicit optimistic "deleting…" state, exclude it from further deletion, notify on delete failure, and add create/delete logging on both frontend and backend.

Scope is the **worktree editor session list only** (`WorktreeSessionEditorPanel` / `WorktreeSessionEditorManager`). The sidebar `HistoryPanel` (different renderer) is out of scope.

## Resolved decisions (from interview)

1. **Toolbar Delete on in-progress rows**: the Delete action excludes sessions already being deleted. Toolbar button is enabled only when the selection contains ≥1 still-deletable session; disabled if only "deleting…" (or the New) rows are selected. Mixed selections act only on the deletable ones. The row-level trash cell is hidden on deleting rows.
2. **Deleting the currently-open session**: switch the editor away immediately when deletion starts (to the newest remaining non-deleting session, or a new session) while the row stays visible as "deleting…". On success the row disappears; on failure the row reverts to normal (clickable) and a notification is shown; the editor stays where it switched.
3. **Failure notification**: one error notification per failed session, titled with that session's name plus the error detail.

## Additional decisions (grounded in existing patterns, not blocking)

- **Clicking a deleting row is a no-op** (open is suppressed), mirroring `AgentManagerPanel.open` which returns early for `controller.isPending(item.id)`. Selection is still allowed so the toolbar reflects it.
- **Badges hidden while deleting** (a disappearing session should not show a RUNNING badge).
- **Greying** uses a new additive `ActiveListItem.muted` flag (default `false`) so the shared renderer change cannot affect the Providers/settings lists that already use `disabled`.

## Design / data flow

- **Pending-delete set** lives in `WorktreeSessionEditorManager` (EDT-only `LinkedHashSet<String>`), exposed as `deleting(): Set<String>`. The panel already queries the manager during `sync()` (`currentKey()`, `hasPendingNew()`, `activity()`), so it reads `deleting()` there too. Mutating the set is followed by `onListChanged?.invoke()` to re-sync rows.
- **Delete orchestration** moves to per-id so each session has independent pending state, success removal, and failure handling:
  - `WorktreeSessionEditorManager.deleteSessions(ids)`:
    1. `targets` = `ids` minus `NEW`, minus already-in-`deleting`, distinct. Return if empty.
    2. Confirm dialog (unchanged messages; count = `targets.size`).
    3. Add all `targets` to `deleting`; dispose their cached UIs (`forceSession`); `onListChanged`.
    4. If `currentKey()` ∈ `targets`: open fallback now = `latest()` (which must now skip `deleting` ids) else `newSession()`.
    5. For each id call `list.delete(id) { ok, error -> ... }`:
       - success: remove id from `deleting`, `onListChanged`, done (controller removed the row).
       - failure: remove id from `deleting`, `onListChanged`, `notify(title, error)`.
  - `WorktreeSessionListController.delete(ids, done)` → replace with per-id `delete(id, done: (Boolean, String?) -> Unit)`: `runCatching { service.deleteSession(id, dir) }`; on EDT, success → remove that row from `model` + telemetry + `done(true, null)`; failure → `LOG.warn` + `done(false, message)`; `reload()` only on failure to reconcile.
- **`latest()`** in the manager must ignore ids currently in `deleting` so the switch-away fallback never selects a disappearing session. (`start()` is unaffected — no deleting rows at startup.)
- **Notification** is injected into the manager like the existing `confirm` seam: `notify: (String, String?) -> Unit = { title, content -> KiloNotifications.error(project, title, content) }` (uses the manager's `project`), so tests capture it without real popups.

## Ordered tasks

1. **`ActiveListModel.kt`**: add `val muted: Boolean get() = false` to `ActiveListItem`.
2. **`ActiveListRenderer.kt`**: compute the title color as `val titleFg = if (value.muted) weak else fg` and use it for the title append (leaving badges/desc/trailing as-is). `weak` already resolves to the inactive/hint color when the row is not the active selection.
3. **`WorktreeSessionEditorManager.kt`**:
   - Add `private val deleting = linkedSetOf<String>()` and `@RequiresEdt fun deleting(): Set<String> = deleting`.
   - Add constructor seam `notify: (String, String?) -> Unit` (default calls `KiloNotifications.error(project, …)`), placed after `confirm` (keep existing default-arg order stable for tests).
   - Rewrite `deleteSessions(ids)` per the design (targets filter, confirm, mark deleting, immediate switch-away with deleting-excluded fallback, per-id delete with success/failure handling + `notify`).
   - Make `latest()` skip ids in `deleting`.
4. **`WorktreeSessionListController.kt`**: replace batch `delete(ids, done)` with per-id `delete(id, done: (Boolean, String?) -> Unit)` (runCatching, EDT model removal on success, warn + reconcile `reload()` on failure). Keep the existing `capture("Worktree Session Deleted", …)` telemetry on success.
5. **`WorktreeSessionEditorPanel.kt`**:
   - In `sync()`, build rows as `SessionRow(it.session, kinds[it.id], deleting = it.id in manager.deleting())`.
   - `SessionRow`: add `deleting: Boolean = false`; `trailing` → `KiloBundle.message("worktree.session.deleting")` when deleting else relative time; `cells` → `emptyList()` when deleting; `badges` → empty when deleting; add `override val muted get() = deleting`.
   - `selectedKeys()` → also exclude `manager.deleting()` (drives DeleteAction disable + delete target set).
   - `open(row, …)` → return early (no-op) when `row.key in manager.deleting()`.
   - Wire `manager.notify` is set in the manager itself; no panel change needed unless the panel owns `project` (it does not) — keep notification inside the manager.
6. **`KiloBundle.properties`**: add
   - `worktree.session.deleting=Deleting…`
   - `worktree.session.delete.failed.title=Failed to delete session "{0}"`
7. **Frontend logging — `KiloSessionService.kt`**:
   - `create(dir)`: standardize to `log.info("kind=session create=true dir=${ChatLogSummary.dir(dir)}")` before and `log.info("${ChatLogSummary.sid(session.id)} kind=session create=true ok=true …")` after.
   - `deleteSession(id, dir)`: add `log.info("${ChatLogSummary.sid(id)} kind=session delete=true dir=${ChatLogSummary.dir(dir)}")` before `call { delete }` and `… ok=true` after.
8. **Backend logging — `KiloSessionRpcApiImpl.kt`**:
   - `create`: keep `create session: directory=…`, then log the created id after `createSession()`.
   - `delete`: add `log.info("delete session: id=$id, directory=$directory")` (matches existing backend log style like `prompt RPC: session=…`).
9. **Tests — frontend**:
   - `FakeSessionRpcApi.kt`: add `var deleteThrows: Exception? = null`; throw it at the start of `delete(...)` (before recording) when set.
   - `WorktreeSessionEditorPanelTest.kt`:
     - `FakeManager` gains a mutable `deleting` set + `override fun deleting()`.
     - `test deleting row shows deleting state`: mark a session deleting → assert its `SessionRow.trailing` == "Deleting…", `cells` empty, `muted` true, no badges.
     - `test toolbar delete disabled when only deleting selected`: select only a deleting row → `DeleteAction` disabled; mixed selection → enabled and `deleteSelected()` targets exclude the deleting id.
     - `test clicking deleting row does not open`: click a deleting row → `FakeManager.refs` unchanged.
   - `WorktreeSessionEditorManagerTest.kt`:
     - Add `notify` capture to the `manager()` factory.
     - `test delete marks row deleting then removes on success`: use `rpc.deleteGate` to observe the intermediate `deleting()` membership, release, assert removal and empty `deleting()`.
     - `test delete failure reverts row and notifies`: set `rpc.deleteThrows`, delete → assert row still present, `deleting()` empty, `notify` called once with the session title.
     - Update `test deleting shown session removes it and falls back to next session` for immediate switch-away + `notify` seam.
10. **Tests — backend** (`KiloSessionRpcApiImplTest.kt`): inject a capturing `KiloLog` (see `backend/.../testing/TestLog.kt`) and assert a create log contains the created id and a delete log contains the deleted id. Keep assertions to "a line containing the id" to avoid brittleness.

## Failure modes / risks

- **Shared renderer change**: `muted` must stay additive (default `false`); verify Providers/settings lists render unchanged (their rows never set `muted`).
- **Controller API change**: `delete` signature changes; the manager is the only caller — update it and all tests that call the batch form.
- **Fallback selection**: if `latest()` is not updated to skip `deleting`, switch-away could reopen the session being deleted. Covered by task 3.
- **EDT discipline**: `deleting` is mutated only on EDT; RPC runs off-EDT via the controller and marshals callbacks back to EDT (existing `edt {}` helper).
- **Reconcile on failure**: controller `reload()` after a failed delete re-fetches server truth so the reverted row is consistent; the `deleting` flag is already cleared before re-sync.
- **Notification noise**: per-session notifications are intended (decision 3); acceptable for typical small multi-selects.

## Validation

- `./gradlew :frontend:test --tests ai.kilocode.client.agentManager.worktree.WorktreeSessionEditorPanelTest --tests ai.kilocode.client.agentManager.worktree.WorktreeSessionEditorManagerTest` (run from `packages/kilo-jetbrains/`).
- `./gradlew :backend:test --tests ai.kilocode.backend.rpc.KiloSessionRpcApiImplTest`.
- `./gradlew typecheck`.
- Manual smoke (optional): delete a session and confirm it greys, shows "Deleting…", trash icon hidden, toolbar disabled for it; force a failure to confirm revert + notification.

## Out of scope

- Sidebar `HistoryPanel` deletion styling.
- Changing the delete confirmation dialog.
- Any `kilocode_change` markers — `packages/kilo-jetbrains/` is entirely Kilo-owned.

## Open questions

None blocking.
