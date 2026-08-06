# JetBrains Agent Manager: worktree list follows the selected editor tab

## Goal

Make the Agent Manager worktree list selection a live projection of the currently
**selected editor tab**:

- When the selected editor tab is a worktree editor, select that worktree's row.
- When the selected editor tab is anything else (or there is no editor), the list has **no** selection.
- Keep the "which editor belongs to which worktree" decision **pluggable** so future editor kinds
  (e.g. a worktree diff view) can contribute matches. For now only the worktree **session** editor
  is recognized.

Decision (confirmed with user): track the *selected editor tab* via
`FileEditorManagerListener.selectionChanged`, not raw window focus. The row stays highlighted while
the user interacts with the Agent Manager tool window and only clears when the selected editor tab
switches to a non-worktree file. This is the canonical platform API (all callbacks fire on EDT), no
hacks.

## Constraints / context

- All code lives in `packages/kilo-jetbrains/` (frontend module), which is entirely Kilo-owned — **no
  `kilocode_change` markers needed** and the opencode annotation check does not apply.
- `WorktreeDto.id == WorktreeDto.path` (absolute path is the stable key). The worktree session editor
  stores that path in `KiloPath.params["path"]` for kind `WorktreeSessionEditorKind.ID`.
- EDT-only: `FileEditorManagerListener` callbacks are on EDT; `ActiveList` mutations require EDT.
- Existing `AgentManagerPanel.selected: String?` already holds the selected worktree key and
  `sync()` re-applies it after every model replace.

## Affected / new files

1. **New** `frontend/.../client/agentManager/worktree/WorktreeEditorMatcher.kt`
   - Pluggable matcher interface, its project-level registry service, and the default session matcher.
2. **Edit** `frontend/.../client/ui/list/ActiveList.kt` and `ActiveListView.kt`
   - Add a public `clearSelection()` so the panel can express "no selection".
3. **Edit** `frontend/.../client/agentManager/AgentManagerPanel.kt`
   - Register the default matcher, subscribe to editor-selection changes, drive list selection.
4. **Edit** `frontend/.../client/agentManager/AgentManagerPanelTest.kt`
   - Add coverage for tab-selection tracking, clearing, and matcher pluggability.

## Design

### 1. Pluggable matcher (`WorktreeEditorMatcher.kt`)

```kotlin
package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.vfs.KiloVirtualFile
import com.intellij.openapi.components.Service
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Resolves the worktree path an editor file belongs to, or null when the file is not a worktree
 * editor. Pluggable so future editor kinds (e.g. a worktree diff view) can contribute matches.
 */
fun interface WorktreeEditorMatcher {
    @RequiresEdt
    fun match(file: VirtualFile): String?
}

/** Project-level registry of [WorktreeEditorMatcher]s consulted in registration order. */
@Service(Service.Level.PROJECT)
class WorktreeEditorMatchers {
    private val matchers = CopyOnWriteArrayList<WorktreeEditorMatcher>()

    fun register(matcher: WorktreeEditorMatcher) {
        matchers.addIfAbsent(matcher)
    }

    @RequiresEdt
    fun match(file: VirtualFile?): String? {
        if (file == null) return null
        return matchers.firstNotNullOfOrNull { it.match(file) }
    }
}

/** Default matcher: the worktree session editor tab. */
object WorktreeSessionEditorMatcher : WorktreeEditorMatcher {
    override fun match(file: VirtualFile): String? {
        val kilo = file as? KiloVirtualFile ?: return null
        if (kilo.path.kind != WorktreeSessionEditorKind.ID) return null
        return kilo.path.params["path"]?.takeIf { it.isNotBlank() }
    }
}
```

Notes:
- Project-level registry: gives a fresh instance per project (no cross-test leakage) and matches
  where future project-scoped matchers (diff editors) will need to look up worktree paths.
- The default matcher is a stateless singleton `object`; `addIfAbsent` makes registration idempotent.

### 2. `ActiveList` / `ActiveListView` — expose `clearSelection()`

`ActiveListView` already calls `list.clearSelection()` internally; expose it:

```kotlin
// ActiveListView
@RequiresEdt
fun clearSelection() {
    checkEdt()
    list.clearSelection()
}
```

```kotlin
// ActiveList
@RequiresEdt
fun clearSelection() = view.clearSelection()
```

### 3. `AgentManagerPanel`

