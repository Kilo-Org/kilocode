package ai.kilocode.client.agentManager
import ai.kilocode.client.ui.list.section

import ai.kilocode.client.actions.AgentManagerAddAction
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
import ai.kilocode.client.agentManager.hosted.HostedManagementService
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceEditorKind
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceRemoval
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceRow
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceRowData
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceIcons
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceDataKeys
import ai.kilocode.client.agentManager.worktree.WorktreeDataKeys
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.TestLog
import ai.kilocode.client.session.SpinnerIcon
import ai.kilocode.client.ui.active.ACTIVE_MENU_CELL
import ai.kilocode.rpc.KiloHostedRpcApi
import ai.kilocode.rpc.dto.HostedAgentDto
import ai.kilocode.rpc.dto.HostedCreateWorkspaceDto
import ai.kilocode.rpc.dto.HostedDeleteResultDto
import ai.kilocode.rpc.dto.HostedMutationResultDto
import ai.kilocode.rpc.dto.HostedRepositoryDto
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceListDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import ai.kilocode.rpc.dto.HostedProviderDto
import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import ai.kilocode.client.test.CopyProviderSink
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
import ai.kilocode.client.ui.active.ActiveBadge
import ai.kilocode.client.ui.active.ActiveBadgeCell
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveMetrics
import ai.kilocode.client.ui.active.ActiveMove
import ai.kilocode.client.ui.tree.ActiveEntry
import ai.kilocode.client.ui.tree.ActiveTreeView
import ai.kilocode.client.ui.active.activeHitCells
import ai.kilocode.client.ui.active.activeLayout
import ai.kilocode.client.ui.active.ACTIVE_CHANGES_CELL
import ai.kilocode.client.ui.active.activeToolWindowBackground
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
import com.intellij.ide.DataManager
import com.intellij.ide.IdeEventQueue
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.PlatformDataKeys
import com.intellij.ide.DeleteProvider
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.actionSystem.DataProvider
import com.intellij.openapi.actionSystem.DataSnapshotProvider
import com.intellij.openapi.actionSystem.DataMap
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.SearchTextField
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
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
import javax.swing.tree.TreePath
import com.intellij.util.ui.tree.TreeUtil
import javax.swing.UIManager
import javax.swing.plaf.FontUIResource
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow

