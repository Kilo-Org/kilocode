package ai.kilocode.client.settings.rules

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.testing.FakeAgentBehaviorRpcApi
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.fire
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.activeListCellBounds
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.openapi.actionSystem.impl.ActionButton
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.TestDialog
import com.intellij.openapi.ui.TestDialogManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.TitledSeparator
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Container
import java.awt.Dimension
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.ScrollPaneConstants

class RulesSettingsUiTest : BasePlatformTestCase() {
    private lateinit var appCoroutines: TestCoroutines
    private lateinit var uiCoroutines: TestCoroutines
    private lateinit var rpc: FakeAppRpcApi
    private lateinit var workspaceRpc: FakeWorkspaceRpcApi
    private lateinit var agentRpc: FakeAgentBehaviorRpcApi
    private lateinit var app: KiloAppService
    private lateinit var workspaces: KiloWorkspaceService
    private lateinit var agent: KiloAgentBehaviorService
    private val writes = mutableListOf<Pair<String, String>>()
    private var ui: RulesSettingsUi? = null

    override fun tearDown() {
        try {
            TestDialogManager.setTestDialog(TestDialog.DEFAULT)
            val panel = ui
            if (panel != null) edt { panel.dispose() }
            ui = null
            if (::uiCoroutines.isInitialized) uiCoroutines.close(::pump)
            if (::appCoroutines.isInitialized) appCoroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    fun `test rules list is center with claude footer south and right padding`() {
        val panel = panel()
        flushUntil { rows(panel).size == 1 }

        edt {
            val pane = scrollFor(panel, rulesList(panel))
            val layout = panel.content.layout as BorderLayout
            assertSame(pane, layout.getLayoutComponent(BorderLayout.CENTER))
            assertSame(panel.footer, layout.getLayoutComponent(BorderLayout.SOUTH))
            assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, pane.horizontalScrollBarPolicy)
            assertTrue(panel.footer.insets.right > 0)
            assertTrue(components(panel.footer).filterIsInstance<TitledSeparator>().any { it.text == "Claude Code Compatibility" })
        }
    }

    fun `test toolbar has add action and no refresh action`() {
        val panel = panel()
        flushUntil { rows(panel).size == 1 }

        edt {
            val texts = components(panel).filterIsInstance<ActionButton>().mapNotNull { it.presentation.text }
            assertTrue(texts.any { it == "Add file" })
            assertFalse(texts.any { it.contains("Refresh", ignoreCase = true) })
        }
    }

    fun `test rows use standard action cells`() {
        val panel = panel()
        flushUntil { rows(panel).size == 1 }

        edt {
            val row = rows(panel).single()
            assertEquals("./RULES.md", row.title)
            assertEquals("edit", row.doubleClick)
            assertEquals(listOf("open", "edit", "delete"), row.cells.map { it.id })
            assertTrue(row.cells.single { it.id == "open" }.primary)
            assertEquals("Edit", row.cells.single { it.id == "edit" }.label)
            assertTrue(row.cells.single { it.id == "delete" }.iconOnly)
        }
    }

    fun `test add file stages instructions patch only`() {
        val panel = panel(input = { "./TEAM.md" })
        flushUntil { rows(panel).size == 1 }

        edt {
            panel.addFile()
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() && !edt { panel.modified() } }
        assertEquals(listOf("./RULES.md", "./TEAM.md"), rpc.configPatches.single().instructions)
        assertTrue(agentRpc.compatSaves.isEmpty())
        assertTrue(writes.isEmpty())
    }

    fun `test edit opens content editor and writes file on apply without config patch`() {
        val edited = mutableListOf<Pair<String, String>>()
        val panel = panel(
            read = { path -> "# $path" },
            editor = { title, content ->
                edited += title to content
                FakeContentDialog("# edited")
            },
        )
        flushUntil { rows(panel).size == 1 }

        doubleClick(rulesList(panel), panel, "./RULES.md")
        assertEquals(listOf("./RULES.md" to "# ./RULES.md"), edited)
        assertTrue(edt { panel.modified() })
        assertTrue(rpc.configPatches.isEmpty())

        edt { panel.applyDraft() }
        flushUntil { writes.isNotEmpty() && !edt { panel.modified() } }
        assertEquals(listOf("./RULES.md" to "# edited"), writes)
        assertTrue(rpc.configPatches.isEmpty())
    }

    fun `test reopening staged edit shows draft content`() {
        val seen = mutableListOf<String>()
        val panel = panel(
            read = { "# disk" },
            editor = { _, content ->
                seen += content
                FakeContentDialog("# draft")
            },
        )
        flushUntil { rows(panel).size == 1 }

        doubleClick(rulesList(panel), panel, "./RULES.md")
        doubleClick(rulesList(panel), panel, "./RULES.md")

        assertEquals(listOf("# disk", "# draft"), seen)
    }

    fun `test edit is a no-op when file content is unavailable`() {
        var opened = false
        val panel = panel(read = { null }, editor = { _, _ -> opened = true; FakeContentDialog("x") })
        flushUntil { rows(panel).size == 1 }

        doubleClick(rulesList(panel), panel, "./RULES.md")

        assertFalse(opened)
        assertFalse(edt { panel.modified() })
    }

    fun `test open in editor action opens instruction file`() {
        val panel = panel(root = "/repo")
        flushUntil { rows(panel).size == 1 }

        click(rulesList(panel), panel, "./RULES.md", "open")

        flushUntil { workspaceRpc.openedFiles.size == 1 }
        assertEquals(FakeWorkspaceRpcApi.Opened("/repo/RULES.md", null, null), workspaceRpc.openedFiles.single())
    }

    fun `test delete action stages removal until apply`() {
        val panel = panel()
        flushUntil { rows(panel).size == 1 }
        TestDialogManager.setTestDialog(TestDialog.YES)

        click(rulesList(panel), panel, "./RULES.md", "delete")
        assertTrue(edt { rows(panel).isEmpty() })
        edt { panel.applyDraft() }

        flushUntil { rpc.configPatches.isNotEmpty() }
        assertEquals(emptyList<String>(), rpc.configPatches.single().instructions)
    }

    fun `test delete action requires confirmation`() {
        val panel = panel()
        flushUntil { rows(panel).size == 1 }
        TestDialogManager.setTestDialog { Messages.NO }

        click(rulesList(panel), panel, "./RULES.md", "delete")

        assertEquals(listOf("./RULES.md"), edt { rows(panel).map { it.key } })
        assertFalse(edt { panel.modified() })
    }

    fun `test toggling compat saves compat only`() {
        val panel = panel()
        flushUntil { rows(panel).size == 1 }

        edt {
            toggle(panel).doClick()
            panel.applyDraft()
        }

        flushUntil { agentRpc.compatSaves.isNotEmpty() && !edt { panel.modified() } }
        assertEquals(listOf(false), agentRpc.compatSaves)
        assertTrue(rpc.configPatches.isEmpty())
    }

    fun `test save survives dialog dispose on ok`() {
        val panel = panel(input = { "./TEAM.md" })
        flushUntil { rows(panel).size == 1 }

        edt {
            panel.addFile()
            panel.applyDraft()
            // Emulate the platform disposing the configurable immediately after apply() on OK.
            panel.dispose()
        }
        ui = null

        flushUntil { rpc.configPatches.isNotEmpty() }
        assertEquals(listOf("./RULES.md", "./TEAM.md"), rpc.configPatches.single().instructions)
    }

    fun `test reset restores seeded baseline`() {
        val panel = panel(input = { "./TEAM.md" }, read = { "# disk" }, editor = { _, _ -> FakeContentDialog("# edited") })
        flushUntil { rows(panel).size == 1 }

        edt {
            panel.addFile()
            toggle(panel).doClick()
            assertTrue(panel.modified())
            panel.resetDraft()
            assertFalse(panel.modified())
            assertEquals(listOf("./RULES.md"), rows(panel).map { it.key })
            assertTrue(toggle(panel).isSelected)
        }
    }

    fun `test content editor dialog exposes content`() {
        edt {
            val dialog = InstructionEditDialog("./RULES.md", "# Rules")
            try {
                assertEquals("# Rules", dialog.content())
            } finally {
                dialog.close(0)
            }
        }
    }

    fun `test content scroll renders an editor field`() {
        edt {
            val field = ai.kilocode.client.settings.base.SettingsContentField(
                "# Rules",
                ai.kilocode.client.settings.base.settingsEditorFileType("./RULES.md", "# Rules"),
                true,
            )
            val scroll = ai.kilocode.client.settings.base.settingsContentScroll(field)
            assertTrue(components(scroll).any { it is com.intellij.ui.EditorTextField })
        }
    }

    fun `test rule path descriptor chooses files`() {
        assertTrue(rulePathDescriptor().isChooseFiles)
        assertFalse(rulePathDescriptor().isChooseFolders)
    }

    private fun panel(
        root: String? = null,
        choose: (JComponent) -> String? = { null },
        input: () -> String? = { null },
        read: (String) -> String? = { null },
        editor: (String, String) -> RuleContentDialogHandle = { _, _ -> FakeContentDialog("") },
    ): RulesSettingsUi {
        install()
        val write: (String, String) -> Boolean = { path, text -> writes += path to text; true }
        val panel = edt { RulesSettingsUi(uiCoroutines.scope, root, choose, input, read, write, editor, app, workspaces, agent) }
        ui = panel
        return panel
    }

    private fun install() {
        appCoroutines = TestCoroutines()
        uiCoroutines = TestCoroutines()
        rpc = FakeAppRpcApi()
        workspaceRpc = FakeWorkspaceRpcApi()
        agentRpc = FakeAgentBehaviorRpcApi()
        agentRpc.claudeCodeCompat = true
        app = KiloAppService(appCoroutines.scope, rpc)
        workspaces = KiloWorkspaceService(appCoroutines.scope, workspaceRpc)
        agent = KiloAgentBehaviorService(appCoroutines.scope, agentRpc)
        val state = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(instructions = listOf("./RULES.md")),
        )
        rpc.state.value = state
        app._state.value = state
    }

