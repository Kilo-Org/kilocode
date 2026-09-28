package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.TitledSeparator
import com.intellij.ui.components.ActionLink
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.Component
import java.awt.Container

@Suppress("UnstableApiUsage")
class AgentBehaviorSettingsUiTest : BasePlatformTestCase() {
    private lateinit var appScope: CoroutineScope
    private lateinit var uiScope: CoroutineScope
    private lateinit var rpc: FakeAppRpcApi
    private lateinit var app: KiloAppService
    private lateinit var workspaces: KiloWorkspaceService
    private var ui: AgentBehaviorSettingsUi? = null

    override fun tearDown() {
        try {
            val panel = ui
            if (panel != null) edt { panel.dispose() }
            ui = null
            if (::uiScope.isInitialized) uiScope.cancel()
            if (::appScope.isInitialized) appScope.cancel()
        } finally {
            super.tearDown()
        }
    }

    private fun start(config: ConfigDto) {
        appScope = CoroutineScope(SupervisorJob())
        uiScope = CoroutineScope(SupervisorJob())
        rpc = FakeAppRpcApi()
        app = KiloAppService(appScope, rpc)
        workspaces = KiloWorkspaceService(appScope, FakeWorkspaceRpcApi())
        val state = KiloAppStateDto(KiloAppStatusDto.READY, config = config)
        rpc.state.value = state
        app._state.value = state
        edt { ui = AgentBehaviorSettingsUi(uiScope, app, workspaces) }
        flushUntil { edt { toggle() != null } }
    }

    fun `test toggle starts on when the key is unset`() {
        start(ConfigDto())

        edt {
            assertTrue(requireNotNull(toggle()).isSelected)
            assertFalse(requireNotNull(ui).modified())
        }
    }

    fun `test toggle starts off for an explicit opt-out`() {
        start(ConfigDto(shared_agent_board = false))

        edt { assertFalse(requireNotNull(toggle()).isSelected) }
    }

    fun `test turning it off sends an explicit false patch`() {
        start(ConfigDto())

        edt {
            requireNotNull(toggle()).doClick()
            assertTrue(requireNotNull(ui).modified())
            requireNotNull(ui).applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        assertEquals(false, rpc.configPatches.single().shared_agent_board)
    }

    fun `test reset restores the baseline`() {
        start(ConfigDto())

        edt {
            val toggle = requireNotNull(toggle())
            toggle.doClick()
            assertTrue(requireNotNull(ui).modified())
            requireNotNull(ui).resetDraft()
            assertFalse(requireNotNull(ui).modified())
            assertTrue(toggle.isSelected)
        }
    }

    fun `test page keeps the sub-page navigation links`() {
        start(ConfigDto())

        edt {
            val labels = components(requireNotNull(ui)).filterIsInstance<ActionLink>().map { it.text }
            assertEquals(listOf("Agents", "MCP Servers", "Skills", "Workflows", "Rules"), labels)
        }
    }

    fun `test swarm toggle sits below the links behind the extended agents separator`() {
        start(ConfigDto())

        edt {
            val all = components(requireNotNull(ui))
            val lastLink = all.indexOfLast { it is ActionLink }
            val separator = all.indexOfFirst { it is TitledSeparator && it.text == "Extended agents" }
            val toggle = all.indexOfFirst { it is SettingsToggle }

            assertTrue("expected an Extended agents separator", separator >= 0)
            assertTrue("separator must follow the links", separator > lastLink)
            assertTrue("toggle must follow the separator", toggle > separator)
        }
    }

    private fun toggle(): SettingsToggle? =
        components(requireNotNull(ui)).filterIsInstance<SettingsToggle>().singleOrNull()

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun flushUntil(done: () -> Boolean) = runBlocking {
        repeat(200) {
            delay(10)
            edt { UIUtil.dispatchAllInvocationEvents() }
            if (done()) return@runBlocking
        }
        edt { UIUtil.dispatchAllInvocationEvents() }
        assertTrue(done())
    }

    private fun components(root: Container): List<Component> = buildList {
        fun visit(comp: Component) {
            add(comp)
            if (comp is Container) comp.components.forEach { visit(it) }
        }
        visit(root)
    }
}
