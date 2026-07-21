package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.KiloWorktreeService
import ai.kilocode.client.agentManager.worktree.WorktreeController
import ai.kilocode.client.agentManager.worktree.WorktreeRenderer
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import javax.swing.JList

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

    fun `test reload populates the model`() {
        rpc.listed += WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val controller = controller()

        controller.reload()
        flush()

        assertEquals(2, controller.model.size)
        assertEquals("main", controller.model.getElementAt(0).branch)
        assertEquals("feature/x", controller.model.getElementAt(1).branch)
    }

    fun `test create invokes rpc and adds the created worktree`() {
        val controller = controller()

        controller.create("feature/y", null)
        flush()

        assertEquals(listOf("feature/y"), rpc.creates.map { it.branch })
        assertEquals(1, controller.model.size)
        assertEquals("feature/y", controller.model.getElementAt(0).branch)
    }

    fun `test remove invokes rpc and removes from the model`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        val controller = controller()
        controller.reload()
        flush()

        controller.remove(controller.model.getElementAt(0))
        flush()

        assertEquals(listOf(Triple("/test", item.path, "feature/x")), rpc.removes.toList())
        assertEquals(0, controller.model.size)
    }

    fun `test renderer shows delete icon only when selected and not main`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val child = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val renderer = WorktreeRenderer()
        val list = JList(arrayOf(main, child))

        renderer.getListCellRendererComponent(list, child, 1, false, false)
        assertFalse(renderer.deleteVisible())

        renderer.getListCellRendererComponent(list, child, 1, true, false)
        assertTrue(renderer.deleteVisible())

        renderer.getListCellRendererComponent(list, main, 0, true, false)
        assertFalse(renderer.deleteVisible())
    }

    private fun controller() =
        WorktreeController(service, "/test", coroutines.scope)

    private fun flush() = coroutines.drain(::pump)

    private fun pump() {
        ApplicationManager.getApplication().invokeAndWait { UIUtil.dispatchAllInvocationEvents() }
    }
}
