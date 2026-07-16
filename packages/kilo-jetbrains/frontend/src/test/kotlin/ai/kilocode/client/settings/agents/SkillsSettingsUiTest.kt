package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsListItem
import ai.kilocode.client.settings.base.settingsListCellBounds
import ai.kilocode.client.testing.FakeAgentBehaviorRpcApi
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.fire
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.SkillDto
import ai.kilocode.rpc.dto.SkillsConfigDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.TestDialog
import com.intellij.openapi.ui.TestDialogManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.Container
import java.awt.Dimension
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.JTextField

class SkillsSettingsUiTest : BasePlatformTestCase() {
    private var scope: CoroutineScope? = null
    private var ui: SkillsSettingsUi? = null
    private lateinit var app: KiloAppService
    private lateinit var appRpc: FakeAppRpcApi
    private lateinit var agentRpc: FakeAgentBehaviorRpcApi
    private lateinit var workspaceRpc: FakeWorkspaceRpcApi

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

    fun `test loads skills with location note and builtins have no actions`() {
        val panel = panel()

        flushUntil { rows(panel).size == 2 }

        edt {
            val rows = rows(panel)
            val custom = rows.single { it.key == CUSTOM }
            assertEquals("plan", custom.title)
            assertEquals(CUSTOM, custom.note)
            assertEquals("Plan work", custom.description)
            assertEquals(listOf("open", "delete"), custom.cells.map { it.id })
            val open = custom.cells.single { it.id == "open" }
            assertEquals(KiloBundle.message("settings.agentBehavior.skills.open"), open.label)
            assertTrue(open.primary)
            assertFalse(open.iconOnly)
            assertNull(open.icon)
            assertTrue(custom.cells.single { it.id == "delete" }.iconOnly)
            val builtin = rows.single { it.key == "builtin" }
            assertEquals("thinking", builtin.title)
            assertNull(builtin.note)
            assertEquals(listOf("built-in"), builtin.badges.map { it.text })
            assertTrue(builtin.cells.isEmpty())
            assertEquals(listOf(DIR), agentRpc.skillCalls)
            true
        }
    }

    fun `test skills list does not show description tooltips`() {
        val panel = panel()
        flushUntil { rows(panel).size == 2 }

        edt {
            val list = skillsList(panel)
            list.size = Dimension(520, 320)
            list.doLayout()
            val bounds = list.getCellBounds(0, 0)

            assertNull(list.getToolTipText(mouse(list, MouseEvent.MOUSE_MOVED, Point(bounds.x + 8, bounds.y + 8))))
            true
        }
    }

    fun `test renderer puts location on first line and description on preview line`() {
        val panel = panel()
        flushUntil { rows(panel).size == 2 }

        edt {
            val list = skillsList(panel)
            val row = rows(panel).single { it.key == CUSTOM }
            val idx = rows(panel).indexOf(row)
            val comp = list.cellRenderer.getListCellRendererComponent(list, row, idx, true, true)
            comp.setSize(520, list.fixedCellHeight)
            layout(comp)
            val title = components(comp).filterIsInstance<SimpleColoredComponent>().single()
            val labels = components(comp).filterIsInstance<JBLabel>().filter { it.isVisible }.map { it.text }

            assertEquals("plan  $CUSTOM", title.toString())
            assertTrue(labels.contains("Plan work"))
            true
        }
    }

    fun `test open action calls direct open file`() {
        val panel = panel()
        flushUntil { rows(panel).size == 2 }

        click(skillsList(panel), panel, CUSTOM, "open")

        flushUntil { workspaceRpc.opened.contains(CUSTOM) }
        assertEquals(listOf(CUSTOM), workspaceRpc.opened)
        assertTrue(workspaceRpc.fileCalls.isEmpty())
    }

    fun `test delete action removes skill and reloads`() {
        val panel = panel()
        flushUntil { rows(panel).size == 2 }
        TestDialogManager.setTestDialog(TestDialog.YES)

        click(skillsList(panel), panel, CUSTOM, "delete")

        flushUntil { rows(panel).none { it.key == CUSTOM } }
        assertEquals(listOf(DIR to CUSTOM), agentRpc.skillRemovals)
    }

    fun `test delete action requires confirmation`() {
        val panel = panel()
        flushUntil { rows(panel).size == 2 }
        TestDialogManager.setTestDialog { Messages.NO }

        click(skillsList(panel), panel, CUSTOM, "delete")

        edt { UIUtil.dispatchAllInvocationEvents(); true }
        assertTrue(agentRpc.skillRemovals.isEmpty())
        assertTrue(edt { rows(panel).any { it.key == CUSTOM } })
    }

