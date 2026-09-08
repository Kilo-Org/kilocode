package ai.kilocode.client.agentManager

import ai.kilocode.client.util.edtWait
import ai.kilocode.client.agentManager.worktree.KiloRunService
import ai.kilocode.client.agentManager.worktree.KiloWorktreeService
import ai.kilocode.client.agentManager.worktree.GhStatusCoordinator
import ai.kilocode.client.agentManager.worktree.NewWorktreeHandle
import ai.kilocode.client.agentManager.worktree.NewWorktreePlan
import ai.kilocode.client.agentManager.worktree.PendingPrompt
import ai.kilocode.client.agentManager.worktree.PendingWorktreePrompt
import ai.kilocode.client.agentManager.worktree.WorktreeController
import ai.kilocode.client.agentManager.worktree.WorktreeEditorMatcher
import ai.kilocode.client.agentManager.worktree.WorktreeEditorMatchers
import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.agentManager.worktree.WorktreeNameCache
import ai.kilocode.client.agentManager.worktree.WorktreeSessionEditorKind
import ai.kilocode.client.agentManager.worktree.WorktreeStatusService
import ai.kilocode.client.agentManager.worktree.ensureWorktreeSessionEditorKind
import ai.kilocode.client.agentManager.worktree.worktreeSessionParams
import ai.kilocode.client.diff.KiloDiffEditorKind
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.testing.FakeRunRpcApi
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.fakeRoot
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.testing.fire
import ai.kilocode.client.testing.installBrowser
import ai.kilocode.client.testing.rowLines
import ai.kilocode.client.testing.rowTitle
import ai.kilocode.client.ui.PrIcons
import ai.kilocode.client.ui.mergeLabel
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListBadgeCell
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListMetrics
import ai.kilocode.client.ui.list.ActiveListView
import ai.kilocode.client.ui.list.ACTIVE_LIST_CHANGES_CELL
import ai.kilocode.client.ui.list.activeListCellBounds
import ai.kilocode.client.ui.list.activeListToolWindowBackground
import ai.kilocode.client.vfs.KiloPath
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.client.vfs.KiloVirtualFile
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhCommentsDto
import ai.kilocode.rpc.dto.GhMerge
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.RunProcessState
import ai.kilocode.rpc.dto.RunStateDto
import ai.kilocode.rpc.dto.SetupScriptTargetDto
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreeDirtyListDto
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
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.ExpandedItemListCellRendererWrapper
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.IJSwingUtilities
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Container
import java.awt.Cursor
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import java.awt.Point
import javax.swing.JComponent
import javax.swing.SwingUtilities
import javax.swing.UIManager
import javax.swing.plaf.FontUIResource
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow

