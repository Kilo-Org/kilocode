package ai.kilocode.client.settings.agents

import ai.kilocode.cli.KiloCliParser
import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsListItem
import ai.kilocode.client.settings.base.settingsListCellBounds
import ai.kilocode.client.testing.FakeAgentBehaviorRpcApi
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.AgentConfigDto
import ai.kilocode.rpc.dto.AgentCreateDto
import ai.kilocode.rpc.dto.AgentDetailDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import ai.kilocode.rpc.dto.PermissionRuleDto
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.rpc.dto.ProvidersDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.TestDialog
import com.intellij.openapi.ui.TestDialogManager
import com.intellij.testFramework.replaceService
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.LightVirtualFile
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.Container
import java.awt.Dimension
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.JButton
import javax.swing.JComboBox
import javax.swing.JTextField

class AgentsSettingsUiTest : BasePlatformTestCase() {
    private var scope: CoroutineScope? = null
    private var ui: AgentsSettingsUi? = null
    private lateinit var app: KiloAppService
    private lateinit var appRpc: FakeAppRpcApi
    private lateinit var agentRpc: FakeAgentBehaviorRpcApi

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

    fun `test loads agents from cli`() {
        val panel = panel()

        flushUntil { rows(panel).size == 6 }

        edt {
            val rows = rows(panel)
            assertEquals(listOf("ask", "code", "generated", "hidden", "old", "worker"), rows.map { it.key })
            assertEquals("Configured code", rows.single { it.key == "code" }.description)
            assertEquals(listOf("subagent"), rows.single { it.key == "generated" }.badges.map { it.text })
            assertEquals(listOf("custom", "hidden"), rows.single { it.key == "hidden" }.badges.map { it.text })
            assertEquals(listOf("custom", "deprecated"), rows.single { it.key == "old" }.badges.map { it.text })
            assertEquals(listOf("custom", "subagent"), rows.single { it.key == "worker" }.badges.map { it.text }.sorted())
            assertFalse(rows.single { it.key == "ask" }.cells.any { it.id == DELETE_CELL })
            assertFalse(rows.single { it.key == "generated" }.cells.any { it.id == DELETE_CELL })
            assertTrue(rows.single { it.key == "hidden" }.cells.any { it.id == DELETE_CELL })
            assertEquals("code", picker(panel).selectedItem)
            assertEquals(listOf("", "ask", "code", "old"), comboItems(picker(panel)))
        }
    }

