package ai.kilocode.client.settings.checkpoints

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
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.Component
import java.awt.Container

@Suppress("UnstableApiUsage")
class CheckpointsSettingsUiTest : BasePlatformTestCase() {
    private lateinit var appScope: CoroutineScope
    private lateinit var uiScope: CoroutineScope
    private lateinit var rpc: FakeAppRpcApi
    private lateinit var workspaceRpc: FakeWorkspaceRpcApi
    private lateinit var app: KiloAppService
    private lateinit var workspaces: KiloWorkspaceService
    private var ui: CheckpointsSettingsUi? = null

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

    private fun start(config: ConfigDto, workspace: ConfigDto? = null) {
        appScope = CoroutineScope(SupervisorJob())
        uiScope = CoroutineScope(SupervisorJob())
        rpc = FakeAppRpcApi()
        app = KiloAppService(appScope, rpc)
        workspaceRpc = FakeWorkspaceRpcApi().apply {
            if (workspace != null) this.config = workspace
        }
        workspaces = KiloWorkspaceService(appScope, workspaceRpc)
        val state = KiloAppStateDto(KiloAppStatusDto.READY, config = config)
        rpc.state.value = state
        app._state.value = state
        edt { ui = CheckpointsSettingsUi(uiScope, app, workspaces, hint = workspace?.let { "/test" }) }
        flushUntil {
            edt { toggle() != null } && (workspace == null || workspaceRpc.configCalls > 0)
        }
    }

    fun `test snapshots start on when the key is unset`() {
        start(ConfigDto())

        edt {
            assertTrue(requireNotNull(toggle()).isSelected)
            assertFalse(requireNotNull(ui).modified())
        }
    }

    fun `test snapshots start off for an explicit opt-out`() {
        start(ConfigDto(snapshot = false))

        edt { assertFalse(requireNotNull(toggle()).isSelected) }
    }

    fun `test turning snapshots off sends an explicit false patch`() {
        start(ConfigDto())

        edt {
            requireNotNull(toggle()).doClick()
            assertTrue(requireNotNull(ui).modified())
            requireNotNull(ui).applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        assertEquals(false, rpc.configPatches.single().snapshot)
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

    fun `test project snapshot override is shown and updated in project scope`() {
        start(ConfigDto(), ConfigDto(snapshot = false))

        edt {
            val toggle = requireNotNull(toggle())
            assertFalse(toggle.isSelected)
            toggle.doClick()
            requireNotNull(ui).applyDraft()
        }

        flushUntil { workspaceRpc.configPatches.isNotEmpty() }
        assertEquals(true, workspaceRpc.configPatches.single().snapshot)
        assertTrue(rpc.configPatches.isEmpty())
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
