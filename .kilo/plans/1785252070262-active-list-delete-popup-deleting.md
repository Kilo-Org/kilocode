# Generalize delete-confirmation popup + "deleting" UX into ActiveList; drop session timestamps

## Goal

Refactor the JetBrains Agent Manager UI so the delete-confirmation **balloon popup** and the
optimistic **"deleting…" row state** become generic capabilities of the shared `ui/list/` active
list, used by both the worktree list and the worktree session editor list without duplicating code
and without the shared code knowing anything about worktrees or sessions. Also remove the per-row
timestamp from the worktree session editor list (keep sorting and day-group section headers).

All work is in `packages/kilo-jetbrains/` (entirely Kilo-owned — **no `kilocode_change` markers**).

## Resolved decisions (from interview)

1. **Session timestamp**: remove the per-row relative-time trailing (`HistoryTime.relative`) from the
   session list. Keep `HistoryTime.sorted()` ordering and the Today/Yesterday/… section headers. The
   `trailing` slot is then used only for the generic "Deleting…" indicator.
2. **Confirmation popup**: replace the session list's synchronous `Messages.showYesNoDialog` with the
   same balloon popup style the worktree list uses. Extract one generic popup into `ui/list/`.
   Multi-select delete stays: the balloon anchors at the primary (lead) selected row and, on confirm,
   runs the manager's optimistic multi-delete. Confirmation moves from the manager into the panel
   (mirroring `AgentManagerPanel`).
3. **Deleting UX is generic and wired to both lists**: the active list renders a `deleting` row muted,
   with a "Deleting…" trailing label, hidden badges, hidden action cells, and suppressed interaction.
   The session list keeps its existing manager-tracked deleting set; the worktree list gains an
   optimistic deleting state in `WorktreeController` (mark on remove, drop on success, revert on
   failure) instead of vanishing instantly.

## Shared model / behavior design (`ui/list/`)

- **`ActiveListModel.kt`**
  - Add `val deleting: Boolean get() = false` to `ActiveListItem`.
  - **Remove** `val muted: Boolean` (its only consumer is the deleting path; `deleting` replaces it).
  - In `activeListVisibleCells(item, active)`: also return `emptyList()` when `item.deleting` (so a
    deleting row never shows action cells), alongside the existing `item.disabled` check.
- **`ActiveListRenderer.kt`** — centralize the deleting visuals (was per-`SessionRow`):
  - `val titleFg = if (value.deleting) weak else fg` (replaces the `value.muted` check).
  - Trailing text: `val end = if (value.deleting) KiloBundle.message("common.deleting") else value.trailing.orEmpty()` (import `KiloBundle`).
  - Badges: skip/clear badges when `value.deleting` (guard the `syncBadges(value)` call so a
    disappearing row shows no RUNNING badge).
  - Cells already hidden via `activeListVisibleCells` change; no extra work.
- **`ActiveListView.kt`** — suppress interaction on deleting rows generically (was in the panel):
  - In the mouse `mouseClicked` (single + double) and `mouseReleased` handlers and the keyboard
    `open()`/`source()`/`primary()`/`activate()` paths, no-op when the hit/selected item's
    `deleting` is true. Simplest: guard `onOpen`/`onActivate`/`onCell`/`primary` dispatch with
    `if (item.deleting) return`. Selection is still allowed (so toolbars can reflect it).
