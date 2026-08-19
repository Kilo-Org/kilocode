package ai.kilocode.client.agentManager

import ai.kilocode.client.util.edtWait
import ai.kilocode.client.agentManager.worktree.KiloWorktreeService
import ai.kilocode.client.agentManager.worktree.GhStatusCoordinator
import ai.kilocode.client.agentManager.worktree.WorktreeController
import ai.kilocode.client.agentManager.worktree.WorktreeEditorMatcher
import ai.kilocode.client.agentManager.worktree.WorktreeEditorMatchers
import ai.kilocode.client.agentManager.worktree.WorktreeNameCache
import ai.kilocode.client.agentManager.worktree.WorktreeSessionEditorKind
import ai.kilocode.client.agentManager.worktree.WorktreeStatusService
import ai.kilocode.client.agentManager.worktree.ensureWorktreeSessionEditorKind
import ai.kilocode.client.agentManager.worktree.worktreeSessionParams
import ai.kilocode.client.diff.KiloDiffEditorKind
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.testing.fire
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListMetrics
import ai.kilocode.client.ui.list.ACTIVE_LIST_PR_CELL
import ai.kilocode.client.ui.list.activeListCellBounds
import ai.kilocode.client.ui.list.activeListToolWindowBackground
import ai.kilocode.client.vfs.KiloPath
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.client.vfs.KiloVirtualFile
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreePrListDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import ai.kilocode.rpc.dto.WorktreeStatsListDto
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.SearchTextField
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.UIUtil
import java.awt.event.MouseEvent
import java.awt.Point
import javax.swing.JComponent
import javax.swing.SwingUtilities
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow

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
        ApplicationManager.getApplication().replaceService(KiloWorktreeService::class.java, service, testRootDisposable)
        ApplicationManager.getApplication()
            .replaceService(GhStatusCoordinator::class.java, GhStatusCoordinator(coroutines.scope, TestUiTimers()), testRootDisposable)
    }

    override fun tearDown() {
        try {
            edt { service<WorktreeNameCache>().clear() }
            coroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    fun `test creating a worktree selects it while pending and after the rpc resolves`() {
        rpc.listed += WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
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

    fun `test creating a worktree opens the created worktree session editor`() {
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }

        edt { controller.create("feature/y", null) }
        flush()

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        val created = edt { controller.model.getElementAt(0) }
        assertEquals(created.id, edt { (list.selectedValue as ActiveListItem).key })
        val file = edt { FileEditorManager.getInstance(project).openFiles.single() as KiloVirtualFile }
        assertEquals(WorktreeSessionEditorKind.ID, file.path.kind)
        assertEquals(created.path, file.path.params["path"])
        assertSame(WorktreeSessionEditorKind.fileType(file.path.params), file.fileType)
        assertEquals(false, file.getUserData(KiloVfsManager.FOCUS))
    }

    fun `test panel hides worktree search field`() {
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller) }

        assertNull(edt { UIUtil.findComponentOfType(panel, SearchTextField::class.java) })
    }

    fun `test worktree list paints tool window background`() {
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller) }

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        val scroll = edt { SwingUtilities.getAncestorOfClass(JBScrollPane::class.java, list) as JBScrollPane }

        assertEquals(activeListToolWindowBackground(), edt { panel.background })
        assertEquals(activeListToolWindowBackground(), edt { list.background })
        assertEquals(activeListToolWindowBackground(), edt { scroll.background })
        assertEquals(activeListToolWindowBackground(), edt { scroll.viewport.background })
        assertEquals(activeListToolWindowBackground(), edt { (scroll.viewport.view as JComponent).background })
        assertEquals(0, edt { scroll.viewportBorder.getBorderInsets(scroll).top })
    }

    fun `test clicking a worktree opens the worktree session editor`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "${project.basePath!!}/.kilo/worktrees/feature-x")
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
        assertEquals(false, file.getUserData(KiloVfsManager.FOCUS))
    }

    fun `test refresh preserves selected worktree across model replace`() {
        val first = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val second = WorktreeDto("/repo/.kilo/worktrees/feature-y", "feature-y", "feature/y", "/repo/.kilo/worktrees/feature-y")
        rpc.listed += first
        rpc.listed += second
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller) }
        edt { controller.reload() }
        flush()
        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt { list.selectedIndex = 1 }

        edt { controller.reload() }
        flush()

        assertEquals(second.id, edt { (list.selectedValue as ActiveListItem).key })
    }

    fun `test refresh selects active worktree editor`() {
        val first = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val second = WorktreeDto("/repo/.kilo/worktrees/feature-y", "feature-y", "feature/y", "/repo/.kilo/worktrees/feature-y")
        rpc.listed += first
        rpc.listed += second
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt {
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(second), focus = true)
            list.selectedIndex = 0
            panel.refresh()
        }
        flush()

        assertEquals(second.id, edt { (list.selectedValue as ActiveListItem).key })
    }

    fun `test selecting worktree editor tab selects its worktree row`() {
        val first = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val second = WorktreeDto("/repo/.kilo/worktrees/feature-y", "feature-y", "feature/y", "/repo/.kilo/worktrees/feature-y")
        rpc.listed += first
        rpc.listed += second
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt {
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(second), focus = true)
        }
        pump()

        assertEquals(second.id, edt { (list.selectedValue as ActiveListItem).key })
    }

    fun `test selecting non worktree editor tab clears worktree row selection`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt {
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(item), focus = true)
        }
        pump()
        assertEquals(item.id, edt { (list.selectedValue as ActiveListItem).key })

        val file = myFixture.addFileToProject("src/Main.kt", "fun main() = Unit").virtualFile
        edt { FileEditorManager.getInstance(project).openFile(file, true) }
        pump()

        assertEquals(-1, edt { list.selectedIndex })
    }

    fun `test panel starts with no selection when active editor tab is not worktree`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        val file = myFixture.addFileToProject("src/Current.kt", "fun current() = Unit").virtualFile
        edt { FileEditorManager.getInstance(project).openFile(file, true) }
        pump()
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        assertEquals(-1, edt { list.selectedIndex })
    }

    fun `test custom worktree editor matcher can select a row for another editor kind`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        val file = myFixture.addFileToProject("src/Diff.kt", "fun diff() = Unit").virtualFile
        edt {
            project.service<WorktreeEditorMatchers>().register(WorktreeEditorMatcher { current: VirtualFile ->
                if (current == file) item.path else null
            })
            controller.reload()
        }
        flush()

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt { FileEditorManager.getInstance(project).openFile(file, true) }
        pump()

        assertEquals(item.id, edt { (list.selectedValue as ActiveListItem).key })
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

    fun `test deleting the shown worktree selects and opens the next row`() {
        val a = WorktreeDto("/repo/.kilo/worktrees/a", "a", "a", "/repo/.kilo/worktrees/a")
        val b = WorktreeDto("/repo/.kilo/worktrees/b", "b", "b", "/repo/.kilo/worktrees/b")
        val c = WorktreeDto("/repo/.kilo/worktrees/c", "c", "c", "/repo/.kilo/worktrees/c")
        rpc.listed += a
        rpc.listed += b
        rpc.listed += c
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }

        edt {
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(b), focus = true)
        }
        pump()
        assertEquals(b.id, edt { (list.selectedValue as ActiveListItem).key })

        edt { controller.remove(b) }
        flush()

        assertEquals(c.id, edt { (list.selectedValue as ActiveListItem).key })
        val file = edt { FileEditorManager.getInstance(project).openFiles.single() as KiloVirtualFile }
        assertEquals(c.path, file.path.params["path"])
    }

    fun `test deleting the last worktree selects and opens the previous row`() {
        val a = WorktreeDto("/repo/.kilo/worktrees/a", "a", "a", "/repo/.kilo/worktrees/a")
        val b = WorktreeDto("/repo/.kilo/worktrees/b", "b", "b", "/repo/.kilo/worktrees/b")
        rpc.listed += a
        rpc.listed += b
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }

        edt {
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(b), focus = true)
        }
        pump()
        assertEquals(b.id, edt { (list.selectedValue as ActiveListItem).key })

        edt { controller.remove(b) }
        flush()

        assertEquals(a.id, edt { (list.selectedValue as ActiveListItem).key })
        val file = edt { FileEditorManager.getInstance(project).openFiles.single() as KiloVirtualFile }
        assertEquals(a.path, file.path.params["path"])
    }

    fun `test deleting a background worktree keeps the shown selection`() {
        val a = WorktreeDto("/repo/.kilo/worktrees/a", "a", "a", "/repo/.kilo/worktrees/a")
        val b = WorktreeDto("/repo/.kilo/worktrees/b", "b", "b", "/repo/.kilo/worktrees/b")
        rpc.listed += a
        rpc.listed += b
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }

        edt {
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(a), focus = true)
        }
        pump()
        assertEquals(a.id, edt { (list.selectedValue as ActiveListItem).key })

        edt { controller.remove(b) }
        flush()

        assertEquals(a.id, edt { (list.selectedValue as ActiveListItem).key })
        val file = edt { FileEditorManager.getInstance(project).openFiles.single() as KiloVirtualFile }
        assertEquals(a.path, file.path.params["path"])
    }

    fun `test worktree row shows activity badge for matching directory`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val activity = MutableStateFlow(mapOf(
            "ses_1" to SessionActivityDto(item.path, SessionActivityKindDto.QUESTION),
        ))
        rpc.listed += item
        val controller = WorktreeController(service, "/test", coroutines.scope, activity = activity)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller) }
        edt { controller.reload() }
        flush()

        val row = row(panel, 0)
        assertEquals(listOf(ActiveListBadge(SessionActivityKind.QUESTION.label(), SessionActivityKind.QUESTION.style())), row.badges)
    }

    fun `test worktree row shows metrics from status service`() {
        val item = WorktreeDto("${project.basePath!!}/.kilo/worktrees/feature-x", "feature-x", "feature/x", "${project.basePath!!}/.kilo/worktrees/feature-x")
        rpc.listed += item
        rpc.statsResult = WorktreeStatsListDto(listOf(WorktreeStatsDto(item.path, additions = 5, deletions = 2, ahead = 1, behind = 3)))
        val timers = TestUiTimers()
        ApplicationManager.getApplication().replaceService(KiloWorktreeService::class.java, service, testRootDisposable)
        project.replaceService(WorktreeStatusService::class.java, WorktreeStatusService(project, coroutines.scope, timers), testRootDisposable)
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        timers.advanceBy(300)
        waitUntil { row(panel, 0).metrics != null }

        val metrics: ActiveListMetrics = row(panel, 0).metrics ?: error("expected metrics")
        assertEquals(5, metrics.additions)
        assertEquals(2, metrics.deletions)
        assertEquals(1, metrics.ahead)
        assertEquals(3, metrics.behind)
    }

    fun `test open diff opens the branch diff editor`() {
        val item = WorktreeDto("${project.basePath!!}/.kilo/worktrees/feature-x", "feature-x", "feature/x", "${project.basePath!!}/.kilo/worktrees/feature-x")
        rpc.listed += item
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        assertTrue(edt { panel.canOpenDiff(item) })
        edt { panel.openDiff(item) }

        val file = edt { FileEditorManager.getInstance(project).openFiles.single() as KiloVirtualFile }
        assertEquals(KiloDiffEditorKind.ID, file.path.kind)
        assertEquals(item.path, file.path.params["directory"])
    }

    fun `test open pr availability reflects pr status`() {
        val item = WorktreeDto("${project.basePath!!}/.kilo/worktrees/feature-x", "feature-x", "feature/x", "${project.basePath!!}/.kilo/worktrees/feature-x")
        rpc.listed += item
        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(item.path, 7, GhState.OPEN, "https://example.test/pr/7")))
        val timers = TestUiTimers()
        ApplicationManager.getApplication().replaceService(KiloWorktreeService::class.java, service, testRootDisposable)
        project.replaceService(WorktreeStatusService::class.java, WorktreeStatusService(project, coroutines.scope, timers), testRootDisposable)
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        timers.advanceBy(300)
        flush()

        assertTrue(edt { panel.canOpenPr(item) })
        assertFalse(edt { panel.canOpenPr(null) })
        assertFalse(edt { panel.canRename(item) })
        assertTrue(edt { panel.canShowRename(item) })
    }

    fun `test pr title replaces row name and tooltip reveals custom name`() {
        val path = "${project.basePath!!}/.kilo/worktrees/feature-x"
        val item = WorktreeDto(path, "Feature Label", "feature/x", path)
        rpc.listed += item
        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(path, 7, GhState.DRAFT, "https://example.test/pr/7", "Fix <login> bug")))
        val timers = TestUiTimers()
        ApplicationManager.getApplication().replaceService(KiloWorktreeService::class.java, service, testRootDisposable)
        project.replaceService(WorktreeStatusService::class.java, WorktreeStatusService(project, coroutines.scope, timers), testRootDisposable)
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        timers.advanceBy(300)
        flush()

        val row = row(panel, 0)
        assertEquals("Fix <login> bug", row.title)
        val tip = row.metrics?.prTooltip ?: error("expected PR tooltip")
        assertEquals("<html>Draft #7 Fix &lt;login&gt; bug<br>(Feature Label)<br>Click to open the pull request in your browser.</html>", tip)
        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt {
            list.size = java.awt.Dimension(360, 80)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
        }
        val area = edt { activeListCellBounds(list, 0, selected = false).getValue(ACTIVE_LIST_PR_CELL) }

        assertEquals(tip, edt { list.getToolTipText(MouseEvent(list, MouseEvent.MOUSE_MOVED, System.currentTimeMillis(), 0, center(area).x, center(area).y, 0, false)) })
    }

    fun `test blank pr title keeps row name and omits custom name line`() {
        val path = "${project.basePath!!}/.kilo/worktrees/feature-x"
        val item = WorktreeDto(path, "Feature Label", "feature/x", path)
        rpc.listed += item
        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(path, 8, GhState.OPEN, "https://example.test/pr/8", "   ")))
        val timers = TestUiTimers()
        ApplicationManager.getApplication().replaceService(KiloWorktreeService::class.java, service, testRootDisposable)
        project.replaceService(WorktreeStatusService::class.java, WorktreeStatusService(project, coroutines.scope, timers), testRootDisposable)
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        timers.advanceBy(300)
        flush()

        val row = row(panel, 0)
        assertEquals("Feature Label", row.title)
        assertEquals("<html>Open #8<br>Click to open the pull request in your browser.</html>", row.metrics?.prTooltip)
    }

    fun `test worktree row hides badge while pending or deleting`() {
        val path = "feature/y"
        val activity = MutableStateFlow(mapOf(
            "ses_1" to SessionActivityDto(path, SessionActivityKindDto.RUNNING),
        ))
        val gate = CompletableDeferred<Unit>()
        rpc.beforeCreate = { gate.await() }
        val controller = WorktreeController(service, "/test", coroutines.scope, activity = activity)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller) }

        edt { controller.create("feature/y", null) }
        flush()

        val pending = row(panel, 0)
        assertEquals(emptyList<ActiveListBadge>(), pending.badges)
        gate.complete(Unit)
        flush()
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun flush() = coroutines.drain(::pump)

    private fun waitUntil(block: () -> Boolean) {
        assertTrue(coroutines.pumpUntil { edt(block) })
    }

    private fun row(panel: AgentManagerPanel, idx: Int): ActiveListItem {
        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        return edt { list.model.getElementAt(idx) as ActiveListItem }
    }

    private fun center(rect: java.awt.Rectangle) = Point(rect.x + rect.width / 2, rect.y + rect.height / 2)

    private fun pump() = pumpEdt()
}
