package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.agentManager.worktree.KiloWorktreeService
import ai.kilocode.client.agentManager.worktree.WorktreeController
import ai.kilocode.client.agentManager.worktree.WorktreeNames
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CompletableDeferred

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

    fun `test create failure removes placeholder and reports the error`() {
        rpc.createResult = { CreateWorktreeResultDto(error = "boom") }
        val controller = controller()
        val failures = mutableListOf<String?>()
        controller.onCreateFailure = { failures.add(it) }

        ApplicationManager.getApplication().invokeAndWait { controller.create("feature/y", null) }
        val id = controller.model.getElementAt(0).id
        assertTrue(controller.isPending(id))
        flush()

        assertEquals(0, controller.model.size)
        assertFalse(controller.isPending(id))
        assertEquals(listOf("boom"), failures)
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

        assertEquals(listOf("feature/x", "feature/y"), (0 until controller.model.size).map { controller.model.getElementAt(it).branch })
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
        controller.remove(controller.model.getElementAt(0), onSuccess = { success = true })
        flush()

        assertEquals(listOf(Triple("/test", item.path, "feature/x")), rpc.removes.toList())
        assertEquals(0, controller.model.size)
        assertTrue(success)
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
        assertEquals(1, failures.size)
        assertTrue(failures.first().locked)
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

    fun `test name generator avoids taken names`() {
        val taken = setOf("ambitious-keyboard", "brave-otter")
        repeat(50) {
            val name = WorktreeNames.generate(taken)
            assertFalse(name in taken)
            assertTrue("generated '$name'", name.matches(Regex("[a-z]+-[a-z]+(-\\d+)?")))
        }
    }

    fun `test worktree icons prefer pending then locked then branch`() {
        assertSame(WorktreeIcons.spinner, WorktreeIcons.forRow(locked = false, pending = true))
        assertSame(WorktreeIcons.locked, WorktreeIcons.forRow(locked = true, pending = false))
        assertSame(WorktreeIcons.branch, WorktreeIcons.forRow(locked = false, pending = false))
    }

    fun `test branch and lock icons load at the same size`() {
        assertTrue("branch icon should load", WorktreeIcons.branch.iconWidth > 0)
        assertTrue("lock icon should load", WorktreeIcons.locked.iconWidth > 0)
        assertEquals(WorktreeIcons.branch.iconWidth, WorktreeIcons.locked.iconWidth)
        assertEquals(WorktreeIcons.branch.iconHeight, WorktreeIcons.locked.iconHeight)
    }

    fun `test worktree delete eligibility excludes missing main and pending rows`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val child = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")

        assertFalse(worktreeDeletable(null, pending = false))
        assertFalse(worktreeDeletable(main, pending = false))
        assertFalse(worktreeDeletable(child, pending = true))
        assertTrue(worktreeDeletable(child, pending = false))
    }

    private fun controller() =
        WorktreeController(service, "/test", coroutines.scope)

    private fun flush() = coroutines.drain(::pump)

    private fun pump() {
        ApplicationManager.getApplication().invokeAndWait { UIUtil.dispatchAllInvocationEvents() }
    }
}