- **Generic delete popup** — new file `ui/list/ActiveListDeletePopup.kt` (no `WorktreeDto`/`SessionDto`
  imports):
  - `internal data class ActiveListDeleteOptions(val message: String, val detail: String? = null, val gate: String? = null, val button: String = KiloBundle.message("common.delete"))`.
    `gate` is an optional required-checkbox label (used for the worktree "locked" confirm).
  - `internal fun activeListDeleteContent(options: ActiveListDeleteOptions, hide: () -> Unit, onConfirm: (Boolean) -> Unit): JComponent` — builds the `Stack` content (message label; optional
    help-colored detail label; optional `JBCheckBox` gate; a `DialogWrapper.createJButtonForAction`
    Delete button). Delete is enabled iff `gate == null || checkbox.isSelected`; on click it calls
    `hide()` then `onConfirm(checkbox?.isSelected ?: false)`. This is a real
    content/presentation split so gating is unit-testable without creating a live `Balloon`.
  - `internal fun showActiveListDeletePopup(anchor: RelativePoint, options: ActiveListDeleteOptions, onConfirm: (Boolean) -> Unit): Balloon` — wraps `activeListDeleteContent` in the same
    `JBPopupFactory` balloon config currently in `WorktreeDeletePopup.kt` (fill/border/callout/
    close-on-outside, `defaultButton`, `show(anchor, below)`), passing `balloon.hide(true)` as `hide`.
  - **Delete** `agentManager/worktree/WorktreeDeletePopup.kt` (its logic moves here).
- **`ActiveList.kt`** — add a convenience method so both panels avoid duplicating show+track:
  - `@RequiresEdt fun confirmDelete(anchor: RelativePoint, options: ActiveListDeleteOptions, onConfirm: (Boolean) -> Unit) { trackBalloon(showActiveListDeletePopup(anchor, options, onConfirm)) }`.

## Worktree session list changes

- **`WorktreeSessionEditorPanel.kt`**
  - `SessionRow` simplifies: drop the `trailing` override entirely (no timestamp), drop the
    `badges`/`cells`/`muted` deleting-branches, and add `override val deleting: Boolean = deleting`.
    Keep `title`, `tooltip`, `section` (still `HistoryTime.title(HistoryTime.section(item))`),
    `search`, the `kind` badge (unconditional now — renderer hides it while deleting), and the delete
    cell (unconditional — renderer hides it while deleting). Remove the now-unused `HistoryTime.relative`
    import (keep `HistoryTime.sorted`/`section`/`title` and `LocalHistoryItem`).
  - `open(row, focus)`: remove the `if (row.key in manager.deleting()) return` guard (the view now
    suppresses opening deleting rows generically). Keep the `NEW` branch.
  - Add a constructor seam for confirmation (default = real balloon, overridable in tests):
    `confirm: (RelativePoint, ActiveListDeleteOptions, () -> Unit) -> Unit = { anchor, opts, run -> list.confirmDelete(anchor, opts) { run() } }`.
  - New `private fun confirmDelete(ids: List<String>, cell: String? = null)`: return if empty; build
    message via `worktree.session.delete.confirm.message` / `.message.multiple` (count = `ids.size`,
    single-name via `item(ids.first())?.title`); `ActiveListDeleteOptions(message, detail = worktree.session.delete.confirm.detail)`;
    call `confirm(list.point(ids.first(), cell), opts) { manager.deleteSessions(ids) }`.
  - Route delete through confirmation: `onCell` → `confirmDelete(listOf(key), DELETE_CELL)`;
    `deleteSelected()` → `confirmDelete(selectedKeys())`. `selectedKeys()` unchanged (still excludes
    `NEW` and `manager.deleting()`).
- **`WorktreeSessionEditorManager.kt`**
  - Remove the `confirm` constructor param and the confirm/message block from `deleteSessions` (the
    panel confirms first). `deleteSessions(ids)` keeps: filter `active`, mark `deleting`,
    `onListChanged`, immediate switch-away using deleting-excluded `latest()`/`newSession()`,
    per-id `list.delete` with `deleting.remove` + `notify` on failure, `forceSession`. Keep the
    `notify` seam. Remove the now-unused `Messages` import.

## Worktree list changes

- **`WorktreeController.kt`**
  - Add `private val deleting = linkedSetOf<String>()` and `fun isDeleting(id: String) = id in deleting`.
  - `remove(dto, force, onSuccess, onFailure)`: return early if `dto.id in deleting`; on EDT
    `deleting.add(dto.id)` + fire a re-render (`model.contentsChanged(dto)`; fall back to
    `allContentsChanged()` if `contentsChanged(T)` is not accessible) before launching. On success:
    `deleting.remove(dto.id)`, then existing `model.remove(dto)` + callbacks/telemetry. On failure:
    `deleting.remove(dto.id)`, fire `model.contentsChanged(dto)` to un-mute, then existing
    `onFailure` + `reload()` reconcile.
