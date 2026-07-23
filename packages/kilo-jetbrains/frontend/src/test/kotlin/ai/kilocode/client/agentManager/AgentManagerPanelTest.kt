package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.KiloWorktreeService
import ai.kilocode.client.agentManager.worktree.WorktreeController
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBList
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CompletableDeferred

@Suppress("UnstableApiUsage")
class AgentManagerPanelTest : BasePlatformTestCase() {
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

    fun `test creating a worktree selects it while pending and after the rpc resolves`() {
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller) }
        edt { controller.reload() }
        flush()

        val gate = CompletableDeferred<Unit>()
        rpc.beforeCreate = { gate.await() }
        edt { controller.create("feature/y", null) }

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        val pendingId = edt { controller.model.getElementAt(controller.model.size - 1).id }
        assertEquals(pendingId, edt { (list.selectedValue as ActiveListItem).key })

        gate.complete(Unit)
        flush()

        val created = edt { controller.model.getElementAt(controller.model.size - 1) }
        assertEquals("feature/y", created.branch)
        assertEquals(created.id, edt { (list.selectedValue as ActiveListItem).key })
    }

    private fun <T> edt(block: () -> T): T {
        val out = arrayOfNulls<Any?>(1)
        ApplicationManager.getApplication().invokeAndWait { out[0] = block() }
        @Suppress("UNCHECKED_CAST")
        return out[0] as T
    }

    private fun flush() = coroutines.drain(::pump)

    private fun pump() {
        ApplicationManager.getApplication().invokeAndWait { UIUtil.dispatchAllInvocationEvents() }
    }
}
