package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.util.edtWait
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.diff.KiloDiffComparison
import ai.kilocode.client.diff.KiloDiffEditorKind
import ai.kilocode.client.diff.KiloDiffEditorService
import ai.kilocode.client.diff.openKiloDiff
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.onboarding.providers.v5migration.FakeMigrationUiController
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.history.HistorySection
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.session.history.LocalHistoryItem
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.testing.fire
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.ChangesPanel
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloVirtualFile
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.activeListSectionTitle
import ai.kilocode.client.ui.list.activeListToolWindowBackground
import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreeDirtyListDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import ai.kilocode.rpc.dto.WorktreeStatsListDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.replaceService
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionTimeDto
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.DataMap
import com.intellij.openapi.actionSystem.DataProvider
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.DataSnapshotProvider
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.actionSystem.impl.ActionButton
import com.intellij.openapi.ui.TestDialog
import com.intellij.openapi.ui.TestDialogManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.SearchTextField
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.UIUtil
import java.awt.Color
import com.intellij.util.ui.JBUI
import java.awt.Container
import javax.swing.JPanel
import javax.swing.JSeparator
import javax.swing.SwingConstants
import java.awt.Point
import java.awt.event.ActionEvent
import java.awt.event.InputEvent
import java.awt.event.KeyEvent
import java.awt.event.MouseEvent
import javax.swing.Icon
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.KeyStroke
import javax.swing.SwingUtilities
import javax.swing.UIManager