- **`AgentManagerPanel.kt`**
  - `WorktreeRow`: add `override val deleting: Boolean` sourced from `controller.isDeleting(dto.id)`;
    pass it in `sync()` (`WorktreeRow(item, controller.isPending(item.id), controller.isDeleting(item.id))`).
    Keep the delete cell condition (`main || pending`); renderer hides it while deleting.
  - Replace `showWorktreeDeletePopup(...) + list.trackBalloon(...)` in `showDeletePopup` with
    `list.confirmDelete(list.point(item.id, cell), options) { force -> controller.remove(item, force, onSuccess = { restoreFocus(idx) }, onFailure = { notifyFailed(item, it, force) }) }`,
    where `options = ActiveListDeleteOptions(message = worktree.delete.confirm.message(name), detail = worktree.delete.confirm.detail, gate = if (item.locked) worktree.delete.locked.confirm else null)`.
    Remove the `showWorktreeDeletePopup` import.
  - Add a small guard helper and use it at both delete entry points (`onCell` and the
    `WorktreeDeleteProvider`): deletable iff `worktreeDeletable(item, pending) && !controller.isDeleting(item.id)`.
    (Belt-and-braces; the view already suppresses interaction on deleting rows.)

## Bundle strings (`frontend/.../messages/KiloBundle.properties`)

- Add `common.deleting=Deleting…`.
- Add `worktree.session.delete.confirm.detail=This permanently removes the session.`
- Remove `worktree.session.deleting=Deleting…` (replaced by `common.deleting`).
- Remove `worktree.session.delete.confirm.title=Delete session?` (balloon has no title bar).
- Remove `worktree.delete.button=Delete` (popup uses the `common.delete` default).
- (No locale-parity test exists in the JetBrains frontend; mirroring to `KiloBundle_*.properties` is
  optional and not required for correctness.)

## Ordered tasks

1. `ui/list/ActiveListModel.kt`: add `deleting`, remove `muted`, update `activeListVisibleCells`.
2. `ui/list/ActiveListRenderer.kt`: key muting/trailing/badges off `deleting`; import `KiloBundle`.
3. `ui/list/ActiveListView.kt`: no-op open/activate/primary/cell dispatch for `deleting` items.
4. Create `ui/list/ActiveListDeletePopup.kt` (`ActiveListDeleteOptions`, `activeListDeleteContent`,
   `showActiveListDeletePopup`); delete `agentManager/worktree/WorktreeDeletePopup.kt`.
5. `ui/list/ActiveList.kt`: add `confirmDelete(anchor, options, onConfirm)`.
6. `KiloBundle.properties`: add/remove keys per above.
7. `WorktreeSessionEditorManager.kt`: drop `confirm` seam + confirm/message block from `deleteSessions`.
8. `WorktreeSessionEditorPanel.kt`: simplify `SessionRow` (drop timestamp + deleting branches, add
   `deleting`); add panel `confirm` seam + `confirmDelete`; route `onCell`/`deleteSelected` through it;
   drop the `open` deleting guard.
9. `WorktreeController.kt`: add `deleting` set + `isDeleting`; wire optimistic deleting into `remove`.
10. `AgentManagerPanel.kt`: `WorktreeRow.deleting`; build `ActiveListDeleteOptions`; use
    `list.confirmDelete`; add `isDeleting` guard; drop `showWorktreeDeletePopup` import.
11. Tests (below).
12. Run validation checks.

## Tests

- **New `ui/list/ActiveListDeletePopupTest.kt`** (`BasePlatformTestCase`): drive `activeListDeleteContent`
  (not a live balloon). Assert: (a) no gate → Delete button enabled, click → `onConfirm(false)` +
  `hide` called; (b) gate set → Delete disabled until the `JBCheckBox` is selected, then enabled,
  click → `onConfirm(true)`. Locate the button/checkbox by walking the returned component tree.
