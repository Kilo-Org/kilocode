# Worktree Side Panel — Iteration 1 Plan

Scope: add a `[ Branch | Worktrees ]` switch to the top of the Kilo tool window side
panel. **Branch** keeps the current chat/session UI unchanged. **Worktrees** shows a
simple list of the repo's git worktrees (name only) with a `+` to create and a
selection-only **Delete** action; no History button, keep Settings.

This is the JetBrains counterpart of the VS Code Agent Manager, cut down to the minimum.
Everything lives in `packages/kilo-jetbrains/` (Kilo-owned — no `kilocode_change` markers).

## Guiding facts (already verified in the codebase)

- The side panel is built in `KiloToolWindowFactory.kt` → `KiloToolWindowSetupService.setup()`,
  which creates `SessionSidePanelManager(project, workspace)` and calls
  `toolWindow.setTitleActions([NewSession, History, Settings])`.
- `SessionSidePanelManager.component` is a `JPanel(BorderLayout)` implementing `DataProvider`
  and exposes `SessionManager.KEY` / `SessionManager.WORKSPACE_KEY`.
- The list + renderer + delete-on-selection pattern to mirror is the History stack:
  `session/history/HistoryModel.kt`, `HistoryListRenderer.kt` (`del.icon` shown only when
  `selected`; `isDeleteClick(list, bounds, point)`; `DELETE_AREA_WIDTH = 32`),
  `HistoryPanel.kt` (JBList + JBScrollPane + MouseAdapter + confirm dialog + theme),
  `HistoryController.kt` (RPC on a coroutine scope + `edt {}` helper + telemetry).
- RPC pattern: `@Rpc interface … : RemoteApi<Unit>` + `@Serializable` DTOs in `shared/`,
  backend `*Impl` + `*Provider : RemoteApiProvider` registered in
  `backend/src/main/resources/kilo.jetbrains.backend.xml`, frontend `@Service(Level.APP)`
  wrapper using `durable {}` / a `call {}` helper (see `KiloWorkspaceService.kt`).
- **Git runs as a subprocess in the backend already.** `KiloWorkspaceRpcApiImpl.kt` has
  `runWorkspaceGit(base, *args)` using `GeneralCommandLine` + `CapturingProcessHandler`
  (used for `git diff` / `git rev-parse`). Reuse this approach. **Do NOT add git4idea or
  any bundled plugin dependency** — the subprocess path is already established and keeps the
  diff from upstream and the dependency graph unchanged.

Follow `packages/kilo-jetbrains/AGENTS.md`: Swing on EDT only (`@RequiresEdt`), light
services, injected coroutine scopes, JBList/JBLabel/JBScrollPane/JBUI + theme colors,
`KiloBundle` strings. No Kotlin UI DSL, no Compose, no JCEF.

## Out of scope for iteration 1

Per-worktree sessions/chat, opening a worktree into a session, grouping/sections, PR badges,
setup scripts, terminals, multi-version worktrees, diff/review, and any
`.kilo/agent-manager.json` persistence. Git is the source of truth for the list.

---

## Phase 1 — Shared DTOs + RPC contract

**New** `shared/src/main/kotlin/ai/kilocode/rpc/dto/WorktreeDto.kt`

```kotlin
package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class WorktreeDto(
    val id: String,      // stable key = absolute path
    val name: String,    // display name (last path segment)
    val branch: String,  // "feature/x" or "(detached)"
    val path: String,    // absolute worktree path
    val main: Boolean = false,   // primary working tree — not deletable
)

@Serializable
data class WorktreeListDto(val worktrees: List<WorktreeDto> = emptyList())

@Serializable
data class CreateWorktreeRequestDto(
    val branch: String,
    val baseBranch: String? = null,
)

@Serializable
data class CreateWorktreeResultDto(
    val worktree: WorktreeDto? = null,
    val error: String? = null,
)
```

**New** `shared/src/main/kotlin/ai/kilocode/rpc/KiloWorktreeRpcApi.kt` (structure copied from
`KiloWorkspaceRpcApi.kt`)

```kotlin
package ai.kilocode.rpc

import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeListDto
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor

@Rpc
interface KiloWorktreeRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloWorktreeRpcApi =
            RemoteApiProviderService.resolve(remoteApiDescriptor<KiloWorktreeRpcApi>())
    }

    suspend fun list(directory: String): WorktreeListDto
    suspend fun create(directory: String, request: CreateWorktreeRequestDto): CreateWorktreeResultDto
    suspend fun remove(directory: String, path: String, branch: String? = null)
}
```