    fun `test add path and url write skills config patch`() {
        var path = "/extra/skills"
        var url = "https://skills.test/index.json"
        val panel = panel(choose = { path }, input = { _, _ -> url })
        flushUntil { rows(panel).size == 2 }

        edt { panel.sources.addPath(); true }
        flushUntil { appRpc.configPatches.size == 1 }
        flushUntil { edt { skillsList(panel).isEnabled } }
        edt { panel.sources.addUrl(); true }
        flushUntil { appRpc.configPatches.size == 2 }

        val paths = appRpc.configPatches.first().skills!!.paths
        val urls = appRpc.configPatches.last().skills!!.urls
        assertEquals(listOf("/global/skills", path), paths)
        assertEquals(listOf("https://skills.test/base.json", url), urls)
    }

    fun `test delete source writes skills config patch`() {
        val panel = panel()
        flushUntil { rows(panel).size == 2 && sourceRows(panel).size == 2 }

        click(sourceList(panel), panel, "path:/global/skills", "delete")

        flushUntil { appRpc.configPatches.size == 1 }
        val patch = appRpc.configPatches.single().skills!!
        assertEquals(emptyList<String>(), patch.paths)
        assertEquals(listOf("https://skills.test/base.json"), patch.urls)
    }

    fun `test search filters skills by name`() {
        val panel = panel()
        flushUntil { rows(panel).size == 2 }

        edt {
            components(panel).filterIsInstance<JTextField>().single().text = "think"
            UIUtil.dispatchAllInvocationEvents()
            true
        }

        flushUntil { rows(panel).map { it.key } == listOf("builtin") }
    }

    private fun panel(
        choose: (JComponent) -> String? = { null },
        input: (String, String) -> String? = { _, _ -> null },
    ): SkillsSettingsUi {
        install()
        val panel = edt { SkillsSettingsUi(scope!!, DIR, choose, input) }
        ui = panel
        edt { panel.reload(); true }
        return panel
    }

    private fun install() {
        val cs = CoroutineScope(SupervisorJob())
        scope = cs
        appRpc = FakeAppRpcApi()
        agentRpc = FakeAgentBehaviorRpcApi().apply {
            skills = listOf(
                SkillDto("plan", "Plan work", CUSTOM),
                SkillDto("thinking", "Built in", "builtin"),
            )
        }
        workspaceRpc = FakeWorkspaceRpcApi()
        app = KiloAppService(cs, appRpc)
        val ready = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(skills = SkillsConfigDto(
                paths = listOf("/global/skills"),
                urls = listOf("https://skills.test/base.json"),
            )),
        )
        app._state.value = ready
        appRpc.state.value = ready
        ApplicationManager.getApplication().replaceService(KiloAppService::class.java, app, testRootDisposable)
        ApplicationManager.getApplication().replaceService(KiloAgentBehaviorService::class.java, KiloAgentBehaviorService(cs, agentRpc), testRootDisposable)
        ApplicationManager.getApplication().replaceService(KiloWorkspaceService::class.java, KiloWorkspaceService(cs, workspaceRpc), testRootDisposable)
    }

    private fun click(list: JBList<SettingsListItem>, panel: SkillsSettingsUi, key: String, id: String) {
        edt {
            list.size = Dimension(520, 320)
            list.doLayout()
            val rows = if (list === skillsList(panel)) rows(panel) else sourceRows(panel)
            val idx = rows.indexOfFirst { it.key == key }
            list.selectedIndex = idx
            val area = settingsListCellBounds(list, idx, selected = true).getValue(id)
            click(list, center(area))
            true
        }
    }

    private fun rows(panel: SkillsSettingsUi): List<SettingsListItem> = items(skillsList(panel))

    private fun sourceRows(panel: SkillsSettingsUi): List<SettingsListItem> = items(sourceList(panel))

    private fun items(list: JBList<SettingsListItem>): List<SettingsListItem> {
        val model = list.model
        return (0 until model.size).map { model.getElementAt(it) }
    }

    private fun skillsList(panel: SkillsSettingsUi) = components(panel).filterIsInstance<JBList<SettingsListItem>>().first()

    private fun sourceList(panel: SkillsSettingsUi) = components(panel).filterIsInstance<JBList<SettingsListItem>>().last()

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

    private fun click(list: JBList<SettingsListItem>, point: Point) {
        fire(list, mouse(list, MouseEvent.MOUSE_PRESSED, point))
        fire(list, mouse(list, MouseEvent.MOUSE_RELEASED, point))
    }

    private fun mouse(list: JBList<SettingsListItem>, id: Int, point: Point) = MouseEvent(
        list,
        id,
        System.currentTimeMillis(),
        if (id == MouseEvent.MOUSE_PRESSED) InputEvent.BUTTON1_DOWN_MASK else 0,
        point.x,
        point.y,
        1,
        false,
        MouseEvent.BUTTON1,
    )

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

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
        const val CUSTOM = "/home/test/.config/kilo/skill/plan/SKILL.md"
    }
}