Imports to add: `com.intellij.openapi.fileEditor.FileEditorManagerEvent`,
`com.intellij.openapi.fileEditor.FileEditorManagerListener`,
`com.intellij.openapi.vfs.VirtualFile`, and the new
`ai.kilocode.client.agentManager.worktree.WorktreeEditorMatcher` / `WorktreeEditorMatchers` /
`WorktreeSessionEditorMatcher`.

In `init` (only when `project != null`):
- Register the default matcher: `project.service<WorktreeEditorMatchers>().register(WorktreeSessionEditorMatcher)`.
- Subscribe to editor selection and seed the initial state:

```kotlin
project?.let { p ->
    p.service<WorktreeEditorMatchers>().register(WorktreeSessionEditorMatcher)
    p.messageBus.connect(this).subscribe(
        FileEditorManagerListener.FILE_EDITOR_MANAGER,
        object : FileEditorManagerListener {
            override fun selectionChanged(event: FileEditorManagerEvent) = track(event.newFile)
        },
    )
    track(FileEditorManager.getInstance(p).selectedFiles.firstOrNull())
}
```

Add the tracking helper (source of truth = active editor tab):

```kotlin
@RequiresEdt
private fun track(file: VirtualFile?) {
    val key = project?.let { it.service<WorktreeEditorMatchers>().match(file) }
    selected = key
    if (key == null || !list.select(key, scroll = false)) list.clearSelection()
}
```

Update `sync()` so "no selection" is sticky across model replaces:

```kotlin
private fun sync() {
    val key = selected
    list.update( /* unchanged rows */, ActiveListSelection.PreserveNoScroll)
    if (key != null) list.select(key, scroll = false) else list.clearSelection()
}
```

Replace `activeWorktreeKey()` (which scanned *all* open worktree editors) and rewire `refresh()` to
use the active editor tab via the matcher:

```kotlin
fun refresh() {
    selected = currentEditorWorktree()
    controller.reload()
}

private fun currentEditorWorktree(): String? {
    val p = project ?: return null
    return p.service<WorktreeEditorMatchers>().match(
        FileEditorManager.getInstance(p).selectedFiles.firstOrNull(),
    )
}
```

Delete the old `activeWorktreeKey()` method (its `KiloVirtualFile`-scanning logic now lives in
`WorktreeSessionEditorMatcher`; drop the now-unused `KiloVirtualFile` import if nothing else uses it).

### Behavior / interaction notes

- Clicking a list row calls `onOpen -> open(item, focus=false)`, which selects that editor tab and
  fires `selectionChanged`; `track` then re-selects the same row (no loop, `selected` unchanged).
- `controller.onSelect` (create/quick-create flow) still selects+focuses the freshly created row; the
  subsequent editor open re-affirms the same selection.
- Focusing the Agent Manager tool window does **not** fire `selectionChanged`, so the row stays
  highlighted — matching the requirement.
- Switching to a normal code file fires `selectionChanged(newFile = code file)` → matcher returns
  null → `clearSelection()`.

## Validation

From `packages/kilo-jetbrains/`:
- `./gradlew typecheck`
- `./gradlew test` (or targeted: the `AgentManagerPanelTest` class).

Add tests to `AgentManagerPanelTest` (extends `BasePlatformTestCase`, uses the existing `edt`/`flush`
helpers and `myFixture` for real files):

1. **Selecting a worktree editor tab selects its row** — with the panel + a loaded worktree, open the
   worktree session editor via `project.service<KiloVfsManager>().open(...)` (focus=true); assert
   `list.selectedValue.key == worktree.id`.
2. **Selecting a non-worktree editor clears the row** — after (1), open a normal file
   (`myFixture.addFileToProject(...)` + `FileEditorManager.getInstance(project).openFile(vf, true)`);
   assert `list.selectedIndex == -1`.
3. **No selection when the active tab isn't a worktree on open** — with a normal file already the
   selected editor, create the panel + reload; assert `list.selectedIndex == -1`.
4. **Matcher pluggability** — register a custom `WorktreeEditorMatcher` on
   `project.service<WorktreeEditorMatchers>()` that maps a normal file's path to a worktree path
   present in the list; open that normal file; assert the corresponding row becomes selected. Proves
   the pluggable check drives selection for a non-session editor.

Confirm the existing `test refresh selects active worktree editor` still passes (it opens the
worktree editor with focus, so it remains the active tab and resolves via the matcher).

## Out of scope

- Implementing a worktree **diff** editor matcher (only the interface + registry are added now).
- Any backend/RPC changes — this is a frontend-only interaction change.
- Multi-split "which split wins" refinements beyond `selectedFiles.first()` / `event.newFile`.