    fun `test agent rows keep equal height`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt {
            val list = list(panel)
            list.size = Dimension(420, 260)
            list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            val heights = rows(panel).indices.map { idx -> list.getCellBounds(idx, idx).height }.toSet()

            assertEquals(1, heights.size)
            assertTrue(list.fixedCellHeight > 0)
        }
    }

    fun `test changing default agent saves patch`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt { picker(panel).selectedItem = "ask"; true }
        assertTrue(edt { panel.modified() })
        edt { panel.applyDraft(); true }
        flushUntil { appRpc.configPatches.isNotEmpty() }

        assertEquals("ask", appRpc.configPatches.single().values[KiloCliParser.CONFIG_DEFAULT_AGENT])
        flushUntil { !edt { panel.modified() } }
    }

    fun `test reset reverts unsaved default agent change`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt {
            picker(panel).selectedItem = "ask"
            assertTrue(panel.modified())
            panel.resetDraft()
            assertFalse(panel.modified())
            assertEquals("code", picker(panel).selectedItem)
            true
        }
    }

    fun `test adding an agent stages it until apply and supports undo`() {
        val input = AgentCreateDto("reviewer", "Review code", description = "Reviews code")
        var names = emptyList<String>()
        val panel = panel { existing ->
            names = existing.toList()
            FakeCreateDialog(input)
        }
        flushUntil { rows(panel).size == 6 }

        edt {
            panel.CreateAction().perform()
            true
        }

        edt {
            val row = rows(panel).single { it.key == "reviewer" }
            assertEquals(listOf("ask", "code", "generated", "hidden", "old", "worker"), names.sorted())
            assertTrue(agentRpc.creations.isEmpty())
            assertTrue(panel.modified())
            assertEquals("Reviews code", row.description)
            assertEquals("reviewer", list(panel).selectedValue?.key)
            assertEquals(listOf("not applied", "custom"), row.badges.map { it.text })
            assertEquals(listOf(UNDO_CELL), row.cells.map { it.id })
            clickCell(panel, "reviewer", UNDO_CELL)
            assertFalse(panel.modified())
            assertFalse(rows(panel).any { it.key == "reviewer" })
            true
        }
    }

    fun `test applying staged create commits and reloads`() {
        val input = AgentCreateDto("reviewer", "Review code", description = "Reviews code")
        val panel = panel { FakeCreateDialog(input) }
        flushUntil { rows(panel).size == 6 }

        edt {
            panel.CreateAction().perform()
            panel.applyDraft()
            true
        }
        flushUntil { agentRpc.creations.isNotEmpty() && !edt { panel.modified() } }

        assertEquals(listOf(input), agentRpc.creations)
        assertEquals(listOf(DIR), agentRpc.createDirs)
        assertTrue(edt { rows(panel).any { it.key == "reviewer" } })
    }

    fun `test apply waits for backend ready before refetching`() {
        val loading = CompletableDeferred<Unit>()
        val panel = panel()
        flushUntil { rows(panel).size == 6 }
        appRpc.afterConfig = {
            app._state.value = app._state.value.copy(status = KiloAppStatusDto.LOADING)
            loading.complete(Unit)
        }

        edt {
            picker(panel).selectedItem = "ask"
            panel.applyDraft()
            true
        }
        runBlocking { loading.await() }
        edt { UIUtil.dispatchAllInvocationEvents(); true }

        assertEquals(listOf(DIR), agentRpc.agentCalls)
        assertTrue(edt { text(panel).contains(KiloBundle.message("settings.agentBehavior.saving")) })

        app._state.value = app._state.value.copy(status = KiloAppStatusDto.READY)
        flushUntil { agentRpc.agentCalls.size == 2 && !edt { panel.modified() } }
    }

    fun `test importing an agent stages patch until apply`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt {
            panel.ImportAction().perform(file("reviewer.agent.json", """
                {
                    "name": "reviewer",
                    "description": "Reviews code",
                    "prompt": "Review carefully",
                    "mode": "subagent",
                    "permission": {
                        "bash": {
                            "*": "deny",
                            "uname": "allow"
                        },
                        "edit": "ask"
                    }
                }
            """.trimIndent()))
            true
        }
        flushUntil { rows(panel).any { it.key == "reviewer" } }

        edt {
            assertTrue(appRpc.configPatches.isEmpty())
            assertTrue(panel.modified())
            val row = rows(panel).single { it.key == "reviewer" }
            assertEquals("Reviews code", row.description)
            assertEquals("reviewer", list(panel).selectedValue?.key)
            assertTrue(row.badges.any { it.text == "not applied" })
            assertTrue(row.badges.any { it.text == "subagent" })
            assertEquals(listOf(UNDO_CELL), row.cells.map { it.id })
            true
        }

        appRpc.afterConfig = { patch ->
            if (patch.agents.containsKey("reviewer")) {
                agentRpc.agents = agentRpc.agents + AgentDetailDto(
                    "reviewer",
                    description = "Reviews code",
                    mode = KiloCliParser.MODE_SUBAGENT,
                    native = false,
                    removable = true,
                )
            }
        }
        edt { panel.applyDraft(); true }
        flushUntil { appRpc.configPatches.isNotEmpty() && !edt { panel.modified() } }

        edt {
            val patch = appRpc.configPatches.single().agents.getValue("reviewer")
            assertEquals("Reviews code", patch.description)
            assertEquals("Review carefully", patch.prompt)
            assertEquals(KiloCliParser.MODE_SUBAGENT, patch.mode)
            assertEquals(PermissionRuleDto.Patterns(mapOf("*" to "deny", "uname" to "allow")), patch.permission?.get("bash"))
            assertEquals(PermissionRuleDto.Level("ask"), patch.permission?.get("edit"))
            true
        }
    }

    fun `test importing invalid JSON shows settings error message`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt {
            panel.ImportAction().perform(file("bad.agent.json", "{"))
            true
        }
        val message = KiloBundle.message("settings.agentBehavior.agents.import.invalidJson")
        flushUntil { text(panel).contains(message) }

        assertTrue(appRpc.configPatches.isEmpty())
        assertFalse(edt { text(panel).contains("AgentImportException") })
    }

    fun `test deleting custom agent stages removal and supports undo`() {
        val panel = panel()
        flushUntil { rows(panel).size == 6 }

        edt {
            val list = list(panel)
            list.size = Dimension(420, 260)
            list.doLayout()
            val idx = rows(panel).indexOfFirst { it.key == "hidden" }
            list.selectedIndex = idx
            val row = rows(panel)[idx]
            val bounds = list.getCellBounds(idx, idx)
            val area = settingsListCellBounds(list, bounds, row, selected = true).getValue(DELETE_CELL)
            click(list, center(area))
            true
        }

        edt {
            val row = rows(panel).single { it.key == "hidden" }
            assertTrue(panel.modified())
            assertTrue(agentRpc.removals.isEmpty())
            assertTrue(row.badges.any { it.text == "will be removed" })
            assertEquals(listOf(UNDO_CELL), row.cells.map { it.id })
            clickCell(panel, "hidden", UNDO_CELL)
            assertFalse(panel.modified())
            assertTrue(rows(panel).single { it.key == "hidden" }.cells.any { it.id == DELETE_CELL })
            true
        }
    }

    fun `test composite apply calls endpoints in order`() {
        val input = AgentCreateDto("creator", "Create", description = "Created")
        val order = mutableListOf<String>()
        val panel = panel { FakeCreateDialog(input) }
        flushUntil { rows(panel).size == 6 }
        agentRpc.afterRemove = { _, name -> order += "remove:$name" }
        agentRpc.afterCreate = { _, item -> order += "create:${item.name}" }
        appRpc.afterConfig = { patch ->
            order += "config:${patch.agents.keys.sorted().joinToString("+")}:${patch.values.keys.sorted().joinToString("+")}"
            if (patch.agents.containsKey("imported")) {
                agentRpc.agents = agentRpc.agents + AgentDetailDto(
                    "imported",
                    description = "Imported",
                    mode = KiloCliParser.MODE_SUBAGENT,
                    native = false,
                    removable = true,
                )
            }
        }

        edt {
            clickCell(panel, "hidden", DELETE_CELL)
            panel.CreateAction().perform()
            panel.ImportAction().perform(file("imported.agent.json", """
                { "name": "imported", "description": "Imported", "prompt": "Import", "mode": "subagent" }
            """.trimIndent()))
            picker(panel).selectedItem = "ask"
            true
        }
        flushUntil { rows(panel).any { it.key == "imported" } }
        edt { panel.applyDraft(); true }
        flushUntil { !edt { panel.modified() } }

        assertEquals(listOf(
            "remove:hidden",
            "create:creator",
            "config:imported:",
            "config::default_agent",
        ), order)
    }

    fun `test apply failure reloads and keeps remaining staged changes`() {
        val input = AgentCreateDto("creator", "Create", description = "Created")
        val panel = panel { FakeCreateDialog(input) }
        flushUntil { rows(panel).size == 6 }
        agentRpc.createError = RuntimeException("boom")

        edt {
            clickCell(panel, "hidden", DELETE_CELL)
            panel.CreateAction().perform()
            panel.applyDraft()
            true
        }
        flushUntil { text(panel).contains(KiloBundle.message("settings.agentBehavior.agents.create.failed")) }

        edt {
            assertEquals(listOf("hidden"), agentRpc.removals)
            assertFalse(rows(panel).any { it.key == "hidden" })
            val row = rows(panel).single { it.key == "creator" }
            assertEquals(listOf(UNDO_CELL), row.cells.map { it.id })
            assertTrue(panel.modified())
            true
        }
    }

    fun `test refresh preserves staged intents`() {
        val input = AgentCreateDto("creator", "Create", description = "Created")
        val panel = panel { FakeCreateDialog(input) }
        flushUntil { rows(panel).size == 6 }

        edt {
            clickCell(panel, "hidden", DELETE_CELL)
            panel.CreateAction().perform()
            panel.reload()
            true
        }
        flushUntil { agentRpc.agentCalls.size >= 2 }

        edt {
            assertTrue(rows(panel).single { it.key == "hidden" }.badges.any { it.text == "will be removed" })
            assertEquals(listOf(UNDO_CELL), rows(panel).single { it.key == "creator" }.cells.map { it.id })
            assertTrue(panel.modified())
            true
        }
    }

    private fun panel(create: (Collection<String>) -> AgentCreateDialogHandle = ::AgentCreateDialog): AgentsSettingsUi {
        install()
        val panel = edt { AgentsSettingsUi(scope!!, DIR, create) }
        ui = panel
        edt { panel.reload(); true }
        return panel
    }

    private fun install() {
        val cs = CoroutineScope(SupervisorJob())
        scope = cs
        appRpc = FakeAppRpcApi()
        agentRpc = FakeAgentBehaviorRpcApi().apply {
            agents = listOf(
                AgentDetailDto("ask", displayName = "Ask", description = "Ask questions", mode = KiloCliParser.MODE_PRIMARY, native = true),
                AgentDetailDto("code", displayName = "Code", description = "Code things", mode = KiloCliParser.MODE_PRIMARY, native = true),
                AgentDetailDto("generated", description = "Generated", mode = KiloCliParser.MODE_SUBAGENT, native = false, removable = false),
                AgentDetailDto("hidden", description = "Hidden custom", mode = KiloCliParser.MODE_PRIMARY, native = false, removable = true, hidden = true),
                AgentDetailDto("old", description = "Old custom", mode = KiloCliParser.MODE_PRIMARY, native = false, removable = true, deprecated = true),
                AgentDetailDto("worker", description = "Worker", mode = KiloCliParser.MODE_SUBAGENT, native = false, removable = true),
            )
        }
        val workspaceRpc = FakeWorkspaceRpcApi().apply { models = ModelsWorkspaceDto(providers()) }
        app = KiloAppService(cs, appRpc)
        val ready = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(
                defaultAgent = "code",
                agent = mapOf("code" to AgentConfigDto(description = "Configured code")),
            ),
        )
        app._state.value = ready
        appRpc.state.value = ready
        ApplicationManager.getApplication().replaceService(KiloAppService::class.java, app, testRootDisposable)
        ApplicationManager.getApplication().replaceService(KiloAgentBehaviorService::class.java, KiloAgentBehaviorService(cs, agentRpc), testRootDisposable)
        ApplicationManager.getApplication().replaceService(KiloWorkspaceService::class.java, KiloWorkspaceService(cs, workspaceRpc), testRootDisposable)
    }

    private fun providers() = ProvidersDto(
        providers = listOf(ProviderDto("kilo", "Kilo", models = mapOf("gpt-5" to ModelDto("gpt-5", "GPT-5")))),
        connected = listOf("kilo"),
        defaults = emptyMap(),
    )

    private fun rows(panel: AgentsSettingsUi): List<SettingsListItem> {
        val model = list(panel).model
        return (0 until model.size).map { model.getElementAt(it) }
    }

    private fun list(panel: AgentsSettingsUi) = components(panel).filterIsInstance<JBList<SettingsListItem>>().single()

    private fun picker(panel: AgentsSettingsUi) = components(panel).filterIsInstance<JComboBox<String>>().single()

    private fun comboItems(box: JComboBox<String>) = (0 until box.itemCount).map { box.getItemAt(it) }

    private fun components(root: java.awt.Component): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        fun visit(item: java.awt.Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private fun text(root: Container): String {
        val out = mutableListOf<String>()
        for (comp in components(root)) {
            if (!comp.isVisible) continue
            when (comp) {
                is JButton -> comp.text?.let { out.add(it) }
                is JBLabel -> comp.text?.let { out.add(it) }
                is JTextField -> comp.text?.let { out.add(it) }
            }
        }
        return out.joinToString("\n")
    }

    private fun center(rect: java.awt.Rectangle) = Point(rect.x + rect.width / 2, rect.y + rect.height / 2)

    private fun click(list: JBList<SettingsListItem>, point: Point) {
        list.dispatchEvent(mouse(list, MouseEvent.MOUSE_PRESSED, point))
        list.dispatchEvent(mouse(list, MouseEvent.MOUSE_RELEASED, point))
    }

    private fun clickCell(panel: AgentsSettingsUi, key: String, cell: String) {
        val list = list(panel)
        list.size = Dimension(420, 260)
        list.doLayout()
        val idx = rows(panel).indexOfFirst { it.key == key }
        list.selectedIndex = idx
        val row = rows(panel)[idx]
        val bounds = list.getCellBounds(idx, idx)
        val area = settingsListCellBounds(list, bounds, row, selected = true).getValue(cell)
        click(list, center(area))
    }

    private fun file(name: String, text: String) = LightVirtualFile(name, text)

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
        repeat(30) {
            delay(100)
            edt { UIUtil.dispatchAllInvocationEvents(); true }
            if (done()) return@runBlocking
        }
        edt { UIUtil.dispatchAllInvocationEvents(); true }
        assertTrue(done())
    }

    private companion object {
        const val DIR = "/test"
        const val DELETE_CELL = "delete"
        const val UNDO_CELL = "undo"
    }
}

private class FakeCreateDialog(private val input: AgentCreateDto) : AgentCreateDialogHandle {
    override fun showAndGet() = true

    override fun result() = input
}