- **Optional `ui/list/ActiveListRendererTest.kt`** (or fold into the panel test): a `deleting` item
  renders "Deleting…" in the trailing label, hides badges/cells, and mutes the title; a non-deleting
  item renders its own trailing/badges/cells. This is the canonical home for the generic behavior now
  that `SessionRow` no longer encodes it.
- **`WorktreeSessionEditorPanelTest.kt`**:
  - `test session rows match history visuals`: remove the `row.trailing == HistoryTime.relative(...)`
    assertion; keep title/badges/section assertions. Add that `row.trailing` is null/blank.
  - `test deleting row shows deleting state`: assert `row.deleting == true` (the row no longer
    overrides trailing/badges/cells/muted — those are renderer concerns, covered by the renderer test).
  - `FakeManager`: remove the `confirm = { _, _, _ -> true }` arg. Construct the panel with an
    auto-confirming seam: `confirm = { _, _, run -> run() }` so `deleteSelected()`/`onCell` still reach
    `manager.deleteSessions(ids)`. The existing multi-select / skip-deleting assertions then hold.
  - `test row click ignores deleting session`: still valid (view suppression); keep.
- **`WorktreeSessionEditorManagerTest.kt`**:
  - Remove the `confirm` seam usage, the `confirms` counter, and `assertEquals(1, confirms)` in
    `test deleting shown session removes it and falls back to next session`. Other delete tests
    (`marks session deleting then removes on success`, `failure reverts row and notifies`) call
    `deleteSessions` directly and remain valid.
- **`WorktreeControllerTest.kt`**: add coverage for the new deleting state:
  - `test remove marks the row deleting until it resolves`: gate the remove RPC (existing
    `FakeWorktreeRpcApi` gating pattern like `beforeCreate`; add a `beforeRemove` gate if none exists),
    assert `isDeleting(id)` true while in flight and false after success + row removed.
  - `test failed remove clears deleting and keeps the row`: with `removeResult` returning locked/error,
    assert `isDeleting(id)` false afterwards and the row still present (extends the existing failure test).
- **`AgentManagerPanelTest.kt`**: existing tests drive `controller.remove` directly and stay green; no
  balloon interaction needed. Optionally assert a `WorktreeRow` reports `deleting` while a gated remove
  is in flight.

## Failure modes / risks

- **Removing `muted`**: only `SessionRow` + the renderer + one panel test reference it; grep confirms no
  other consumers. Replace all with `deleting`.
- **Async confirmation vs. tests**: the session panel's balloon is injected behind a `confirm` seam so
  tests confirm synchronously; production uses the real balloon. `AgentManagerPanel` keeps calling the
  shared popup directly (its tests bypass via `controller.remove`), matching current structure.
- **Worktree deleting re-render**: `CollectionListModel.contentsChanged(T)` must fire a `ListDataEvent`
  so `AgentManagerPanel.sync()` rebuilds rows; if that method isn't accessible use `allContentsChanged()`
  (selection is preserved by key via `PreserveNoScroll`).
- **Double-delete**: `remove` early-returns for ids already in `deleting`; the view + hidden cell also
  prevent re-triggering.
- **Switch-away fallback**: `WorktreeSessionEditorManager.latest()` already excludes `deleting`; unchanged.
- **EDT discipline**: all `deleting` mutations and model changes happen on EDT; RPC stays off-EDT and
  marshals back via the existing `edt {}` helpers.

## Validation

From `packages/kilo-jetbrains/`:
- `./gradlew :frontend:test --tests "ai.kilocode.client.ui.list.*" --tests "ai.kilocode.client.agentManager.*" --tests "ai.kilocode.client.agentManager.worktree.*"`
- `./gradlew typecheck`
- Manual smoke (optional): session list has no per-row time but keeps Today/Yesterday headers;
  deleting a session/worktree shows the balloon confirm, then a muted "Deleting…" row that disappears
  on success or reverts (with notification) on failure.

## Out of scope

- Sidebar `HistoryPanel` styling and the older `HistoryListRenderer` timestamp column.
- Changing worktree/session delete telemetry or RPC contracts.
- Localizing the new `common.deleting` / session detail strings into `KiloBundle_*.properties`.

## Open questions

None blocking.
