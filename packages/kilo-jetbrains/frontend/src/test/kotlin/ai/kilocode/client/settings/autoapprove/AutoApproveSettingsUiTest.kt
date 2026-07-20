package ai.kilocode.client.settings.autoapprove

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.settings.base.SettingsListItem
import ai.kilocode.client.settings.base.settingsListCellBounds
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.PermissionRuleDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBList
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.Container
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.AbstractButton
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.text.JTextComponent

// Matches AutoApproveContent's fixed granular section order.
private val LEVEL_SELECT_ORDER = listOf("external_directory", "bash", "read", "edit")

class AutoApproveSettingsUiTest : BasePlatformTestCase() {
    private lateinit var appScope: CoroutineScope
    private lateinit var uiScope: CoroutineScope
    private lateinit var rpc: FakeAppRpcApi
    private lateinit var workspaceRpc: FakeWorkspaceRpcApi
    private lateinit var app: KiloAppService
    private lateinit var workspaces: KiloWorkspaceService
    private var ui: AutoApproveSettingsUi? = null
    private var pick: (List<LevelChoice>) -> LevelChoice = { it.first() }
    private val picker = LevelPicker { choices, choose ->
        choose(pick(choices))
        null
    }

    override fun setUp() {
        super.setUp()
        appScope = CoroutineScope(SupervisorJob())
        uiScope = CoroutineScope(SupervisorJob())
        rpc = FakeAppRpcApi()
        workspaceRpc = FakeWorkspaceRpcApi()
        app = KiloAppService(appScope, rpc)
        workspaces = KiloWorkspaceService(appScope, workspaceRpc)
        val state = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto())
        rpc.state.value = state
        app._state.value = state
        edt { ui = AutoApproveSettingsUi(uiScope, app, workspaces, picker) }
        flushUntil { text(requireUi()).contains("External Directory") }
    }

    override fun tearDown() {
        try {
            val panel = ui
            if (panel != null) edt { panel.dispose() }
            ui = null
            uiScope.cancel()
            appScope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test page is not editable before app is ready`() {
        rpc.state.value = KiloAppStateDto(KiloAppStatusDto.LOADING)
        app._state.value = KiloAppStateDto(KiloAppStatusDto.LOADING)
        edt { ui = AutoApproveSettingsUi(uiScope, app, workspaces, picker) }
        flushUntil { text(requireUi()).contains("External Directory") }

        edt {
            assertTrue(levelSelects(requireUi()).all { !it.isEnabled })
            assertTrue(inlineLists(requireUi()).map { jbList(it) }.all { !it.isEnabled })
        }
    }

    fun `test simple tool rows use list renderer and level action`() {
        val panel = requireUi()

        edt {
            pick = { choices -> choices.first { it is LevelChoice.Level && it.level == "allow" } }
            clickLevel(toolsList(panel), "glob")
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        assertEquals(mapOf("glob" to PermissionRuleDto.Level("allow")), rpc.configPatches.single().permission)
    }

    fun `test setting a simple tool level sends the expected patch`() {
        val panel = requireUi()

        edt {
            selectLevel(levelSelectFor(panel, "read"), "deny")
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        assertEquals(mapOf("read" to PermissionRuleDto.Level("deny")), rpc.configPatches.single().permission)
    }

    fun `test choosing Default reverts a tool to inherited`() {
        val panel = requireUi()
        rpc.state.value = rpc.state.value.copy(config = ConfigDto(permission = mapOf("bash" to PermissionRuleDto.Level("deny"))))
        app._state.value = rpc.state.value
        flushUntil { !edt { panel.modified() } }

        edt {
            selectInherit(levelSelectFor(panel, "bash"))
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        assertEquals(mapOf("bash" to PermissionRuleDto.Level(null)), rpc.configPatches.single().permission)
    }

    fun `test adding an exception to a granular tool sends full patterns patch`() {
        val panel = requireUi()

        edt {
            val list = inlineListFor(panel, "bash")
            list.input = { "git *" }
            click(button(list, 0))
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        val rule = rpc.configPatches.single().permission?.get("bash")
        assertEquals(PermissionRuleDto.Patterns(mapOf("git *" to "allow")), rule)
    }

    fun `test removing an exception sends a null delete for that pattern only`() {
        val panel = requireUi()
        rpc.state.value = rpc.state.value.copy(
            config = ConfigDto(permission = mapOf(
                "read" to PermissionRuleDto.Patterns(mapOf("*" to "allow", "*.env" to "deny", "*.key" to "deny")),
            )),
        )
        app._state.value = rpc.state.value
        flushUntil { !edt { panel.modified() } }

        edt {
            removeException(panel, "read", "*.env")
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        val rule = rpc.configPatches.single().permission?.get("read")
        assertEquals(PermissionRuleDto.Patterns(mapOf("*" to "allow", "*.key" to "deny", "*.env" to null)), rule)
    }

    fun `test grouped todo row uses the most restrictive level and applies to both ids`() {
        val panel = requireUi()

        edt {
            pick = { choices -> choices.first { it is LevelChoice.Level && it.level == "deny" } }
            clickLevel(toolsList(panel), "todoread+todowrite")
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        assertEquals(
            mapOf("todoread" to PermissionRuleDto.Level("deny"), "todowrite" to PermissionRuleDto.Level("deny")),
            rpc.configPatches.single().permission,
        )
    }

    fun `test isModified reflects unsaved changes and resetDraft reverts them`() {
        val panel = requireUi()

        edt {
            assertFalse(panel.modified())
            selectLevel(levelSelectFor(panel, "read"), "deny")
            assertTrue(panel.modified())
            panel.resetDraft()
            assertFalse(panel.modified())
        }
    }

    fun `test reselecting the already explicit level leaves the page unmodified`() {
        val panel = requireUi()
        rpc.state.value = rpc.state.value.copy(config = ConfigDto(permission = mapOf("read" to PermissionRuleDto.Level("allow"))))
        app._state.value = rpc.state.value
        flushUntil { !edt { panel.modified() } }

        edt {
            selectLevel(levelSelectFor(panel, "read"), "allow")
            assertFalse(panel.modified())
        }
    }

    fun `test apply keeps selected auto approve section row and height`() {
        val panel = requireUi()
        rpc.state.value = rpc.state.value.copy(
            config = ConfigDto(permission = mapOf(
                "bash" to PermissionRuleDto.Patterns(mapOf("*" to "ask", "git log *" to "allow", "got" to "allow")),
            )),
        )
        app._state.value = rpc.state.value
        flushUntil { !edt { panel.modified() } }
        val list = edt { inlineListFor(panel, "bash") }
        val height = edt {
            val jList = jbList(list)
            val idx = indexOf(jList, "git log *")
            jList.selectedIndex = idx
            jList.fixedCellHeight
        }

        edt {
            pick = { choices -> choices.first { it is LevelChoice.Level && it.level == "deny" } }
            clickLevel(list, "git log *")
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        edt {
            val jList = jbList(list)
            assertEquals("git log *", (jList.selectedValue as SettingsListItem).key)
            assertEquals(height, jList.fixedCellHeight)
        }
    }

    fun `test granular row stays selected when level changes before apply`() {
        val panel = requireUi()
        rpc.state.value = rpc.state.value.copy(
            config = ConfigDto(permission = mapOf(
                "read" to PermissionRuleDto.Patterns(mapOf("*" to "ask", "*.env" to "allow")),
            )),
        )
        app._state.value = rpc.state.value
        flushUntil { !edt { panel.modified() } }
        val list = edt { inlineListFor(panel, "read") }
        val height = edt { jbList(list).fixedCellHeight }

        edt {
            pick = { choices -> choices.first { it is LevelChoice.Level && it.level == "deny" } }
            clickLevel(list, "*.env")
            val jList = jbList(list)
            assertEquals("*.env", (jList.selectedValue as SettingsListItem).key)
            assertEquals(height, jList.fixedCellHeight)
        }
    }

    fun `test granular exception edit renames pattern and keeps selection`() {
        val panel = requireUi()
        rpc.state.value = rpc.state.value.copy(
            config = ConfigDto(permission = mapOf(
                "bash" to PermissionRuleDto.Patterns(mapOf("*" to "ask", "git *" to "allow")),
            )),
        )
        app._state.value = rpc.state.value
        flushUntil { !edt { panel.modified() } }
        val list = edt { inlineListFor(panel, "bash") }

        edt {
            list.editInput = { "git status" }
            val jList = jbList(list)
            jList.setSize(600, jList.preferredSize.height.coerceAtLeast(80))
            jList.doLayout()
            doubleClickRow(jList, indexOf(jList, "git *"))
            panel.applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        val rule = rpc.configPatches.last().permission?.get("bash")
        assertEquals(PermissionRuleDto.Patterns(mapOf("*" to "ask", "git status" to "allow", "git *" to null)), rule)
        edt {
            assertEquals("git status", (jbList(list).selectedValue as SettingsListItem).key)
        }
    }

    private fun requireUi(): AutoApproveSettingsUi = requireNotNull(ui)

    private fun levelSelects(panel: AutoApproveSettingsUi): List<LevelSelect> =
        components(panel).filterIsInstance<LevelSelect>()

    private fun levelSelectFor(panel: AutoApproveSettingsUi, tool: String): LevelSelect {
        val index = LEVEL_SELECT_ORDER.indexOf(tool)
        require(index >= 0) { "unknown tool $tool" }
        return levelSelects(panel)[index]
    }

    private fun inlineListFor(panel: AutoApproveSettingsUi, tool: String): SettingsInlineList {
        val index = GRANULAR_ORDER.indexOf(tool)
        require(index >= 0) { "unknown granular tool $tool" }
        return inlineLists(panel)[index]
    }

    private fun toolsList(panel: AutoApproveSettingsUi): SettingsInlineList = inlineLists(panel).last()

    private fun inlineLists(panel: AutoApproveSettingsUi): List<SettingsInlineList> =
        components(panel).filterIsInstance<SettingsInlineList>()

    private fun removeException(panel: AutoApproveSettingsUi, tool: String, pattern: String) {
        val list = inlineListFor(panel, tool)
        val jList = components(list).filterIsInstance<JBList<*>>().single()
        val idx = (0 until jList.model.size).first { jList.model.getElementAt(it).toString().contains(pattern) }
        jList.selectedIndex = idx
        UIUtil.dispatchAllInvocationEvents()
        click(button(list, 1))
    }

    private fun clickLevel(list: SettingsInlineList, key: String) {
        val jList = jbList(list)
        val model = jList.model
        val idx = (0 until model.size).first { (model.getElementAt(it) as SettingsListItem).key == key }
        jList.selectedIndex = idx
        jList.setSize(600, jList.preferredSize.height.coerceAtLeast(80))
        jList.doLayout()
        val bounds = settingsListCellBounds(jList, idx, true).getValue("level")
        click(jList, Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
    }

    private fun jbList(list: SettingsInlineList): JBList<*> = components(list).filterIsInstance<JBList<*>>().single()

    private fun indexOf(list: JBList<*>, key: String): Int = (0 until list.model.size)
        .first { (list.model.getElementAt(it) as SettingsListItem).key == key }

    private fun button(list: SettingsInlineList, index: Int): JComponent = components(list)
        .filterIsInstance<JComponent>()
        .filter { it.javaClass.name.endsWith("ActionButton") }
        .let { it[index] }

    private fun click(target: JComponent) {
        target.setSize(target.preferredSize)
        val point = Point(target.width.coerceAtLeast(2) / 2, target.height.coerceAtLeast(2) / 2)
        click(target, point)
    }

    private fun click(target: JComponent, point: Point) {
        val press = MouseEvent(
            target,
            MouseEvent.MOUSE_PRESSED,
            System.currentTimeMillis(),
            InputEvent.BUTTON1_DOWN_MASK,
            point.x,
            point.y,
            1,
            false,
            MouseEvent.BUTTON1,
        )
        val release = MouseEvent(
            target,
            MouseEvent.MOUSE_RELEASED,
            System.currentTimeMillis(),
            0,
            point.x,
            point.y,
            1,
            false,
            MouseEvent.BUTTON1,
        )
        val clicked = MouseEvent(
            target,
            MouseEvent.MOUSE_CLICKED,
            System.currentTimeMillis(),
            0,
            point.x,
            point.y,
            1,
            false,
            MouseEvent.BUTTON1,
        )
        target.dispatchEvent(press)
        target.dispatchEvent(release)
        target.dispatchEvent(clicked)
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun doubleClickRow(list: JBList<*>, idx: Int) {
        val bounds = list.getCellBounds(idx, idx)
        val point = Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        val event = MouseEvent(
            list,
            MouseEvent.MOUSE_CLICKED,
            System.currentTimeMillis(),
            0,
            point.x,
            point.y,
            2,
            false,
            MouseEvent.BUTTON1,
        )
        list.dispatchEvent(event)
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun selectLevel(combo: LevelSelect, level: String) {
        val item = (0 until combo.itemCount).map { combo.getItemAt(it) }
            .first { it is LevelSelect.Item.Level && it.value == level }
        combo.selectedItem = item
    }

    private fun selectInherit(combo: LevelSelect) {
        val item = (0 until combo.itemCount).map { combo.getItemAt(it) }.first { it is LevelSelect.Item.Default }
        combo.selectedItem = item
    }

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun flushUntil(done: () -> Boolean) = runBlocking {
        repeat(200) {
            delay(10)
            edt { UIUtil.dispatchAllInvocationEvents() }
            if (done()) return@runBlocking
        }
        edt { UIUtil.dispatchAllInvocationEvents() }
        assertTrue(done())
    }

    private fun text(root: Container): String {
        val out = mutableListOf<String>()
        for (comp in components(root)) {
            if (!comp.isVisible) continue
            when (comp) {
                is AbstractButton -> comp.text?.let { out.add(it) }
                is JLabel -> comp.text?.let { out.add(it) }
                is JTextComponent -> comp.text?.let { out.add(it) }
            }
        }
        return out.joinToString("\n")
    }

    private fun components(root: Container): List<java.awt.Component> = buildList {
        fun visit(comp: java.awt.Component) {
            add(comp)
            if (comp is Container) comp.components.forEach { visit(it) }
        }
        visit(root)
    }

    private companion object {
        val GRANULAR_ORDER = listOf("external_directory", "bash", "read", "edit")
    }
}