Checkpoint: `./gradlew :shared:compileKotlin`.

## Phase 2 — Backend RPC implementation (git subprocess)

**New** `backend/src/main/kotlin/ai/kilocode/backend/rpc/KiloWorktreeRpcApiImpl.kt`

```kotlin
package ai.kilocode.backend.rpc

import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreeListDto
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.nio.file.Files
import java.nio.file.Path

class KiloWorktreeRpcApiImpl : KiloWorktreeRpcApi {

    override suspend fun list(directory: String): WorktreeListDto = withContext(Dispatchers.IO) {
        val base = Path.of(directory).normalize()
        val res = runGit(base, "worktree", "list", "--porcelain")
        if (!res.ok) WorktreeListDto() else WorktreeListDto(parseWorktreeList(res.stdout))
    }

    override suspend fun create(directory: String, request: CreateWorktreeRequestDto): CreateWorktreeResultDto =
        withContext(Dispatchers.IO) {
            val base = Path.of(directory).normalize()
            val branch = request.branch.trim()
            if (branch.isEmpty()) return@withContext CreateWorktreeResultDto(error = "Branch name is required")
            val dir = base.resolve(".kilo").resolve("worktrees").resolve(branch.replace('/', '-'))
            Files.createDirectories(dir.parent)
            val args = buildList {
                addAll(listOf("worktree", "add", "-b", branch, dir.toString()))
                request.baseBranch?.trim()?.takeIf { it.isNotEmpty() }?.let { add(it) }
            }
            val res = runGit(base, *args.toTypedArray())
            if (!res.ok) CreateWorktreeResultDto(error = res.stderr.ifBlank { "git worktree add failed" })
            else CreateWorktreeResultDto(
                worktree = WorktreeDto(dir.toString(), dir.fileName.toString(), branch, dir.toString()),
            )
        }

    override suspend fun remove(directory: String, path: String, branch: String?) = withContext(Dispatchers.IO) {
        val base = Path.of(directory).normalize()
        runGit(base, "worktree", "remove", "--force", path)
        branch?.trim()?.takeIf { it.isNotEmpty() }?.let { runGit(base, "branch", "-D", it) }
        Unit
    }

    private data class GitResult(val exit: Int, val stdout: String, val stderr: String) {
        val ok get() = exit == 0
    }

    private fun runGit(base: Path, vararg args: String): GitResult {
        return try {
            val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(base.toFile())
            val out = CapturingProcessHandler(cmd).runProcess(30_000)
            GitResult(if (out.isTimeout) -1 else out.exitCode, out.stdout, out.stderr)
        } catch (e: Exception) {
            GitResult(-1, "", e.message ?: "git failed")
        }
    }
}

/** Parse `git worktree list --porcelain`. First entry is the main working tree. */
internal fun parseWorktreeList(raw: String): List<WorktreeDto> {
    val out = mutableListOf<WorktreeDto>()
    var path: String? = null
    var branch = "(detached)"
    var first = true
    fun flush() {
        val p = path ?: return
        val name = p.substringAfterLast('/').ifBlank { p }
        out.add(WorktreeDto(p, name, branch, p, main = first))
        first = false
        path = null
        branch = "(detached)"
    }
    for (line in raw.lines()) {
        when {
            line.startsWith("worktree ") -> { flush(); path = line.removePrefix("worktree ").trim() }
            line.startsWith("branch ") -> branch = line.removePrefix("branch ").trim().removePrefix("refs/heads/")
            line.isBlank() -> flush()
        }
    }
    flush()
    return out
}
```

**New** `backend/.../rpc/KiloWorktreeRpcApiProvider.kt` (copy `KiloProviderRpcApiProvider.kt`,
swap types)

```kotlin
@file:Suppress("UnstableApiUsage")
package ai.kilocode.backend.rpc

import ai.kilocode.rpc.KiloWorktreeRpcApi
import com.intellij.platform.rpc.backend.RemoteApiProvider
import fleet.rpc.remoteApiDescriptor

internal class KiloWorktreeRpcApiProvider : RemoteApiProvider {
    override fun RemoteApiProvider.Sink.remoteApis() {
        remoteApi(remoteApiDescriptor<KiloWorktreeRpcApi>()) { KiloWorktreeRpcApiImpl() }
    }
}
```

**Edit** `backend/src/main/resources/kilo.jetbrains.backend.xml` — add inside `<extensions>`:

```xml
<platform.rpc.backend.remoteApiProvider implementation="ai.kilocode.backend.rpc.KiloWorktreeRpcApiProvider"/>
```

Checkpoint: `./gradlew :backend:compileKotlin`.

