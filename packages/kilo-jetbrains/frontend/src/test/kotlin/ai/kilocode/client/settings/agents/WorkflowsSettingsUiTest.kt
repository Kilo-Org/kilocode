package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.testing.FakeAgentBehaviorRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.fire
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.activeListCellBounds
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.CommandFileDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.fileTypes.UnknownFileType
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.TestDialog
import com.intellij.openapi.ui.TestDialogManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.UIUtil
import java.awt.Container
import java.awt.Dimension
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.JTextField
import javax.swing.ScrollPaneConstants
import javax.swing.Scrollable
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking

class WorkflowsSettingsUiTest : BasePlatformTestCase() {
    private var scope: CoroutineScope? = null
    private var ui: WorkflowsSettingsUi? = null
    private lateinit var agentRpc: FakeAgentBehaviorRpcApi
    private lateinit var workspaceRpc: FakeWorkspaceRpcApi
    private var shown = 0

    override fun tearDown() {
        try {
            TestDialogManager.setTestDialog(TestDialog.DEFAULT)
            ui?.let { panel -> edt { panel.dispose(); true } }
            ui = null
            scope?.cancel()
            scope = null
        } finally {
            super.tearDown()
        }
    }

    fun `test loads workflows with location note and builtins have no actions`() {
        val panel = panel()

        flushUntil { rows(panel).size == 3 }

        edt {
            val rows = rows(panel)
            val custom = rows.single { it.key == CUSTOM }
            assertEquals("/plan", custom.title)
            assertEquals(CUSTOM, custom.note)
            assertEquals("Plan work", custom.description)
            assertEquals("edit", custom.doubleClick)
            assertEquals(listOf("open", "edit", "delete"), custom.cells.map { it.id })
            assertTrue(custom.cells.single { it.id == "open" }.primary)
            assertFalse(custom.cells.single { it.id == "edit" }.primary)
            assertEquals("Edit", custom.cells.single { it.id == "edit" }.label)
            assertTrue(custom.cells.single { it.id == "delete" }.iconOnly)
            val builtin = rows.single { it.key == "builtin::init" }
            assertEquals("/init", builtin.title)
            assertNull(builtin.note)
            assertEquals(listOf("built-in"), builtin.badges.map { it.text })
            assertEquals(listOf("edit"), builtin.cells.map { it.id })
            assertEquals("Open", builtin.cells.single().label)
            val remote = rows.single { it.key == REMOTE }
            assertEquals(listOf("edit"), remote.cells.map { it.id })
            assertEquals("Open", remote.cells.single().label)
            assertEquals(listOf(DIR), agentRpc.commandCalls)
            true
        }
    }

    fun `test workflows list is vertically scrolled without horizontal scrollbar`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val pane = scrollFor(panel, workflowsList(panel))
            val view = pane.viewport.view

            assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, pane.horizontalScrollBarPolicy)
            assertTrue((view as Scrollable).getScrollableTracksViewportWidth())
            assertFalse(view.getScrollableTracksViewportHeight())
            true
        }
    }

    fun `test renderer puts location on first line and description on preview line`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val list = workflowsList(panel)
            val row = rows(panel).single { it.key == CUSTOM }
            val idx = rows(panel).indexOf(row)
            val comp = list.cellRenderer.getListCellRendererComponent(list, row, idx, true, true)
            comp.setSize(520, list.fixedCellHeight)
            layout(comp)
            val title = components(comp).filterIsInstance<SimpleColoredComponent>().single()
            val labels = components(comp).filterIsInstance<JBLabel>().filter { it.isVisible }.map { it.text }

            assertEquals("/plan  $CUSTOM", title.toString())
            assertTrue(labels.contains("Plan work"))
            true
        }
    }

    fun `test double click stages workflow content until apply`() {
        val panel = panel(edit = { _, _ -> FakeWorkflowDialog("# Saved") })
        flushUntil { rows(panel).size == 3 }

        doubleClick(workflowsList(panel), panel, CUSTOM)

        assertTrue(edt { panel.modified() })
        assertTrue(agentRpc.commandSaves.isEmpty())
        edt { panel.applyDraft(); true }
        flushUntil { agentRpc.commandSaves.size == 1 }
        assertEquals(Triple(DIR, CUSTOM, "# Saved"), agentRpc.commandSaves.single())
    }

    fun `test reopening staged workflow edit shows draft content before apply`() {
        val seen = mutableListOf<String?>()
        val panel = panel(edit = { flow, _ ->
            seen += flow.content
            FakeWorkflowDialog(if (seen.size == 1) "# Draft" else "# Draft 2")
        })
        flushUntil { rows(panel).size == 3 }

        doubleClick(workflowsList(panel), panel, CUSTOM)
        doubleClick(workflowsList(panel), panel, CUSTOM)

        assertEquals(listOf("# Plan\nUse steps", "# Draft"), seen)
        assertTrue(agentRpc.commandSaves.isEmpty())
    }

    fun `test open in editor action opens workflow file`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        click(workflowsList(panel), panel, CUSTOM, "open")

        assertEquals("The workflow file will open after you close Settings.", edt { progressText(panel) })
        flushUntil { workspaceRpc.openedFiles.size == 1 }
        assertEquals(FakeWorkspaceRpcApi.Opened(CUSTOM, null, null), workspaceRpc.openedFiles.single())
    }

    fun `test read only workflows open without staging edits or editor file open`() {
        shown = 0
        val panel = panel(edit = { _, savable ->
            assertFalse(savable)
            FakeWorkflowDialog("# Ignored") { shown += 1 }
        })
        flushUntil { rows(panel).size == 3 }

        click(workflowsList(panel), panel, REMOTE, "edit")

        assertEquals(1, shown)
        assertFalse(edt { panel.modified() })
        assertTrue(agentRpc.commandSaves.isEmpty())
        assertTrue(workspaceRpc.openedFiles.isEmpty())
    }

    fun `test workflow edit dialog shows content with fallback`() {
        edt {
            val content = WorkflowEditDialog(CommandFileDto("plan", "desc", location = CUSTOM, content = "# Plan\nUse steps"), true)
            val fallback = WorkflowEditDialog(CommandFileDto("plan", "desc", location = CUSTOM), true)
            val readonly = WorkflowEditDialog(CommandFileDto("init", "desc", location = "builtin", content = "Built in content"), false)
            try {
                assertEquals("# Plan\nUse steps", content.content())
                assertEquals("desc", fallback.content())
                assertEquals("Built in content", readonly.content())
                assertEquals("OK", content.okText())
            } finally {
                content.close(DialogWrapper.CANCEL_EXIT_CODE)
                fallback.close(DialogWrapper.CANCEL_EXIT_CODE)
                readonly.close(DialogWrapper.CANCEL_EXIT_CODE)
            }
            true
        }
    }

    fun `test delete action stages workflow removal until apply`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        TestDialogManager.setTestDialog(TestDialog.YES)

        click(workflowsList(panel), panel, CUSTOM, "delete")

        assertTrue(edt { rows(panel).none { it.key == CUSTOM } })
        assertTrue(agentRpc.commandRemovals.isEmpty())
        edt { panel.applyDraft(); true }
        flushUntil { agentRpc.commandRemovals.size == 1 }
        assertEquals(listOf(DIR to CUSTOM), agentRpc.commandRemovals)
    }

    fun `test delete action requires confirmation`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        TestDialogManager.setTestDialog { Messages.NO }

        click(workflowsList(panel), panel, CUSTOM, "delete")

        edt { UIUtil.dispatchAllInvocationEvents(); true }
        assertTrue(agentRpc.commandRemovals.isEmpty())
        assertTrue(edt { rows(panel).any { it.key == CUSTOM } })
    }

    fun `test blocked reload completes apply with warning`() {
        val panel = panel(edit = { _, _ -> FakeWorkflowDialog("# Saved") })
        agentRpc.reloadCommandResult = false
        flushUntil { rows(panel).size == 3 }

        doubleClick(workflowsList(panel), panel, CUSTOM)
        edt { panel.applyDraft(); true }

        flushUntil { agentRpc.commandSaves.size == 1 && !edt { panel.modified() } }
        assertEquals(listOf(DIR), agentRpc.commandReloads)
        assertEquals("Workflows settings saved, but active sessions are present. Reload the core after those sessions finish to apply the new workflows.", edt { progressText(panel) })
    }

    fun `test post apply workflows refresh failure keeps saved rows`() {
        val panel = panel(edit = { _, _ -> FakeWorkflowDialog("# Saved") })
        flushUntil { rows(panel).size == 3 }

        doubleClick(workflowsList(panel), panel, CUSTOM)
        agentRpc.commandFilesError = RuntimeException("timeout")
        edt { panel.applyDraft(); true }

        flushUntil { agentRpc.commandSaves.size == 1 && !edt { panel.modified() } }
        assertEquals(listOf(CUSTOM, "builtin::init", REMOTE), edt { rows(panel).map { it.key } })
        assertEquals("# Saved", agentRpc.commandFiles.single { it.location == CUSTOM }.content)
    }

    fun `test fileless workflow keys stay unique and route read only opens`() {
        val seen = mutableListOf<String?>()
        val panel = panel(edit = { flow, savable ->
            assertFalse(savable)
            seen += flow.content
            FakeWorkflowDialog("# Ignored")
        })
        flushUntil { rows(panel).size == 3 }
        agentRpc.commandFiles = listOf(
            CommandFileDto("init", "Built in", builtin = true, location = "builtin", content = "Init content"),
            CommandFileDto("review", "Built in", builtin = true, location = "builtin", content = "Review content"),
        )
        edt { panel.reload(); true }
        flushUntil { rows(panel).size == 2 }

        click(workflowsList(panel), panel, "builtin::init", "edit")
        click(workflowsList(panel), panel, "builtin::review", "edit")

        assertEquals(listOf("builtin::init", "builtin::review"), edt { rows(panel).map { it.key } })
        assertEquals(listOf("Init content", "Review content"), seen)
    }

    fun `test apply while list busy preserves staged workflow edits`() {
        val panel = panel(edit = { _, _ -> FakeWorkflowDialog("# Saved") })
        flushUntil { rows(panel).size == 3 }
        doubleClick(workflowsList(panel), panel, CUSTOM)
        agentRpc.commandFilesGate = CompletableDeferred()

        edt {
            panel.reload()
            panel.applyDraft()
            true
        }

        assertTrue(edt { panel.modified() })
        assertTrue(agentRpc.commandSaves.isEmpty())
        agentRpc.commandFilesGate?.complete(Unit)
    }

    fun `test failed open in editor clears pending banner`() {
        val panel = panel()
        workspaceRpc.openResult = false
        flushUntil { rows(panel).size == 3 }

        click(workflowsList(panel), panel, CUSTOM, "open")

        flushUntil { workspaceRpc.openedFiles.size == 1 && edt { !panel.progress.isVisible && progressText(panel).isBlank() } }
    }

    fun `test search filters workflows by name`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            components(panel).filterIsInstance<JTextField>().single().text = "init"
            UIUtil.dispatchAllInvocationEvents()
            true
        }

        flushUntil { rows(panel).map { it.key } == listOf("builtin::init") }
    }

    fun `test workflows reload failure keeps existing rows`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        agentRpc.commandFilesError = RuntimeException("timeout")

        edt { panel.reload(); true }
        flushUntil { edt { workflowsList(panel).isEnabled } }

        assertEquals(listOf(CUSTOM, "builtin::init", REMOTE), edt { rows(panel).map { it.key } })
    }

    fun `test workflow editor file type follows location extension`() {
        assertNotSame(UnknownFileType.INSTANCE, workflowFileType("/tmp/workflows/plan.md"))
        assertEquals(
            FileTypeManager.getInstance().getFileTypeByFileName("index.html"),
            workflowFileType("/tmp/workflows/index.html"),
        )
        assertEquals(PlainTextFileType.INSTANCE, workflowFileType("/tmp/workflows/index.unknown"))
    }

    private fun panel(
        edit: (CommandFileDto, Boolean) -> WorkflowEditDialogHandle = { _, _ -> FakeWorkflowDialog("# Plan\nUse steps") },
    ): WorkflowsSettingsUi {
        install()
        val panel = edt { WorkflowsSettingsUi(scope!!, DIR, edit) }
        ui = panel
        edt { panel.reload(); true }
        return panel
    }

    private fun install() {
        val cs = CoroutineScope(SupervisorJob())
        scope = cs
        workspaceRpc = FakeWorkspaceRpcApi()
        agentRpc = FakeAgentBehaviorRpcApi().apply {
            commandFiles = listOf(
                CommandFileDto("plan", "Plan work", location = CUSTOM, editable = true, content = "# Plan\nUse steps"),
                CommandFileDto("init", "Built in", builtin = true, location = "builtin", content = "Built in content"),
                CommandFileDto("remote", "Remote workflow", location = REMOTE, content = "# Remote workflow"),
            )
        }
        ApplicationManager.getApplication().replaceService(KiloAgentBehaviorService::class.java, KiloAgentBehaviorService(cs, agentRpc), testRootDisposable)
        ApplicationManager.getApplication().replaceService(KiloWorkspaceService::class.java, KiloWorkspaceService(cs, workspaceRpc), testRootDisposable)
    }

    private fun click(list: JBList<ActiveListItem>, panel: WorkflowsSettingsUi, key: String, id: String) {
        edt {
            list.size = Dimension(520, 320)
            list.doLayout()
            val idx = rows(panel).indexOfFirst { it.key == key }
            list.selectedIndex = idx
            val area = activeListCellBounds(list, idx, selected = true).getValue(id)
            click(list, center(area))
            true
        }
    }

    private fun doubleClick(list: JBList<ActiveListItem>, panel: WorkflowsSettingsUi, key: String) {
        edt {
            list.size = Dimension(520, 320)
            list.doLayout()
            val idx = rows(panel).indexOfFirst { it.key == key }
            list.selectedIndex = idx
            val area = list.getCellBounds(idx, idx)
            fire(list, mouse(list, MouseEvent.MOUSE_CLICKED, center(area), count = 2))
            true
        }
    }

    private fun rows(panel: WorkflowsSettingsUi): List<ActiveListItem> = items(workflowsList(panel))

    private fun items(list: JBList<ActiveListItem>): List<ActiveListItem> {
        val model = list.model
        return (0 until model.size).map { model.getElementAt(it) }
    }

    private fun workflowsList(panel: WorkflowsSettingsUi) = components(panel).filterIsInstance<JBList<ActiveListItem>>().first()

    private fun scrollFor(panel: WorkflowsSettingsUi, list: JBList<ActiveListItem>) = components(panel)
        .filterIsInstance<JBScrollPane>()
        .single { pane -> pane.viewport.view === list.parent }

    private fun progressText(panel: WorkflowsSettingsUi) = components(panel.progress).filterIsInstance<JBLabel>().single().text

    private fun WorkflowEditDialog.okText(): String {
        val method = DialogWrapper::class.java.getDeclaredMethod("getOKAction")
        method.isAccessible = true
        return (method.invoke(this) as javax.swing.Action).getValue(javax.swing.Action.NAME) as String
    }

    private fun components(root: java.awt.Component): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        fun visit(item: java.awt.Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private fun layout(root: java.awt.Component) {
        root.doLayout()
        if (root is Container) root.components.filterIsInstance<Container>().forEach { layout(it) }
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun center(rect: java.awt.Rectangle) = Point(rect.x + rect.width / 2, rect.y + rect.height / 2)

    private fun click(list: JBList<ActiveListItem>, point: Point) {
        fire(list, mouse(list, MouseEvent.MOUSE_PRESSED, point))
        fire(list, mouse(list, MouseEvent.MOUSE_RELEASED, point))
    }

    private fun mouse(list: JBList<ActiveListItem>, id: Int, point: Point, count: Int = 1) = MouseEvent(
        list,
        id,
        System.currentTimeMillis(),
        if (id == MouseEvent.MOUSE_PRESSED) InputEvent.BUTTON1_DOWN_MASK else 0,
        point.x,
        point.y,
        count,
        false,
        MouseEvent.BUTTON1,
    )

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun flushUntil(done: () -> Boolean) = runBlocking {
        repeat(300) {
            delay(10)
            edt { UIUtil.dispatchAllInvocationEvents(); true }
            if (done()) return@runBlocking
        }
        edt { UIUtil.dispatchAllInvocationEvents(); true }
        assertTrue(done())
    }

    private companion object {
        const val DIR = "/test"
        const val CUSTOM = "/home/test/.kilo/workflows/plan.md"
        const val REMOTE = "/home/test/.cache/kilo/commands/remote.md"
    }
}

private class FakeWorkflowDialog(private val text: String, private val show: () -> Unit = {}) : WorkflowEditDialogHandle {
    override fun showAndGet(): Boolean {
        show()
        return true
    }
    override fun content() = text
}
