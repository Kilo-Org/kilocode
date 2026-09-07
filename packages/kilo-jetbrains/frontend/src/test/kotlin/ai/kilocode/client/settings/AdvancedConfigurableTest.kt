package ai.kilocode.client.settings

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.settings.CompactModeListener
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.util.edtWait
import ai.kilocode.log.LogConfig
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.options.ConfigurationException
import com.intellij.openapi.ui.ComboBox
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.ui.components.OnOffButton
import java.awt.Container
import javax.swing.JComponent
import kotlinx.coroutines.CompletableDeferred

private val COMPACT_KEYS = listOf(
    "settings.advanced.compact.enabled.title",
    "settings.advanced.compact.reads.title",
    "settings.advanced.compact.writes.title",
    "settings.advanced.compact.web.title",
    "settings.advanced.compact.other.title",
    "settings.advanced.compact.subagents.title",
)

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
        resetCompact()
        coroutines = TestCoroutines()
        ui = TestCoroutines()
        appRpc = FakeAppRpcApi()
        app = KiloAppService(coroutines.scope, appRpc)
    }

    override fun tearDown() {
        try {
            ui.close()
            coroutines.close()
            LogConfig.apply(null, null, null)
            resetCompact()
        } finally {
            super.tearDown()
        }
    }

    private fun resetCompact() {
        KiloPluginSettings.unsetCompactMode()
        KiloPluginSettings.unsetCompactGroupReads()
        KiloPluginSettings.unsetCompactGroupWrites()
        KiloPluginSettings.unsetCompactGroupWeb()
        KiloPluginSettings.unsetCompactGroupOther()
        KiloPluginSettings.unsetCompactGroupSubagents()
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

    // ---- compact transcript mode ----

    fun `test compact rows render one toggle each`() {
        val cfg = configurable()
        edt {
            val root = cfg.createComponent() as Container
            for (key in COMPACT_KEYS) assertNotNull(key, toggle(root, key))
        }
    }

    fun `test compact toggles apply immediately without touching apply or reset`() {
        val cfg = configurable()
        edt {
            val root = cfg.createComponent() as Container
            toggle(root, "settings.advanced.compact.enabled.title").doClick()

            assertTrue(KiloPluginSettings.getCompactMode())
            assertFalse("compact mode is not part of the log draft", cfg.isModified)

            cfg.reset()
            assertTrue("reset only restores the log form", KiloPluginSettings.getCompactMode())
        }
    }

    fun `test each category toggle writes its own setting`() {
        val cfg = configurable()
        edt {
            val root = cfg.createComponent() as Container
            // The category rows are disabled until the master switch is on, so a click would be a no-op.
            toggle(root, "settings.advanced.compact.enabled.title").doClick()

            toggle(root, "settings.advanced.compact.reads.title").doClick()
            assertFalse(KiloPluginSettings.getCompactGroupReads())
            assertTrue(KiloPluginSettings.getCompactGroupWrites())

            toggle(root, "settings.advanced.compact.subagents.title").doClick()
            assertFalse(KiloPluginSettings.getCompactGroupSubagents())
            assertTrue(KiloPluginSettings.getCompactGroupWeb())

            toggle(root, "settings.advanced.compact.other.title").doClick()
            assertFalse(KiloPluginSettings.getCompactGroupOther())
        }
    }

    // The category toggles do nothing while the master switch is off, so the page must show that.
    fun `test category toggles follow the master switch`() {
        val cfg = configurable()
        edt {
            val root = cfg.createComponent() as Container
            val categories = COMPACT_KEYS.drop(1).map { toggle(root, it) }
            assertTrue("disabled while compact mode is off", categories.none { it.isEnabled })

            toggle(root, "settings.advanced.compact.enabled.title").doClick()
            assertTrue("enabled once compact mode is on", categories.all { it.isEnabled })
        }
    }

    fun `test flipping a compact toggle notifies open sessions`() {
        val cfg = configurable()
        val seen = intArrayOf(0)
        ApplicationManager.getApplication().messageBus.connect(testRootDisposable)
            .subscribe(CompactModeListener.TOPIC, CompactModeListener { seen[0]++ })
        edt {
            val root = cfg.createComponent() as Container
            toggle(root, "settings.advanced.compact.enabled.title").doClick()
            toggle(root, "settings.advanced.compact.web.title").doClick()
        }

        assertEquals("every flip has to reach open transcripts", 2, seen[0])
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

        assertTrue(edt { toggle(root).isSelected })
        assertFalse(edt { cfg.isModified })
    }

    fun `test isModified tracks index worktrees toggle`() {
        val cfg = configurable()
        val root = edt { cfg.createComponent() as Container }
        ui.drain()

        edt { toggle(root).doClick() }

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
            toggle(root).doClick()
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
            toggle(root).doClick()
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
        edt { toggle(root).doClick() }
        gate.complete(Unit)
        ui.drain()

        assertTrue("late fetch cleared the user's toggle", edt { toggle(root).isSelected })
        assertTrue("late fetch cleared the dirty state", edt { cfg.isModified })
    }

    private fun configurable() = AdvancedConfigurable(settings, { it.applyLocal() }, app) { ui.scope }

    private fun toggle(root: Container): SettingsToggle = toggles(root).single()

    private fun toggles(root: Container): List<SettingsToggle> = buildList {
        collect(root) { if (it is SettingsToggle) add(it) }
    }

    /** The [OnOffButton] in the settings row whose bold title comes from [titleKey]. */
    private fun toggle(root: Container, titleKey: String): OnOffButton {
        val title = KiloBundle.message(titleKey)
        val row = rows(root).firstOrNull { row -> labels(row).any { it.text == title } }
            ?: error("no settings row titled '$title'")
        return buildList<OnOffButton> { collect(row) { if (it is OnOffButton) add(it) } }.single()
    }

    private fun rows(root: Container): List<SettingsRow> = buildList {
        collect(root) { if (it is SettingsRow) add(it) }
    }

    private fun labels(root: Container): List<JBLabel> = buildList {
        collect(root) { if (it is JBLabel) add(it) }
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
