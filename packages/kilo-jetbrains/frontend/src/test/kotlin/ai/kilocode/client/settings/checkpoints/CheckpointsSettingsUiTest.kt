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
import ai.kilocode.rpc.dto.RetentionConfigDto
import ai.kilocode.rpc.dto.RetentionPolicyDto
import ai.kilocode.rpc.dto.RetentionStatusDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.fields.IntegerField
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.Component
import java.awt.Container
import java.util.concurrent.atomic.AtomicBoolean
import javax.swing.JButton

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

    private fun start(
        config: ConfigDto,
        workspace: ConfigDto? = null,
        confirm: (() -> Boolean)? = null,
        status: RetentionStatusDto? = null,
    ) {
        appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        uiScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        rpc = FakeAppRpcApi()
        if (status != null) rpc.retention = status
        app = KiloAppService(appScope, rpc)
        workspaceRpc = FakeWorkspaceRpcApi().apply {
            if (workspace != null) this.config = workspace
        }
        workspaces = KiloWorkspaceService(appScope, workspaceRpc)
        val state = KiloAppStateDto(KiloAppStatusDto.READY, config = config)
        rpc.state.value = state
        app._state.value = state
        edt { ui = CheckpointsSettingsUi(uiScope, app, workspaces, hint = workspace?.let { "/test" }, confirm = confirm) }
        val selected = workspace?.snapshot ?: config.snapshot ?: true
        val expectedCleanup = config.retention?.enabled == true
        val expectedDays = config.retention?.maxAgeDays?.takeIf { it >= 1 } ?: 30
        flushUntil {
            edt {
                toggles().size == 2 &&
                    snapshot().isSelected == selected &&
                    cleanup().isSelected == expectedCleanup &&
                    days().value == expectedDays &&
                    !requireNotNull(ui).modified()
            } && (workspace == null || workspaceRpc.configCalls > 0)
        }
    }

    fun `test snapshots start on when the key is unset`() {
        start(ConfigDto())

        edt {
            assertTrue(snapshot().isSelected)
            assertFalse(requireNotNull(ui).modified())
        }
    }

    fun `test snapshots start off for an explicit opt-out`() {
        start(ConfigDto(snapshot = false))

        edt { assertFalse(snapshot().isSelected) }
    }

    fun `test turning snapshots off sends an explicit false patch`() {
        start(ConfigDto())

        edt {
            snapshot().doClick()
            assertTrue(requireNotNull(ui).modified())
            requireNotNull(ui).applyDraft()
        }

        flushUntil { rpc.configPatches.isNotEmpty() }
        assertEquals(false, rpc.configPatches.single().snapshot)
    }

    fun `test reset restores the baseline`() {
        start(ConfigDto())

        edt {
            val toggle = snapshot()
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
            val toggle = snapshot()
            assertFalse(toggle.isSelected)
            toggle.doClick()
            requireNotNull(ui).applyDraft()
        }

        flushUntil { workspaceRpc.configPatches.isNotEmpty() }
        assertEquals(true, workspaceRpc.configPatches.single().snapshot)
        assertTrue(rpc.configPatches.isEmpty())
    }

    fun `test cleanup defaults off at thirty days`() {
        start(ConfigDto())

        edt {
            assertFalse(cleanup().isSelected)
            assertEquals(30, days().value)
            assertFalse(runButton().isEnabled)
        }
    }

    fun `test invalid retention days disable manual cleanup without changing the draft`() {
        start(ConfigDto(retention = RetentionConfigDto(enabled = true, maxAgeDays = 30)))

        edt {
            days().text = "0"
        }
        flushUntil { edt { !runButton().isEnabled } }
        edt { assertFalse(requireNotNull(ui).modified()) }
    }

    fun `test cleanup policy saves globally while snapshots save to project`() {
        start(ConfigDto(), ConfigDto(snapshot = false))

        edt {
            snapshot().doClick()
            cleanup().doClick()
            days().value = 60
            requireNotNull(ui).applyDraft()
        }

        flushUntil { workspaceRpc.configPatches.isNotEmpty() && rpc.configPatches.isNotEmpty() }
        assertEquals(true, workspaceRpc.configPatches.single().snapshot)
        val retention = rpc.configPatches.single().retention
        assertEquals(true, retention?.enabled)
        assertEquals(60, retention?.maxAgeDays)
    }

    fun `test cleanup action requires confirmation`() {
        val accepted = AtomicBoolean()
        var confirmations = 0
        val values = mutableListOf<Boolean>()
        val status = RetentionStatusDto(policy = RetentionPolicyDto(true, 30))
        start(
            ConfigDto(retention = RetentionConfigDto(enabled = true, maxAgeDays = 30)),
            confirm = {
                confirmations += 1
                accepted.get().also(values::add)
            },
            status = status,
        )

        edt {
            assertTrue(
                "button disabled: cleanup=${cleanup().isSelected} days='${days().text}' dirty=${requireNotNull(ui).modified()}",
                runButton().isEnabled,
            )
            runButton().doClick(0)
        }
        assertEquals(1, confirmations)
        assertTrue(rpc.retentionForces.isEmpty())

        accepted.set(true)
        edt { runButton().doClick(0) }
        assertEquals(2, confirmations)
        assertEquals(listOf(false, true), values)
    }

    fun `test app service delegates forced cleanup off the edt`() {
        start(ConfigDto(retention = RetentionConfigDto(enabled = true, maxAgeDays = 30)))
        val done = CompletableDeferred<Unit>()

        app.runRetentionAsync(true) { done.complete(Unit) }
        runBlocking(Dispatchers.Default) { done.await() }

        assertEquals(listOf(true), rpc.retentionForces)
    }

    private fun toggles(): List<SettingsToggle> = components(requireNotNull(ui)).filterIsInstance<SettingsToggle>()
    private fun snapshot(): SettingsToggle = toggles().single { it.name == "checkpoint-snapshots" }
    private fun cleanup(): SettingsToggle = toggles().single { it.name == "checkpoint-cleanup" }
    private fun days(): IntegerField = components(requireNotNull(ui)).filterIsInstance<IntegerField>()
        .single { it.name == "checkpoint-cleanup-days" }
    private fun runButton(): JButton = components(requireNotNull(ui)).filterIsInstance<JButton>()
        .single { it.name == "checkpoint-cleanup-run" }

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