@Suppress("UnstableApiUsage")
class AgentManagerPanelTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeWorktreeRpcApi
    private lateinit var service: KiloWorktreeService
    private lateinit var run: FakeRunRpcApi

    override fun setUp() {
        super.setUp()
        installBrowser()
        coroutines = TestCoroutines()
        rpc = FakeWorktreeRpcApi()
        service = KiloWorktreeService(coroutines.scope, rpc)
        ApplicationManager.getApplication().replaceService(KiloWorktreeService::class.java, service, testRootDisposable)
        // remove() releases any worktree run processes through this service before deleting; the
        // live-run indicator tests below push states through the same fake to drive the row icon.
        run = FakeRunRpcApi()
        ApplicationManager.getApplication()
            .replaceService(KiloRunService::class.java, KiloRunService(coroutines.scope, run), testRootDisposable)
        // Worktree stats/PR loading resolves the backend project root first.
        fakeRoot(project, coroutines.scope, testRootDisposable, project.basePath!!)
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
        val pendingId = edt { controller.model.getElementAt(0).id }
        assertEquals(pendingId, edt { (list.selectedValue as ActiveListItem).key })

        gate.complete(Unit)
        flush()

        val created = edt { controller.model.getElementAt(0) }
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

    fun `test configure creates the worktree only after the dialog closes`() {
        val order = mutableListOf<String>()
        val plan = NewWorktreePlan.Create("feature/y", "main", PendingPrompt("build it"))
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt {
            AgentManagerPanel(testRootDisposable, controller, project, dialog = { _, _ -> FakeWorktreeDialog(plan, order) })
        }

        edt { panel.configure(onCreate = { order += "switch" }) }
        flush()

        // The view switch happens after the modal dialog is gone and before the worktree row lands.
        assertEquals(listOf("show", "switch"), order)
        val created = edt { controller.model.getElementAt(0) }
        assertEquals("feature/y", created.branch)
        assertEquals("main", rpc.creates.single().baseBranch)
        edt { assertEquals("build it", service<PendingWorktreePrompt>().take(created.path)?.text) }
    }

    fun `test configure does nothing when the dialog is cancelled`() {
        val order = mutableListOf<String>()
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt {
            AgentManagerPanel(testRootDisposable, controller, project, dialog = { _, _ -> FakeWorktreeDialog(null, order) })
        }

        edt { panel.configure(onCreate = { order += "switch" }) }
        flush()

        assertEquals(listOf("show"), order)
        assertEquals(0, edt { controller.model.size })
        assertTrue(rpc.creates.isEmpty())
    }

    fun `test configure imports an existing branch`() {
        val order = mutableListOf<String>()
        val plan = NewWorktreePlan.Branch("feature/x")
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt {
            AgentManagerPanel(testRootDisposable, controller, project, dialog = { _, _ -> FakeWorktreeDialog(plan, order) })
        }

        edt { panel.configure() }
        flush()

        val req = rpc.creates.single()
        assertEquals("feature/x", req.branch)
        assertTrue("branch import checks out an existing branch", req.existingBranch)
    }

    fun `test configure imports a pull request`() {
        val order = mutableListOf<String>()
        val plan = NewWorktreePlan.Pr("https://github.com/o/r/pull/7")
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt {
            AgentManagerPanel(testRootDisposable, controller, project, dialog = { _, _ -> FakeWorktreeDialog(plan, order) })
        }

        edt { panel.configure() }
        flush()

        assertEquals(listOf("https://github.com/o/r/pull/7"), rpc.prImports.toList())
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

    fun `test worktree list renders row titles in plain weight`() {
        rpc.listed += worktree("aardvark")
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        @Suppress("UNCHECKED_CAST")
        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! as JBList<Any?> }
        val title = edt {
            val row = list.model.getElementAt(0) as ActiveListItem
            val comp = list.cellRenderer.getListCellRendererComponent(list, row, 0, false, false)
            rowTitle(comp)
        }
        val iter = title.iterator()
        iter.next()

        assertEquals(SimpleTextAttributes.STYLE_PLAIN, iter.textAttributes.style)
    }

    /**
     * End-to-end cover for an IDE interface zoom on the real panel. Only the platform's own refresh is
     * applied — raise the `*.font` defaults and the user scale like `LafManagerImpl.patchLafFonts`, then
     * walk the tree — because that walk never reaches the shared row renderer and the list is what has
     * to refresh it. See `ActiveListScaleTest` for the unit-level detail.
     */
    fun `test worktree row height grows after an IDE zoom instead of staying at the pre zoom size`() {
        rpc.listed += worktree("aardvark")
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        // Worktree rows carry a "Local worktrees" section, so the list keeps fixedCellHeight at -1 and
        // BasicListUI measures each row from the renderer instead — this is the exact call it makes.
        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        assertEquals(-1, edt { list.fixedCellHeight })
        val before = edt { rowHeight(list) }
        assertTrue("expected a real row height, got $before", before > 0)

        val label = UIManager.getFont("Label.font")
        val scale = JBUIScale.scale(1f)
        val keys = UIManager.getDefaults().keys.toList().filterIsInstance<String>().filter { it.endsWith(".font") }
        val fonts = keys.associateWith { UIManager.getFont(it) }
        try {
            edt {
                keys.forEach { UIManager.put(it, FontUIResource(label.deriveFont(label.size2D * 2f))) }
                JBUIScale.setUserScaleFactorForTest(scale * 2f)
                IJSwingUtilities.updateComponentTreeUI(panel)
            }

            val after = edt { rowHeight(list) }
            assertTrue("expected the row height to grow with the zoom, was $before then $after", after > before)
        } finally {
            edt {
                JBUIScale.setUserScaleFactorForTest(scale)
                fonts.forEach { (key, font) -> UIManager.put(key, FontUIResource(font)) }
            }
        }
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

    fun `test current branch row appears first and opens session editor`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += main
        rpc.listed += item
        val controller = WorktreeController(service, "/repo", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val current = row(panel, 0)
        assertEquals("main", current.title)
        assertEquals("repo", current.description)
        assertNull(current.section)
        assertNull(current.metrics)
        assertEquals("Local worktrees", row(panel, 1).section)

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt {
            list.setSize(400, 120)
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
        assertEquals(main.path, file.path.params["path"])
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

    fun `test panel refresh keeps selected worktree across tab switch reload`() {
        val first = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val second = WorktreeDto("/repo/.kilo/worktrees/feature-y", "feature-y", "feature/y", "/repo/.kilo/worktrees/feature-y")
        rpc.listed += first
        rpc.listed += second
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt { list.selectedIndex = 1 }

        edt { panel.refresh() }
        flush()

        assertEquals(second.id, edt { (list.selectedValue as ActiveListItem).key })
    }

    fun `test refresh keeps existing selection`() {
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

        assertEquals(first.id, edt { (list.selectedValue as ActiveListItem).key })
    }

    fun `test refresh uses active worktree editor when no selection exists`() {
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

    fun `test worktree row shows activity icon for matching directory`() {
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
        assertSame(SessionActivityKind.QUESTION.icon(), row.icon)
        assertEquals(emptyList<ActiveListBadge>(), row.badges)
    }

    fun `test worktree row uses the error icon for error activity`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        val activity = MutableStateFlow(mapOf(
            "ses_1" to SessionActivityDto(item.path, SessionActivityKindDto.ERROR),
        ))
        rpc.listed += item
        val controller = WorktreeController(service, "/test", coroutines.scope, activity = activity)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller) }
        edt { controller.reload() }
        flush()

        assertSame(SessionActivityKind.ERROR.icon(), row(panel, 0).icon)
    }

    fun `test idle worktree rows show the branch icon and the local row shows the monitor`() {
        rpc.listed += main()
        rpc.listed += worktree("aardvark")
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        assertSame(WorktreeIcons.local, row(panel, 0).icon)
        assertSame(WorktreeIcons.branch, row(panel, 1).icon)
    }

    fun `test locked worktree row shows the lock icon`() {
        val path = "${project.basePath!!}/.kilo/worktrees/held"
        rpc.listed += WorktreeDto(path, "held", "held", path, locked = true, lockReason = "held by test")
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        assertSame(WorktreeIcons.locked, row(panel, 0).icon)
    }

    fun `test a running process replaces the resting icon with the platform live-run indicator`() {
        val item = worktree("feature-x")
        rpc.listed += item
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        assertSame(WorktreeIcons.branch, row(panel, 0).icon)

        run.states.value = listOf(RunStateDto("id1", "dev [wt]", item.path))
        waitUntil { row(panel, 0).icon === WorktreeIcons.runIndicator }
    }

    fun `test a stopping process still shows the live-run indicator`() {
        val item = worktree("feature-x")
        rpc.listed += item
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        run.states.value = listOf(RunStateDto("id1", "dev [wt]", item.path, state = RunProcessState.STOPPING))
        waitUntil { row(panel, 0).icon === WorktreeIcons.runIndicator }
    }

    fun `test the live-run indicator follows the worktree the process runs in`() {
        val item = worktree("feature-x")
        rpc.listed += item
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        // Shown while the process belongs to this row...
        run.states.value = listOf(RunStateDto("id1", "dev [wt]", item.path))
        waitUntil { row(panel, 0).icon === WorktreeIcons.runIndicator }

        // ...and cleared once the only live process belongs to a different worktree. Asserting the
        // transition rather than a bare non-match keeps this from passing when the states never arrive.
        run.states.value = listOf(RunStateDto("id1", "dev [other]", "${project.basePath!!}/.kilo/worktrees/other"))
        waitUntil { row(panel, 0).icon === WorktreeIcons.branch }
    }

    fun `test the live-run indicator clears when the last process exits`() {
        val item = worktree("feature-x")
        rpc.listed += item
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        run.states.value = listOf(RunStateDto("id1", "dev [wt]", item.path))
        waitUntil { row(panel, 0).icon === WorktreeIcons.runIndicator }

        run.states.value = emptyList()
        waitUntil { row(panel, 0).icon === WorktreeIcons.branch }
    }

    fun `test a running process badges the session activity glyph and settles back to the run indicator`() {
        val item = worktree("feature-x")
        val activity = MutableStateFlow(mapOf("ses_1" to SessionActivityDto(item.path, SessionActivityKindDto.QUESTION)))
        rpc.listed += item
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope, activity = activity)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        assertSame(SessionActivityKind.QUESTION.icon(), row(panel, 0).icon)

        // A process starts while the agent is still waiting on an answer: the question glyph stays and
        // picks up the run badge, rather than being replaced by the run indicator.
        run.states.value = listOf(RunStateDto("id1", "dev [wt]", item.path))
        waitUntil { row(panel, 0).icon === WorktreeIcons.live(SessionActivityKind.QUESTION.icon()) }

        // The question is answered, the process is still up: back to the standard running glyph.
        activity.value = emptyMap()
        waitUntil { row(panel, 0).icon === WorktreeIcons.runIndicator }
    }

    fun `test a running process in the main checkout replaces the monitor icon`() {
        rpc.listed += main()
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        assertSame(WorktreeIcons.local, row(panel, 0).icon)

        run.states.value = listOf(RunStateDto("id1", "dev", project.basePath!!))
        waitUntil { row(panel, 0).icon === WorktreeIcons.runIndicator }
    }

    fun `test a pending worktree row never shows the live-run indicator even if its synthetic path matches a running process`() {
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }

        val gate = CompletableDeferred<Unit>()
        rpc.beforeCreate = { gate.await() }
        edt { controller.create("feature/y", null) }
        flush()

        val pendingPath = edt { controller.model.getElementAt(0).path }
        run.states.value = listOf(RunStateDto("id1", "dev", pendingPath))
        flush()

        assertEquals(KiloBundle.message("worktree.progress.creating"), row(panel, 0).progress)
        assertSame(WorktreeIcons.spinner, row(panel, 0).icon)

        gate.complete(Unit)
        flush()
    }

    /**
     * Zooming in and back out repeatedly must land on exactly the original row height. Rows carrying
     * diff metrics and a PR badge are the tallest shape the panel renders, and the row height is the
     * maximum across rows, so a single value that latches instead of being re-derived shows up here as
     * padding that never shrinks back.
     */
    fun `test worktree row height round trips through repeated IDE zoom changes`() {
        val item = WorktreeDto("${project.basePath!!}/.kilo/worktrees/feature-x", "feature-x", "feature/x", "${project.basePath!!}/.kilo/worktrees/feature-x")
        rpc.listed += main()
        rpc.listed += item
        rpc.statsResult = WorktreeStatsListDto(
            listOf(WorktreeStatsDto(item.path, additions = 742, deletions = 169, ahead = 2, behind = 41, files = 14, base = "origin/main")),
        )
        val timers = TestUiTimers()
        ApplicationManager.getApplication().replaceService(KiloWorktreeService::class.java, service, testRootDisposable)
        project.replaceService(WorktreeStatusService::class.java, WorktreeStatusService(project, coroutines.scope, timers), testRootDisposable)
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        timers.advanceBy(300)
        waitUntil { row(panel, 0).metrics != null || row(panel, 1).metrics != null }

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt {
            list.setSize(360, 600)
            list.doLayout()
        }
        val label = UIManager.getFont("Label.font")
        val scale = JBUIScale.scale(1f)
        val keys = UIManager.getDefaults().keys.toList().filterIsInstance<String>().filter { it.endsWith(".font") }
        val fonts = keys.associateWith { UIManager.getFont(it) }
        // Applies a real IDE zoom — the *.font defaults and the user scale — then refreshes the tree.
        // The font has to be a FontUIResource like LafManagerImpl.patchLafFonts installs, because
        // LookAndFeel.installColorsAndFont only replaces a component font that is null or a UIResource.
        val zoom = { factor: Float ->
            edt {
                keys.forEach { UIManager.put(it, FontUIResource(label.deriveFont(label.size2D * factor))) }
                JBUIScale.setUserScaleFactorForTest(scale * factor)
                IJSwingUtilities.updateComponentTreeUI(panel)
            }
            edt { rowHeight(list) }
        }
        try {
            val base = edt { rowHeight(list) }
            assertTrue("expected a real row height, got $base", base > 0)

            val zoomed = zoom(1.25f)
            assertTrue("expected the row height to grow when zooming in, was $base then $zoomed", zoomed > base)

            // Two full round trips, so a value that grows per zoom event cannot hide behind a single one.
            assertEquals(base, zoom(1f))
            assertEquals(zoomed, zoom(1.25f))
            assertEquals(base, zoom(1f))
        } finally {
            edt {
                JBUIScale.setUserScaleFactorForTest(scale)
                fonts.forEach { (key, font) -> UIManager.put(key, FontUIResource(font)) }
            }
        }
    }

    fun `test worktree row shows metrics from status service`() {
        val item = WorktreeDto("${project.basePath!!}/.kilo/worktrees/feature-x", "feature-x", "feature/x", "${project.basePath!!}/.kilo/worktrees/feature-x")
        rpc.listed += item
        rpc.statsResult = WorktreeStatsListDto(listOf(WorktreeStatsDto(item.path, additions = 5, deletions = 2, ahead = 1, behind = 3, files = 2, base = "origin/main")))
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
        assertEquals(2, metrics.files)
        assertEquals("origin/main", metrics.base)
    }

    /**
     * A worktree whose pull request no longer merges. The mark rides the changes summary rather than joining
     * the verdict glyphs, because what conflicts is the diff the summary is already reporting.
     */
    fun `test worktree row marks its changes summary when the pull request no longer merges`() {
        val item = worktree("feature-x")
        rpc.listed += item
        rpc.statsResult = WorktreeStatsListDto(listOf(WorktreeStatsDto(item.path, additions = 5, deletions = 2, files = 2, base = "origin/main")))
        rpc.prResult = prs(item, merge = GhMerge.CONFLICTING)
        val panel = panelWithPr()
        waitUntil { row(panel, 0).metrics != null }

        assertTrue(row(panel, 0).metrics?.conflict == true)
        // The row's own tooltip is where the mark says what it means: a red crescent alone cannot.
        edt {
            val view = UIUtil.findComponentOfType(panel, ActiveListView::class.java)!!
            val list = view.list
            list.setSize(560, 160)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            list.clearSelection()
            val cell = activeListCellBounds(list, 0, selected = false).getValue(ACTIVE_LIST_CHANGES_CELL)
            val point = center(cell)
            val hover = MouseEvent(list, MouseEvent.MOUSE_MOVED, System.currentTimeMillis(), 0, point.x, point.y, 0, false)
            val tip = list.getToolTipText(hover) ?: error("expected a tooltip over the changes cell")
            assertTrue("expected the conflict named in $tip", tip.contains(mergeLabel("origin/main")))
            assertTrue("expected the click hint kept in $tip", tip.contains(KiloBundle.message("worktree.stats.tooltip.open")))
        }
    }

    fun `test worktree rows prefer base files and fall back to uncommitted ones`() {
        val committed = worktree("committed")
        val local = worktree("local")
        val both = worktree("both")
        val renamed = worktree("renamed")
        val counters = worktree("counters")
        val clean = worktree("clean")
        rpc.listed += listOf(committed, local, both, renamed, counters, clean)
        rpc.statsResult = WorktreeStatsListDto(
            listOf(
                WorktreeStatsDto(committed.path, additions = 5, deletions = 1, files = 2),
                WorktreeStatsDto(local.path, ahead = 3, behind = 2),
                WorktreeStatsDto(both.path, additions = 3, files = 1),
                WorktreeStatsDto(renamed.path, files = 1),
                WorktreeStatsDto(counters.path, ahead = 3, behind = 2),
                WorktreeStatsDto(clean.path),
            ),
        )
        rpc.dirtyResult = WorktreeDirtyListDto(
            listOf(
                WorktreeDirtyDto(local.path, additions = 2, files = 1),
                WorktreeDirtyDto(both.path, additions = 4, files = 2),
            ),
        )
        val timers = TestUiTimers()
        project.replaceService(WorktreeStatusService::class.java, WorktreeStatusService(project, coroutines.scope, timers), testRootDisposable)
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        timers.advanceBy(300)
        flush()

        val first = row(panel, 0).metrics ?: error("expected committed changes")
        assertEquals(5, first.additions)
        assertEquals(2, first.files)
        assertFalse(first.local)
        // Nothing committed, so the uncommitted set is the only thing the row can report.
        val uncommitted = row(panel, 1).metrics ?: error("expected uncommitted changes")
        assertTrue(uncommitted.local)
        assertEquals(0, uncommitted.files)
        assertEquals(1, uncommitted.localFiles)
        assertEquals(2, uncommitted.localAdditions)
        val mixed = row(panel, 2).metrics ?: error("expected base changes to win")
        assertEquals(3, mixed.additions)
        assertEquals(1, mixed.files)
        assertFalse(mixed.local)
        val move = row(panel, 3).metrics ?: error("expected file-only changes")
        assertEquals(1, move.files)
        assertEquals(0, move.additions)
        assertEquals(0, move.deletions)
        // A compact summary has no ahead/behind counters, and a clean worktree has nothing at all.
        assertNull(row(panel, 4).metrics)
        assertNull(row(panel, 5).metrics)

        edt {
            val view = UIUtil.findComponentOfType(panel, ActiveListView::class.java)!!
            view.list.setSize(480, 600)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            for (index in listOf(0, 1, 2, 3)) {
                assertTrue(activeListCellBounds(view.list, index, selected = false).containsKey(ACTIVE_LIST_CHANGES_CELL))
            }
            for (index in listOf(4, 5)) {
                assertFalse(activeListCellBounds(view.list, index, selected = false).containsKey(ACTIVE_LIST_CHANGES_CELL))
            }
        }
    }

    fun `test the changes badge opens whichever comparison it is showing`() {
        val committed = worktree("committed")
        val local = worktree("local")
        rpc.listed += listOf(committed, local)
        rpc.statsResult = WorktreeStatsListDto(
            listOf(
                WorktreeStatsDto(committed.path, additions = 5, files = 2, base = "origin/main"),
                WorktreeStatsDto(local.path),
            ),
        )
        rpc.dirtyResult = WorktreeDirtyListDto(listOf(WorktreeDirtyDto(local.path, additions = 2, files = 1)))
        val timers = TestUiTimers()
        project.replaceService(WorktreeStatusService::class.java, WorktreeStatusService(project, coroutines.scope, timers), testRootDisposable)
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        timers.advanceBy(300)
        flush()

        edt { row(panel, 0).metrics!!.action!!() }
        waitUntil { opened().isNotEmpty() }
        assertEquals("branch", opened().single().path.params["source"])
        edt { FileEditorManager.getInstance(project).openFiles.forEach { FileEditorManager.getInstance(project).closeFile(it) } }

        edt { row(panel, 1).metrics!!.action!!() }
        // The local comparison passes no branch, so the tab waits on a branch-name lookup for its title.
        waitUntil { opened().isNotEmpty() }
        assertEquals("local", opened().single().path.params["source"])
    }

    fun `test the uncommitted badge says so and reaches its own comparison through the list`() {
        val local = worktree("local")
        rpc.listed += local
        rpc.dirtyResult = WorktreeDirtyListDto(listOf(WorktreeDirtyDto(local.path, additions = 2, deletions = 1, files = 3)))
        val timers = TestUiTimers()
        project.replaceService(WorktreeStatusService::class.java, WorktreeStatusService(project, coroutines.scope, timers), testRootDisposable)
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        timers.advanceBy(300)
        flush()

        edt {
            val view = UIUtil.findComponentOfType(panel, ActiveListView::class.java)!!
            val list = view.list
            list.setSize(560, 160)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            list.clearSelection()
            val renderer = list.cellRenderer.getListCellRendererComponent(list, list.model.getElementAt(0), 0, false, true)
            renderer.setSize(list.width, list.getCellBounds(0, 0).height)
            components(renderer).filterIsInstance<Container>().forEach { it.doLayout() }
            assertEquals(
                listOf("3 files", "-1", "+2"),
                components(renderer).filterIsInstance<JBLabel>().filter { it.isVisible && !it.text.isNullOrEmpty() }
                    .map { it.text },
            )

            val point = center(activeListCellBounds(list, 0, selected = false).getValue(ACTIVE_LIST_CHANGES_CELL))
            val hover = MouseEvent(list, MouseEvent.MOUSE_MOVED, System.currentTimeMillis(), 0, point.x, point.y, 0, false)
            list.mouseMotionListeners.forEach { it.mouseMoved(hover) }
            assertEquals(Cursor.HAND_CURSOR, list.cursor.type)
            assertEquals(KiloBundle.message("worktree.dirty.tooltip.open"), list.getToolTipText(hover))
            for (id in listOf(MouseEvent.MOUSE_PRESSED, MouseEvent.MOUSE_RELEASED, MouseEvent.MOUSE_CLICKED)) {
                fire(list, MouseEvent(
                    list,
                    id,
                    System.currentTimeMillis(),
                    if (id == MouseEvent.MOUSE_PRESSED) InputEvent.BUTTON1_DOWN_MASK else 0,
                    point.x,
                    point.y,
                    1,
                    false,
                    MouseEvent.BUTTON1,
                ))
            }
        }
        waitUntil { opened().isNotEmpty() }

        assertEquals("local", opened().single().path.params["source"])
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
        assertEquals("branch", file.path.params["source"])
        assertEquals(item.branch, file.path.params["branch"])
        assertEquals(KiloBundle.message("diff.editor.branch.title.named", item.branch), file.name)
    }

    fun `test open local diff opens the uncommitted changes editor`() {
        val item = WorktreeDto("${project.basePath!!}/.kilo/worktrees/feature-x", "feature-x", "feature/x", "${project.basePath!!}/.kilo/worktrees/feature-x")
        rpc.listed += item
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        assertTrue(edt { panel.canOpenLocalDiff(item) })
        edt { panel.openLocalDiff(item) }
        // No branch is passed for the local comparison, so opening resolves the branch name
        // asynchronously (for the editor title) on KiloDiffEditorService's own scope before
        // creating the tab, hence pumpUntil rather than this test's own coroutines.drain().
        val editors = FileEditorManager.getInstance(project)
        assertTrue(coroutines.pumpUntil { edt { editors.openFiles.isNotEmpty() } })

        val file = edt { editors.openFiles.single() as KiloVirtualFile }
        assertEquals(KiloDiffEditorKind.ID, file.path.kind)
        assertEquals(item.path, file.path.params["directory"])
        assertEquals("local", file.path.params["source"])
        assertEquals(KiloBundle.message("diff.editor.local.title"), file.name)
    }

    fun `test open local diff is hidden on the main worktree row`() {
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }

        assertFalse(edt { panel.canOpenLocalDiff(main()) })
    }

    fun `test setup script actions are hidden and disabled on the main worktree row`() {
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }

        assertFalse(edt { panel.canOpenSetupScript(main()) })
        assertFalse(edt { panel.canRunSetup(main()) })
    }

    fun `test can run setup script requires an existing script for a non-main worktree row`() {
        val workspaceRpc = FakeWorkspaceRpcApi()
        ApplicationManager.getApplication()
            .replaceService(KiloWorkspaceService::class.java, KiloWorkspaceService(coroutines.scope, workspaceRpc), testRootDisposable)
        val item = worktree("feature-x")
        rpc.listed += item
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        assertTrue(edt { panel.canOpenSetupScript(item) })
        // No cached target yet: hidden, not just disabled, and a background refresh is kicked off.
        assertFalse(edt { panel.canRunSetup(item) })
        flush()
        assertEquals(listOf(controller.directory), workspaceRpc.setupScriptTargetCalls.toList())

        service<KiloWorkspaceService>().setupScript[controller.directory] =
            SetupScriptTargetDto("${controller.directory}/.kilo/setup-script", "", exists = false)
        assertFalse(edt { panel.canRunSetup(item) })

        service<KiloWorkspaceService>().setupScript[controller.directory] =
            SetupScriptTargetDto("${controller.directory}/.kilo/setup-script", "", exists = true)
        assertTrue(edt { panel.canRunSetup(item) })
    }

    fun `test worktree changes clicks use the correct branch after equal-count rows render`() {
        val first = worktree("first").copy(name = "Custom title")
        val second = worktree("second")
        rpc.listed += listOf(first, second)
        rpc.statsResult = WorktreeStatsListDto(listOf(
            WorktreeStatsDto(first.path, additions = 5, deletions = 1, files = 2, base = "origin/main"),
            WorktreeStatsDto(second.path, additions = 5, deletions = 1, files = 2, base = "origin/main"),
        ))
        val timers = TestUiTimers()
        project.replaceService(WorktreeStatusService::class.java, WorktreeStatusService(project, coroutines.scope, timers), testRootDisposable)
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        timers.advanceBy(300)
        flush()

        edt {
            val view = UIUtil.findComponentOfType(panel, ActiveListView::class.java)!!
            val list = view.list
            list.setSize(480, 320)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            val areas = (0..1).associateWith { activeListCellBounds(list, it, selected = false).getValue(ACTIVE_LIST_CHANGES_CELL) }
            activeListCellBounds(list, 0, selected = true)
            for (index in listOf(1, 0, 1)) {
                val point = center(areas.getValue(index))
                for (id in listOf(MouseEvent.MOUSE_PRESSED, MouseEvent.MOUSE_RELEASED, MouseEvent.MOUSE_CLICKED)) {
                    fire(list, MouseEvent(
                        list,
                        id,
                        System.currentTimeMillis(),
                        if (id == MouseEvent.MOUSE_PRESSED) InputEvent.BUTTON1_DOWN_MASK else 0,
                        point.x,
                        point.y,
                        1,
                        false,
                        MouseEvent.BUTTON1,
                    ))
                }
                val item = if (index == 0) first else second
                val file = FileEditorManager.getInstance(project).selectedFiles.single() as KiloVirtualFile
                assertEquals(KiloDiffEditorKind.ID, file.path.kind)
                assertEquals(item.path, file.path.params["directory"])
                assertEquals("branch", file.path.params["source"])
                assertEquals(item.branch, file.path.params["branch"])
                assertEquals(KiloBundle.message("diff.editor.branch.title.named", item.branch), file.name)
            }
            val files = FileEditorManager.getInstance(project).openFiles.filterIsInstance<KiloVirtualFile>()
            assertEquals(2, files.size)
            assertTrue(files.all { it.path.kind == KiloDiffEditorKind.ID })
        }
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

    fun `test current row renders without any linked worktrees`() {
        rpc.listed += main()
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }

        edt { controller.reload() }
        flush()

        // Replacing an empty model with an empty list notifies nobody, so the row has to come from
        // the reload itself.
        assertEquals(1, rows(panel))
        assertEquals("main", row(panel, 0).title)
    }

    fun `test current row shows the pr badge for the main checkout`() {
        val main = main()
        rpc.listed += main
        rpc.prResult = WorktreePrListDto(
            GhAvailability.OK,
            listOf(WorktreePrDto(main.path, 12, GhState.OPEN, "https://example.test/pr/12", "Main work")),
        )
        val timers = TestUiTimers()
        ApplicationManager.getApplication().replaceService(KiloWorktreeService::class.java, service, testRootDisposable)
        project.replaceService(WorktreeStatusService::class.java, WorktreeStatusService(project, coroutines.scope, timers), testRootDisposable)
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        timers.advanceBy(300)
        waitUntil { rows(panel) > 0 && row(panel, 0).secondaryBadges.isNotEmpty() }

        val current = row(panel, 0)
        assertEquals("main", current.title)
        assertTrue(current.leading.isEmpty())
        assertTrue(current.badges.isEmpty())
        assertEquals("#12", current.secondaryBadges.single().text)
        assertEquals("pull-request", current.secondaryBadges.single().id)
        assertTrue(edt { panel.canOpenPr(main) })
    }

    fun `test conversation review and check glyphs sit on the title line in that order`() {
        val item = worktree("feature-x")
        rpc.listed += item
        rpc.prResult = prs(
            item,
            review = GhReview.APPROVED,
            checks = GhChecksDto(GhChecks.FAILED, total = 5, passed = 3, failed = 2),
            comments = GhCommentsDto(total = 8, unresolved = 3),
        )
        val panel = panelWithPr()

        val row = row(panel, 0)
        // Conversations lead: a build result and a review verdict are outcomes to read, an unresolved
        // thread is somebody waiting on a reply.
        assertEquals(listOf("pr-comments", "pr-review", "pr-checks"), row.badges.map { it.id })
        // Glyphs, not worded pills: the icon carries the state and the text would only repeat it. The
        // conversation count is the exception, because a glyph alone cannot say how much is outstanding.
        assertEquals(listOf("3", "", ""), row.badges.map { it.text })
        assertEquals(PrIcons.comments, row.badges[0].icon)
        assertEquals(PrIcons.reviewApproved, row.badges[1].icon)
        assertEquals(PrIcons.checksFailed, row.badges[2].icon)
        // The changes cell and PR number stay where they were, on the description line.
        assertEquals("pull-request", row.secondaryBadges.single().id)

        edt {
            val view = UIUtil.findComponentOfType(panel, ActiveListView::class.java)!!
            val list = view.list
            list.setSize(560, 160)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            list.clearSelection()
            val areas = activeListCellBounds(list, 0, selected = false)
            val comments = areas.getValue("pr-comments")
            val review = areas.getValue("pr-review")
            val checks = areas.getValue("pr-checks")
            val badge = areas.getValue("pull-request")
            assertTrue("conversations must sit left of the review", comments.x + comments.width <= review.x)
            assertTrue("review must sit left of the run status", review.x + review.width <= checks.x)
            assertTrue(kotlin.math.abs(center(comments).y - center(review).y) <= 1)
            assertTrue(kotlin.math.abs(center(review).y - center(checks).y) <= 1)

            val renderer = list.cellRenderer.getListCellRendererComponent(list, row, 0, false, true)
            renderer.setSize(list.width, list.getCellBounds(0, 0).height)
            components(renderer).filterIsInstance<Container>().forEach { it.doLayout() }
            val title = rowTitle(renderer)
            val header = SwingUtilities.convertPoint(title, 0, 0, renderer)
            val bounds = list.getCellBounds(0, 0)
            // Line one, clear of the title, and above the PR number on line two.
            assertTrue(comments.x >= bounds.x + header.x + title.width)
            // A column, not a ragged edge: the last glyph ends where the PR pill under it ends, so the
            // verdicts line up down the list instead of following each title's own width.
            assertEquals(badge.x + badge.width, checks.x + checks.width)
            assertTrue(kotlin.math.abs(center(comments).y - (bounds.y + header.y + title.height / 2)) <= 2)
            assertTrue(checks.y + checks.height <= badge.y)
            assertTrue(bounds.contains(comments))
            assertTrue(bounds.contains(review))
            assertTrue(bounds.contains(checks))
        }
    }

    fun `test the conversation glyph carries its count in the tooltip and opens the pull request`() {
        val browser = installBrowser()
        val item = worktree("feature-x")
        rpc.listed += item
        rpc.prResult = prs(item, comments = GhCommentsDto(total = 8, unresolved = 3))
        val panel = panelWithPr()

        val badge = row(panel, 0).badges.single()
        assertEquals("pr-comments", badge.id)
        assertEquals("3", badge.text)
        assertEquals(
            "<html>3 of 8 review conversations unresolved<br>" +
                "Click to open the pull request conversation in your browser.</html>",
            badge.tooltip,
        )

        edt { badge.action?.invoke() }

        // The threads themselves are listed on the conversation tab, not under Checks or Files changed.
        assertEquals(listOf("https://example.test/pr/7"), browser.urls)
    }

    fun `test a pull request whose conversations are all resolved gets no glyph`() {
        val item = worktree("feature-x")
        rpc.listed += item
        rpc.prResult = prs(item, comments = GhCommentsDto(total = 8, unresolved = 0))
        val panel = panelWithPr()

        // Most reviewed PRs end up here, so a glyph would sit on nearly every row saying only that
        // somebody once commented.
        assertTrue(row(panel, 0).badges.isEmpty())
        assertEquals("pull-request", row(panel, 0).secondaryBadges.single().id)
    }

    fun `test the conversation count renders as label text beside the glyph`() {
        val item = worktree("feature-x")
        rpc.listed += item
        rpc.prResult = prs(item, comments = GhCommentsDto(total = 8, unresolved = 3))
        val panel = panelWithPr()
        val row = row(panel, 0)

        edt {
            val list = UIUtil.findComponentOfType(panel, ActiveListView::class.java)!!.list
            list.setSize(560, 160)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            val renderer = list.cellRenderer.getListCellRendererComponent(list, row, 0, false, true)
            val cell = components(renderer)
                .filterIsInstance<ActiveListBadgeCell>()
                .single { it.cellId == "pr-comments" }

            // A pill paints its text inside the icon; this one keeps the figure as real label text so the
            // glyph and the number sit side by side.
            assertEquals("3", cell.text)
            assertEquals(PrIcons.comments, cell.icon)
            // The row's ordinary text color, not the muted one: the count is a figure meant to be read,
            // and the muted tone left it fainter than the neutral glyph beside it.
            assertEquals(UIUtil.getListForeground(false, false), cell.foreground)
        }
    }

    fun `test a selected row keeps the conversation count readable`() {
        val item = worktree("feature-x")
        rpc.listed += item
        rpc.prResult = prs(item, comments = GhCommentsDto(total = 8, unresolved = 3))
        val panel = panelWithPr()
        val row = row(panel, 0)

        edt {
            val list = UIUtil.findComponentOfType(panel, ActiveListView::class.java)!!.list
            list.setSize(560, 160)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            val renderer = list.cellRenderer.getListCellRendererComponent(list, row, 0, true, true)
            val cell = components(renderer)
                .filterIsInstance<ActiveListBadgeCell>()
                .single { it.cellId == "pr-comments" }

            // Selection paints the row blue, so a fixed label foreground would leave the count dark on dark.
            assertEquals(UIUtil.getListForeground(true, true), cell.foreground)
        }
    }

    fun `test glyphs carry counts in their tooltips and the run glyph opens the checks tab`() {
        val browser = installBrowser()
        val item = worktree("feature-x")
        rpc.listed += item
        rpc.prResult = prs(
            item,
            review = GhReview.CHANGES_REQUESTED,
            checks = GhChecksDto(GhChecks.FAILED, total = 5, passed = 3, failed = 2),
        )
        val panel = panelWithPr()

        val row = row(panel, 0)
        assertEquals("<html>Changes requested</html>", row.badges[0].tooltip)
        // The glyph cannot say how many failed, so the tooltip has to.
        assertEquals(
            "<html>2 of 5 checks failed<br>Click to open the checks in your browser.</html>",
            row.badges[1].tooltip,
        )

        edt { row.badges[1].action?.invoke() }

        assertEquals(listOf("https://example.test/pr/7/checks"), browser.urls)
    }

    fun `test a required but ungiven review gets no glyph`() {
        val item = worktree("feature-x")
        rpc.listed += item
        rpc.prResult = prs(item, review = GhReview.PENDING, checks = GhChecksDto(GhChecks.PASSED, total = 2, passed = 2))
        val panel = panelWithPr()

        // Nearly every open PR is waiting on review, so a glyph for it would sit on almost every row
        // and tell the user nothing.
        assertEquals(listOf("pr-checks"), row(panel, 0).badges.map { it.id })
        assertEquals(PrIcons.checksPassed, row(panel, 0).badges.single().icon)
    }

    fun `test a running build gets the run glyph`() {
        val item = worktree("feature-x")
        rpc.listed += item
        rpc.prResult = prs(item, checks = GhChecksDto(GhChecks.PENDING, total = 3, passed = 1, pending = 2))
        val panel = panelWithPr()

        val badge = row(panel, 0).badges.single()
        assertEquals("pr-checks", badge.id)
        assertEquals(PrIcons.checksRunning, badge.icon)
        assertEquals(
            "<html>2 of 3 checks running<br>Click to open the checks in your browser.</html>",
            badge.tooltip,
        )
    }

    fun `test no glyphs when github reports no review, checks, or conversations`() {
        val item = worktree("feature-x")
        rpc.listed += item
        rpc.prResult = prs(item)
        val panel = panelWithPr()

        // What an older gh or a restricted token resolves to, and what a repo with no CI looks like.
        assertTrue(row(panel, 0).badges.isEmpty())
        assertEquals("pull-request", row(panel, 0).secondaryBadges.single().id)
    }

    fun `test pr title replaces row name and the pill tooltip is only the click hint`() {
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
        assertTrue(row.leading.isEmpty())
        assertTrue(row.badges.isEmpty())
        val tip = row.secondaryBadges.single().tooltip ?: error("expected PR tooltip")
        // The row shows the title, the pill shows the number, and the popup header carries the rest, so
        // repeating any of it here is noise over a badge the user is about to click.
        assertEquals("<html>Click to open the pull request in your browser.</html>", tip)
        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt {
            list.size = java.awt.Dimension(360, 80)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
        }
        val area = edt { activeListCellBounds(list, 0, selected = false).getValue("pull-request") }

        assertEquals(tip, edt { list.getToolTipText(MouseEvent(list, MouseEvent.MOUSE_MOVED, System.currentTimeMillis(), 0, center(area).x, center(area).y, 0, false)) })
    }

    fun `test blank pr title keeps the row name`() {
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
        assertTrue(row.leading.isEmpty())
        // The pill already reads "#8" next to the state color, so its tooltip is only the click hint.
        assertEquals("<html>Click to open the pull request in your browser.</html>", row.secondaryBadges.single().tooltip)
    }

    fun `test pr badge follows stats on the description line and opens the browser without opening an editor`() {
        val browser = installBrowser()
        val item = worktree("feature-x")
        val url = "https://example.test/pr/7"
        rpc.listed += item
        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(item.path, 7, GhState.OPEN, url, "Feature title")))
        rpc.statsResult = WorktreeStatsListDto(listOf(WorktreeStatsDto(item.path, additions = 5, deletions = 2, ahead = 1, files = 2)))
        rpc.dirtyResult = WorktreeDirtyListDto(listOf(WorktreeDirtyDto(item.path, additions = 3, files = 1)))
        val timers = TestUiTimers()
        project.replaceService(WorktreeStatusService::class.java, WorktreeStatusService(project, coroutines.scope, timers), testRootDisposable)
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        timers.advanceBy(300)
        flush()

        edt {
            val view = UIUtil.findComponentOfType(panel, ActiveListView::class.java)!!
            val list = view.list
            list.setSize(560, 160)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            list.clearSelection()
            val row = list.model.getElementAt(0)
            assertTrue(row.leading.isEmpty())
            assertTrue(row.badges.isEmpty())
            assertEquals("#7", row.secondaryBadges.single().text)
            assertEquals("pull-request", row.secondaryBadges.single().id)
            val areas = activeListCellBounds(list, 0, selected = false)
            val badge = areas.getValue("pull-request")
            val changes = areas.getValue(ACTIVE_LIST_CHANGES_CELL)
            assertEquals(setOf("pull-request", ACTIVE_LIST_CHANGES_CELL), areas.keys)
            val renderer = list.cellRenderer.getListCellRendererComponent(list, row, 0, false, true)
            renderer.setSize(list.width, list.getCellBounds(0, 0).height)
            components(renderer).filterIsInstance<Container>().forEach { it.doLayout() }
            val (title, desc) = rowLines(renderer)
            val origin = SwingUtilities.convertPoint(desc, 0, 0, renderer)
            val header = SwingUtilities.convertPoint(title, 0, 0, renderer)
            val bounds = list.getCellBounds(0, 0)
            assertTrue(origin.x + desc.width + bounds.x <= changes.x)
            assertTrue(changes.x + changes.width <= badge.x)
            assertTrue(kotlin.math.abs(center(badge).y - center(changes).y) <= 1)
            assertTrue(kotlin.math.abs(center(badge).y - (bounds.y + origin.y + desc.height / 2)) <= 1)
            assertTrue(badge.y >= bounds.y + header.y + title.height)
            assertTrue(bounds.contains(badge))
            assertTrue(browser.urls.isEmpty())

            val point = center(badge)
            val hover = MouseEvent(list, MouseEvent.MOUSE_MOVED, System.currentTimeMillis(), 0, point.x, point.y, 0, false)
            list.mouseMotionListeners.forEach { it.mouseMoved(hover) }
            assertEquals(Cursor.HAND_CURSOR, list.cursor.type)
            assertEquals(row.secondaryBadges.single().tooltip, list.getToolTipText(hover))
            for (id in listOf(MouseEvent.MOUSE_PRESSED, MouseEvent.MOUSE_RELEASED, MouseEvent.MOUSE_CLICKED)) {
                fire(list, MouseEvent(
                    list,
                    id,
                    System.currentTimeMillis(),
                    if (id == MouseEvent.MOUSE_PRESSED) InputEvent.BUTTON1_DOWN_MASK else 0,
                    point.x,
                    point.y,
                    1,
                    false,
                    MouseEvent.BUTTON1,
                ))
            }
            assertEquals(listOf(url), browser.urls)
            assertTrue(FileEditorManager.getInstance(project).openFiles.isEmpty())
        }
    }

    fun `test worktree row hides badge while in progress`() {
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
        assertSame(WorktreeIcons.spinner, pending.icon)
        assertEquals(KiloBundle.message("worktree.progress.creating"), pending.progress)
        assertEquals(emptyList<ActiveListBadge>(), pending.leading)
        assertEquals(emptyList<ActiveListBadge>(), pending.badges)
        assertEquals(emptyList<ActiveListBadge>(), pending.secondaryBadges)
        assertNull(pending.metrics)
        gate.complete(Unit)
        flush()
    }

    fun `test dragging a worktree above another reorders the model and persists the path order`() {
        val a = worktree("aardvark")
        val b = worktree("beluga")
        rpc.listed += main()
        rpc.listed += a
        rpc.listed += b
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val view = edt { UIUtil.findComponentOfType(panel, ActiveListView::class.java)!! }
        layout(view)
        // Display order: current (main) row is index 0, then a (1), b (2).
        edt {
            assertEquals(b.id, view.pickable(rowCenter(view, 2)))
            view.over(b.id, rowCenter(view, 1))
            view.drop()
        }
        flush()

        assertEquals(listOf(b.path, a.path), edt { worktreeIds(controller) })
        assertEquals(listOf(listOf(b.path, a.path)), rpc.reorders.toList())
    }

    fun `test dragging a worktree keeps dropped row selected after reorder reload`() {
        val a = worktree("aardvark")
        val b = worktree("beluga")
        rpc.listed += main()
        rpc.listed += a
        rpc.listed += b
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val view = edt { UIUtil.findComponentOfType(panel, ActiveListView::class.java)!! }
        layout(view)
        edt {
            assertTrue(view.select(b.id))
            view.over(b.id, rowCenter(view, 1))
            view.drop()
        }
        flush()

        assertEquals(b.id, edt { view.selected()?.key })
    }

    fun `test renaming selected worktree keeps it selected`() {
        val item = worktree("aardvark")
        rpc.listed += main()
        rpc.listed += item
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val view = edt { UIUtil.findComponentOfType(panel, ActiveListView::class.java)!! }
        edt {
            assertTrue(view.select(item.id))
            controller.rename(item, "renamed", onFailure = {})
        }
        flush()

        assertEquals(item.id, edt { view.selected()?.key })
        assertEquals("renamed", edt { (view.selected() as ActiveListItem).title })
    }

    fun `test the current and pending rows are not draggable`() {
        rpc.listed += main()
        rpc.listed += worktree("aardvark")
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val gate = CompletableDeferred<Unit>()
        rpc.beforeCreate = { gate.await() }
        edt { controller.create("feature/pending", null) }
        val view = edt { UIUtil.findComponentOfType(panel, ActiveListView::class.java)!! }
        layout(view)

        edt {
            // Row 0 is the current (main) row; row 1 is the pending create.
            assertNull(view.pickable(rowCenter(view, 0)))
            assertNull(view.pickable(rowCenter(view, 1)))
        }
        gate.complete(Unit)
        flush()
    }

    fun `test a failed reorder rpc reloads from git ground truth`() {
        val a = worktree("aardvark")
        val b = worktree("beluga")
        rpc.listed += main()
        rpc.listed += a
        rpc.listed += b
        rpc.reorderResult = false
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val view = edt { UIUtil.findComponentOfType(panel, ActiveListView::class.java)!! }
        layout(view)
        edt {
            view.over(b.id, rowCenter(view, 1))
            view.drop()
        }
        flush()

        // The optimistic swap is discarded; reload restores the backend (listed) order.
        assertEquals(listOf(a.path, b.path), edt { worktreeIds(controller) })
        assertEquals(listOf(listOf(b.path, a.path)), rpc.reorders.toList())
    }

    private fun prs(
        item: WorktreeDto,
        review: GhReview = GhReview.NONE,
        checks: GhChecksDto = GhChecksDto(),
        comments: GhCommentsDto = GhCommentsDto(),
        merge: GhMerge = GhMerge.UNKNOWN,
    ) = WorktreePrListDto(
        GhAvailability.OK,
        listOf(
            WorktreePrDto(
                item.path,
                7,
                GhState.OPEN,
                "https://example.test/pr/7",
                "Feature title",
                review,
                checks,
                comments,
                merge,
            ),
        ),
    )

    /** Panel wired to a status service with a controllable clock, reloaded past the stats debounce. */
    private fun panelWithPr(): AgentManagerPanel {
        val timers = TestUiTimers()
        project.replaceService(WorktreeStatusService::class.java, WorktreeStatusService(project, coroutines.scope, timers), testRootDisposable)
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        timers.advanceBy(300)
        flush()
        return panel
    }

    private fun main(): WorktreeDto {
        val base = project.basePath!!
        return WorktreeDto(base, "repo", "main", base, main = true)
    }

    /** The preferred height BasicListUI itself measures for row 0 when fixedCellHeight is -1. */
    @Suppress("UNCHECKED_CAST")
    private fun rowHeight(rawList: JBList<*>): Int {
        val list = rawList as JBList<Any?>
        val renderer = ExpandedItemListCellRendererWrapper.unwrap(list.cellRenderer)
        return renderer.getListCellRendererComponent(list, list.model.getElementAt(0), 0, false, false).preferredSize.height
    }

    private fun worktree(name: String): WorktreeDto {
        val path = "${project.basePath!!}/.kilo/worktrees/$name"
        return WorktreeDto(path, name, name, path)
    }

    private fun worktreeIds(controller: WorktreeController): List<String> {
        return (0 until controller.model.size).map { controller.model.getElementAt(it).path }
    }

    private fun layout(view: ActiveListView) {
        edt {
            view.list.setSize(360, 600)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
        }
    }

    private fun rowCenter(view: ActiveListView, index: Int): Point {
        val bounds = view.list.getCellBounds(index, index)!!
        return Point(bounds.x + 8, bounds.y + bounds.height / 2)
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

    private fun rows(panel: AgentManagerPanel): Int {
        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        return edt { list.model.size }
    }

    private fun components(root: Component): List<Component> {
        val out = mutableListOf<Component>()
        fun visit(item: Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private fun center(rect: java.awt.Rectangle) = Point(rect.x + rect.width / 2, rect.y + rect.height / 2)

    private fun opened(): List<KiloVirtualFile> =
        edt { FileEditorManager.getInstance(project).openFiles.filterIsInstance<KiloVirtualFile>() }

    private fun pump() = pumpEdt()
}

/** Stands in for the modal New Worktree dialog: records that it was shown, then reports [plan]. */
private class FakeWorktreeDialog(
    private val plan: NewWorktreePlan?,
    private val order: MutableList<String>,
) : NewWorktreeHandle {
    override fun showAndGet(): Boolean {
        order += "show"
        return plan != null
    }

    override fun result(): NewWorktreePlan? = plan
}
