package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.agentManager.worktree.CreateFailure
import ai.kilocode.client.agentManager.worktree.CreateKind
import ai.kilocode.client.agentManager.worktree.KiloWorktreeService
import ai.kilocode.client.agentManager.worktree.WorktreeController
import ai.kilocode.client.agentManager.worktree.PendingPrompt
import ai.kilocode.client.agentManager.worktree.PendingWorktreePrompt
import ai.kilocode.client.agentManager.worktree.PendingWorktreeSession
import ai.kilocode.client.agentManager.worktree.WorktreeNameCache
import ai.kilocode.client.agentManager.worktree.WorktreeNames
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.MoveProgressDto
import ai.kilocode.rpc.dto.MoveStage
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.util.IconLoader
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.GraphicsEnvironment
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

@Suppress("UnstableApiUsage")
class WorktreeControllerTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeWorktreeRpcApi
    private lateinit var service: KiloWorktreeService

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        rpc = FakeWorktreeRpcApi()
        service = KiloWorktreeService(coroutines.scope, rpc)
    }

    override fun tearDown() {
        try {
            cache().clear()
            coroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    fun `test reload lists only non-main worktrees`() {
        rpc.listed += WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val controller = controller()

        controller.reload()
        flush()

        assertEquals(1, controller.model.size)
        assertEquals("feature/x", controller.model.getElementAt(0).branch)
        assertEquals("/repo", controller.current?.path)
    }

    fun `test service open routes the directory to the backend rpc`() {
        var result: Boolean? = null
        coroutines.scope.launch { result = service.open("/repo/.kilo/worktrees/feature-x") }
        flush()

        assertEquals(true, result)
        assertEquals(listOf("/repo/.kilo/worktrees/feature-x"), rpc.opens.toList())
    }

    fun `test service open returns false when the backend call fails`() {
        rpc.openResult = { error("boom") }
        var result: Boolean? = null
        coroutines.scope.launch { result = service.open("/repo/x") }
        flush()

        assertEquals(false, result)
    }

    fun `test create invokes rpc and adds the created worktree`() {
        val controller = controller()
        val selected = mutableListOf<String>()
        controller.onSelect = { selected.add(it) }

        ApplicationManager.getApplication().invokeAndWait { controller.create("feature/y", null) }

        assertEquals(1, controller.model.size)
        assertTrue(controller.isPending(controller.model.getElementAt(0).id))
        assertEquals(controller.model.getElementAt(0).id, selected.single())
        flush()

        assertEquals(listOf("feature/y"), rpc.creates.map { it.branch })
        assertEquals(1, controller.model.size)
        assertEquals("feature/y", controller.model.getElementAt(0).branch)
        assertFalse(controller.isPending(controller.model.getElementAt(0).id))
        assertEquals("feature/y", selected.last())
    }

    fun `test create prepends placeholder and created worktree`() {
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val gate = CompletableDeferred<Unit>()
        rpc.beforeCreate = { gate.await() }
        val controller = controller()
        controller.reload()
        flush()

        ApplicationManager.getApplication().invokeAndWait { controller.create("feature/y", null) }

        assertEquals("feature/y", controller.model.getElementAt(0).branch)
        assertTrue(controller.isPending(controller.model.getElementAt(0).id))
        gate.complete(Unit)
        flush()

        assertEquals("feature/y", controller.model.getElementAt(0).branch)
        assertFalse(controller.isPending(controller.model.getElementAt(0).id))
    }

    fun `test created worktrees are announced once they exist`() {
        val controller = controller()
        val created = mutableListOf<WorktreeDto>()
        controller.onCreated = { created.add(it) }

        ApplicationManager.getApplication().invokeAndWait { controller.create("feature/y", null) }
        // Nothing exists on disk while the create is still pending.
        assertEquals(emptyList<WorktreeDto>(), created)
        flush()

        assertEquals(listOf("feature/y"), created.map { it.branch })
    }

    fun `test a failed create announces nothing`() {
        rpc.createResult = { CreateWorktreeResultDto(error = "boom") }
        val controller = controller()
        val created = mutableListOf<WorktreeDto>()
        controller.onCreated = { created.add(it) }

        ApplicationManager.getApplication().invokeAndWait { controller.create("feature/y", null) }
        flush()

        assertEquals(emptyList<WorktreeDto>(), created)
    }

    fun `test create failure removes placeholder and reports the error`() {
        rpc.createResult = { CreateWorktreeResultDto(error = "boom") }
        val controller = controller()
        val failures = mutableListOf<CreateFailure>()
        controller.onCreateFailure = { failures.add(it) }

        ApplicationManager.getApplication().invokeAndWait { controller.create("feature/y", null) }
        val id = controller.model.getElementAt(0).id
        assertTrue(controller.isPending(id))
        flush()

        assertEquals(0, controller.model.size)
        assertFalse(controller.isPending(id))
        assertEquals(listOf(CreateFailure("boom", CreateKind.CREATE, "feature/y")), failures)
    }

    fun `test reload preserves pending worktrees`() {
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val gate = CompletableDeferred<Unit>()
        rpc.beforeCreate = { gate.await() }
        val controller = controller()

        ApplicationManager.getApplication().invokeAndWait { controller.create("feature/y", null) }
        val id = controller.model.getElementAt(0).id
        controller.reload()
        flush()

        assertEquals(listOf("feature/y", "feature/x"), (0 until controller.model.size).map { controller.model.getElementAt(it).branch })
        assertTrue(controller.isPending(id))
        gate.complete(Unit)
        flush()
    }

    fun `test remove invokes rpc and removes from the model`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        val controller = controller()
        controller.reload()
        flush()

        var success = false
        val removed = mutableListOf<WorktreeDto>()
        controller.onRemoveSuccess = { dto, _ -> removed.add(dto) }
        controller.remove(controller.model.getElementAt(0), onSuccess = { success = true })
        flush()

        assertEquals(listOf(Triple("/test", item.path, "feature/x")), rpc.removes.toList())
        assertEquals(0, controller.model.size)
        assertTrue(success)
        assertEquals(listOf(item), removed)
    }

    fun `test remove marks the row deleting until it resolves`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val gate = CompletableDeferred<Unit>()
        rpc.listed += item
        rpc.beforeRemove = { gate.await() }
        val controller = controller()
        controller.reload()
        flush()

        controller.remove(controller.model.getElementAt(0))

        assertEquals(KiloBundle.message("common.deleting"), controller.progress(item.id))
        assertEquals(1, controller.model.size)

        gate.complete(Unit)
        flush()

        assertNull(controller.progress(item.id))
        assertEquals(0, controller.model.size)
    }

    fun `test failed remove keeps the row and invokes the failure callback`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        rpc.removeResult = { _, _, _ -> RemoveWorktreeResultDto(error = "cannot remove a locked working tree", locked = true) }
        val controller = controller()
        controller.reload()
        flush()

        val failures = mutableListOf<RemoveWorktreeResultDto>()
        controller.remove(controller.model.getElementAt(0), onFailure = { failures.add(it) })
        flush()

        // git rejected the removal, so the entry must remain instead of vanishing optimistically.
        assertEquals(1, controller.model.size)
        assertEquals("feature/x", controller.model.getElementAt(0).branch)
        assertNull(controller.progress(item.id))
        assertEquals(1, failures.size)
        assertTrue(failures.first().locked)
    }

    fun `test refused nested remove keeps the row and surfaces the error`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        rpc.removeResult = { _, _, _ -> RemoveWorktreeResultDto(error = "Delete nested worktrees first:\n/repo/.kilo/worktrees/feature-x/.kilo/worktrees/nested") }
        val controller = controller()
        controller.reload()
        flush()

        val failures = mutableListOf<RemoveWorktreeResultDto>()
        controller.remove(controller.model.getElementAt(0), onFailure = { failures.add(it) })
        flush()

        assertEquals(1, controller.model.size)
        assertEquals("feature/x", controller.model.getElementAt(0).branch)
        assertNull(controller.progress(item.id))
        assertEquals(listOf(false), rpc.removeForces.toList())
        assertEquals("Delete nested worktrees first:\n/repo/.kilo/worktrees/feature-x/.kilo/worktrees/nested", failures.single().error)
    }

    fun `test force remove passes the force flag and drops the row on success`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x", locked = true)
        rpc.listed += item
        val controller = controller()
        controller.reload()
        flush()

        controller.remove(controller.model.getElementAt(0), force = true)
        flush()

        assertEquals(listOf(true), rpc.removeForces.toList())
        assertEquals(0, controller.model.size)
    }

    fun `test rename optimistically updates and keeps successful result`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val gate = CompletableDeferred<Unit>()
        rpc.listed += item
        rpc.beforeRename = { gate.await() }
        val controller = controller()
        controller.reload()
        flush()

        ApplicationManager.getApplication().invokeAndWait { controller.rename(controller.model.getElementAt(0), "Feature Label") }

        assertEquals("Feature Label", controller.model.getElementAt(0).name)
        assertEquals("Feature Label", cache().get(item.path))
        assertTrue(rpc.renames.isEmpty())

        gate.complete(Unit)
        flush()

        assertEquals(listOf(Triple("/test", item.path, "Feature Label")), rpc.renames.toList())
        assertEquals("Feature Label", controller.model.getElementAt(0).name)
        assertEquals("Feature Label", cache().get(item.path))
    }

    fun `test rename failure reverts row and invokes callback`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        rpc.renameResult = { _, _ -> RenameWorktreeResultDto(error = "cannot rename") }
        val failures = mutableListOf<String?>()
        val controller = controller()
        controller.reload()
        flush()

        ApplicationManager.getApplication().invokeAndWait {
            controller.rename(controller.model.getElementAt(0), "Feature Label", onFailure = { failures += it })
        }
        flush()

        assertEquals("feature-x", controller.model.getElementAt(0).name)
        assertEquals(listOf("cannot rename"), failures)
        assertEquals("feature-x", cache().get(item.path))
    }

    fun `test reload derives default branch from the main worktree`() {
        rpc.listed += WorktreeDto("/repo", "repo", "trunk", "/repo", main = true)
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val controller = controller()

        controller.reload()
        flush()

        assertEquals("trunk", controller.defaultBranch)
    }

    fun `test reload caches the local branch list`() {
        rpc.listed += WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        rpc.branchesList += listOf("main", "feature/x", "release/1.0")
        val controller = controller()

        controller.reload()
        flush()

        assertEquals(listOf("main", "feature/x", "release/1.0"), controller.branches)
    }

    fun `test base branches exclude branches checked out in worktrees`() {
        rpc.listed += WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.branchesList += listOf("main", "feature/x", "develop")
        val controller = controller()

        controller.reload()
        flush()

        // main (main worktree branch) stays; feature/x (a worktree branch) is excluded.
        assertEquals(listOf("main", "develop"), controller.branches)
    }

    fun `test quick create generates a friendly name based on the default branch`() {
        rpc.listed += WorktreeDto("/repo", "repo", "trunk", "/repo", main = true)
        val controller = controller()
        controller.reload()
        flush()

        controller.quickCreate()
        flush()

        assertEquals(1, rpc.creates.size)
        val req = rpc.creates.first()
        assertEquals("trunk", req.baseBranch)
        assertTrue("generated '${req.branch}'", req.branch.matches(Regex("[a-z]+-[a-z]+(-\\d+)?")))
        assertEquals(1, controller.model.size)
    }

    fun `test import branch creates a worktree on an existing branch`() {
        val controller = controller()

        ApplicationManager.getApplication().invokeAndWait { controller.importBranch("feature/x") }
        flush()

        val req = rpc.creates.single()
        assertEquals("feature/x", req.branch)
        assertTrue("should check out an existing branch", req.existingBranch)
        assertEquals(1, controller.model.size)
    }

    fun `test import pr creates a worktree from the pr url`() {
        rpc.importPrResult = { CreateWorktreeResultDto(WorktreeDto("/wt/pr-7", "pr-7", "pr-7", "/wt/pr-7")) }
        val controller = controller()

        ApplicationManager.getApplication().invokeAndWait { controller.importPr("https://github.com/o/r/pull/7") }
        flush()

        assertEquals(listOf("https://github.com/o/r/pull/7"), rpc.prImports)
        assertEquals("/wt/pr-7", controller.model.getElementAt(0).path)
    }

    fun `test move adds placeholder tracks progress and swaps to worktree`() {
        val done = WorktreeDto("/wt/moved", "moved", "moved", "/wt/moved")
        rpc.moveScript = listOf(
            MoveProgressDto(MoveStage.CREATING),
            MoveProgressDto(MoveStage.TRANSFERRING),
            MoveProgressDto(MoveStage.FORKING),
            MoveProgressDto(MoveStage.DONE, worktree = done, session = "ses_fork"),
        )
        val selected = mutableListOf<String>()
        val aborts = mutableListOf<Pair<String, String>>()
        val events = mutableListOf<Pair<String, Map<String, String>>>()
        val controller = controller(abort = { id, dir -> aborts += id to dir }, telemetry = { name, props -> events += name to props })
        controller.onSelect = { selected += it }

        ApplicationManager.getApplication().invokeAndWait { controller.move("ses_source", "/repo") }
        val temp = controller.model.getElementAt(0)
        assertTrue(controller.isPending(temp.id))
        assertEquals(KiloBundle.message("worktree.progress.capturing"), controller.progress(temp.id))
        assertEquals(temp.id, selected.single())
        flush()

        assertEquals(listOf("ses_source" to "/repo"), aborts)
        assertEquals("/repo", rpc.moves.single().first)
        assertEquals("ses_source", rpc.moves.single().second)
        assertEquals(done, controller.model.getElementAt(0))
        assertNull(controller.progress(temp.id))
        // The forked session is queued for the editor the selection opens, keyed by worktree path,
        // so the tab identity stays the path alone. One-shot: a second open starts a new session.
        ApplicationManager.getApplication().invokeAndWait {
            assertEquals("ses_fork", service<PendingWorktreeSession>().take(done.path))
            assertNull(service<PendingWorktreeSession>().take(done.path))
        }
        assertEquals(done.id, selected.last())
        assertTrue(
            events.any {
                it.first == "Continue in Worktree" && it.second["surface"] == "sidebar" && it.second["session"] == "true"
            },
        )
    }

    fun `test move without a session transfers changes and skips forking`() {
        val done = WorktreeDto("/wt/moved", "moved", "moved", "/wt/moved")
        rpc.moveScript = listOf(
            MoveProgressDto(MoveStage.CREATING),
            MoveProgressDto(MoveStage.TRANSFERRING),
            MoveProgressDto(MoveStage.DONE, worktree = done),
        )
        val selected = mutableListOf<String>()
        val aborts = mutableListOf<Pair<String, String>>()
        val events = mutableListOf<Pair<String, Map<String, String>>>()
        val controller = controller(abort = { id, dir -> aborts += id to dir }, telemetry = { name, props -> events += name to props })
        controller.onSelect = { selected += it }

        ApplicationManager.getApplication().invokeAndWait { controller.move(null, "/repo") }
        flush()

        assertTrue("a session-less move has no turn to abort", aborts.isEmpty())
        assertEquals("/repo", rpc.moves.single().first)
        assertNull(rpc.moves.single().second)
        assertEquals(done, controller.model.getElementAt(0))
        // Nothing is queued for the worktree editor, so opening it starts a fresh session.
        ApplicationManager.getApplication().invokeAndWait {
            assertNull(service<PendingWorktreeSession>().take(done.path))
        }
        assertEquals(done.id, selected.last())
        assertTrue(events.any { it.first == "Continue in Worktree" && it.second["session"] == "false" })
    }

    fun `test duplicate move without a session is ignored while in flight`() {
        rpc.moveScript = listOf(MoveProgressDto(MoveStage.DONE, worktree = WorktreeDto("/wt/moved", "moved", "moved", "/wt/moved")))
        val controller = controller()

        ApplicationManager.getApplication().invokeAndWait {
            controller.move(null, "/repo")
            controller.move(null, "/repo")
        }
        flush()

        assertEquals(1, controller.model.size)
        assertEquals(1, rpc.moves.size)
    }

    fun `test move failure removes placeholder and reports last stage`() {
        rpc.moveScript = listOf(
            MoveProgressDto(MoveStage.CREATING),
            MoveProgressDto(MoveStage.ERROR, error = "boom"),
        )
        val failures = mutableListOf<String?>()
        val events = mutableListOf<Pair<String, Map<String, String>>>()
        val controller = controller(telemetry = { name, props -> events += name to props })
        controller.onMoveFailure = { failures += it }

        ApplicationManager.getApplication().invokeAndWait { controller.move("ses_source", "/repo") }
        flush()

        assertEquals(0, controller.model.size)
        assertEquals(listOf("boom"), failures)
        assertTrue(events.any { it.first == "Continue in Worktree Failed" && it.second["stage"] == "CREATING" })
    }

    fun `test duplicate move for session is ignored while in flight`() {
        val gate = CompletableDeferred<Unit>()
        rpc.moveScript = listOf(MoveProgressDto(MoveStage.DONE, worktree = WorktreeDto("/wt/moved", "moved", "moved", "/wt/moved")))
        val controller = controller(abort = { _, _ -> gate.await() })

        ApplicationManager.getApplication().invokeAndWait {
            controller.move("ses_source", "/repo")
            controller.move("ses_source", "/repo")
        }
        flush()

        assertEquals(1, controller.model.size)
        assertEquals(0, rpc.moves.size)
        gate.complete(Unit)
        flush()

        assertEquals(1, rpc.moves.size)
    }

    fun `test create stashes the prompt with its picked selection for the created worktree`() {
        val controller = controller()

        ApplicationManager.getApplication().invokeAndWait {
            controller.create(
                "feature/y",
                null,
                prompt = PendingPrompt("fix the bug", agent = "plan", provider = "kilo", model = "gpt-5", variant = "high"),
            )
        }
        flush()

        val created = controller.model.getElementAt(0)
        ApplicationManager.getApplication().invokeAndWait {
            val stashed = service<PendingWorktreePrompt>().take(created.path)
            assertEquals(PendingPrompt("fix the bug", "plan", "kilo", "gpt-5", "high"), stashed)
            // A one-shot take clears it.
            assertNull(service<PendingWorktreePrompt>().take(created.path))
        }
    }

    fun `test name generator avoids taken names`() {
        val taken = setOf("ambitious-keyboard", "brave-otter")
        repeat(50) {
            val name = WorktreeNames.generate(taken)
            assertFalse(name in taken)
            assertTrue("generated '$name'", name.matches(Regex("[a-z]+-[a-z]+(-\\d+)?")))
        }
    }

    fun `test worktree row icons show while running, waiting or failed`() {
        assertSame(
            WorktreeIcons.spinner,
            WorktreeIcons.forRow(busy = true, kind = SessionActivityKind.RUNNING),
        )
        assertSame(
            WorktreeIcons.running,
            WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.RUNNING),
        )
        assertSame(
            SessionActivityKind.QUESTION.icon(),
            WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.QUESTION),
        )
        assertSame(
            SessionActivityKind.PLAN.icon(),
            WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.PLAN),
        )
        assertSame(
            SessionActivityKind.ERROR.icon(),
            WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.ERROR),
        )
        assertSame(WorktreeIcons.branch, WorktreeIcons.forRow(busy = false, kind = null))
    }

    fun `test worktree icons load at the same size`() {
        // Loading an svg asset resolves to a 1x1 placeholder while the platform is headless, which is
        // how CI runs, so switch real loading on for the assertions and put the ambient state back.
        IconLoader.activate()
        try {
            assertTrue("branch icon should load", WorktreeIcons.branch.iconWidth > 1)
            assertTrue("lock icon should load", WorktreeIcons.locked.iconWidth > 1)
            assertTrue("local icon should load", WorktreeIcons.local.iconWidth > 1)
            assertEquals(WorktreeIcons.branch.iconWidth, WorktreeIcons.locked.iconWidth)
            assertEquals(WorktreeIcons.branch.iconHeight, WorktreeIcons.locked.iconHeight)
            assertEquals(WorktreeIcons.branch.iconWidth, WorktreeIcons.local.iconWidth)
            assertEquals(WorktreeIcons.branch.iconHeight, WorktreeIcons.local.iconHeight)
            for (kind in SessionActivityKind.entries) {
                assertEquals(WorktreeIcons.branch.iconWidth, kind.icon().iconWidth)
                assertEquals(WorktreeIcons.branch.iconHeight, kind.icon().iconHeight)
            }
        } finally {
            if (GraphicsEnvironment.isHeadless()) IconLoader.deactivate()
        }
    }

    fun `test activity icons are stable per kind`() {
        assertSame(SessionActivityKind.RUNNING.icon(), SessionActivityKind.RUNNING.icon())
        assertNotSame(SessionActivityKind.RUNNING.icon(), SessionActivityKind.ERROR.icon())
    }

    fun `test worktree delete eligibility excludes missing main and pending rows`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val child = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")

        assertFalse(worktreeDeletable(null, busy = false))
        assertFalse(worktreeDeletable(main, busy = false))
        assertFalse(worktreeDeletable(child, busy = true))
        assertTrue(worktreeDeletable(child, busy = false))
    }

    fun `test applyName updates the matching row so an adopted name shows live`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        val controller = controller()
        controller.reload()
        flush()

        ApplicationManager.getApplication().invokeAndWait { controller.applyName(item.path, "Repository overview request") }

        assertEquals("Repository overview request", controller.model.getElementAt(0).name)
    }

    fun `test applyName ignores unknown paths, identical names, and blanks`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        val controller = controller()
        controller.reload()
        flush()
        val before = controller.model.getElementAt(0)

        ApplicationManager.getApplication().invokeAndWait {
            controller.applyName("/repo/.kilo/worktrees/other", "Ignored")
            controller.applyName(item.path, "feature-x")
            controller.applyName(item.path, null)
        }

        assertSame(before, controller.model.getElementAt(0))
    }

    fun `test activity flow updates worktree kind and notifies on EDT`() {
        val activity = MutableStateFlow<Map<String, SessionActivityDto>>(emptyMap())
        val controller = controller(activity)
        val calls = mutableListOf<Boolean>()
        controller.onActivityChanged = { calls.add(ApplicationManager.getApplication().isDispatchThread) }

        activity.value = mapOf("ses_1" to SessionActivityDto("/repo/wt/", SessionActivityKindDto.RUNNING))
        flush()

        assertEquals(SessionActivityKind.RUNNING, controller.kind("/repo/wt"))
        assertEquals(SessionActivityKind.RUNNING, controller.kind("/repo/wt/"))
        assertTrue(calls.isNotEmpty())
        assertTrue(calls.all { it })
    }

    fun `test cache notifies on single put and remove but not on bulk sync`() {
        val cache = cache()
        val events = mutableListOf<Pair<String, String?>>()
        cache.addListener(testRootDisposable) { path, name -> events += path to name }

        ApplicationManager.getApplication().invokeAndWait {
            cache.put("/wt", "Name")
            cache.put("/wt", "Name")
            cache.putAll(listOf(WorktreeDto("/wt2", "Two", "b", "/wt2")))
            cache.remove("/wt")
            cache.remove("/wt")
        }

        assertEquals(listOf("/wt" to "Name", "/wt" to null), events)
    }

    private fun controller(
        activity: MutableStateFlow<Map<String, SessionActivityDto>> = MutableStateFlow(emptyMap()),
        abort: suspend (String, String) -> Unit = { _, _ -> },
        telemetry: (String, Map<String, String>) -> Unit = { _, _ -> },
    ) = WorktreeController(service, "/test", coroutines.scope, activity = activity, abort = abort, telemetry = telemetry)

    private fun flush() = coroutines.drain(::pump)

    private fun cache(): WorktreeNameCache = ApplicationManager.getApplication().service()

    private fun pump() = pumpEdt()
}