## Phase 3 — Frontend RPC service (light service)

**New** `frontend/src/main/kotlin/ai/kilocode/client/worktree/KiloWorktreeService.kt`
(mirror `KiloWorkspaceService` `call {}` / `durable {}`; light `@Service(Level.APP)`, no XML)

```kotlin
@file:Suppress("UnstableApiUsage")
package ai.kilocode.client.worktree

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeListDto
import com.intellij.openapi.components.Service
import fleet.rpc.client.durable
import kotlinx.coroutines.CoroutineScope

@Service(Service.Level.APP)
class KiloWorktreeService internal constructor(
    private val cs: CoroutineScope,
    private val rpc: KiloWorktreeRpcApi?,
) {
    constructor(cs: CoroutineScope) : this(cs, null)

    companion object { private val LOG = KiloLog.create(KiloWorktreeService::class.java) }

    private suspend fun <T> call(block: suspend KiloWorktreeRpcApi.() -> T): T {
        val api = rpc
        return if (api != null) block(api) else durable { block(KiloWorktreeRpcApi.getInstance()) }
    }

    suspend fun list(directory: String): WorktreeListDto = try {
        call { list(directory) }
    } catch (e: Exception) { LOG.warn("worktree list failed for $directory", e); WorktreeListDto() }

    suspend fun create(directory: String, req: CreateWorktreeRequestDto): CreateWorktreeResultDto =
        call { create(directory, req) }

    suspend fun remove(directory: String, path: String, branch: String?) {
        call { remove(directory, path, branch) }
    }
}
```

## Phase 4 — Worktree list UI (mirror the History stack)

Create under `frontend/.../worktree/`. Copy row/delete/mouse/theme patterns from
`session/history/HistoryModel.kt`, `HistoryListRenderer.kt`, `HistoryPanel.kt`.

1. **`WorktreeController.kt`** — owns a `com.intellij.ui.CollectionListModel<WorktreeDto>`,
   an injected `CoroutineScope`, and `service<KiloWorktreeService>()`. Methods `reload()`,
   `create(branch, base)`, `remove(dto)`. Mutate the model on the EDT via an `edt {}` helper
   (copy the one at the bottom of `HistoryController.kt`). Emit
   `Telemetry.send("Worktree List Loaded" / "Worktree Created" / "Worktree Deleted", …)`.

2. **`WorktreeRenderer.kt`** — `JPanel(BorderLayout), ListCellRenderer<WorktreeDto>`.
   Left: name (`SimpleColoredComponent`/`JBLabel`) with branch in
   `SimpleTextAttributes.GRAYED_ATTRIBUTES`. Trailing delete strip: copy `HistoryRenderer`'s
   `del` label + `companion object { isDeleteClick(list, bounds, point) }` + `DELETE_AREA_WIDTH`.
   Show `AllIcons.Actions.GC` only when `selected && !value.main`, else `EmptyIcon`. Colors from
   `UIUtil.getListForeground/Background(selected, focused)`.

3. **`WorktreePanel.kt`** — `BorderLayoutPanel` with `JBList(model)` in a `JBScrollPane`. Wire:
   - `emptyText.text = KiloBundle.message("worktree.empty")`, `cursor = HAND_CURSOR`,
     `ScrollingUtil.installActions(list)`.
   - `MouseAdapter.mouseClicked`: resolve row via `locationToIndex`/`getCellBounds`; if
     `WorktreeRenderer.isDeleteClick(...)` and `!item.main` → confirm via
     `Messages.showYesNoDialog(...)` then `controller.remove(item)`.
   - `bindTheme()` via `LafManagerListener.TOPIC` (copy from `HistoryPanel`).
   - `fun requestCreate()` → `Messages.showInputDialog(...)` for the branch name; if non-blank
     call `controller.create(name, null)`.
   - `val component: JComponent get() = this`; `fun refresh() = controller.reload()`.

## Phase 5 — Mode switch + mode-aware title actions

Use **`JBTabs`** as the switch (already used in `HistoryPanel`): two tabs `Branch` /
`Worktrees` hosting the two components — this is the `[ Branch | Worktrees ]` control.

**New** `frontend/.../worktree/SidePanelKeys.kt`

```kotlin
package ai.kilocode.client.worktree

import com.intellij.openapi.actionSystem.DataKey

enum class SidePanelMode { BRANCH, WORKTREES }

object SidePanelKeys {
    val MODE: DataKey<SidePanelMode> = DataKey.create("kilo.sidePanel.mode")
    val WORKTREE_PANEL: DataKey<WorktreePanel> = DataKey.create("kilo.sidePanel.worktreePanel")
}
```