@Suppress("UnstableApiUsage")
class AgentManagerPanelTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeWorktreeRpcApi
    private lateinit var service: KiloWorktreeService
    private lateinit var run: FakeRunRpcApi
    private var delegate: Any? = null
    private var stored: String? = null

    override fun setUp() {
        super.setUp()
        delegate = UIManager.get("TreeUI")
        UIManager.put("TreeUI", "com.intellij.ui.tree.ui.DefaultTreeUI")
        stored = PropertiesComponent.getInstance(project).getValue("kilo.agentManager.layout")
        PropertiesComponent.getInstance(project).unsetValue("kilo.agentManager.layout")
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
            PropertiesComponent.getInstance(project).setValue("kilo.agentManager.layout", stored)
            UIManager.put("TreeUI", delegate)
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

        val list = edt { tree(panel) }
        val pendingId = edt { controller.model.getElementAt(0).id }
        assertEquals(pendingId, edt { (selectedValue(list) as ActiveItem).key })

        gate.complete(Unit)
        flush()

        val created = edt { controller.model.getElementAt(0) }
        assertEquals("feature/y", created.branch)
        assertEquals(created.id, edt { (selectedValue(list) as ActiveItem).key })
    }

    fun `test creating a worktree opens the created worktree session editor`() {
        val gate = CompletableDeferred<Unit>()
        rpc.beforeCreate = { gate.await() }
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }

        edt { controller.create("feature/y", null) }
        val pending = edt { controller.model.getElementAt(0).id }
        gate.complete(Unit)
        flush()

        val list = edt { tree(panel) }
        val created = edt { controller.model.getElementAt(0) }
        assertEquals(created.id, edt { (selectedValue(list) as ActiveItem).key })
        val file = edt { FileEditorManager.getInstance(project).openFiles.single() as KiloVirtualFile }
        assertEquals(WorktreeSessionEditorKind.ID, file.path.kind)
        assertEquals(created.path, file.path.params["path"])
        assertSame(WorktreeSessionEditorKind.fileType(file.path.params), file.fileType)
        assertEquals(false, file.getUserData(KiloVfsManager.FOCUS))
        assertFalse(PropertiesComponent.getInstance(project).getValue("kilo.agentManager.layout")!!.contains(pending))
    }

    fun `test failed creation forgets its pending layout key`() {
        val gate = CompletableDeferred<Unit>()
        rpc.beforeCreate = { gate.await() }
        rpc.createResult = { ai.kilocode.rpc.dto.CreateWorktreeResultDto(error = "creation failed") }
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }

        edt { controller.create("feature/failure", null) }
        val pending = edt { controller.model.getElementAt(0).id }
        gate.complete(Unit)
        flush()

        assertEquals(0, rows(panel))
        assertFalse(PropertiesComponent.getInstance(project).getValue("kilo.agentManager.layout")!!.contains(pending))
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

    fun `test Add Local opens the existing worktree dialog`() {
        val order = mutableListOf<String>()
        val plan = NewWorktreePlan.Create("feature/local", "main", PendingPrompt("build locally"))
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt {
            AgentManagerPanel(testRootDisposable, controller, project, dialog = { _, _ -> FakeWorktreeDialog(plan, order) })
        }
        val local = AgentManagerAddAction().getChildren(null).first()
        val context = SimpleDataContext.builder().add(SidePanelKeys.WORKTREE_PANEL, panel).build()
        val event = AnActionEvent.createFromAnAction(local, null, ActionPlaces.TOOLWINDOW_TITLE, context)

        edt { local.actionPerformed(event) }
        flush()

        assertEquals(listOf("show"), order)
        assertEquals("feature/local", rpc.creates.single().branch)
        assertEquals("main", rpc.creates.single().baseBranch)
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

    fun `test worktrees appear at the root without fixed groups`() {
        rpc.listed += main()
        rpc.listed += worktree("aardvark")
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller) }
        edt { controller.reload() }
        flush()
        val view = tree(panel)
        layout(view)

        edt {
            assertEquals(2, view.rowCount)
            assertTrue(leaves(view).all { it.parent === view.hierarchy.root })
        }
    }

    fun `test section rows use the shared menu glyph and deletion keeps their worktrees`() {
        val current = main()
        val item = worktree("aardvark")
        rpc.listed += listOf(current, item)
        val section = edt {
            val state = AgentManagerLayout(PropertiesComponent.getInstance(project))
            val section = state.create("Planning")
            state.nodes(listOf(object : ActiveItem { override val key = current.id; override val title = current.name },
                object : ActiveItem { override val key = item.id; override val title = item.name }))
            state.move(ai.kilocode.client.ui.active.ActiveMove(item.id, 1, 0, listOf(item.id), parent = section.key))
            section
        }
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        val view = tree(panel)
        layout(view)

        edt {
            val entry = view.hierarchy.entries.getValue(section.key)
            assertTrue(entry.allowsChildren)
            assertEquals("Planning", entry.item.title)
            assertEquals(ai.kilocode.client.ui.tree.ActiveTreeColors.color("red"), entry.color)
            assertSame(entry, view.hierarchy.entries.getValue(item.id).parent)
            assertNull(view.hierarchy.entries.getValue(item.id).color)
            val frame = view.regions.cell(entry)
            view.dispatchEvent(MouseEvent(view, MouseEvent.MOUSE_MOVED, 0, 0,
                frame.x + 1, frame.y + frame.height / 2, 0, false, MouseEvent.NOBUTTON))
            assertTrue(view.regions.hits(entry).any { it.id == ACTIVE_MENU_CELL && it.enabled })
            assertTrue(view.select(section.key))
            val context = context(panel)
            assertNull(WorktreeDataKeys.WORKTREE.getData(context))
            assertNull(HostedWorkspaceDataKeys.WORKSPACE.getData(context))
            val provider = PlatformDataKeys.DELETE_ELEMENT_PROVIDER.getData(context)!!
            assertTrue(provider.canDeleteElement(context))
            provider.deleteElement(context)
            assertFalse(view.hierarchy.entries.containsKey(section.key))
            assertEquals(listOf(current.id, item.id), leaves(view).map { it.key })
            assertTrue(leaves(view).all { it.parent === view.hierarchy.root })
            assertNull(AgentManagerLayout(PropertiesComponent.getInstance(project)).section(section.key))
        }
        assertTrue(rpc.removes.isEmpty())
    }

    fun `test worktrees drag into a section and back below the primary checkout using the shared tree`() {
        val current = main()
        val item = worktree("aardvark")
        rpc.listed += listOf(current, item)
        val section = edt { AgentManagerLayout(PropertiesComponent.getInstance(project)).create("Planning") }
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        val view = tree(panel)
        layout(view)

        edt {
            val entry = view.hierarchy.entries.getValue(section.key)
            val frame = view.regions.cell(entry)
            view.over(item.id, center(frame))
            view.drop()
            assertSame(entry, view.hierarchy.entries.getValue(item.id).parent)
            assertEquals(item.id, view.selected()?.key)
            val root = view.regions.cell(view.hierarchy.entries.getValue(current.id))
            view.over(item.id, Point(root.x + 1, root.y))
            assertSame(entry, view.hierarchy.entries.getValue(item.id).parent)
            assertFalse(view.placeholder(view.hierarchy.entries.getValue(item.id)))
            assertEquals(listOf(current.id, section.key), roots(view))
            view.drop()
            view.over(item.id, Point(root.x + root.width / 2, root.y + root.height - 1))
            assertSame(view.hierarchy.root, view.hierarchy.entries.getValue(item.id).parent)
            assertTrue(view.placeholder(view.hierarchy.entries.getValue(item.id)))
            assertEquals(listOf(current.id, item.id, section.key), roots(view))
            view.drop()
            assertSame(view.hierarchy.root, view.hierarchy.entries.getValue(item.id).parent)
            assertEquals(listOf(current.id, item.id, section.key), roots(view))
            assertEquals(item.id, view.selected()?.key)
        }
        edt { controller.reload() }
        flush()
        assertEquals(listOf(current.id, item.id), leaves(view).map { it.key })
        assertTrue(rpc.reorders.isEmpty())
    }

    fun `test repeated usable local reloads prune missing worktrees but not undiscovered cloud placement`() {
        val item = worktree("aardvark")
        val cloud = HostedWorkspaceRefDto("cloud", "missing")
        val props = PropertiesComponent.getInstance(project)
        val items = listOf(main().id, item.id, cloud.key).map { key ->
            object : ActiveItem { override val key = key; override val title = key }
        }
        val section = edt {
            val state = AgentManagerLayout(props)
            val section = state.create("Planning")
            state.nodes(items)
            state.move(ai.kilocode.client.ui.active.ActiveMove(item.id, 1, 0, listOf(item.id), parent = section.key))
            state.move(ai.kilocode.client.ui.active.ActiveMove(cloud.key, 1, 1, listOf(item.id, cloud.key), parent = section.key))
            section
        }
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        assertTrue(props.getValue("kilo.agentManager.layout")!!.contains(item.id))

        rpc.listed += main()
        repeat(WORKTREE_MISS_LIMIT - 1) {
            edt { controller.reload() }
            flush()
            assertTrue(props.getValue("kilo.agentManager.layout")!!.contains(item.id))
        }
        edt { controller.reload() }
        flush()

        assertFalse(props.getValue("kilo.agentManager.layout")!!.contains(item.id))
        val nodes = edt { AgentManagerLayout(props).nodes(items) }
        assertEquals(listOf(cloud.key), nodes.single { it.item.key == section.key }.children!!.map { it.item.key })
        assertEquals(listOf(main().id), leaves(tree(panel)).map { it.key })
    }

    fun `test temporarily unlisted worktrees retain placement and returning resets consecutive misses`() {
        val a = worktree("aardvark")
        val b = worktree("beluga")
        rpc.listed += listOf(main(), a, b)
        val props = PropertiesComponent.getInstance(project)
        val items = rpc.listed.map { dto ->
            object : ActiveItem { override val key = dto.id; override val title = dto.name }
        }
        val section = edt {
            val state = AgentManagerLayout(props)
            val section = state.create("Planning")
            state.nodes(items, pin = main().id)
            state.move(ai.kilocode.client.ui.active.ActiveMove(a.id, 1, 0, listOf(a.id), parent = section.key))
            state.move(ai.kilocode.client.ui.active.ActiveMove(b.id, 1, 1, listOf(main().id, b.id, section.key)))
            state.move(ai.kilocode.client.ui.active.ActiveMove(section.key, 2, 1, listOf(main().id, section.key, b.id)))
            section
        }
        val before = props.getValue("kilo.agentManager.layout")
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        rpc.listed.removeAll { !it.main }
        repeat(WORKTREE_MISS_LIMIT - 1) {
            edt { controller.reload() }
            flush()
            assertEquals(before, props.getValue("kilo.agentManager.layout"))
        }

        rpc.listed += listOf(b, a)
        edt { controller.reload() }
        flush()

        val view = tree(panel)
        edt {
            val entry = view.hierarchy.entries.getValue(section.key)
            assertSame(entry, view.hierarchy.entries.getValue(a.id).parent)
            assertEquals(listOf(main().id, section.key, b.id), roots(view))
        }
        assertEquals(listOf(main().id, a.id, b.id), leaves(view).map { it.key })

        rpc.listed.removeAll { !it.main }
        repeat(WORKTREE_MISS_LIMIT - 1) {
            edt { controller.reload() }
            flush()
            assertEquals(before, props.getValue("kilo.agentManager.layout"))
        }

        edt { controller.remove(a) }
        flush()
        assertFalse(props.getValue("kilo.agentManager.layout")!!.contains(a.id))
        assertTrue(props.getValue("kilo.agentManager.layout")!!.contains(b.id))
    }

    fun `test worktree list paints tool window background`() {
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller) }

        val list = edt { tree(panel) }
        val scroll = edt { SwingUtilities.getAncestorOfClass(JBScrollPane::class.java, list) as JBScrollPane }

        assertEquals(activeToolWindowBackground(), edt { panel.background })
        assertEquals(activeToolWindowBackground(), edt { list.background })
        assertEquals(activeToolWindowBackground(), edt { scroll.background })
        assertEquals(activeToolWindowBackground(), edt { scroll.viewport.background })
        assertEquals(activeToolWindowBackground(), edt { (scroll.viewport.view as JComponent).background })
        assertEquals(0, edt { scroll.viewportBorder.getBorderInsets(scroll).top })
    }

    fun `test worktree list renders row titles in plain weight`() {
        rpc.listed += worktree("aardvark")
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        @Suppress("UNCHECKED_CAST")
        val list = edt { tree(panel) }
        val title = edt {
            val row = leafEntry(list, 0).item
            val comp = rendered(list, leafEntry(list, 0), false, false)
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

        val list = edt { tree(panel) }
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

        val list = edt { tree(panel) }
        edt {
            list.setSize(400, 100)
            list.doLayout()
            val bounds = list.let { rowBounds(it, 0) }
            list.dispatchEvent(MouseEvent(
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
        assertNull(row(panel, 1).section)
        assertEquals(2, edt { tree(panel).hierarchy.root.childCount })

        val list = edt { tree(panel) }
        edt {
            list.setSize(400, 120)
            list.doLayout()
            val bounds = list.let { rowBounds(it, 0) }
            list.dispatchEvent(MouseEvent(
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
        val list = edt { tree(panel) }
        edt { selectLeaf(list, 1) }

        edt { controller.reload() }
        flush()

        assertEquals(second.id, edt { (selectedValue(list) as ActiveItem).key })
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
        val list = edt { tree(panel) }
        edt { selectLeaf(list, 1) }

        edt { panel.refresh() }
        flush()

        assertEquals(second.id, edt { (selectedValue(list) as ActiveItem).key })
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
        val list = edt { tree(panel) }
        edt {
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(second), focus = true)
            selectLeaf(list, 0)
            panel.refresh()
        }
        flush()

        assertEquals(first.id, edt { (selectedValue(list) as ActiveItem).key })
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
        val list = edt { tree(panel) }
        edt {
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(second), focus = true)
            panel.refresh()
        }
        flush()

        assertEquals(second.id, edt { (selectedValue(list) as ActiveItem).key })
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

        val list = edt { tree(panel) }
        edt {
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(second), focus = true)
        }
        pump()

        assertEquals(second.id, edt { (selectedValue(list) as ActiveItem).key })
    }

    fun `test selecting non worktree editor tab clears worktree row selection`() {
        val item = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")
        rpc.listed += item
        val controller = WorktreeController(service, "/test", coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val list = edt { tree(panel) }
        edt {
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(item), focus = true)
        }
        pump()
        assertEquals(item.id, edt { (selectedValue(list) as ActiveItem).key })

        val file = myFixture.addFileToProject("src/Main.kt", "fun main() = Unit").virtualFile
        edt { FileEditorManager.getInstance(project).openFile(file, true) }
        pump()

        assertEquals(-1, edt { selectedLeaf(list) })
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

        val list = edt { tree(panel) }
        assertEquals(-1, edt { selectedLeaf(list) })
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

        val list = edt { tree(panel) }
        edt { FileEditorManager.getInstance(project).openFile(file, true) }
        pump()

        assertEquals(item.id, edt { (selectedValue(list) as ActiveItem).key })
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
        val list = edt { tree(panel) }

        edt {
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(b), focus = true)
        }
        pump()
        assertEquals(b.id, edt { (selectedValue(list) as ActiveItem).key })

        edt { controller.remove(b) }
        flush()

        assertEquals(c.id, edt { (selectedValue(list) as ActiveItem).key })
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
        val list = edt { tree(panel) }

        edt {
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(b), focus = true)
        }
        pump()
        assertEquals(b.id, edt { (selectedValue(list) as ActiveItem).key })

        edt { controller.remove(b) }
        flush()

        assertEquals(a.id, edt { (selectedValue(list) as ActiveItem).key })
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
        val list = edt { tree(panel) }

        edt {
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(a), focus = true)
        }
        pump()
        assertEquals(a.id, edt { (selectedValue(list) as ActiveItem).key })

        edt { controller.remove(b) }
        flush()

        assertEquals(a.id, edt { (selectedValue(list) as ActiveItem).key })
        val file = edt { FileEditorManager.getInstance(project).openFiles.single() as KiloVirtualFile }
        assertEquals(a.path, file.path.params["path"])
    }

    fun `test deleting a reordered worktree opens its visual neighbor inside a section`() {
        val a = worktree("aardvark")
        val b = worktree("beluga")
        val c = worktree("cougar")
        rpc.listed += listOf(a, b, c)
        val section = edt { AgentManagerLayout(PropertiesComponent.getInstance(project)).create("Planning") }
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        val view = tree(panel)
        layout(view)
        edt {
            val entry = view.hierarchy.entries.getValue(section.key)
            view.over(a.id, center(view.regions.cell(entry)))
            view.drop()
            val cell = view.regions.cell(view.hierarchy.entries.getValue(a.id))
            view.over(c.id, Point(cell.x + cell.width / 2, cell.y))
            view.drop()
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(c), focus = true)
        }
        pump()
        assertEquals(listOf(b.id, c.id, a.id), leaves(view).map { it.key })

        edt { controller.remove(c) }
        flush()

        assertEquals(a.id, edt { view.selected()?.key })
        val file = edt { FileEditorManager.getInstance(project).openFiles.single() as KiloVirtualFile }
        assertEquals(a.path, file.path.params["path"])
        assertFalse(PropertiesComponent.getInstance(project).getValue("kilo.agentManager.layout")!!.contains(c.id))
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
        assertEquals(emptyList<ActiveBadge>(), row.badges)
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

        val list = edt { tree(panel) }
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

        val metrics: ActiveMetrics = row(panel, 0).metrics ?: error("expected metrics")
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
            val view = tree(panel)
            val list = view
            list.setSize(560, 160)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            list.clearSelection()
            val cell = hitIds(list, 0).getValue(ACTIVE_CHANGES_CELL)
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
            val view = tree(panel)
            view.setSize(480, 600)
            view.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            for (index in listOf(0, 1, 2, 3)) {
                assertTrue(hitIds(view, index).containsKey(ACTIVE_CHANGES_CELL))
            }
            for (index in listOf(4, 5)) {
                assertFalse(hitIds(view, index).containsKey(ACTIVE_CHANGES_CELL))
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

        waitUntil { row(panel, 0).metrics?.action != null }
        edt { row(panel, 0).metrics!!.action!!() }
        waitUntil { opened().isNotEmpty() }
        assertEquals("branch", opened().single().path.params["source"])
        edt { FileEditorManager.getInstance(project).openFiles.forEach { FileEditorManager.getInstance(project).closeFile(it) } }

        waitUntil { row(panel, 1).metrics?.action != null }
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
            val view = tree(panel)
            val list = view
            list.setSize(560, 160)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            list.clearSelection()
            val bounds = rowBounds(list, 0)
            val renderer = rendered(list, leafEntry(list, 0), false, true)
            renderer.setSize(bounds.width, bounds.height)
            components(renderer).filterIsInstance<Container>().forEach { it.doLayout() }
            assertEquals(
                listOf("3 files", "-1", "+2"),
                components(renderer).filterIsInstance<JBLabel>().filter { it.isVisible && !it.text.isNullOrEmpty() }
                    .map { it.text },
            )

            val point = center(hitIds(list, 0).getValue(ACTIVE_CHANGES_CELL))
            val hover = MouseEvent(list, MouseEvent.MOUSE_MOVED, System.currentTimeMillis(), 0, point.x, point.y, 0, false)
            list.mouseMotionListeners.forEach { it.mouseMoved(hover) }
            assertEquals(Cursor.HAND_CURSOR, list.cursor.type)
            assertEquals(KiloBundle.message("worktree.dirty.tooltip.open"), list.getToolTipText(hover))
            for (id in listOf(MouseEvent.MOUSE_PRESSED, MouseEvent.MOUSE_RELEASED, MouseEvent.MOUSE_CLICKED)) {
                list.dispatchEvent(MouseEvent(
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
            val view = tree(panel)
            val list = view
            list.setSize(480, 320)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            val areas = (0..1).associateWith { hitIds(list, it).getValue(ACTIVE_CHANGES_CELL) }
            hitIds(list, 0)
            for (index in listOf(1, 0, 1)) {
                val point = center(areas.getValue(index))
                for (id in listOf(MouseEvent.MOUSE_PRESSED, MouseEvent.MOUSE_RELEASED, MouseEvent.MOUSE_CLICKED)) {
                    list.dispatchEvent(MouseEvent(
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
        val gate = CompletableDeferred<Unit>()
        rpc.beforePrStatus = { gate.await() }
        val timers = TestUiTimers()
        ApplicationManager.getApplication().replaceService(KiloWorktreeService::class.java, service, testRootDisposable)
        project.replaceService(WorktreeStatusService::class.java, WorktreeStatusService(project, coroutines.scope, timers), testRootDisposable)
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        timers.advanceBy(300)
        flush()

        assertFalse(edt { panel.canOpenPr(item) })
        assertTrue(edt { panel.canRename(item) })

        gate.complete(Unit)
        // The status binding uses Dispatchers.Default, which flush() does not drain.
        waitUntil { panel.canOpenPr(item) }

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

    fun `test current row PR badge follows manual branch reloads`() {
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

        val gate = CompletableDeferred<Unit>()
        rpc.beforePrStatus = { gate.await() }
        rpc.prResult = WorktreePrListDto(
            GhAvailability.OK,
            listOf(WorktreePrDto(main.path, 13, GhState.OPEN, "https://example.test/pr/13", "Feature work")),
        )
        rpc.listed[0] = main.copy(branch = "feature/y")
        edt { controller.reload() }
        waitUntil { row(panel, 0).title == "feature/y" }
        waitUntil { rpc.prCalls.size == 2 && row(panel, 0).secondaryBadges.isEmpty() }

        assertFalse(edt { panel.canOpenPr(main) })
        assertEquals(0L, rpc.prAges.last())
        assertEquals(listOf(main.path), rpc.prFresh.last())

        gate.complete(Unit)
        waitUntil { row(panel, 0).secondaryBadges.singleOrNull()?.text == "#13" }
        assertEquals("feature/y", row(panel, 0).title)
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
            val view = tree(panel)
            val list = view
            list.setSize(560, 160)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            list.clearSelection()
            val areas = hitIds(list, 0)
            val comments = areas.getValue("pr-comments")
            val review = areas.getValue("pr-review")
            val checks = areas.getValue("pr-checks")
            val badge = areas.getValue("pull-request")
            assertTrue("conversations must sit left of the review", comments.x + comments.width <= review.x)
            assertTrue("review must sit left of the run status", review.x + review.width <= checks.x)
            assertTrue(kotlin.math.abs(center(comments).y - center(review).y) <= 1)
            assertTrue(kotlin.math.abs(center(review).y - center(checks).y) <= 1)

            val renderer = rendered(list, leafEntry(list, 0), false, true)
            renderer.setSize(rowBounds(list, 0).width, rowBounds(list, 0).height)
            components(renderer).filterIsInstance<Container>().forEach { it.doLayout() }
            val title = rowTitle(renderer)
            val header = SwingUtilities.convertPoint(title, 0, 0, renderer)
            val bounds = list.let { rowBounds(it, 0) }
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
            val list = tree(panel)
            list.setSize(560, 160)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            val renderer = rendered(list, leafEntry(list, 0), false, true)
            val cell = components(renderer)
                .filterIsInstance<ActiveBadgeCell>()
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
            val list = tree(panel)
            list.setSize(560, 160)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            val renderer = rendered(list, leafEntry(list, 0), true, true)
            val cell = components(renderer)
                .filterIsInstance<ActiveBadgeCell>()
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
        val list = edt { tree(panel) }
        edt {
            list.size = java.awt.Dimension(360, 80)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
        }
        val area = edt { hitIds(list, 0).getValue("pull-request") }

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
            val view = tree(panel)
            val list = view
            list.setSize(560, 160)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            list.clearSelection()
            val row = leafEntry(list, 0).item
            assertTrue(row.leading.isEmpty())
            assertTrue(row.badges.isEmpty())
            assertEquals("#7", row.secondaryBadges.single().text)
            assertEquals("pull-request", row.secondaryBadges.single().id)
            val areas = hitIds(list, 0)
            val badge = areas.getValue("pull-request")
            val changes = areas.getValue(ACTIVE_CHANGES_CELL)
            assertEquals(setOf("pull-request", ACTIVE_CHANGES_CELL), areas.keys)
            val renderer = rendered(list, leafEntry(list, 0), false, true)
            renderer.setSize(rowBounds(list, 0).width, rowBounds(list, 0).height)
            components(renderer).filterIsInstance<Container>().forEach { it.doLayout() }
            val (title, desc) = rowLines(renderer)
            val origin = SwingUtilities.convertPoint(desc, 0, 0, renderer)
            val header = SwingUtilities.convertPoint(title, 0, 0, renderer)
            val bounds = list.let { rowBounds(it, 0) }
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
                list.dispatchEvent(MouseEvent(
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
        assertEquals(emptyList<ActiveBadge>(), pending.leading)
        assertEquals(emptyList<ActiveBadge>(), pending.badges)
        assertEquals(emptyList<ActiveBadge>(), pending.secondaryBadges)
        assertNull(pending.metrics)
        gate.complete(Unit)
        flush()
    }

    fun `test dragging a worktree above another persists the unified display order`() {
        val a = worktree("aardvark")
        val b = worktree("beluga")
        rpc.listed += main()
        rpc.listed += a
        rpc.listed += b
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val view = edt { tree(panel) }
        layout(view)
        // Display order: current (main) row is index 0, then a (1), b (2).
        edt {
            assertEquals(b.id, view.pickable(rowCenter(view, 2)))
            view.over(b.id, rowCenter(view, 1).apply { y-- })
            view.drop()
        }
        flush()

        assertEquals(listOf(main().id, b.id, a.id), leaves(view).map { it.key })
        assertTrue(rpc.reorders.isEmpty())
        val restored = edt { AgentManagerLayout(PropertiesComponent.getInstance(project)) }
        assertEquals(listOf(main().id, b.id, a.id), edt {
            restored.nodes(leaves(view).map { it.item }.reversed()).map { it.item.key }
        })
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

        val view = edt { tree(panel) }
        layout(view)
        edt {
            assertTrue(view.select(b.id))
            view.over(b.id, rowCenter(view, 1).apply { y-- })
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

        val view = edt { tree(panel) }
        edt {
            assertTrue(view.select(item.id))
            controller.rename(item, "renamed", onFailure = {})
        }
        flush()

        assertEquals(item.id, edt { view.selected()?.key })
        assertEquals("renamed", edt { (view.selected() as ActiveItem).title })
    }

    fun `test primary and pending rows are not draggable while normal worktrees are`() {
        val item = worktree("aardvark")
        rpc.listed += main()
        rpc.listed += item
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val gate = CompletableDeferred<Unit>()
        rpc.beforeCreate = { gate.await() }
        edt { controller.create("feature/pending", null) }
        val view = edt { tree(panel) }
        layout(view)

        edt {
            // Row 0 is the current (main) row; row 1 is the pending create.
            assertNull(view.pickable(rowCenter(view, 0)))
            assertNull(view.pickable(rowCenter(view, 1)))
            assertEquals(item.id, view.pickable(rowCenter(view, 2)))
        }
        gate.complete(Unit)
        flush()
    }

    fun `test primary flag pins a feature checkout while a linked worktree named main can move`() {
        val current = main().copy(branch = "feature/primary")
        val item = worktree("main")
        rpc.listed += listOf(item, current)
        val section = edt { AgentManagerLayout(PropertiesComponent.getInstance(project)).create("Planning") }
        val controller = WorktreeController(service, item.path, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        val view = tree(panel)
        layout(view)

        edt {
            val primary = view.hierarchy.entries.getValue(current.id)
            val entry = view.hierarchy.entries.getValue(item.id)
            val group = view.hierarchy.entries.getValue(section.key)
            val frame = view.regions.cell(primary)
            val cell = view.regions.cell(entry)
            assertEquals("feature/primary", primary.item.title)
            assertNull(primary.item.progress)
            assertNull(view.pickable(Point(frame.x + 8, frame.y + frame.height / 2)))
            assertEquals(item.id, view.pickable(Point(cell.x + 8, cell.y + cell.height / 2)))
            assertTrue(view.select(current.id))
            val before = roots(view)
            assertEquals(current.id, before.first())

            for (point in listOf(center(view.regions.cell(group)), Point(frame.x + 8, view.height))) {
                view.over(current.id, point)

                assertSame(view.hierarchy.root, primary.parent)
                assertEquals(before, roots(view))
                assertFalse(view.placeholder(primary))
                assertEquals(current.id, view.selected()?.key)
                view.drop()
            }

            view.over(item.id, center(view.regions.cell(group)))

            assertSame(group, entry.parent)
            assertTrue(view.placeholder(entry))
            assertEquals(current.id, roots(view).first())
            view.drop()
            assertSame(group, entry.parent)
            assertEquals(item.id, view.selected()?.key)
        }
        assertTrue(rpc.reorders.isEmpty())
    }

    fun `test root worktrees sections and section children cannot preview before the primary checkout`() {
        val current = main()
        val item = worktree("aardvark")
        val other = worktree("beluga")
        rpc.listed += listOf(current, item, other)
        val props = PropertiesComponent.getInstance(project)
        val section = edt {
            val state = AgentManagerLayout(props)
            val section = state.create("Planning")
            state.nodes(rpc.listed.map { dto ->
                object : ActiveItem { override val key = dto.id; override val title = dto.name }
            }, pin = current.id)
            state.move(ActiveMove(item.id, 1, 0, listOf(item.id), parent = section.key))
            section
        }
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        val view = tree(panel)
        layout(view)

        edt {
            val frame = view.regions.cell(view.hierarchy.entries.getValue(current.id))
            val before = listOf(current.id, other.id, section.key)
            assertEquals(before, roots(view))
            assertTrue(view.select(current.id))
            val saved = props.getValue("kilo.agentManager.layout")
            for (key in listOf(other.id, section.key, item.id)) {
                val entry = view.hierarchy.entries.getValue(key)
                val parent = entry.parent

                view.over(key, Point(frame.x + 1, frame.y))

                assertEquals(before, roots(view))
                assertSame(parent, entry.parent)
                assertFalse(view.placeholder(entry))
                assertEquals(current.id, view.selected()?.key)
                view.drop()
                assertEquals(before, roots(view))
                assertEquals(saved, props.getValue("kilo.agentManager.layout"))
            }
        }
        assertTrue(rpc.reorders.isEmpty())
    }

    fun `test repaired primary placement and selection survive reload and panel reconstruction`() {
        val current = main()
        val item = worktree("aardvark")
        val other = worktree("beluga")
        rpc.listed += listOf(current, item, other)
        val props = PropertiesComponent.getInstance(project)
        val section = edt {
            val state = AgentManagerLayout(props)
            val section = state.create("Planning")
            state.color(section.key, "purple")
            // Reproduce a layout saved before primary checkouts were pinned.
            state.nodes(rpc.listed.map { dto ->
                object : ActiveItem { override val key = dto.id; override val title = dto.name }
            })
            state.move(ActiveMove(current.id, 0, 0, listOf(current.id), parent = section.key))
            state.move(ActiveMove(item.id, 0, 1, listOf(current.id, item.id), parent = section.key))
            state.move(ActiveMove(section.key, 1, 0, listOf(section.key, other.id)))
            section
        }
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()
        val view = tree(panel)
        layout(view)
        val primary = edt { view.hierarchy.entries.getValue(current.id) }
        edt {
            assertEquals(listOf(current.id, section.key, other.id), roots(view))
            assertSame(view.hierarchy.root, primary.parent)
            assertSame(view.hierarchy.entries.getValue(section.key), view.hierarchy.entries.getValue(item.id).parent)
            ensureWorktreeSessionEditorKind()
            project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(current), focus = true)
            assertTrue(view.select(current.id))
        }
        flush()
        val saved = props.getValue("kilo.agentManager.layout")
        rpc.listed.clear()
        rpc.listed += listOf(other, current.copy(branch = "feature/reloaded"), item)

        edt { controller.reload() }
        flush()

        edt {
            assertEquals(listOf(current.id, section.key, other.id), roots(view))
            assertSame(primary, view.hierarchy.entries.getValue(current.id))
            assertEquals("feature/reloaded", primary.item.title)
            assertEquals(current.id, view.selected()?.key)
            assertEquals(saved, props.getValue("kilo.agentManager.layout"))
            Disposer.dispose(panel)
        }
        val next = WorktreeController(service, project.basePath!!, coroutines.scope)
        edt { next.reload() }
        flush()
        val rebuilt = edt { AgentManagerPanel(testRootDisposable, next, project) }
        flush()
        val restored = tree(rebuilt)
        layout(restored)

        edt {
            assertEquals(listOf(current.id, section.key, other.id), roots(restored))
            val entry = restored.hierarchy.entries.getValue(current.id)
            assertSame(restored.hierarchy.root, entry.parent)
            assertNull(restored.pickable(rowCenter(restored, 0)))
            assertEquals(current.id, restored.selected()?.key)
            val group = restored.hierarchy.entries.getValue(section.key)
            assertSame(group, restored.hierarchy.entries.getValue(item.id).parent)
            assertEquals(ai.kilocode.client.ui.tree.ActiveTreeColors.color("purple"), group.color)
            assertEquals(saved, props.getValue("kilo.agentManager.layout"))
        }
        assertTrue(rpc.reorders.isEmpty())
    }

    fun `test unified display order survives a backend refresh`() {
        val a = worktree("aardvark")
        val b = worktree("beluga")
        rpc.listed += main()
        rpc.listed += a
        rpc.listed += b
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        flush()

        val view = edt { tree(panel) }
        layout(view)
        edt {
            view.over(b.id, rowCenter(view, 1).apply { y-- })
            view.drop()
            controller.reload()
        }
        flush()

        assertEquals(listOf(a.path, b.path), edt { worktreeIds(controller) })
        assertEquals(listOf(main().id, b.id, a.id), leaves(view).map { it.key })
        assertTrue(rpc.reorders.isEmpty())
    }

    fun `test cloud rows share busy indicators and popup context without reloading or losing selection`() {
        val ref = HostedWorkspaceRefDto("cloud", "one")
        val other = HostedWorkspaceRefDto("cloud", "two")
        val key = HostedIDs.session(ref.providerID, ref.workspaceID, "same")
        val second = HostedIDs.session(other.providerID, other.workspaceID, "same")
        val third = HostedIDs.session(other.providerID, other.workspaceID, "sibling")
        val items = listOf(
            HostedWorkspaceDto(ref, name = "Cloud one", sessions = listOf(HostedWorkspaceSessionDto(key, "same"))),
            HostedWorkspaceDto(other, name = "Cloud two", sessions = listOf(
                HostedWorkspaceSessionDto(second, "same"), HostedWorkspaceSessionDto(third, "sibling"))),
        )
        val calls = java.util.concurrent.CopyOnWriteArrayList<String?>()
        val hosted = KiloHostedService(coroutines.scope, object : KiloHostedRpcApi {
            override suspend fun providers(): List<HostedProviderDto> = emptyList()
            override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?): HostedWorkspaceListDto {
                calls += repositoryUrl
                return HostedWorkspaceListDto(items)
            }
            override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?) = items.single { it.ref == ref }
            override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedWorkspaceStatusDto(ref, "active", "active", "sandbox_ready", 100.0, hasActiveTurn = ref == other)
            override suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String, organizationID: String?): Flow<HostedSystemEventDto> = emptyFlow()
            override suspend fun workspaceProfiles(organizationID: String?) =
                ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto()
            override suspend fun setPersonalDefaultProfile(profileID: String) =
                ai.kilocode.rpc.dto.HostedProfileDefaultDto(success = true)
            override suspend fun createWorkspace(request: ai.kilocode.rpc.dto.HostedCreateWorkspaceDto) =
                ai.kilocode.rpc.dto.HostedMutationResultDto()
            override suspend fun startWorkspaceSession(ref: HostedWorkspaceRefDto, request: ai.kilocode.rpc.dto.HostedStartSessionDto) =
                ai.kilocode.rpc.dto.HostedMutationResultDto()
            override suspend fun deleteWorkspace(ref: HostedWorkspaceRefDto, organizationID: String?) =
                ai.kilocode.rpc.dto.HostedDeleteResultDto(ref)
        }, gate = { true }, log = TestLog(), repo = { "repo" })
        val sessions = FakeSessionRpcApi()
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        project.replaceService(KiloSessionService::class.java,
            KiloSessionService(project, coroutines.scope, sessions), testRootDisposable)
        val section = edt { AgentManagerLayout(PropertiesComponent.getInstance(project)).create("Planning") }
        rpc.listed += main()
        rpc.listed += worktree("aardvark")
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        waitUntil { rows(panel) == 4 }
        val view = tree(panel)
        edt {
            assertEquals(listOf(main().id, worktree("aardvark").id, ref.key, other.key), leaves(view).map { it.key })
            assertTrue(leaves(view).all { it.parent === view.hierarchy.root })
            assertTrue(view.select(ref.key))
            val row = row(panel, 2) as HostedWorkspaceRow
            assertEquals("Active", row.badges.single().text)
            assertSame(HostedWorkspaceIcons.cloud, row.icon)
            assertSame(SpinnerIcon.icon, row(panel, 3).icon)
            assertEquals("Cloud", row.section)
            val context = context(panel)
            assertEquals(project, com.intellij.openapi.actionSystem.CommonDataKeys.PROJECT.getData(context))
            assertEquals(items.first(), HostedWorkspaceDataKeys.WORKSPACE.getData(context))
            assertNull(WorktreeDataKeys.WORKTREE.getData(context))
            panel.addNotify()
            Disposer.register(testRootDisposable) { panel.removeNotify() }
            layout(view)
            val point = rowCenter(view, 2)
            val screen = Point(point)
            SwingUtilities.convertPointToScreen(screen, view)
            IdeEventQueue.getInstance().dispatchEvent(MouseEvent(view, MouseEvent.MOUSE_MOVED, 0, 0,
                point.x, point.y, screen.x, screen.y, 0, false, MouseEvent.NOBUTTON))
            val menu = hitIds(view, 2).getValue(ACTIVE_MENU_CELL)
            assertFalse("Cloud rows must render a usable menu glyph", menu.isEmpty)
            val at = center(menu)
            val move = MouseEvent(view, MouseEvent.MOUSE_MOVED, 0, 0,
                at.x, at.y, 0, 0, 0, false, MouseEvent.NOBUTTON)
            val hit = view.regions.hit(move, enabled = true)
            assertEquals(ref.key, hit?.entry?.key)
            assertEquals(ACTIVE_MENU_CELL, hit?.id)
        }
        sessions.statuses.value = mapOf(second to SessionStatusDto("idle"))
        coroutines.drain()
        edt { assertSame(SpinnerIcon.icon, row(panel, 3).icon) }
        sessions.statuses.value = mapOf(key to SessionStatusDto("busy"), second to SessionStatusDto("idle"), third to SessionStatusDto("idle"))
        waitUntil { row(panel, 2).icon === SpinnerIcon.icon && row(panel, 3).icon === HostedWorkspaceIcons.cloud }
        sessions.activity.value = mapOf(key to SessionActivityDto("/cloud", SessionActivityKindDto.PERMISSION))
        waitUntil { row(panel, 2).icon === WorktreeIcons.forRow(false, SessionActivityKind.PERMISSION) }
        sessions.activity.value = emptyMap()
        sessions.statuses.value = mapOf(key to SessionStatusDto("idle"), second to SessionStatusDto("idle"), third to SessionStatusDto("idle"))
        waitUntil { row(panel, 2).icon === HostedWorkspaceIcons.cloud }
        edt {
            assertEquals(ref.key, view.selected()?.key)
            assertEquals(1, calls.size)
            assertTrue(view.select(worktree("aardvark").id))
            val context = context(panel)
            assertNull(HostedWorkspaceDataKeys.WORKSPACE.getData(context))
            assertNotNull(WorktreeDataKeys.WORKTREE.getData(context))
            val entry = view.hierarchy.entries.getValue(section.key)
            assertEquals(ref.key, view.pickable(rowCenter(view, 2)))
            view.over(ref.key, center(view.regions.cell(entry)))
            view.drop()
            assertSame(entry, view.hierarchy.entries.getValue(ref.key).parent)
            view.over(worktree("aardvark").id, center(view.regions.cell(entry)))
            view.drop()
            assertEquals(listOf(ref.key, worktree("aardvark").id),
                (0 until entry.childCount).map { (entry.getChildAt(it) as ActiveEntry).key })
            val cell = view.regions.cell(view.hierarchy.entries.getValue(main().id))
            view.over(ref.key, Point(cell.x + 1, cell.y))
            assertSame(entry, view.hierarchy.entries.getValue(ref.key).parent)
            assertFalse(view.placeholder(view.hierarchy.entries.getValue(ref.key)))
            assertEquals(main().id, roots(view).first())
            view.drop()
            view.over(ref.key, Point(cell.x + cell.width / 2, cell.y + cell.height - 1))
            assertSame(view.hierarchy.root, view.hierarchy.entries.getValue(ref.key).parent)
            assertTrue(view.placeholder(view.hierarchy.entries.getValue(ref.key)))
            assertEquals(main().id, roots(view).first())
            view.drop()
            assertSame(view.hierarchy.root, view.hierarchy.entries.getValue(ref.key).parent)
            assertSame(entry, view.hierarchy.entries.getValue(worktree("aardvark").id).parent)
        }
    }

    fun `test cloud create without a profile shows a pending row and delete reuses local progress`() {
        val createdRef = HostedWorkspaceRefDto("cloud", "created")
        val session = HostedWorkspaceSessionDto(
            HostedIDs.session(createdRef.providerID, createdRef.workspaceID, "root"),
            "root",
        )
        val created = HostedWorkspaceDto(createdRef, name = "Created", sessions = listOf(session))
        val createGate = CompletableDeferred<Unit>()
        val deleteGate = CompletableDeferred<Unit>()
        var createdOnce = false
        var deleted = false
        val calls = java.util.concurrent.CopyOnWriteArrayList<String?>()
        val hosted = KiloHostedService(coroutines.scope, object : KiloHostedRpcApi {
            override suspend fun providers(): List<HostedProviderDto> = emptyList()
            override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?): HostedWorkspaceListDto {
                calls += repositoryUrl
                return HostedWorkspaceListDto(if (createdOnce && !deleted) listOf(created) else emptyList())
            }
            override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?) = created
            override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedWorkspaceStatusDto(ref, "active", "active", "sandbox_ready", 100.0)
            override suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String, organizationID: String?): Flow<HostedSystemEventDto> = emptyFlow()
            override suspend fun workspaceProfiles(organizationID: String?) =
                ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto()
            override suspend fun setPersonalDefaultProfile(profileID: String) =
                ai.kilocode.rpc.dto.HostedProfileDefaultDto(success = true)
            override suspend fun createWorkspace(request: HostedCreateWorkspaceDto): HostedMutationResultDto {
                assertNull(request.profileID)
                createGate.await()
                createdOnce = true
                return HostedMutationResultDto(workspace = created, session = session)
            }
            override suspend fun startWorkspaceSession(ref: HostedWorkspaceRefDto, request: ai.kilocode.rpc.dto.HostedStartSessionDto) =
                HostedMutationResultDto()
            override suspend fun deleteWorkspace(ref: HostedWorkspaceRefDto, organizationID: String?): HostedDeleteResultDto {
                deleteGate.await()
                deleted = true
                return HostedDeleteResultDto(ref, success = true)
            }
        }, gate = { true }, log = TestLog(), repo = { "https://github.com/kilo-org/example" })
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        project.replaceService(KiloSessionService::class.java,
            KiloSessionService(project, coroutines.scope, FakeSessionRpcApi()), testRootDisposable)
        rpc.listed += main()
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        waitUntil { rows(panel) == 1 }

        val request = HostedCreateWorkspaceDto(
            repository = HostedRepositoryDto("github", repo = "kilo-org/example"),
            prompt = "Build it",
            agent = HostedAgentDto("code", "kilo/kilo-auto/free"),
            operationKey = "00000000-0000-4000-8000-000000000001",
            messageID = "msg_00000000000100000000000000",
        )
        edt { panel.createHosted(request) }
        flush()

        val view = tree(panel)
        val pending = edt { selectedValue(view)!! }
        assertTrue(pending.key.contains(HostedWorkspaceEditorKind.PENDING_PREFIX))
        assertEquals(KiloBundle.message("hosted.workspace.progress.creating.short"), pending.progress)
        assertEmpty(pending.badges)
        val pendingFile = edt { FileEditorManager.getInstance(project).openFiles.single() as KiloVirtualFile }
        assertEquals(HostedWorkspaceEditorKind.ID, pendingFile.path.kind)
        assertTrue(pendingFile.path.params[HostedWorkspaceEditorKind.WORKSPACE]!!.startsWith(HostedWorkspaceEditorKind.PENDING_PREFIX))

        createGate.complete(Unit)
        waitUntil { rows(panel) == 2 && edt { selectedValue(view)?.key } == createdRef.key }
        waitUntil { calls.size == 2 }
        assertFalse(PropertiesComponent.getInstance(project).getValue("kilo.agentManager.layout")!!.contains(pending.key))

        val removal = project.service<HostedWorkspaceRemoval>()
        edt { removal.delete(createdRef, project.basePath!!) }
        waitUntil { (row(panel, 1) as HostedWorkspaceRow).progress == KiloBundle.message("common.deleting") }
        assertEmpty((row(panel, 1) as HostedWorkspaceRow).badges)
        assertEquals(2, calls.size)

        deleteGate.complete(Unit)
        waitUntil { rows(panel) == 1 && calls.size == 3 }
        // Successful deletion forgets the workspace entirely instead of leaving it in the
        // persisted exclusion set.
        assertFalse(project.service<HostedManagementService>().excluded(createdRef))
        assertFalse(PropertiesComponent.getInstance(project).getValue("kilo.agentManager.layout")!!.contains(createdRef.key))
    }

    fun `test cloud create keeps its row through a stale discovery`() {
        val createdRef = HostedWorkspaceRefDto("cloud", "created")
        val session = HostedWorkspaceSessionDto(
            HostedIDs.session(createdRef.providerID, createdRef.workspaceID, "root"),
            "root",
        )
        val created = HostedWorkspaceDto(createdRef, name = "Created", sessions = listOf(session))
        val first = CompletableDeferred<Unit>()
        val second = CompletableDeferred<Unit>()
        val create = CompletableDeferred<Unit>()
        val calls = java.util.concurrent.atomic.AtomicInteger()
        var createdOnce = false
        val hosted = KiloHostedService(coroutines.scope, object : KiloHostedRpcApi {
            override suspend fun providers(): List<HostedProviderDto> = emptyList()
            override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?): HostedWorkspaceListDto {
                val call = calls.incrementAndGet()
                val listed = createdOnce
                when (call) {
                    1 -> first.await()
                    2 -> second.await()
                }
                return HostedWorkspaceListDto(if (listed) listOf(created) else emptyList())
            }
            override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?) = created
            override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedWorkspaceStatusDto(ref, "active", "active", "sandbox_ready", 100.0)
            override suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String, organizationID: String?): Flow<HostedSystemEventDto> = emptyFlow()
            override suspend fun workspaceProfiles(organizationID: String?) =
                ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto()
            override suspend fun setPersonalDefaultProfile(profileID: String) =
                ai.kilocode.rpc.dto.HostedProfileDefaultDto(success = true)
            override suspend fun createWorkspace(request: HostedCreateWorkspaceDto): HostedMutationResultDto {
                create.await()
                createdOnce = true
                return HostedMutationResultDto(workspace = created, session = session)
            }
            override suspend fun startWorkspaceSession(ref: HostedWorkspaceRefDto, request: ai.kilocode.rpc.dto.HostedStartSessionDto) =
                HostedMutationResultDto()
            override suspend fun deleteWorkspace(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedDeleteResultDto(ref, success = true)
        }, gate = { true }, log = TestLog(), repo = { "https://github.com/kilo-org/example" })
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        project.replaceService(KiloSessionService::class.java,
            KiloSessionService(project, coroutines.scope, FakeSessionRpcApi()), testRootDisposable)
        rpc.listed += main()
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        waitUntil { rows(panel) == 1 && calls.get() == 1 }

        val request = HostedCreateWorkspaceDto(
            repository = HostedRepositoryDto("github", repo = "kilo-org/example"),
            profileID = "profile",
            prompt = "Build it",
            agent = HostedAgentDto("code", "kilo/kilo-auto/free"),
            operationKey = "00000000-0000-4000-8000-000000000004",
            messageID = "msg_00000000000400000000000000",
        )
        edt { panel.createHosted(request) }
        val view = tree(panel)
        assertTrue(edt { selectedValue(view)!!.key }.contains(HostedWorkspaceEditorKind.PENDING_PREFIX))

        create.complete(Unit)
        waitUntil { rows(panel) == 2 && edt { selectedValue(view)?.key } == createdRef.key }

        first.complete(Unit)
        waitUntil { calls.get() == 2 }
        assertEquals(2, rows(panel))
        assertEquals(createdRef.key, edt { selectedValue(view)?.key })

        second.complete(Unit)
        waitUntil { rows(panel) == 2 && (row(panel, 1) as HostedWorkspaceRow).data.dto.ref == createdRef }
        assertEquals(createdRef.key, edt { selectedValue(view)?.key })
    }

    fun `test cloud create keeps its row when discovery fails`() {
        val createdRef = HostedWorkspaceRefDto("cloud", "created")
        val session = HostedWorkspaceSessionDto(
            HostedIDs.session(createdRef.providerID, createdRef.workspaceID, "root"),
            "root",
        )
        val created = HostedWorkspaceDto(createdRef, name = "Created", sessions = listOf(session))
        var createdOnce = false
        var fail = false
        val calls = java.util.concurrent.atomic.AtomicInteger()
        val hosted = KiloHostedService(coroutines.scope, object : KiloHostedRpcApi {
            override suspend fun providers(): List<HostedProviderDto> = emptyList()
            override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?): HostedWorkspaceListDto {
                calls.incrementAndGet()
                if (fail) error("discovery failed")
                return HostedWorkspaceListDto(if (createdOnce) listOf(created) else emptyList())
            }
            override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?) = created
            override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedWorkspaceStatusDto(ref, "active", "active", "sandbox_ready", 100.0)
            override suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String, organizationID: String?): Flow<HostedSystemEventDto> = emptyFlow()
            override suspend fun workspaceProfiles(organizationID: String?) =
                ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto()
            override suspend fun setPersonalDefaultProfile(profileID: String) =
                ai.kilocode.rpc.dto.HostedProfileDefaultDto(success = true)
            override suspend fun createWorkspace(request: HostedCreateWorkspaceDto): HostedMutationResultDto {
                createdOnce = true
                return HostedMutationResultDto(workspace = created, session = session)
            }
            override suspend fun startWorkspaceSession(ref: HostedWorkspaceRefDto, request: ai.kilocode.rpc.dto.HostedStartSessionDto) =
                HostedMutationResultDto()
            override suspend fun deleteWorkspace(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedDeleteResultDto(ref, success = true)
        }, gate = { true }, log = TestLog(), repo = { "https://github.com/kilo-org/example" })
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        project.replaceService(KiloSessionService::class.java,
            KiloSessionService(project, coroutines.scope, FakeSessionRpcApi()), testRootDisposable)
        rpc.listed += main()
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        waitUntil { rows(panel) == 1 && calls.get() == 1 && !hosted.state.value.loading }

        fail = true
        val request = HostedCreateWorkspaceDto(
            repository = HostedRepositoryDto("github", repo = "kilo-org/example"),
            profileID = "profile",
            prompt = "Build it",
            agent = HostedAgentDto("code", "kilo/kilo-auto/free"),
            operationKey = "00000000-0000-4000-8000-000000000006",
            messageID = "msg_00000000000600000000000000",
        )
        edt { panel.createHosted(request) }
        waitUntil { calls.get() == 2 && hosted.state.value.error != null }
        assertEquals(2, rows(panel))

        fail = false
        edt { hosted.refresh(project.basePath!!) }
        waitUntil { hosted.state.value.error == null && hosted.state.value.items.any { it.ref == createdRef } }
        assertEquals(2, rows(panel))
        assertEquals(createdRef.key, (row(panel, 1) as HostedWorkspaceRow).data.dto.ref.key)
    }

    fun `test cloud workspace row uses latest session title`() {
        val ref = HostedWorkspaceRefDto("cloud", "workspace")
        val old = HostedWorkspaceSessionDto(
            id = HostedIDs.session(ref.providerID, ref.workspaceID, "old"),
            nativeSessionID = "old",
            title = "Old title",
            updated = 1.0,
        )
        val latest = old.copy(
            id = HostedIDs.session(ref.providerID, ref.workspaceID, "latest"),
            nativeSessionID = "latest",
            title = "OpenRouter API access",
            updated = 2.0,
        )
        val dto = HostedWorkspaceDto(
            ref = ref,
            name = "Workspace name",
            branch = "kilo/branch",
            sessions = listOf(old, latest),
        )
        val row = HostedWorkspaceRow(HostedWorkspaceRowData(dto, null))
        assertEquals("OpenRouter API access", row.title)
        assertEquals("kilo/branch", row.description)
        assertTrue(row.search.contains("OpenRouter API access"))
    }

    fun `test hosted rows participate in the platform delete action`() {
        val ref = HostedWorkspaceRefDto("cloud", "one")
        val key = HostedIDs.session(ref.providerID, ref.workspaceID, "same")
        val item = HostedWorkspaceDto(
            ref,
            name = "Cloud one",
            sessions = listOf(HostedWorkspaceSessionDto(key, "same")),
        )
        val hosted = KiloHostedService(coroutines.scope, object : KiloHostedRpcApi {
            override suspend fun providers(): List<HostedProviderDto> = emptyList()
            override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?) =
                HostedWorkspaceListDto(listOf(item))
            override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?) = item
            override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedWorkspaceStatusDto(ref, "active", "active", "sandbox_ready", 100.0)
            override suspend fun systemEvents(
                ref: HostedWorkspaceRefDto,
                sessionID: String,
                organizationID: String?,
            ): Flow<HostedSystemEventDto> = emptyFlow()
            override suspend fun workspaceProfiles(organizationID: String?) =
                ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto()
            override suspend fun setPersonalDefaultProfile(profileID: String) =
                ai.kilocode.rpc.dto.HostedProfileDefaultDto(success = true)
            override suspend fun createWorkspace(request: HostedCreateWorkspaceDto) =
                ai.kilocode.rpc.dto.HostedMutationResultDto()
            override suspend fun startWorkspaceSession(
                ref: HostedWorkspaceRefDto,
                request: ai.kilocode.rpc.dto.HostedStartSessionDto,
            ) = ai.kilocode.rpc.dto.HostedMutationResultDto()
            override suspend fun deleteWorkspace(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedDeleteResultDto(ref)
        }, gate = { true }, log = TestLog(), repo = { "repo" })
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        project.replaceService(
            KiloSessionService::class.java,
            KiloSessionService(project, coroutines.scope, FakeSessionRpcApi()),
            testRootDisposable,
        )
        rpc.listed += main()
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        val view = tree(panel)
        waitUntil { edt { view.select(ref.key) } }

        val context = edt { DataManager.getInstance().getDataContext(panel) }
        val sink = edt { DeleteProviderSink().also { panel.uiDataSnapshot(it) } }
        val provider = sink.provider
        assertNotNull(provider)
        assertTrue(edt { provider!!.canDeleteElement(context) })
    }

    fun `test booting cloud workspace shows the shared running spinner`() {
        val ref = HostedWorkspaceRefDto("cloud", "booting")
        val item = HostedWorkspaceDto(ref, name = "Cloud booting")
        val hosted = KiloHostedService(coroutines.scope, object : KiloHostedRpcApi {
            override suspend fun providers(): List<HostedProviderDto> = emptyList()
            override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?) =
                HostedWorkspaceListDto(listOf(item))
            override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?) = item
            override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedWorkspaceStatusDto(ref, "active", "starting", "sandbox_starting", 100.0)
            override suspend fun systemEvents(
                ref: HostedWorkspaceRefDto,
                sessionID: String,
                organizationID: String?,
            ): Flow<HostedSystemEventDto> = emptyFlow()
            override suspend fun workspaceProfiles(organizationID: String?) =
                ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto()
            override suspend fun setPersonalDefaultProfile(profileID: String) =
                ai.kilocode.rpc.dto.HostedProfileDefaultDto(success = true)
            override suspend fun createWorkspace(request: HostedCreateWorkspaceDto) =
                ai.kilocode.rpc.dto.HostedMutationResultDto()
            override suspend fun startWorkspaceSession(
                ref: HostedWorkspaceRefDto,
                request: ai.kilocode.rpc.dto.HostedStartSessionDto,
            ) = ai.kilocode.rpc.dto.HostedMutationResultDto()
            override suspend fun deleteWorkspace(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedDeleteResultDto(ref)
        }, gate = { true }, log = TestLog(), repo = { "repo" })
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        project.replaceService(
            KiloSessionService::class.java,
            KiloSessionService(project, coroutines.scope, FakeSessionRpcApi()),
            testRootDisposable,
        )
        rpc.listed += main()
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        waitUntil {
            leaves(tree(panel)).any { (it.item as? HostedWorkspaceRow)?.data?.dto?.ref == ref }
        }

        val row = leaves(tree(panel)).map { it.item }.filterIsInstance<HostedWorkspaceRow>()
            .single { it.data.dto.ref == ref }
        // Starting is work in progress; the row wears the same spinner local running sessions use.
        assertSame(SpinnerIcon.icon, row.icon)
        assertEquals("Starting", row.badges.single().text)
    }

    fun `test cloud create is retired after repeated successful omissions`() {
        val createdRef = HostedWorkspaceRefDto("cloud", "created")
        val session = HostedWorkspaceSessionDto(
            id = HostedIDs.session(createdRef.providerID, createdRef.workspaceID, "root"),
            nativeSessionID = "root",
            title = "OpenRouter API access",
            updated = 2.0,
        )
        val created = HostedWorkspaceDto(createdRef, name = "Created", sessions = listOf(session))
        val calls = java.util.concurrent.atomic.AtomicInteger()
        val hosted = KiloHostedService(coroutines.scope, object : KiloHostedRpcApi {
            override suspend fun providers(): List<HostedProviderDto> = emptyList()
            override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?) =
                HostedWorkspaceListDto().also { calls.incrementAndGet() }
            override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?) = created
            override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedWorkspaceStatusDto(ref, "active", "active", "sandbox_ready", 100.0)
            override suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String, organizationID: String?): Flow<HostedSystemEventDto> = emptyFlow()
            override suspend fun workspaceProfiles(organizationID: String?) =
                ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto()
            override suspend fun setPersonalDefaultProfile(profileID: String) =
                ai.kilocode.rpc.dto.HostedProfileDefaultDto(success = true)
            override suspend fun createWorkspace(request: HostedCreateWorkspaceDto): HostedMutationResultDto =
                HostedMutationResultDto(workspace = created, session = session)
            override suspend fun startWorkspaceSession(ref: HostedWorkspaceRefDto, request: ai.kilocode.rpc.dto.HostedStartSessionDto) =
                HostedMutationResultDto()
            override suspend fun deleteWorkspace(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedDeleteResultDto(ref, success = true)
        }, gate = { true }, log = TestLog(), repo = { "https://github.com/kilo-org/example" })
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        project.replaceService(KiloSessionService::class.java,
            KiloSessionService(project, coroutines.scope, FakeSessionRpcApi()), testRootDisposable)
        rpc.listed += main()
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        waitUntil { rows(panel) == 1 && calls.get() == 1 && !hosted.state.value.loading }

        val request = HostedCreateWorkspaceDto(
            repository = HostedRepositoryDto("github", repo = "kilo-org/example"),
            profileID = "profile",
            prompt = "Build it",
            agent = HostedAgentDto("code", "kilo/kilo-auto/free"),
            operationKey = "00000000-0000-4000-8000-000000000007",
            messageID = "msg_00000000000700000000000000",
        )
        edt { panel.createHosted(request) }
        waitUntil { rows(panel) == 2 && calls.get() == 2 && !hosted.state.value.loading }
        assertEquals("OpenRouter API access", (row(panel, 1) as HostedWorkspaceRow).title)

        repeat(5) {
            val count = calls.get()
            edt { hosted.refresh(project.basePath!!) }
            waitUntil { calls.get() > count && !hosted.state.value.loading }
        }
        assertEquals(2, rows(panel))

        repeat(HOSTED_MISS_LIMIT - 1 - 5) {
            val count = calls.get()
            edt { hosted.refresh(project.basePath!!) }
            waitUntil { calls.get() > count && !hosted.state.value.loading }
        }
        waitUntil { rows(panel) == 1 }
        assertFalse(PropertiesComponent.getInstance(project).getValue("kilo.agentManager.layout")!!.contains(createdRef.key))
    }

    fun `test deleting a created workspace that discovery has not listed removes its row`() {
        val createdRef = HostedWorkspaceRefDto("cloud", "created")
        val session = HostedWorkspaceSessionDto(
            HostedIDs.session(createdRef.providerID, createdRef.workspaceID, "root"),
            "root",
        )
        val created = HostedWorkspaceDto(createdRef, name = "Created", sessions = listOf(session))
        val hosted = KiloHostedService(coroutines.scope, object : KiloHostedRpcApi {
            override suspend fun providers(): List<HostedProviderDto> = emptyList()
            override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?) =
                HostedWorkspaceListDto()
            override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?) = created
            override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedWorkspaceStatusDto(ref, "active", "active", "sandbox_ready", 100.0)
            override suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String, organizationID: String?): Flow<HostedSystemEventDto> = emptyFlow()
            override suspend fun workspaceProfiles(organizationID: String?) =
                ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto()
            override suspend fun setPersonalDefaultProfile(profileID: String) =
                ai.kilocode.rpc.dto.HostedProfileDefaultDto(success = true)
            override suspend fun createWorkspace(request: HostedCreateWorkspaceDto): HostedMutationResultDto =
                HostedMutationResultDto(workspace = created, session = session)
            override suspend fun startWorkspaceSession(ref: HostedWorkspaceRefDto, request: ai.kilocode.rpc.dto.HostedStartSessionDto) =
                HostedMutationResultDto()
            override suspend fun deleteWorkspace(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedDeleteResultDto(ref, success = true)
        }, gate = { true }, log = TestLog(), repo = { "https://github.com/kilo-org/example" })
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        project.replaceService(KiloSessionService::class.java,
            KiloSessionService(project, coroutines.scope, FakeSessionRpcApi()), testRootDisposable)
        rpc.listed += main()
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        waitUntil { rows(panel) == 1 }

        val request = HostedCreateWorkspaceDto(
            repository = HostedRepositoryDto("github", repo = "kilo-org/example"),
            profileID = "profile",
            prompt = "Build it",
            agent = HostedAgentDto("code", "kilo/kilo-auto/free"),
            operationKey = "00000000-0000-4000-8000-000000000005",
            messageID = "msg_00000000000500000000000000",
        )
        edt { panel.createHosted(request) }
        waitUntil { rows(panel) == 2 }

        edt { project.service<HostedWorkspaceRemoval>().delete(createdRef, project.basePath!!) }
        waitUntil { rows(panel) == 1 }
    }

    fun `test deleting a discovered workspace hides it before discovery catches up`() {
        val createdRef = HostedWorkspaceRefDto("cloud", "discovered")
        val session = HostedWorkspaceSessionDto(
            HostedIDs.session(createdRef.providerID, createdRef.workspaceID, "root"),
            "root",
        )
        val created = HostedWorkspaceDto(createdRef, name = "Discovered", sessions = listOf(session))
        var createdOnce = false
        val hosted = KiloHostedService(coroutines.scope, object : KiloHostedRpcApi {
            override suspend fun providers(): List<HostedProviderDto> = emptyList()
            override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?) =
                HostedWorkspaceListDto(if (createdOnce) listOf(created) else emptyList())
            override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?) = created
            override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedWorkspaceStatusDto(ref, "active", "active", "sandbox_ready", 100.0)
            override suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String, organizationID: String?): Flow<HostedSystemEventDto> = emptyFlow()
            override suspend fun workspaceProfiles(organizationID: String?) =
                ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto()
            override suspend fun setPersonalDefaultProfile(profileID: String) =
                ai.kilocode.rpc.dto.HostedProfileDefaultDto(success = true)
            override suspend fun createWorkspace(request: HostedCreateWorkspaceDto): HostedMutationResultDto {
                createdOnce = true
                return HostedMutationResultDto(workspace = created, session = session)
            }
            override suspend fun startWorkspaceSession(ref: HostedWorkspaceRefDto, request: ai.kilocode.rpc.dto.HostedStartSessionDto) =
                HostedMutationResultDto()
            override suspend fun deleteWorkspace(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedDeleteResultDto(ref, success = true)
        }, gate = { true }, log = TestLog(), repo = { "https://github.com/kilo-org/example" })
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        project.replaceService(KiloSessionService::class.java,
            KiloSessionService(project, coroutines.scope, FakeSessionRpcApi()), testRootDisposable)
        rpc.listed += main()
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        waitUntil { rows(panel) == 1 }

        val request = HostedCreateWorkspaceDto(
            repository = HostedRepositoryDto("github", repo = "kilo-org/example"),
            profileID = "profile",
            prompt = "Build it",
            agent = HostedAgentDto("code", "kilo/kilo-auto/free"),
            operationKey = "00000000-0000-4000-8000-000000000006",
            messageID = "msg_00000000000600000000000000",
        )
        edt { panel.createHosted(request) }
        waitUntil { rows(panel) == 2 && hosted.state.value.items.any { it.ref == createdRef } }

        edt { project.service<HostedWorkspaceRemoval>().delete(createdRef, project.basePath!!) }
        waitUntil { rows(panel) == 1 }
    }

    fun `test signing out clears created and pending cloud rows`() {
        val createdRef = HostedWorkspaceRefDto("cloud", "created")
        val session = HostedWorkspaceSessionDto(
            HostedIDs.session(createdRef.providerID, createdRef.workspaceID, "root"),
            "root",
        )
        val created = HostedWorkspaceDto(createdRef, name = "Created", sessions = listOf(session))
        var gate = CompletableDeferred<Unit>().apply { complete(Unit) }
        var createdOnce = false
        var signedOut = false
        val hosted = KiloHostedService(coroutines.scope, object : KiloHostedRpcApi {
            override suspend fun providers(): List<HostedProviderDto> = emptyList()
            override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?) =
                HostedWorkspaceListDto(if (createdOnce && !signedOut) listOf(created) else emptyList(), signedOut = signedOut)
            override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?) = created
            override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedWorkspaceStatusDto(ref, "active", "active", "sandbox_ready", 100.0)
            override suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String, organizationID: String?): Flow<HostedSystemEventDto> = emptyFlow()
            override suspend fun workspaceProfiles(organizationID: String?) =
                ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto()
            override suspend fun setPersonalDefaultProfile(profileID: String) =
                ai.kilocode.rpc.dto.HostedProfileDefaultDto(success = true)
            override suspend fun createWorkspace(request: HostedCreateWorkspaceDto): HostedMutationResultDto {
                gate.await()
                createdOnce = true
                return HostedMutationResultDto(workspace = created, session = session)
            }
            override suspend fun startWorkspaceSession(ref: HostedWorkspaceRefDto, request: ai.kilocode.rpc.dto.HostedStartSessionDto) =
                HostedMutationResultDto()
            override suspend fun deleteWorkspace(ref: HostedWorkspaceRefDto, organizationID: String?) =
                HostedDeleteResultDto(ref, success = true)
        }, gate = { true }, log = TestLog(), repo = { "https://github.com/kilo-org/example" })
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        project.replaceService(KiloSessionService::class.java,
            KiloSessionService(project, coroutines.scope, FakeSessionRpcApi()), testRootDisposable)
        rpc.listed += main()
        val controller = WorktreeController(service, project.basePath!!, coroutines.scope)
        val panel = edt { AgentManagerPanel(testRootDisposable, controller, project) }
        edt { controller.reload() }
        waitUntil { rows(panel) == 1 }

        val request = HostedCreateWorkspaceDto(
            repository = HostedRepositoryDto("github", repo = "kilo-org/example"),
            profileID = "profile",
            prompt = "Build it",
            agent = HostedAgentDto("code", "kilo/kilo-auto/free"),
            operationKey = "00000000-0000-4000-8000-000000000002",
            messageID = "msg_00000000000200000000000000",
        )
        edt { panel.createHosted(request) }
        waitUntil { rows(panel) == 2 }

        signedOut = true
        edt { hosted.refresh(project.basePath!!) }
        waitUntil { rows(panel) == 1 }

        signedOut = false
        edt { hosted.refresh(project.basePath!!) }
        waitUntil { rows(panel) == 2 }

        gate = CompletableDeferred()
        edt { panel.createHosted(request.copy(operationKey = "00000000-0000-4000-8000-000000000003")) }
        waitUntil { rows(panel) == 3 }
        signedOut = true
        edt { hosted.refresh(project.basePath!!) }
        waitUntil { rows(panel) == 1 }
    }

    private fun context(panel: AgentManagerPanel): DataContext {
        val values = mutableMapOf<String, Any>()
        panel.uiDataSnapshot(object : CopyProviderSink() {
            override fun <T : Any> set(key: DataKey<T>, data: T?) {
                if (data != null) values[key.name] = data
            }
        })
        return DataContext { values[it] }
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
        // A row hides its PR badges while a reload reports progress, so wait for the load to settle
        // instead of racing a fixed flush under CI load.
        waitUntil { rows(panel) > 0 && (0 until rows(panel)).all { row(panel, it).progress == null } }
        return panel
    }

    private class DeleteProviderSink : DataSink {
        var provider: DeleteProvider? = null

        override fun <T : Any> set(key: DataKey<T>, data: T?) {
            if (key == PlatformDataKeys.DELETE_ELEMENT_PROVIDER) provider = data as? DeleteProvider
        }

        override fun <T : Any> setNull(key: DataKey<T>) {}
        override fun <T : Any> lazyNull(key: DataKey<T>) {}
        override fun <T : Any> lazyValue(key: DataKey<T>, data: (DataMap) -> T?) {}
        override fun uiDataSnapshot(provider: UiDataProvider) = provider.uiDataSnapshot(this)
        override fun dataSnapshot(provider: DataSnapshotProvider) = provider.dataSnapshot(this)
        override fun uiDataSnapshot(provider: DataProvider) {}
    }

    private fun main(): WorktreeDto {
        val base = project.basePath!!
        return WorktreeDto(base, "repo", "main", base, main = true)
    }

    private fun rowHeight(tree: ActiveTreeView): Int = rowBounds(tree, 0).height

    private fun worktree(name: String): WorktreeDto {
        val path = "${project.basePath!!}/.kilo/worktrees/$name"
        return WorktreeDto(path, name, name, path)
    }

    private fun worktreeIds(controller: WorktreeController): List<String> {
        return (0 until controller.model.size).map { controller.model.getElementAt(it).path }
    }

    private fun layout(view: ActiveTreeView) {
        edt {
            (view.parent as? javax.swing.JViewport)?.setSize(360, 600)
            view.setSize(360, 600)
            view.doLayout()
            TreeUtil.invalidateCacheAndRepaint(view.ui as? javax.swing.plaf.TreeUI)
            UIUtil.dispatchAllInvocationEvents()
        }
    }

    private fun rowCenter(view: ActiveTreeView, index: Int): Point {
        val bounds = rowBounds(view, index)
        return Point(bounds.x + 8, bounds.y + bounds.height / 2)
    }

    private fun tree(panel: AgentManagerPanel): ActiveTreeView =
        edt { UIUtil.findComponentOfType(panel, ActiveTreeView::class.java)!! }

    private fun selectedValue(tree: ActiveTreeView): ActiveItem? =
        (tree.selectionPath?.lastPathComponent as? ActiveEntry)?.item

    private fun rendered(
        tree: ActiveTreeView,
        entry: ActiveEntry,
        selected: Boolean = false,
        focused: Boolean = true,
    ): java.awt.Component =
        tree.cellRenderer.getTreeCellRendererComponent(tree, entry, selected, true, false, 0, focused)

    private fun leaves(tree: ActiveTreeView): List<ActiveEntry> =
        edt {
            (0 until tree.rowCount).mapNotNull {
                tree.getPathForRow(it)?.lastPathComponent as? ActiveEntry
            }.filter { !it.allowsChildren }
        }

    private fun roots(tree: ActiveTreeView) = edt {
        (0 until tree.hierarchy.root.childCount).map { (tree.hierarchy.root.getChildAt(it) as ActiveEntry).key }
    }

    private fun leafEntry(tree: ActiveTreeView, index: Int): ActiveEntry = leaves(tree)[index]

    private fun leafRow(tree: ActiveTreeView, index: Int): Int =
        edt { tree.getRowForPath(TreePath(leafEntry(tree, index).path)) }

    /**
     * Row rectangle the renderer is laid out at. It is the tree cell minus the shared outer gutter,
     * which is what the tree itself paints and what a list cell gives its own renderer.
     */
    private fun rowBounds(tree: ActiveTreeView, index: Int): java.awt.Rectangle =
        edt {
            (tree.parent as? javax.swing.JViewport)?.setSize(tree.width, tree.height)
            tree.regions.cell(leafEntry(tree, index))
        }

    private fun selectLeaf(tree: ActiveTreeView, index: Int) {
        edt { tree.selectionModel.selectionPath = TreePath(leafEntry(tree, index).path) }
    }

    private fun selectedLeaf(tree: ActiveTreeView): Int =
        edt {
            val selected = tree.selectionPath?.lastPathComponent as? ActiveEntry ?: return@edt -1
            leaves(tree).indexOfFirst { it.key == selected.key }
        }

    private fun hitIds(tree: ActiveTreeView, index: Int): Map<String, java.awt.Rectangle> {
        val entry = leafEntry(tree, index)
        edt { (tree.parent as? javax.swing.JViewport)?.setSize(tree.width.coerceAtLeast(360), tree.height.coerceAtLeast(600)) }
        val bounds = edt { tree.regions.cell(entry) }
        val selected = edt { tree.selectionModel.isPathSelected(TreePath(entry.path)) }
        val comp = edt {
            tree.cellRenderer.getTreeCellRendererComponent(tree, entry, selected, true, false, 0, true)
        }
        comp.setSize(bounds.width, bounds.height)
        activeLayout(comp)
        return activeHitCells(comp, bounds.x, bounds.y).associate { it.id to it.bounds }
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun flush() = coroutines.drain(::pump)

    private fun waitUntil(block: () -> Boolean) {
        assertTrue(coroutines.pumpUntil { edt(block) })
    }

    private fun row(panel: AgentManagerPanel, idx: Int): ActiveItem = leafEntry(tree(panel), idx).item

    private fun rows(panel: AgentManagerPanel): Int = leaves(tree(panel)).size

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