    private fun click(list: JBList<ActiveListItem>, panel: RulesSettingsUi, key: String, id: String) {
        edt {
            list.size = Dimension(520, 320)
            list.doLayout()
            val idx = rows(panel).indexOfFirst { it.key == key }
            list.selectedIndex = idx
            val area = activeListCellBounds(list, idx, selected = true).getValue(id)
            click(list, center(area))
        }
    }

    private fun doubleClick(list: JBList<ActiveListItem>, panel: RulesSettingsUi, key: String) {
        edt {
            list.size = Dimension(520, 320)
            list.doLayout()
            val idx = rows(panel).indexOfFirst { it.key == key }
            list.selectedIndex = idx
            val area = list.getCellBounds(idx, idx)
            fire(list, mouse(list, MouseEvent.MOUSE_CLICKED, center(area), count = 2))
        }
    }

    private fun rows(panel: RulesSettingsUi): List<ActiveListItem> {
        val list = rulesList(panel)
        val model = list.model
        return (0 until model.size).map { model.getElementAt(it) }
    }

    private fun rulesList(panel: RulesSettingsUi) = components(panel).filterIsInstance<JBList<ActiveListItem>>().single()

    private fun toggle(panel: RulesSettingsUi): SettingsToggle = components(panel).filterIsInstance<SettingsToggle>().single()

    private fun scrollFor(panel: RulesSettingsUi, list: JBList<ActiveListItem>) = components(panel)
        .filterIsInstance<JBScrollPane>()
        .single { pane -> pane.viewport.view === list.parent }

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

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun flushUntil(done: () -> Boolean) {
        repeat(200) {
            flush()
            if (done()) return
        }
        flush()
        assertTrue(done())
    }

    private fun flush() {
        appCoroutines.drain(::pump)
        uiCoroutines.drain(::pump)
        pump()
    }

    private fun pump() {
        edt { UIUtil.dispatchAllInvocationEvents() }
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
}

private class FakeContentDialog(private val text: String) : RuleContentDialogHandle {
    override fun showAndGet() = true
    override fun content() = text
}
