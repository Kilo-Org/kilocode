package ai.kilocode.client.settings

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.util.edtWait
import ai.kilocode.log.LogConfig
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.openapi.options.ConfigurationException
import com.intellij.openapi.ui.ComboBox
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBTextField
import java.awt.Container
import javax.swing.JComponent
import kotlinx.coroutines.CompletableDeferred

class AdvancedConfigurableTest : BasePlatformTestCase() {
    private lateinit var settings: KiloLogSettingsService

    /** App-lifetime scope, the one fire-and-forget saves must survive on. */
    private lateinit var coroutines: TestCoroutines

    /** The configurable's own scope, cancelled by `disposeUIResources()` just as the platform does. */
    private lateinit var ui: TestCoroutines
    private lateinit var appRpc: FakeAppRpcApi
    private lateinit var app: KiloAppService

    override fun setUp() {
        super.setUp()
        settings = KiloLogSettingsService()
        LogConfig.apply(null, null, null)
        coroutines = TestCoroutines()
        ui = TestCoroutines()
        appRpc = FakeAppRpcApi()
        app = KiloAppService(coroutines.scope, appRpc)
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(telemetry = true))
    }

    override fun tearDown() {
        try {
            ui.close()
            coroutines.close()
            LogConfig.apply(null, null, null)
        } finally {
            super.tearDown()
        }
    }

    fun `test createComponent renders log setting editors`() {
        val cfg = configurable()
        edt {
            val root = cfg.createComponent()
            assertEquals(2, combos(root as Container).size)
            assertEquals(1, fields(root).size)
            assertFalse(cfg.isModified)
        }
    }

    fun `test isModified tracks level changes`() {
        val cfg = configurable()
        edt {
            val root = cfg.createComponent()
            level(root as Container).selectedItem = LogConfig.LogLevel.ERROR
            assertTrue(cfg.isModified)
        }
    }

    fun `test reset restores values`() {
        val cfg = configurable()
        edt {
            val root = cfg.createComponent()
            level(root as Container).selectedItem = LogConfig.LogLevel.ERROR
            field(root).text = "25"

            cfg.reset()

            assertEquals(LogConfig.LogLevel.INFO, level(root).selectedItem)
            assertEquals(LogConfig.DEFAULT_PREVIEW.toString(), field(root).text)
            assertFalse(cfg.isModified)
        }
    }

    fun `test apply rejects invalid preview size`() {
        val cfg = configurable()
        edt {
            val root = cfg.createComponent()
            field(root as Container).text = "abc"

            assertThrows(ConfigurationException::class.java) { cfg.apply() }
            assertTrue(cfg.isModified)
        }
    }

    fun `test apply persists log settings`() {
        val cfg = configurable()
        edt {
            val root = cfg.createComponent()
            level(root as Container).selectedItem = LogConfig.LogLevel.WARN
            mode(root).selectedItem = LogConfig.ContentMode.FULL
            field(root).text = "33"

            cfg.apply()

            assertEquals("WARN", settings.state.level)
            assertEquals("FULL", settings.state.contentMode)
            assertEquals(33, settings.state.previewMax)
            assertEquals(LogConfig.LogLevel.WARN, LogConfig.level())
            assertEquals(LogConfig.ContentMode.FULL, LogConfig.contentMode())
            assertEquals(33, LogConfig.previewMax())
            assertFalse(cfg.isModified)
        }
    }

    fun `test createComponent shows a reveal logs action`() {
        // Tests run in monolith mode, so a single OS-appropriate reveal link is shown.
        val cfg = configurable()
        edt {
            val root = cfg.createComponent()
            val labels = links(root as Container).map { it.text }
            assertTrue("expected a reveal-logs link, got $labels", labels.contains(AdvancedLogActions.revealLabel()))
        }
    }

    fun `test createComponent fetches and renders the index worktrees toggle`() {
        appRpc.indexWorktrees = true
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }

        ui.drain()

        assertTrue(edt { indexToggle(root).isSelected })
        assertFalse(edt { cfg.isModified })
    }

    fun `test isModified tracks index worktrees toggle`() {
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }
        ui.drain()

        edt { indexToggle(root).doClick() }

        assertTrue(edt { cfg.isModified })
    }

    fun `test apply persists index worktrees only when changed`() {
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }
        ui.drain()

        edt { cfg.apply() }
        coroutines.drain()

        assertEquals(emptyList<Boolean>(), appRpc.indexWorktreesSaves)

        edt {
            indexToggle(root).doClick()
            cfg.apply()
        }

        assertTrue(coroutines.pumpUntil { appRpc.indexWorktreesSaves.isNotEmpty() })
        assertEquals(listOf(true), appRpc.indexWorktreesSaves)
        assertFalse(edt { cfg.isModified })
    }

    fun `test index worktrees save survives dialog dispose on ok`() {
        // Hold the save inside the RPC so the dispose below provably happens while it is in flight,
        // instead of racing the coroutine's first dispatch.
        val gate = CompletableDeferred<Unit>()
        appRpc.indexWorktreesSaveGate = gate
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }
        ui.drain()

        edt {
            indexToggle(root).doClick()
            cfg.apply()
        }
        assertTrue(coroutines.pumpUntil { appRpc.indexWorktreesSaveAttempts == 1 })

        // Emulate the platform disposing the configurable immediately after apply() on OK.
        edt { cfg.disposeUIResources() }
        gate.complete(Unit)

        assertTrue(coroutines.pumpUntil { appRpc.indexWorktreesSaves.isNotEmpty() })
        assertEquals(listOf(true), appRpc.indexWorktreesSaves)
    }

    fun `test a late index worktrees fetch keeps a user toggle`() {
        val gate = CompletableDeferred<Unit>()
        appRpc.indexWorktreesGate = gate
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }

        // The user flips the switch on before the slow split-mode fetch (which reports off) lands.
        edt { indexToggle(root).doClick() }
        gate.complete(Unit)
        ui.drain()

        assertTrue("late fetch cleared the user's toggle", edt { indexToggle(root).isSelected })
        assertTrue("late fetch cleared the dirty state", edt { cfg.isModified })
    }

    fun `test telemetry toggle reflects the CLI config opt-out`() {
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(telemetry = false))
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }

        assertFalse(edt { telemetryToggle(root).isSelected })
        assertFalse(edt { cfg.isModified })
    }

    fun `test telemetry toggle is disabled until a supported CLI reports its level`() {
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto())
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }

        assertFalse(edt { telemetryToggle(root).isEnabled })
        edt { telemetryToggle(root).doClick(); cfg.apply() }
        coroutines.drain()
        assertTrue(appRpc.telemetryLevels.isEmpty())
        assertFalse(edt { cfg.isModified })

        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(telemetry = true))
        assertTrue(ui.pumpUntil { edt { telemetryToggle(root).isEnabled && telemetryToggle(root).isSelected } })
    }

    fun `test isModified tracks the telemetry toggle`() {
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }

        edt { telemetryToggle(root).doClick() }

        assertTrue(edt { cfg.isModified })
    }

    fun `test apply writes the telemetry opt-out to config only when changed`() {
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }

        edt { cfg.apply() }
        coroutines.drain()
        assertEquals(emptyList<Boolean>(), appRpc.telemetryLevels)

        edt {
            telemetryToggle(root).doClick()
            cfg.apply()
        }

        assertTrue(coroutines.pumpUntil { appRpc.telemetryLevels.isNotEmpty() })
        assertEquals(listOf(false), appRpc.telemetryLevels)
        assertFalse(edt { cfg.isModified })
    }

    fun `test telemetry save survives dialog dispose on ok`() {
        val gate = CompletableDeferred<Unit>()
        appRpc.telemetryLevelGate = gate
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }

        edt {
            telemetryToggle(root).doClick()
            cfg.apply()
        }
        assertTrue(coroutines.pumpUntil { appRpc.telemetryLevelAttempts == 1 })

        edt { cfg.disposeUIResources() }
        gate.complete(Unit)

        assertTrue(coroutines.pumpUntil { appRpc.telemetryLevels.isNotEmpty() })
        assertEquals(listOf(false), appRpc.telemetryLevels)
    }

    fun `test telemetry toggle refreshes from a later app state`() {
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(telemetry = true))
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }

        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(telemetry = false))

        assertTrue(ui.pumpUntil { edt { !telemetryToggle(root).isSelected } })
        assertFalse(edt { cfg.isModified })
    }

    fun `test reconnect keeps the opt-out until config is available`() {
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(telemetry = false))
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }

        app._state.value = KiloAppStateDto(KiloAppStatusDto.LOADING)
        ui.drain()

        assertFalse(edt { telemetryToggle(root).isSelected })
        assertFalse(edt { telemetryToggle(root).isEnabled })
        assertFalse(edt { cfg.isModified })

        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(telemetry = true))
        assertTrue(ui.pumpUntil { edt { telemetryToggle(root).isSelected } })
        assertFalse(edt { cfg.isModified })
    }

    fun `test successful opt-in stays off when the CLI reports an effective opt-out`() {
        appRpc.telemetryAllowed = false
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(telemetry = false))
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }

        edt {
            telemetryToggle(root).doClick()
            cfg.apply()
        }

        assertTrue(coroutines.pumpUntil { edt { telemetryToggle(root).isEnabled && !telemetryToggle(root).isSelected } })
        assertEquals(listOf(true), appRpc.telemetryLevels)
        assertFalse(edt { cfg.isModified })
    }

    fun `test telemetry refresh does not overwrite an in-flight write`() {
        val gate = CompletableDeferred<Unit>()
        appRpc.telemetryLevelGate = gate
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }

        edt {
            telemetryToggle(root).doClick()
            cfg.apply()
        }
        assertTrue(coroutines.pumpUntil { appRpc.telemetryLevelAttempts == 1 })

        // A stale pre-write state (still true) must not flip the toggle while the write is pending.
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(telemetry = true))
        ui.drain()
        assertFalse(edt { telemetryToggle(root).isSelected })

        gate.complete(Unit)
        assertTrue(coroutines.pumpUntil { appRpc.telemetryLevels.isNotEmpty() })
    }

    fun `test failed telemetry write reverts the toggle`() {
        appRpc.telemetryLevelError = IllegalStateException("write failed")
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }

        edt {
            telemetryToggle(root).doClick()
            cfg.apply()
        }

        assertTrue(coroutines.pumpUntil { edt { telemetryToggle(root).isSelected } })
        assertFalse(edt { cfg.isModified })
        assertTrue(appRpc.telemetryLevels.isEmpty())
    }

    private fun configurable() = AdvancedConfigurable(settings, { it.applyLocal() }, app) { ui.scope }

    private fun telemetryToggle(root: Container): SettingsToggle = toggles(root).first()

    private fun indexToggle(root: Container): SettingsToggle = toggles(root).last()

    private fun toggles(root: Container): List<SettingsToggle> = buildList {
        collect(root) { if (it is SettingsToggle) add(it) }
    }

    private fun links(root: Container): List<ActionLink> = buildList {
        collect(root) { if (it is ActionLink) add(it) }
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun level(root: Container): ComboBox<*> = combos(root).single {
        it.itemCount > 0 && it.getItemAt(0) is LogConfig.LogLevel
    }

    private fun mode(root: Container): ComboBox<*> = combos(root).single {
        it.itemCount > 0 && it.getItemAt(0) is LogConfig.ContentMode
    }

    private fun field(root: Container): JBTextField = fields(root).single()

    private fun combos(root: Container): List<ComboBox<*>> = buildList {
        collect(root) { if (it is ComboBox<*>) add(it) }
    }

    private fun fields(root: Container): List<JBTextField> = buildList {
        collect(root) { if (it is JBTextField) add(it) }
    }

    private fun collect(root: Container, block: (JComponent) -> Unit) {
        for (comp in root.components) {
            if (comp is JComponent) block(comp)
            if (comp is Container) collect(comp, block)
        }
    }
}
