package ai.kilocode.client.settings.agents

import ai.kilocode.cli.KiloCliParser
import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
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
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.rpc.dto.ProvidersDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.TestDialog
import com.intellij.openapi.ui.TestDialogManager
import com.intellij.testFramework.replaceService
import com.intellij.testFramework.fixtures.BasePlatformTestCase
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

        flushUntil { rows(panel).size == 5 }

        edt {
            val rows = rows(panel)
            assertEquals(listOf("ask", "code", "hidden", "old", "worker"), rows.map { it.key })
            assertEquals("Configured code", rows.single { it.key == "code" }.description)
            assertEquals(listOf("custom", "hidden"), rows.single { it.key == "hidden" }.badges.map { it.text })
            assertEquals(listOf("custom", "deprecated"), rows.single { it.key == "old" }.badges.map { it.text })
            assertEquals(listOf("custom", "subagent"), rows.single { it.key == "worker" }.badges.map { it.text }.sorted())
            assertFalse(rows.single { it.key == "ask" }.cells.any { it.id == DELETE_CELL })
            assertTrue(rows.single { it.key == "hidden" }.cells.any { it.id == DELETE_CELL })
            assertEquals("code", picker(panel).selectedItem)
            assertEquals(listOf("", "ask", "code", "old"), comboItems(picker(panel)))
        }
    }

    fun `test changing default agent saves patch`() {
        val panel = panel()
        flushUntil { rows(panel).size == 5 }

        edt { picker(panel).selectedItem = "ask"; true }
        assertTrue(edt { panel.modified() })
        edt { panel.applyDraft(); true }
        flushUntil { appRpc.configPatches.isNotEmpty() }

        assertEquals("ask", appRpc.configPatches.single().values[KiloCliParser.CONFIG_DEFAULT_AGENT])
        flushUntil { !edt { panel.modified() } }
    }

    fun `test reset reverts unsaved default agent change`() {
        val panel = panel()
        flushUntil { rows(panel).size == 5 }

        edt {
            picker(panel).selectedItem = "ask"
            assertTrue(panel.modified())
            panel.resetDraft()
            assertFalse(panel.modified())
            assertEquals("code", picker(panel).selectedItem)
            true
        }
    }

    fun `test adding an agent creates it and renders it after reload`() {
        val input = AgentCreateDto("reviewer", "Review code", description = "Reviews code")
        var names = emptyList<String>()
        val panel = panel { existing ->
            names = existing.toList()
            FakeCreateDialog(input)
        }
        flushUntil { rows(panel).size == 5 }

        edt {
            panel.CreateAction().perform()
            true
        }
        flushUntil { rows(panel).any { it.key == "reviewer" } }

        edt {
            val row = rows(panel).single { it.key == "reviewer" }
            assertEquals(listOf("ask", "code", "hidden", "old", "worker"), names.sorted())
            assertEquals(listOf(input), agentRpc.creations)
            assertEquals(listOf(DIR), agentRpc.createDirs)
            assertEquals("Reviews code", row.description)
            assertEquals("reviewer", list(panel).selectedValue?.key)
            assertTrue(row.badges.any { it.text == "custom" })
            assertTrue(row.cells.any { it.id == DELETE_CELL })
            true
        }
    }

    fun `test adding an agent waits for backend reload before refetching`() {
        val input = AgentCreateDto("reviewer", "Review code", description = "Reviews code")
        val loading = CompletableDeferred<Unit>()
        val panel = panel { FakeCreateDialog(input) }
        flushUntil { rows(panel).size == 5 }
        agentRpc.afterCreate = { _, _ ->
            app._state.value = app._state.value.copy(status = KiloAppStatusDto.LOADING)
            loading.complete(Unit)
        }

        edt {
            panel.CreateAction().perform()
            true
        }
        runBlocking { loading.await() }
        edt { UIUtil.dispatchAllInvocationEvents(); true }

        assertFalse(edt { rows(panel).any { it.key == "reviewer" } })
        assertEquals(listOf(DIR), agentRpc.agentCalls)
        assertTrue(edt { text(panel).contains("Loading items") })

        app._state.value = app._state.value.copy(status = KiloAppStatusDto.READY)
        flushUntil { rows(panel).any { it.key == "reviewer" } }
        assertEquals(listOf(DIR, DIR), agentRpc.agentCalls)
    }

    fun `test deleting custom agent removes it`() {
        val loading = CompletableDeferred<Unit>()
        val panel = panel()
        flushUntil { rows(panel).size == 5 }
        TestDialogManager.setTestDialog(TestDialog.YES)
        agentRpc.afterRemove = { _, _ ->
            app._state.value = app._state.value.copy(status = KiloAppStatusDto.LOADING)
            loading.complete(Unit)
        }

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
        runBlocking { loading.await() }
        edt { UIUtil.dispatchAllInvocationEvents(); true }

        assertTrue(edt { rows(panel).any { it.key == "hidden" } })
        assertEquals(listOf(DIR), agentRpc.agentCalls)
        assertTrue(edt { text(panel).contains("Loading items") })

        app._state.value = app._state.value.copy(status = KiloAppStatusDto.READY)
        flushUntil { !edt { rows(panel).any { it.key == "hidden" } } }

        assertEquals(listOf("hidden"), agentRpc.removals)
        assertEquals(listOf(DIR, DIR), agentRpc.agentCalls)
        assertEquals("old", edt { list(panel).selectedValue?.key })
    }

    private fun panel(create: (Collection<String>) -> AgentCreateDialogHandle = ::AgentCreateDialog): AgentsSettingsUi {
        install()
        val panel = edt { AgentsSettingsUi(scope!!, DIR, create) }
        ui = panel
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
                AgentDetailDto("hidden", description = "Hidden custom", mode = KiloCliParser.MODE_PRIMARY, native = false, hidden = true),
                AgentDetailDto("old", description = "Old custom", mode = KiloCliParser.MODE_PRIMARY, native = false, deprecated = true),
                AgentDetailDto("worker", description = "Worker", mode = KiloCliParser.MODE_SUBAGENT, native = false),
            )
        }
        val workspaceRpc = FakeWorkspaceRpcApi().apply { models = ModelsWorkspaceDto(providers()) }
        app = KiloAppService(cs, appRpc)
        app._state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(
                defaultAgent = "code",
                agent = mapOf("code" to AgentConfigDto(description = "Configured code")),
            ),
        )
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
    }
}

private class FakeCreateDialog(private val input: AgentCreateDto) : AgentCreateDialogHandle {
    override fun showAndGet() = true

    override fun result() = input
}
