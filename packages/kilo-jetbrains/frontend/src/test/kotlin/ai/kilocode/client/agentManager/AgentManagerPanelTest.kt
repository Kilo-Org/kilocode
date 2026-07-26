package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.KiloWorktreeService
import ai.kilocode.client.agentManager.worktree.WorktreeController
import ai.kilocode.client.agentManager.worktree.WorktreeSessionEditorKind
import ai.kilocode.client.agentManager.worktree.ensureWorktreeSessionEditorKind
import ai.kilocode.client.agentManager.worktree.worktreeSessionParams
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.fire
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.vfs.KiloPath
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.client.vfs.KiloVirtualFile
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBList
import com.intellij.util.ui.UIUtil
import java.awt.event.MouseEvent
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

    fun `test clicking a worktree opens the worktree session editor`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt {
            list.setSize(400, 100)
            list.doLayout()
            val bounds = list.getCellBounds(0, 0)
            fire(list, MouseEvent(
                list,
                MouseEvent.MOUSE_CLICKED,
                System.currentTimeMillis(),
                0,
                bounds.x + 8,
                bounds.y + bounds.height / 2,
                1,
                false,
                MouseEvent.BUTTON1,
            ))
        }

        val file = edt { FileEditorManager.getInstance(project).openFiles.single() as KiloVirtualFile }
        assertEquals(WorktreeSessionEditorKind.ID, file.path.kind)
        assertEquals(item.path, file.path.params["path"])
        assertSame(WorktreeSessionEditorKind.fileType(file.path.params), file.fileType)
    }

    fun `test deleting a worktree closes and releases its worktree session editor`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        val controller = WorktreeController(service, "/test", coroutines.scope)
        edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val params = worktreeSessionParams(item)
        val path = KiloPath(WorktreeSessionEditorKind.ID, params)
        edt {
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, params)
        }
        assertNotNull(KiloVirtualFileSystem.getInstance().cached(path))
        assertEquals(1, edt { FileEditorManager.getInstance(project).openFiles.size })

        edt { controller.remove(item) }
        flush()

        assertEquals(0, edt { FileEditorManager.getInstance(project).openFiles.size })
        assertNull(KiloVirtualFileSystem.getInstance().cached(path))
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