@Suppress("UnstableApiUsage")
class WorktreeSessionEditorPanelTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeSessionRpcApi
    private lateinit var sessions: KiloSessionService
    private lateinit var controller: WorktreeSessionListController
    private lateinit var manager: FakeManager
    private lateinit var panel: WorktreeSessionEditorPanel
    private val saves = mutableListOf<Boolean>()
    // Read by FakeManager's moveHost/newWorktreeHost, which are passed to the superclass constructor
    // and so cannot reference FakeManager's own not-yet-initialized properties; the outer test
    // instance is already fully constructed by the time FakeManager() runs, so these are safe there.
    private val moves = mutableListOf<Triple<String?, String, String>>()
    private val workspace = Workspace(DIR, kotlinx.coroutines.flow.MutableStateFlow(ai.kilocode.rpc.dto.KiloWorkspaceStateDto(ai.kilocode.rpc.dto.KiloWorkspaceStatusDto.READY)), {}, {})

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        rpc = FakeSessionRpcApi()
        sessions = KiloSessionService(project, coroutines.scope, rpc)
        controller = WorktreeSessionListController(sessions, DIR, coroutines.scope)
        manager = FakeManager()
        // Most tests inspect the session list, so the shared panel starts from a stored "visible".
        panel = view(stored = true)
    }

    override fun tearDown() {
        try {
            TestDialogManager.setTestDialog(TestDialog.DEFAULT)
            coroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    private fun view(
        stored: Boolean? = null,
        load: ((Boolean?) -> Unit) -> Unit = { done -> done(stored) },
        target: Project? = null,
        parent: Disposable = testRootDisposable,
    ): WorktreeSessionEditorPanel = edt {
        WorktreeSessionEditorPanel(
            parent,
            manager,
            controller,
            workspace,
            project = target,
            confirm = { _, _, run -> run() },
            load = load,
            save = { saves += it },
        )
    }

    fun `test panel builds splitter toolbar list and right component`() {
        edt {
            val splitter = UIUtil.findComponentOfType(panel, OnePixelSplitter::class.java)!!
            assertSame(UIUtil.findComponentOfType(panel, ActiveList::class.java), splitter.firstComponent)
            assertSame(manager.component, splitter.secondComponent)
            assertEquals(0.25f, splitter.proportion, 0.01f)
            assertNotNull(UIUtil.findComponentOfType(panel, WorktreePrHeaderView::class.java))
            val buttons = components(panel).filterIsInstance<ActionButton>().mapNotNull { it.presentation.text }
            assertEquals("Hide sessions", toggle().toolTipText)
            assertFalse(buttons.contains("Hide sessions"))
            assertTrue(buttons.contains("New session"))
            assertTrue(buttons.contains("Rename session"))
            assertTrue(buttons.contains("Delete session"))
            assertNotNull(components(panel).filterIsInstance<JButton>().singleOrNull { it.text == "Open" })
            assertNotNull(UIUtil.findComponentOfType(panel, JBList::class.java))
            assertNull(UIUtil.findComponentOfType(panel, SearchTextField::class.java))
        }
    }

    fun `test list and toolbar paint tool window background`() {
        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        val scroll = edt { SwingUtilities.getAncestorOfClass(JBScrollPane::class.java, list) as JBScrollPane }
        val button = edt { components(panel).filterIsInstance<ActionButton>().single { it.presentation.text == "New session" } }
        val toolbar = edt { button.parent }
        val toolbarPanel = edt { toolbar.parent as JComponent }
        val header = edt { UIUtil.findComponentOfType(panel, WorktreePrHeaderView::class.java)!!.parent as JComponent }

        assertEquals(activeListToolWindowBackground(), edt { panel.background })
        assertNull(edt { panel.border })
        assertEquals(activeListToolWindowBackground(), edt { list.background })
        assertEquals(activeListToolWindowBackground(), edt { scroll.background })
        assertEquals(activeListToolWindowBackground(), edt { scroll.viewport.background })
        assertEquals(activeListToolWindowBackground(), edt { (scroll.viewport.view as JComponent).background })
        assertFalse(edt { toolbar.isOpaque })
        assertEquals(activeListToolWindowBackground(), edt { toolbarPanel.background })
        assertEquals(activeListToolWindowBackground(), edt { header.background })
        assertEquals(0, edt { scroll.border.getBorderInsets(scroll).left })
        assertEquals(0, edt { scroll.viewportBorder.getBorderInsets(scroll).left })
        assertTrue(edt { toolbarPanel.border.getBorderInsets(toolbarPanel).right > 0 })
        assertTrue(edt { header.border.getBorderInsets(header).bottom > 0 })
    }

    fun `test toolbar background tracks the theme automatically`() {
        val button = edt { components(panel).filterIsInstance<ActionButton>().single { it.presentation.text == "New session" } }
        val toolbar = edt { button.parent as JComponent }
        val toolbarPanel = edt { toolbar.parent as JComponent }
        val old = UIManager.get("ToolWindow.background")
        val next = Color(17, 34, 51)

        try {
            // The toolbar is transparent, so its themed background comes from the parent and follows
            // the theme's ToolWindow.background live -- no listener or manual assignment required.
            assertFalse(edt { toolbar.isOpaque })
            edt { UIManager.put("ToolWindow.background", next) }
            assertEquals(next, edt { toolbarPanel.background })
        } finally {
            UIManager.put("ToolWindow.background", old)
        }
    }

    fun `test expand collapse hides session list and edit toolbar but keeps header actions`() {
        edt {
            val splitter = UIUtil.findComponentOfType(panel, OnePixelSplitter::class.java)!!
            val list = splitter.firstComponent

            assertSame(list, splitter.firstComponent)
            assertTrue(shown("Rename session"))
            assertTrue(shown("Delete session"))

            click(toggle())

            assertNull(splitter.firstComponent)
            assertEquals("Show sessions", toggle().toolTipText)
            assertTrue(shown("New session"))
            assertFalse(shown("Rename session"))
            assertFalse(shown("Delete session"))
            assertNotNull(UIUtil.findComponentOfType(panel, WorktreePrHeaderView::class.java))
            assertEquals(listOf(false), saves)

            click(toggle())

            assertSame(list, splitter.firstComponent)
            assertEquals("Hide sessions", toggle().toolTipText)
            assertTrue(shown("Rename session"))
            assertTrue(shown("Delete session"))
            assertEquals(listOf(false, true), saves)
        }
    }

    fun `test stored visibility decides whether the session list is shown`() {
        val off = view(stored = false)
        val on = view(stored = true)

        edt {
            assertNull(UIUtil.findComponentOfType(off, OnePixelSplitter::class.java)!!.firstComponent)
            assertNotNull(UIUtil.findComponentOfType(on, OnePixelSplitter::class.java)!!.firstComponent)
            assertFalse(shown(off, "Rename session"))
            assertTrue(shown(on, "Rename session"))
            assertTrue(saves.isEmpty())
        }
    }

    fun `test a worktree without a stored choice stays hidden for a single session`() {
        val view = view()
        rpc.listed += session("ses_1", 1.0)
        edt { controller.reload() }
        flush()

        edt {
            assertNull(UIUtil.findComponentOfType(view, OnePixelSplitter::class.java)!!.firstComponent)
            assertNull(badge(view))
            assertTrue(saves.isEmpty())
        }
    }

    fun `test a second session shows the list once and stores that choice`() {
        val view = view()
        rpc.listed += session("ses_1", 1.0)
        rpc.listed += session("ses_2", 2.0)
        edt { controller.reload() }
        flush()

        edt {
            assertNotNull(UIUtil.findComponentOfType(view, OnePixelSplitter::class.java)!!.firstComponent)
            assertEquals(listOf(true), saves)
        }

        rpc.listed += session("ses_3", 3.0)
        edt { controller.reload() }
        flush()

        assertEquals(listOf(true), saves)
    }

    fun `test a stored hidden list survives extra sessions`() {
        val view = view(stored = false)
        rpc.listed += session("ses_1", 1.0)
        rpc.listed += session("ses_2", 2.0)
        edt { controller.reload() }
        flush()

        edt {
            assertNull(UIUtil.findComponentOfType(view, OnePixelSplitter::class.java)!!.firstComponent)
            assertTrue(saves.isEmpty())
        }
    }

    fun `test a click before the stored value arrives wins`() {
        var answer: ((Boolean?) -> Unit)? = null
        val view = view(load = { done -> answer = done })

        edt { click(toggle(view)) }
        edt { answer!!(false) }

        edt {
            assertNotNull(UIUtil.findComponentOfType(view, OnePixelSplitter::class.java)!!.firstComponent)
            assertEquals(listOf(true), saves)
        }
    }

    fun `test sessions arriving before the stored answer never force the list open`() {
        var answer: ((Boolean?) -> Unit)? = null
        val view = view(load = { done -> answer = done })
        rpc.listed += session("ses_1", 1.0)
        rpc.listed += session("ses_2", 2.0)
        edt { controller.reload() }
        flush()

        edt { assertNull(UIUtil.findComponentOfType(view, OnePixelSplitter::class.java)!!.firstComponent) }
        assertTrue(saves.isEmpty())

        edt { answer!!(false) }

        edt {
            assertNull(UIUtil.findComponentOfType(view, OnePixelSplitter::class.java)!!.firstComponent)
            assertTrue(saves.isEmpty())
        }
    }

    fun `test an empty stored answer promotes a worktree that already holds two sessions`() {
        var answer: ((Boolean?) -> Unit)? = null
        val view = view(load = { done -> answer = done })
        rpc.listed += session("ses_1", 1.0)
        rpc.listed += session("ses_2", 2.0)
        edt { controller.reload() }
        flush()

        edt { answer!!(null) }

        edt {
            assertNotNull(UIUtil.findComponentOfType(view, OnePixelSplitter::class.java)!!.firstComponent)
            assertEquals(listOf(true), saves)
        }
    }

    fun `test hidden toggle badges the session count from the second session on`() {
        val view = view(stored = false)
        rpc.listed += session("ses_1", 1.0)
        edt { controller.reload() }
        flush()

        assertNull(edt { badge(view) })

        rpc.listed += session("ses_2", 2.0)
        edt { controller.reload() }
        flush()

        val icon = edt { badge(view) as FilledBadgeIcon }
        assertEquals("2", icon.text)
        assertSame(UiStyle.Badge.Secondary, icon.style)
    }

    fun `test shown session list drops the count badge`() {
        rpc.listed += session("ses_1", 1.0)
        rpc.listed += session("ses_2", 2.0)
        edt { controller.reload() }
        flush()

        assertNull(edt { badge() })
    }

    fun `test hidden toggle surfaces a session waiting on the user instead of the count`() {
        val view = view(stored = false)
        manager.kinds = mapOf("ses_1" to SessionActivityKind.RUNNING, "ses_2" to SessionActivityKind.QUESTION)
        rpc.listed += session("ses_1", 1.0)
        rpc.listed += session("ses_2", 2.0)
        edt { controller.reload() }
        flush()

        assertSame(SessionActivityKind.QUESTION.icon(), edt { badge(view) })
    }

    fun `test toolbar strip pads three sides and keeps the divider flush`() {
        val standard = JBUI.CurrentTheme.Toolbar.horizontalToolbarInsets()!!

        val ins = edt { strip().insets }

        assertEquals(standard.top, ins.top)
        assertEquals(standard.left, ins.left)
        assertEquals(standard.bottom, ins.bottom)
        // Right carries the divider line only: padding there would push it off the header content.
        assertEquals(1, ins.right)
    }

    fun `test a vertical separator follows the toggle in the toolbar strip`() {
        val kids = edt { row().components.toList() }

        assertEquals(2, kids.size)
        assertTrue(SwingUtilities.isDescendingFrom(toggle(), kids.first()))
        assertEquals(SwingConstants.VERTICAL, (kids.last() as JSeparator).orientation)
    }

    fun `test toggle keeps its own height inside a taller toolbar strip`() {
        edt {
            val strip = strip()
            strip.setSize(JBUI.scale(400), JBUI.scale(48))
            lay(strip)
        }

        // Tracking the strip height would push the hover box against the strip's top and bottom.
        assertEquals(JBUI.scale(24), edt { toggle().height })
        assertTrue(edt { toggle().y } > 0)
    }

    fun `test attention badge returns after showing and hiding the list again`() {
        val view = view(stored = false)
        manager.kinds = mapOf("ses_1" to SessionActivityKind.RUNNING, "ses_2" to SessionActivityKind.QUESTION)
        rpc.listed += session("ses_1", 1.0)
        rpc.listed += session("ses_2", 2.0)
        edt { controller.reload() }
        flush()

        assertSame(SessionActivityKind.QUESTION.icon(), edt { badge(view) })

        edt { click(toggle(view)) }
        assertNull(edt { badge(view) })

        edt { click(toggle(view)) }

        assertSame(SessionActivityKind.QUESTION.icon(), edt { badge(view) })
    }

    fun `test hidden toggle keeps the count while sessions only run`() {
        val view = view(stored = false)
        manager.kinds = mapOf("ses_1" to SessionActivityKind.RUNNING, "ses_2" to SessionActivityKind.RUNNING)
        rpc.listed += session("ses_1", 1.0)
        rpc.listed += session("ses_2", 2.0)
        edt { controller.reload() }
        flush()

        assertEquals("2", edt { (badge(view) as FilledBadgeIcon).text })
    }

    fun `test editor kind delegates preferred focus to panel`() {
        edt {
            assertSame(UIUtil.findComponentOfType(panel, JBList::class.java), panel.preferredFocus())
            assertSame(panel.preferredFocus(), WorktreeSessionEditorKind.preferredFocus(panel))
        }
    }

    fun `test new action creates session`() {
        edt {
            val button = components(panel).filterIsInstance<ActionButton>().single { it.presentation.text == "New session" }
            button.click()
        }

        assertEquals(1, manager.newCount)
    }

    fun `test open action opens worktree directory in new frame`() {
        val opened = mutableListOf<String>()
        val view = edt {
            WorktreeSessionEditorPanel(testRootDisposable, manager, controller, workspace, openWorktree = { opened += it })
        }

        edt {
            components(view).filterIsInstance<JButton>().single { it.text == "Open" }.doClick()
        }

        assertEquals(listOf(DIR), opened)
    }

    fun `test open action disabled without a worktree directory`() {
        val blank = Workspace("", kotlinx.coroutines.flow.MutableStateFlow(ai.kilocode.rpc.dto.KiloWorkspaceStateDto(ai.kilocode.rpc.dto.KiloWorkspaceStatusDto.READY)), {}, {})
        val opened = mutableListOf<String>()
        val view = edt {
            WorktreeSessionEditorPanel(testRootDisposable, manager, controller, blank, openWorktree = { opened += it })
        }

        val button = edt {
            components(view).filterIsInstance<JButton>().single { it.text == "Open" }
        }

        assertFalse(edt { button.isEnabled })
        assertTrue(opened.isEmpty())
    }

    fun `test pending new session appears in list`() {
        manager.pending = true

        edt { manager.onListChanged?.invoke() }

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        assertEquals("New session", edt { (list.model.getElementAt(0) as ActiveListItem).title })
        assertEquals("new", edt { (list.selectedValue as ActiveListItem).key })
    }

    fun `test session row title uses regular font`() {
        rpc.listed += session("ses_1", nowSeconds())
        edt { controller.reload() }
        flush()

        val style = edt {
            @Suppress("UNCHECKED_CAST")
            val list = UIUtil.findComponentOfType(panel, JBList::class.java)!! as JBList<ActiveListItem>
            val row = list.model.getElementAt(0) as ActiveListItem
            val comp = list.cellRenderer.getListCellRendererComponent(list, row, 0, true, true)
            val title = components(comp).filterIsInstance<SimpleColoredComponent>().single()
            val iter = title.iterator()
            assertTrue(iter.hasNext())
            iter.next()
            iter.textAttributes.style
        }

        assertEquals(SimpleTextAttributes.STYLE_PLAIN, style)
    }

    fun `test running session row shows activity badge without leading icon`() {
        manager.kinds = mapOf("ses_1" to SessionActivityKind.RUNNING)
        val session = session("ses_1", nowSeconds())
        rpc.listed += session
        edt { controller.reload() }
        flush()

        val row = row("ses_1")

        assertEquals("Session ses_1", row.title)
        assertNull(row.icon)
        assertNull(row.description)
        assertEquals(KiloBundle.message("session.part.tool.running"), row.badges.single().text)
        assertNull(row.trailing)
        assertEquals(HistoryTime.title(HistoryTime.section(LocalHistoryItem(session))), row.section)
    }

    fun `test plan session row shows activity badge without leading icon`() {
        manager.kinds = mapOf("ses_1" to SessionActivityKind.PLAN)
        rpc.listed += session("ses_1", nowSeconds())
        edt { controller.reload() }
        flush()

        val row = row("ses_1")

        assertNull(row.icon)
        assertEquals(KiloBundle.message("history.badge.plan"), row.badges.single().text)
    }

    fun `test session row shows the live agent title over the listed placeholder`() {
        rpc.listed += session("ses_1", nowSeconds()).copy(title = "New session - 2026-07-30T19:01:40.945Z")
        edt { controller.reload() }
        flush()

        // The listed snapshot is still the CLI placeholder, shown as a friendly "New session".
        assertEquals("New session", row("ses_1").title)

        // The agent names the open session; the live title wins immediately on the next sync.
        manager.live = mapOf("ses_1" to "Repository overview request")
        edt { manager.onListChanged?.invoke() }

        assertEquals("Repository overview request", row("ses_1").title)
    }

    fun `test deleting row shows deleting state`() {
        manager.kinds = mapOf("ses_1" to SessionActivityKind.RUNNING)
        manager.deletingIds += "ses_1"
        rpc.listed += session("ses_1", nowSeconds())
        edt { controller.reload() }
        flush()

        val row = row("ses_1")

        assertEquals(KiloBundle.message("common.deleting"), row.progress)
    }

    fun `test move to worktree is offered only from the base checkout`() {
        val session = session("ses_1", nowSeconds())
        rpc.listed += session
        edt { controller.reload() }
        flush()

        assertFalse(edt { panel.canMove(session) })

        manager.baseValue = true

        assertTrue(edt { panel.canMove(session) })
    }

    fun `test move to worktree hides for the new row and a deleting session`() {
        manager.baseValue = true
        val session = session("ses_1", nowSeconds())
        rpc.listed += session
        edt { controller.reload() }
        flush()

        assertFalse(edt { panel.canMove(null) })

        manager.deletingIds += session.id
        assertFalse(edt { panel.canMove(session) })
    }

    fun `test move to worktree hides for every in-flight turn state`() {
        manager.baseValue = true
        val session = session("ses_1", nowSeconds())
        rpc.listed += session
        edt { controller.reload() }
        flush()

        // The chat dock hides its Move action for anything SessionState.isBusy() covers, and a session
        // stopped on a question or a permission is as mid-turn as a running one.
        for (kind in SessionActivityKind.entries.filter { it.busy() }) {
            manager.kinds = mapOf("ses_1" to kind)
            assertFalse("$kind must hide Move to Worktree", edt { panel.canMove(session) })
        }
    }

    fun `test move to worktree stays offered for a failed or login-blocked session`() {
        manager.baseValue = true
        val session = session("ses_1", nowSeconds())
        rpc.listed += session
        edt { controller.reload() }
        flush()

        // Neither state is busy: the turn is over and the session is waiting on the user, which is
        // exactly when moving it into a worktree is worth offering.
        for (kind in SessionActivityKind.entries.filterNot { it.busy() }) {
            manager.kinds = mapOf("ses_1" to kind)
            assertTrue("$kind must keep Move to Worktree", edt { panel.canMove(session) })
        }
    }

    fun `test move row calls the manager with the worktree directory`() {
        manager.baseValue = true
        val session = session("ses_1", nowSeconds())
        rpc.listed += session
        edt { controller.reload() }
        flush()

        edt { panel.moveRow(session) }

        assertEquals(listOf(Triple(session.id, DIR, "worktree_editor")), moves)
    }

    fun `test move row is a no-op when not offered`() {
        val session = session("ses_1", nowSeconds())
        rpc.listed += session
        edt { controller.reload() }
        flush()

        edt { panel.moveRow(session) }

        assertTrue(moves.isEmpty())
    }

    fun `test pending new session groups under today`() {
        manager.pending = true
        rpc.listed += session("ses_today", nowSeconds())
        edt { controller.reload() }
        flush()

        val items = rows()
        assertEquals("new", items[0].key)
        assertEquals(HistoryTime.title(HistorySection.TODAY), items[0].section)
        // The Today header renders above the pending row (index 0), and the following today session
        // shares its section, so the placeholder sits inside Today rather than detached above it.
        assertEquals(HistoryTime.title(HistorySection.TODAY), activeListSectionTitle(items, 0))
        assertNull(activeListSectionTitle(items, 1))
    }

    fun `test sessions sort by updated desc with new row pinned`() {
        manager.pending = true
        rpc.listed += session("ses_old", 1.0)
        rpc.listed += session("ses_new", 2.0)
        edt { controller.reload() }
        flush()

        val keys = rows().map { it.key }

        assertEquals(listOf("new", "ses_new", "ses_old"), keys)
    }

    fun `test row click opens session`() {
        rpc.listed += session("ses_1", 1.0)
        edt { controller.reload() }
        flush()

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt {
            list.setSize(400, 100)
            list.doLayout()
            val bounds = list.getCellBounds(0, 0)
            fire(list, MouseEvent(list, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, bounds.x + 8, bounds.y + bounds.height / 2, 1, false, MouseEvent.BUTTON1))
        }

        assertEquals(listOf("ses_1"), manager.refs)
        assertEquals(listOf(false), manager.focuses)
    }

    fun `test modified row click preserves multi selection`() {
        rpc.listed += session("ses_1", 1.0)
        rpc.listed += session("ses_2", 2.0)
        edt { controller.reload() }
        flush()

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt {
            list.setSize(400, 100)
            list.doLayout()
            list.selectedIndices = intArrayOf(0, 1)
            val bounds = list.getCellBounds(1, 1)
            val x = bounds.x + 8
            val y = bounds.y + bounds.height / 2
            fire(list, MouseEvent(list, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), InputEvent.SHIFT_DOWN_MASK, x, y, 1, false, MouseEvent.BUTTON1))
            assertEquals(listOf(0, 1), list.selectedIndices.toList())
            fire(list, MouseEvent(list, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), InputEvent.META_DOWN_MASK, x, y, 1, false, MouseEvent.BUTTON1))
            assertEquals(listOf(0, 1), list.selectedIndices.toList())
        }

        assertTrue(manager.refs.isEmpty())
        assertTrue(manager.focuses.isEmpty())
    }

    fun `test row click ignores deleting session`() {
        manager.deletingIds += "ses_1"
        rpc.listed += session("ses_1", 1.0)
        edt { controller.reload() }
        flush()

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt {
            list.setSize(400, 100)
            list.doLayout()
            val bounds = list.getCellBounds(0, 0)
            fire(list, MouseEvent(list, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, bounds.x + 8, bounds.y + bounds.height / 2, 1, false, MouseEvent.BUTTON1))
        }

        assertTrue(manager.refs.isEmpty())
        assertTrue(manager.focuses.isEmpty())
    }

    fun `test row double click opens and focuses session`() {
        rpc.listed += session("ses_1", 1.0)
        edt { controller.reload() }
        flush()

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt {
            list.setSize(400, 100)
            list.doLayout()
            val bounds = list.getCellBounds(0, 0)
            fire(list, MouseEvent(list, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, bounds.x + 8, bounds.y + bounds.height / 2, 2, false, MouseEvent.BUTTON1))
        }

        assertEquals(listOf("ses_1"), manager.refs)
        assertEquals(listOf(true), manager.focuses)
    }

    fun `test enter and f4 focus selected session prompt`() {
        rpc.listed += session("ses_1", 1.0)
        edt { controller.reload() }
        flush()

        val list = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        edt {
            list.selectedIndex = 0
            list.getActionForKeyStroke(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0))!!
                .actionPerformed(ActionEvent(list, ActionEvent.ACTION_PERFORMED, ""))
            list.getActionForKeyStroke(KeyStroke.getKeyStroke(KeyEvent.VK_F4, 0))!!
                .actionPerformed(ActionEvent(list, ActionEvent.ACTION_PERFORMED, ""))
        }

        assertEquals(listOf("ses_1", "ses_1"), manager.refs)
        assertEquals(listOf(true, true), manager.focuses)
    }

    fun `test multi select delete action deletes selected sessions`() {
        rpc.listed += session("ses_1", 1.0)
        rpc.listed += session("ses_2", 2.0)
        edt { controller.reload() }
        flush()

        edt {
            panel.selectSessions(listOf("ses_1", "ses_2"))
            panel.deleteSelected()
        }
        pump()

        assertEquals(listOf("ses_2", "ses_1"), manager.deleted)
    }

    fun `test session rows do not expose inline action cells`() {
        rpc.listed += session("ses_1", 1.0)
        rpc.listed += session("ses_2", 2.0)
        edt { controller.reload() }
        flush()

        edt { panel.selectSessions(listOf("ses_1")) }
        assertTrue(row("ses_1").cells.isEmpty())

        edt { panel.selectSessions(listOf("ses_1", "ses_2")) }

        assertTrue(row("ses_1").cells.isEmpty())
        assertTrue(row("ses_2").cells.isEmpty())
    }

    fun `test multi select rename resets to first visible selected session`() {
        val edits = mutableListOf<String>()
        val view = edt {
            WorktreeSessionEditorPanel(testRootDisposable, manager, controller, workspace, edit = { _, opts, _ -> edits += opts.value })
        }
        rpc.listed += session("ses_1", 1.0)
        rpc.listed += session("ses_2", 2.0)
        edt { controller.reload() }
        flush()

        edt {
            view.selectSessions(listOf("ses_1", "ses_2"))
            view.renameSelected()
        }

        val list = edt { UIUtil.findComponentOfType(view, JBList::class.java)!! }
        assertEquals(listOf("Session ses_2"), edits)
        assertEquals(listOf(0), edt { list.selectedIndices.toList() })
        assertTrue(manager.renamed.isEmpty())
    }

    fun `test delete action skips deleting selected sessions`() {
        manager.deletingIds += "ses_1"
        rpc.listed += session("ses_1", 1.0)
        rpc.listed += session("ses_2", 2.0)
        edt { controller.reload() }
        flush()

        edt {
            panel.selectSessions(listOf("ses_1"))
            panel.deleteSelected()
        }
        assertTrue(manager.deleted.isEmpty())

        edt {
            panel.selectSessions(listOf("ses_1", "ses_2"))
            panel.deleteSelected()
        }

        assertEquals(listOf("ses_2"), manager.deleted)
    }

    fun `test panel provides session manager and workspace data`() {
        val sink = SessionSink()

        edt { panel.uiDataSnapshot(sink) }

        assertSame(manager, sink.manager)
        assertSame(workspace, sink.workspace)
    }

    fun `test project status delivers base and dirty independently and stops after disposal`() {
        val stats = Channel<WorktreeStatsListDto>(Channel.UNLIMITED)
        val dirty = Channel<WorktreeDirtyListDto>(Channel.UNLIMITED)
        val api = object : KiloWorktreeRpcApi by FakeWorktreeRpcApi() {
            override suspend fun stats(directory: String): WorktreeStatsListDto = stats.receive()
            override suspend fun dirty(directory: String): WorktreeDirtyListDto = dirty.receive()
        }
        val (status, timers) = edt { status(api) }
        val owner = Disposer.newDisposable(testRootDisposable, "status header")
        val view = view(target = project, parent = owner)
        val summary = edt { components(view).filterIsInstance<ChangesPanel>().single() }
        val nodes = edt { components(summary) }
        val handle = edt { status.attach() }
        try {
            timers.advanceBy(300)
            stats.trySend(WorktreeStatsListDto(listOf(WorktreeStatsDto(DIR, files = 2, additions = 5, base = "origin/main")))).getOrThrow()
            await(summary, listOf("2 files", "+5"))
            dirty.trySend(WorktreeDirtyListDto(listOf(WorktreeDirtyDto(DIR, files = 1, additions = 7)))).getOrThrow()
            await(summary, listOf("1 file", "+7", "2 files", "+5"))

            edt { status.refreshStats() }
            timers.advanceBy(300)
            dirty.trySend(WorktreeDirtyListDto(listOf(WorktreeDirtyDto(DIR, files = 3, deletions = 4)))).getOrThrow()
            await(summary, listOf("3 files", "-4", "2 files", "+5"))
            stats.trySend(WorktreeStatsListDto(listOf(WorktreeStatsDto(DIR, files = 1, behind = 2, base = "origin/trunk")))).getOrThrow()
            await(summary, listOf("3 files", "-4", "2", "1 file"))

            edt { status.refreshStats() }
            timers.advanceBy(300)
            dirty.trySend(WorktreeDirtyListDto()).getOrThrow()
            await(summary, listOf("2", "1 file"))
            stats.trySend(WorktreeStatsListDto()).getOrThrow()
            await(summary, emptyList())
            edt {
                assertFalse(summary.isVisible)
                assertEquals(nodes, components(summary))
                assertFalse(manager.showsBranchDock)
                Disposer.dispose(owner)
                status.refreshStats()
            }
            timers.advanceBy(300)
            val next = WorktreeStatsDto(DIR, files = 9)
            stats.trySend(WorktreeStatsListDto(listOf(next))).getOrThrow()
            dirty.trySend(WorktreeDirtyListDto(listOf(WorktreeDirtyDto(DIR, files = 8)))).getOrThrow()
            assertTrue(coroutines.pumpUntil { status.stats.value[DIR] == next && status.dirty.value[DIR]?.files == 8 })
            assertTrue(edt { labels(summary).isEmpty() })
        } finally {
            edt {
                Disposer.dispose(owner)
                handle.close()
            }
            stats.close()
            dirty.close()
        }
    }

    fun `test worktree header opens distinct reusable comparison tabs with actual branch name`() {
        val rpc = FakeWorktreeRpcApi().apply {
            statsResult = WorktreeStatsListDto(listOf(WorktreeStatsDto(DIR, files = 2)))
            dirtyResult = WorktreeDirtyListDto(listOf(WorktreeDirtyDto(DIR, files = 1)))
        }
        val (_, timers) = edt { status(rpc) }
        val workspace = FakeWorkspaceRpcApi().apply { branchName = "feature/topic" }
        val app = FakeAppRpcApi().apply { state.value = KiloAppStateDto(KiloAppStatusDto.READY) }
        ApplicationManager.getApplication().replaceService(KiloWorkspaceService::class.java, KiloWorkspaceService(coroutines.scope, workspace), testRootDisposable)
        ApplicationManager.getApplication().replaceService(KiloAppService::class.java, KiloAppService(coroutines.scope, app), testRootDisposable)
        project.replaceService(KiloSessionService::class.java, sessions, testRootDisposable)
        project.replaceService(KiloDiffEditorService::class.java, KiloDiffEditorService(project, coroutines.scope), testRootDisposable)
        val view = view(target = project)
        val summary = edt { components(view).filterIsInstance<ChangesPanel>().single() }
        val editors = FileEditorManager.getInstance(project)
        try {
            timers.advanceBy(300)
            await(summary, listOf("1 file", "2 files"))
            edt {
                click(components(summary).filterIsInstance<JBLabel>().single { it.text == "1 file" })
                click(components(summary).filterIsInstance<JBLabel>().single { it.text == "2 files" })
            }
            assertTrue(coroutines.pumpUntil { edt { editors.openFiles.size == 2 } })
            edt {
                val files = editors.openFiles.filterIsInstance<KiloVirtualFile>()
                assertEquals(setOf("branch", "local"), files.map { it.path.params["source"] }.toSet())
                files.forEach { file ->
                    assertEquals(KiloDiffEditorKind.ID, file.path.kind)
                    assertEquals(DIR, file.path.params["directory"])
                    assertEquals("feature/topic", file.path.params["branch"])
                    assertFalse(file.path.params.containsKey("sessionId"))
                    assertFalse(file.path.params.containsKey("token"))
                    val comparison = KiloDiffComparison.entries.single { it.source == file.path.params["source"] }
                    assertEquals(comparison.title("feature/topic"), file.name)
                    openKiloDiff(project, "$DIR/./", comparison, "feature/topic")
                    assertSame(file, editors.openFiles.filterIsInstance<KiloVirtualFile>().single { it.path.params["source"] == comparison.source })
                }
                assertFalse(manager.showsBranchDock)
            }
            val gate = CompletableDeferred<Unit>()
            workspace.beforeBranchName = { gate.await() }
            edt {
                editors.openFiles.forEach { editors.closeFile(it) }
                click(components(summary).filterIsInstance<JBLabel>().single { it.text == "1 file" })
            }
            flush()
            edt { Disposer.dispose(view) }
            gate.complete(Unit)
            flush()
            assertTrue(edt { editors.openFiles.isEmpty() })
        } finally {
            edt {
                editors.openFiles.forEach { editors.closeFile(it) }
                service<KiloEditorKindRegistry>().unregister(KiloDiffEditorKind.ID)
                KiloVirtualFileSystem.getInstance().clear()
            }
        }
    }

    fun `test header reports the local changes of a checkout with no base stats`() {
        // The base checkout holds the branch the worktrees are compared against, so stats() reports
        // nothing for it and the header's only counts are the uncommitted ones from dirty(). This is
        // where those counts belong -- the base tab's dock stays the action row alone.
        val rpc = FakeWorktreeRpcApi().apply {
            dirtyResult = WorktreeDirtyListDto(listOf(WorktreeDirtyDto(DIR, files = 2, additions = 129)))
        }
        val (_, timers) = edt { status(rpc) }
        val view = view(target = project)
        val summary = edt { components(view).filterIsInstance<ChangesPanel>().single() }

        timers.advanceBy(300)

        await(summary, listOf("2 files", "+129"))
        assertTrue(edt { summary.isVisible })
    }

    @RequiresEdt
    private fun status(rpc: KiloWorktreeRpcApi): Pair<WorktreeStatusService, TestUiTimers> {
        ApplicationManager.getApplication().replaceService(KiloWorktreeService::class.java, KiloWorktreeService(coroutines.scope, rpc), testRootDisposable)
        ApplicationManager.getApplication().replaceService(GhStatusCoordinator::class.java, GhStatusCoordinator(coroutines.scope, TestUiTimers()), testRootDisposable)
        val timers = TestUiTimers()
        val status = WorktreeStatusService(project, coroutines.scope, timers)
        project.replaceService(WorktreeStatusService::class.java, status, testRootDisposable)
        return status to timers
    }

    private fun await(summary: ChangesPanel, expected: List<String>) {
        val arrived = coroutines.pumpUntil { edt { labels(summary) == expected } }
        assertTrue("Expected $expected, last header ${edt { labels(summary) }}", arrived)
    }

    @RequiresEdt
    private fun labels(root: java.awt.Component): List<String> {
        if (!root.isVisible) return emptyList()
        if (root is JBLabel) return listOfNotNull(root.text)
        return if (root is Container) root.components.flatMap(::labels) else emptyList()
    }

    private fun session(id: String, updated: Double) = SessionDto(
        id = id,
        projectID = "proj_test",
        directory = DIR,
        title = "Session $id",
        version = "1",
        time = SessionTimeDto(created = 0.0, updated = updated),
    )

    private fun nowSeconds() = System.currentTimeMillis().toDouble() / 1000.0

    private fun rows(): List<ActiveListItem> {
        val view = edt { UIUtil.findComponentOfType(panel, JBList::class.java)!! }
        return edt { (0 until view.model.size).map { view.model.getElementAt(it) as ActiveListItem } }
    }

    private fun row(key: String): ActiveListItem = rows().single { it.key == key }

    private fun flush() = coroutines.drain(::pump)

    private fun pump() = pumpEdt()

    private fun <T> edt(block: () -> T): T = edtWait(block)

    @RequiresEdt
    private fun components(root: java.awt.Component): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        fun visit(item: java.awt.Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private fun toggle(root: java.awt.Component = panel): WorktreeSessionListToggle =
        components(root).filterIsInstance<WorktreeSessionListToggle>().single()

    /** The row holding the toggle and its separator, left of the toolbar. */
    private fun row(): JPanel = edt { toggle().parent.parent as JPanel }

    /** The strip panel holding that row plus the action toolbar. */
    private fun strip(): JPanel = edt { row().parent as JPanel }

    /** Lays a detached subtree out top-down, since validate() is a no-op without a peer. */
    private fun lay(root: java.awt.Component) {
        if (root !is Container) return
        root.doLayout()
        root.components.forEach(::lay)
    }

    /** Trailing badge icon of the toggle, or null while it carries none. */
    private fun badge(root: java.awt.Component = panel): Icon? {
        val label = components(toggle(root)).filterIsInstance<JBLabel>().getOrNull(1) ?: return null
        return if (label.isVisible) label.icon else null
    }

    private fun shown(text: String): Boolean = shown(panel, text)

    private fun shown(root: java.awt.Component, text: String): Boolean {
        return components(root).filterIsInstance<ActionButton>().firstOrNull { it.presentation.text == text }?.isVisible == true
    }

    @RequiresEdt
    private fun click(target: javax.swing.JComponent) {
        target.setSize(target.preferredSize)
        val point = Point(target.width.coerceAtLeast(2) / 2, target.height.coerceAtLeast(2) / 2)
        listOf(
            MouseEvent(target, MouseEvent.MOUSE_PRESSED, System.currentTimeMillis(), InputEvent.BUTTON1_DOWN_MASK, point.x, point.y, 1, false, MouseEvent.BUTTON1),
            MouseEvent(target, MouseEvent.MOUSE_RELEASED, System.currentTimeMillis(), 0, point.x, point.y, 1, false, MouseEvent.BUTTON1),
            MouseEvent(target, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, point.x, point.y, 1, false, MouseEvent.BUTTON1),
        ).forEach(target::dispatchEvent)
        UIUtil.dispatchAllInvocationEvents()
    }

    private inner class FakeManager : WorktreeSessionEditorManager(
        testRootDisposable,
        project,
        workspace,
        controller,
        create = { _, _, _, _, _ -> error("unused") },
        request = {},
        cs = coroutines.scope,
        migration = FakeMigrationUiController(),
        adopt = { _, _, _ -> RenameWorktreeResultDto() },
        moveHost = { id, dir, surface -> moves += Triple(id, dir, surface) },
    ) {
        var newCount = 0
        var pending = false
        var kinds = emptyMap<String, SessionActivityKind>()
        var live = emptyMap<String, String>()
        val deletingIds = mutableSetOf<String>()
        val refs = mutableListOf<String>()
        val focuses = mutableListOf<Boolean>()
        val deleted = mutableListOf<String>()
        val renamed = mutableListOf<Pair<String, String>>()
        // Real editors resolve this once in start() from git; panel tests set it directly so
        // canMove()/moveRow() can be exercised without touching KiloWorktreeService.
        var baseValue = false

        override fun base(): Boolean = baseValue

        override fun hasPendingNew(): Boolean = pending

        override fun activity(): Map<String, SessionActivityKind> = kinds

        override fun titles(): Map<String, String> = live

        override fun deleting(): Set<String> = deletingIds

        override fun newSession() {
            newCount++
        }

        override fun openSession(ref: SessionRef, focus: Boolean) {
            refs += ref.id
            focuses += focus
        }

        override fun deleteSessions(ids: List<String>) {
            deleted += ids
        }

        override fun renameSession(id: String, title: String) {
            renamed += id to title
        }
    }

    private class SessionSink : DataSink {
        var manager: SessionManager? = null
        var workspace: Workspace? = null

        override fun <T : Any> set(key: DataKey<T>, data: T?) {
            if (key == SessionManager.KEY) manager = data as? SessionManager
            if (key == SessionManager.WORKSPACE_KEY) workspace = data as? Workspace
        }

        override fun <T : Any> setNull(key: DataKey<T>) {}
        override fun <T : Any> lazyNull(key: DataKey<T>) {}
        override fun <T : Any> lazyValue(key: DataKey<T>, data: (DataMap) -> T?) {}
        override fun uiDataSnapshot(provider: UiDataProvider) = provider.uiDataSnapshot(this)
        override fun dataSnapshot(provider: DataSnapshotProvider) = provider.dataSnapshot(this)
        override fun uiDataSnapshot(provider: DataProvider) {}
    }

    private companion object {
        const val DIR = "/repo/.kilo/worktrees/feature-x"
    }
}