**Edit** `KiloToolWindowFactory.kt` `setup()` — replace the direct `manager.component` content
with a root `JPanel(BorderLayout)` implementing `DataProvider` that hosts a `JBTabs` with the
two tabs. The root:
- delegates `SessionManager.KEY` / `WORKSPACE_KEY` to `manager` (keeps existing session
  actions working),
- returns `SidePanelKeys.MODE` from the selected tab,
- returns `SidePanelKeys.WORKTREE_PANEL` = the worktree panel.
Add a `TabsListener.selectionChanged` that calls `worktreePanel.refresh()` when the Worktrees
tab is selected. Keep `content.setPreferredFocusedComponent { manager.defaultFocusedComponent }`.
Keep `toolWindow.setTitleActions(...)`; visibility is per-action below.

**Edit** `NewSessionAction.update` and `HistoryAction.update` — add:

```kotlin
e.presentation.isVisible = e.getData(SidePanelKeys.MODE) != SidePanelMode.WORKTREES
```

(Default visible when the key is null so other surfaces are unaffected.)

**New** `frontend/.../actions/NewWorktreeAction.kt` (icon `AllIcons.General.Add`)

```kotlin
override fun update(e: AnActionEvent) {
    e.presentation.isVisible = e.getData(SidePanelKeys.MODE) == SidePanelMode.WORKTREES
    e.presentation.isEnabled = e.getData(SidePanelKeys.WORKTREE_PANEL) != null
}
override fun actionPerformed(e: AnActionEvent) {
    e.getData(SidePanelKeys.WORKTREE_PANEL)?.requestCreate()
}
```

**Edit** `kilo.jetbrains.frontend.xml` — register the action and add to the toolbar group:

```xml
<action id="Kilo.NewWorktree" class="ai.kilocode.client.actions.NewWorktreeAction"/>
```

Inside `<group id="Kilo.ToolWindowToolbar">` add `<reference ref="Kilo.NewWorktree"/>` after
`Kilo.NewSession`. `Kilo.Settings` stays; `Kilo.History` becomes branch-only via its `update()`.

## Phase 6 — i18n strings

**Edit** `frontend/src/main/resources/messages/KiloBundle.properties`:

```
action.Kilo.NewWorktree.text=New Worktree
action.Kilo.NewWorktree.description=Create a new git worktree
sidePanel.mode.branch=Branch
sidePanel.mode.worktrees=Worktrees
worktree.empty=No worktrees
worktree.delete.confirm.title=Delete Worktree
worktree.delete.confirm.message=Delete worktree "{0}"? This removes the working tree and its branch.
worktree.create.prompt=New branch name
worktree.create.title=New Worktree
```

Use `KiloBundle.message(...)` for every user-visible string.

## Phase 7 — Tests

- `backend/src/test/.../rpc/KiloWorktreeRpcApiImplTest.kt`: create a temp git repo
  (`git init` + initial commit), `create` → assert dir + branch exist and `list` returns it,
  `remove` → assert it's gone. Unit-test `parseWorktreeList` against sample porcelain output.
  Deterministic waits only (no sleeps), per `AGENTS.md`.
- Frontend `BasePlatformTestCase` test with a fake `KiloWorktreeRpcApi`: `reload()` populates
  the model, `create`/`remove` invoke the RPC, and the renderer shows the delete icon only when
  a row is selected and `!main`.

## Phase 8 — Verify

From `packages/kilo-jetbrains/`:

```
./gradlew typecheck
./gradlew test
```

Manual smoke (`./gradlew runIde`): open the Kilo tool window, toggle `Branch`/`Worktrees`.
Branch → chat with New Session + History + Settings. Worktrees → list with `+` + Settings,
no History; selecting a non-main row reveals Delete; create/delete update the list.

## Guardrails

- All code inside `packages/kilo-jetbrains/`; no `kilocode_change` markers.
- Reuse the `GeneralCommandLine` + `CapturingProcessHandler` git subprocess pattern; do **not**
  add git4idea or any bundled plugin dependency.
- Do **not** port VS Code Agent Manager machinery (sections, PR, setup scripts, terminals,
  multi-version, diff, persistence).
- Swing on EDT only (`@RequiresEdt`); RPC/git off-EDT in coroutines; light services; injected
  scopes.
- JBList/JBLabel/JBScrollPane/JBUI + theme colors; no raw `Color`/`Dimension`/`EmptyBorder`;
  no UI DSL / Compose / JCEF. Single-word names; `const`/early-return; no empty catches.
