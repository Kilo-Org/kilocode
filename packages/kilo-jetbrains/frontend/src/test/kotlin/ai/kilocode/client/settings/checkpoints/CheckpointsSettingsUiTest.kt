package ai.kilocode.client.settings.checkpoints

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.ManualRetentionResult
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsRow
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
import ai.kilocode.rpc.dto.RetentionPatchDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.fields.IntegerField
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CancellationException
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
import kotlin.test.assertFailsWith

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
            assertTrue(runButton().isEnabled)
        }
    }

    fun `test cleanup action stays enabled while automatic toggle is dirty`() {
        start(ConfigDto(retention = RetentionConfigDto(enabled = true, maxAgeDays = 30)))

        edt {
            cleanup().doClick()
            assertTrue(requireNotNull(ui).modified())
            assertTrue(runButton().isEnabled)
        }
    }

    fun `test idle cleanup status is fetched once instead of polled`() {
        start(ConfigDto())

        flushUntil { rpc.retentionStatusCalls.get() > 0 }

        assertEquals(1, rpc.retentionStatusCalls.get())
    }

    fun `test invalid retention days disable manual cleanup without changing the draft`() {
        start(ConfigDto(retention = RetentionConfigDto(enabled = true, maxAgeDays = 30)))

        edt {
            days().text = "0"
        }
        flushUntil { edt { !runButton().isEnabled } }
        edt { assertFalse(requireNotNull(ui).modified()) }

        edt { requireNotNull(ui).resetDraft() }

        assertEquals("30", edt { days().text })
        assertTrue(edt { runButton().isEnabled })
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

    fun `test manual cleanup temporarily enables and restores a disabled policy`() {
        start(ConfigDto(retention = RetentionConfigDto(enabled = false, maxAgeDays = 30)))
        val done = CompletableDeferred<Unit>()

        app.runManualRetentionAsync(RetentionPatchDto(enabled = false, maxAgeDays = 30)) {
            done.complete(Unit)
        }
        runBlocking(Dispatchers.Default) { done.await() }

        assertEquals(listOf(true, false), rpc.configPatches.map { it.retention?.enabled })
        assertEquals(listOf(true), rpc.retentionForces)
    }

    fun `test restore failure is reported and leaves the policy enabled`() {
        start(ConfigDto(retention = RetentionConfigDto(enabled = false, maxAgeDays = 30)))
        rpc.configUpdateErrorWhen = { it.retention?.enabled == false }

        val result = awaitManualRetention(RetentionPatchDto(enabled = false, maxAgeDays = 30))

        assertTrue("expected PolicyNotRestored, got $result", result is ManualRetentionResult.PolicyNotRestored)
        assertEquals(listOf(true), rpc.configPatches.map { it.retention?.enabled })
        assertEquals(3, rpc.configUpdateFailedAttempts)
    }

    fun `test a rejected enable write still writes the saved policy back`() {
        start(ConfigDto(retention = RetentionConfigDto(enabled = false, maxAgeDays = 30)))
        rpc.configUpdateErrorWhen = { it.retention?.enabled == true }

        val result = awaitManualRetention(RetentionPatchDto(enabled = false, maxAgeDays = 30))

        assertTrue("expected NotStarted, got $result", result is ManualRetentionResult.NotStarted)
        assertTrue("no cleanup may be forced -> ${rpc.retentionForces}", rpc.retentionForces.isEmpty())
        assertEquals(listOf(false), rpc.configPatches.map { it.retention?.enabled })
        assertEquals(1, rpc.configUpdateFailedAttempts)
    }

    fun `test a rejected enable write with a failed restore reports the policy is still on`() {
        start(ConfigDto(retention = RetentionConfigDto(enabled = false, maxAgeDays = 30)))
        rpc.configUpdateErrorWhen = { true }

        val result = awaitManualRetention(RetentionPatchDto(enabled = false, maxAgeDays = 30))

        assertTrue("expected NotStartedWithPolicyOn, got $result", result is ManualRetentionResult.NotStartedWithPolicyOn)
        assertTrue("no cleanup may be forced -> ${rpc.retentionForces}", rpc.retentionForces.isEmpty())
        // One rejected enabling write plus the three bounded write-back attempts.
        assertEquals(4, rpc.configUpdateFailedAttempts)
    }

    fun `test cancelled cleanup still restores the saved policy`() {
        start(ConfigDto(retention = RetentionConfigDto(enabled = false, maxAgeDays = 30)))
        rpc.retentionError = CancellationException("stop")

        assertFailsWith<CancellationException> {
            runBlocking(Dispatchers.Default) {
                app.runManualRetention(RetentionPatchDto(enabled = false, maxAgeDays = 30))
            }
        }

        assertEquals(listOf(true, false), rpc.configPatches.map { it.retention?.enabled })
    }

    fun `test cancelled cleanup with a failed restore reports the unrestored policy`() {
        start(ConfigDto(retention = RetentionConfigDto(enabled = false, maxAgeDays = 30)))
        rpc.retentionError = CancellationException("stop")
        rpc.configUpdateErrorWhen = { it.retention?.enabled == false }

        val result = awaitManualRetention(RetentionPatchDto(enabled = false, maxAgeDays = 30))

        assertTrue("expected PolicyNotRestored, got $result", result is ManualRetentionResult.PolicyNotRestored)
        assertEquals(listOf(true), rpc.configPatches.map { it.retention?.enabled })
        assertEquals(3, rpc.configUpdateFailedAttempts)
    }

    fun `test cleanup without a run result reports RunFailed`() {
        start(ConfigDto(retention = RetentionConfigDto(enabled = false, maxAgeDays = 30)))
        rpc.retentionError = IllegalStateException("boom")

        val result = awaitManualRetention(RetentionPatchDto(enabled = false, maxAgeDays = 30))

        assertTrue("expected RunFailed, got $result", result is ManualRetentionResult.RunFailed)
        assertEquals(listOf(true, false), rpc.configPatches.map { it.retention?.enabled })
    }

    fun `test restoreRetention retries and reports success`() {
        start(ConfigDto(retention = RetentionConfigDto(enabled = false, maxAgeDays = 30)))

        val restored = runBlocking(Dispatchers.Default) {
            app.restoreRetention(RetentionPatchDto(enabled = false, maxAgeDays = 30))
        }

        assertTrue(restored)
        assertEquals(listOf(false), rpc.configPatches.map { it.retention?.enabled })
        assertEquals(0, rpc.configUpdateFailedAttempts)
    }

    fun `test unrestored cleanup shows the warning and a working retry`() {
        start(
            ConfigDto(retention = RetentionConfigDto(enabled = false, maxAgeDays = 30)),
            confirm = { true },
        )
        rpc.retention = RetentionStatusDto(policy = RetentionPolicyDto(true, 30))
        rpc.configUpdateErrorWhen = { it.retention?.enabled == false }
        val unrestored = KiloBundle.message("settings.checkpoints.cleanup.status.unrestored")

        flushUntil { edt { runButton().isEnabled } }
        edt { runButton().doClick(0) }

        flushUntil(
            describe = {
                edt { "status='${cleanupStatus()}' retryVisible=${retryLink().isVisible} writes=${rpc.configPatches.size} failed=${rpc.configUpdateFailedAttempts}" }
            },
        ) {
            edt { cleanupStatus().contains(unrestored) && retryLink().isVisible }
        }

        rpc.configUpdateErrorWhen = null
        edt { retryLink().doClick() }

        flushUntil(
            describe = { edt { "status='${cleanupStatus()}' retryVisible=${retryLink().isVisible}" } },
        ) {
            edt { !cleanupStatus().contains(unrestored) && !retryLink().isVisible }
        }
        assertEquals(listOf(true, false), rpc.configPatches.map { it.retention?.enabled })
    }

    fun `test retry finishes the write-back after the page is disposed`() {
        start(
            ConfigDto(retention = RetentionConfigDto(enabled = false, maxAgeDays = 30)),
            confirm = { true },
        )
        rpc.retention = RetentionStatusDto(policy = RetentionPolicyDto(true, 30))
        rpc.configUpdateErrorWhen = { it.retention?.enabled == false }
        val unrestored = KiloBundle.message("settings.checkpoints.cleanup.status.unrestored")

        flushUntil { edt { runButton().isEnabled } }
        edt { runButton().doClick(0) }

        flushUntil(
            describe = {
                edt { "status='${cleanupStatus()}' retryVisible=${retryLink().isVisible} writes=${rpc.configPatches.size} failed=${rpc.configUpdateFailedAttempts} forces=${rpc.retentionForces}" }
            },
        ) {
            edt { cleanupStatus().contains(unrestored) && retryLink().isVisible }
        }

        // Gate the write-back so the page can be disposed while the retry is in flight.
        rpc.configUpdateErrorWhen = null
        val attempts = rpc.configUpdateAttempts
        rpc.configUpdateGate = CompletableDeferred()
        edt { retryLink().doClick() }
        flushUntil(
            describe = { "attempts=${rpc.configUpdateAttempts} base=$attempts" },
        ) { rpc.configUpdateAttempts > attempts }

        edt {
            requireNotNull(ui).dispose()
            ui = null
        }

        // The write-back runs on the app scope, so releasing the gate must still land the write.
        rpc.configUpdateGate?.complete(Unit)
        flushUntil(
            describe = { "patches=${rpc.configPatches.map { it.retention?.enabled }} attempts=${rpc.configUpdateAttempts}" },
        ) { rpc.configPatches.map { it.retention?.enabled } == listOf(true, false) }
        assertEquals(listOf(true, false), rpc.configPatches.map { it.retention?.enabled })
    }

    private fun awaitManualRetention(policy: RetentionPatchDto): ManualRetentionResult {
        val done = CompletableDeferred<ManualRetentionResult>()
        app.runManualRetentionAsync(policy) { result -> done.complete(result) }
        return runBlocking(Dispatchers.Default) { done.await() }
    }

    private fun retryLink(): ActionLink = components(requireNotNull(ui)).filterIsInstance<ActionLink>()
        .single { it.name == "checkpoint-cleanup-retry" }

    /** Text of the row that owns the retry link: its title plus the cleanup status line. */
    private fun cleanupStatus(): String {
        var node: Component? = retryLink()
        while (node != null && node !is SettingsRow) node = node.parent
        val row = requireNotNull(node as? SettingsRow) { "retry link must sit in a settings row" }
        return components(row).filterIsInstance<JBLabel>().joinToString(" ") { it.text }
    }

    private fun toggles(): List<SettingsToggle> = components(requireNotNull(ui)).filterIsInstance<SettingsToggle>()
    private fun snapshot(): SettingsToggle = toggles().single { it.name == "checkpoint-snapshots" }
    private fun cleanup(): SettingsToggle = toggles().single { it.name == "checkpoint-cleanup" }
    private fun days(): IntegerField = components(requireNotNull(ui)).filterIsInstance<IntegerField>()
        .single { it.name == "checkpoint-cleanup-days" }
    private fun runButton(): JButton = components(requireNotNull(ui)).filterIsInstance<JButton>()
        .single { it.name == "checkpoint-cleanup-run" }

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun flushUntil(describe: () -> Any = { "" }, done: () -> Boolean) = runBlocking {
        repeat(200) {
            delay(10)
            edt { UIUtil.dispatchAllInvocationEvents() }
            if (done()) return@runBlocking
        }
        edt { UIUtil.dispatchAllInvocationEvents() }
        assertTrue("timed out; last state: ${describe()}", done())
    }

    private fun components(root: Container): List<Component> = buildList {
        fun visit(comp: Component) {
            add(comp)
            if (comp is Container) comp.components.forEach { visit(it) }
        }
        visit(root)
    }
}
