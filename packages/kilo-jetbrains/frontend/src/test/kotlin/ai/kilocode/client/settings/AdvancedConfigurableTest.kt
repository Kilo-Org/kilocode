package ai.kilocode.client.settings

import ai.kilocode.client.util.edtWait
import ai.kilocode.log.LogConfig
import com.intellij.openapi.options.ConfigurationException
import com.intellij.openapi.ui.ComboBox
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBTextField
import java.awt.Container
import javax.swing.JComponent

class AdvancedConfigurableTest : BasePlatformTestCase() {
    private lateinit var settings: KiloLogSettingsService

    override fun setUp() {
        super.setUp()
        settings = KiloLogSettingsService()
        LogConfig.apply(null, null, null)
    }

    override fun tearDown() {
        try {
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

    private fun configurable() = AdvancedConfigurable(settings) { it.applyLocal() }

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
