package ai.kilocode.client.settings.transcript

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.settings.ApprovalReasonVisibilityListener
import ai.kilocode.client.session.settings.BlockDisplay
import ai.kilocode.client.session.settings.ReasoningDisplay
import ai.kilocode.client.session.settings.TranscriptDisplayListener
import ai.kilocode.client.util.edtWait
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.ui.ComboBox
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.OnOffButton
import java.awt.Container
import javax.swing.JComponent

@Suppress("UnstableApiUsage")
class TranscriptConfigurableTest : BasePlatformTestCase() {

    override fun tearDown() {
        try {
            KiloPluginSettings.unsetShowApprovalReason()
            KiloPluginSettings.unsetReasoningDisplay()
            KiloPluginSettings.unsetTerminalCommandDisplay()
            KiloPluginSettings.unsetCodeEditDisplay()
            KiloPluginSettings.unsetMcpToolDisplay()
            KiloPluginSettings.unsetHoverPreview()
        } finally {
            super.tearDown()
        }
    }

    fun `test id matches xml registration`() {
        assertEquals("ai.kilocode.jetbrains.settings.transcript", TranscriptConfigurable().id)
    }

    fun `test page is searchable and opts out of platform margin and scrollpane`() {
        val cfg: Configurable = TranscriptConfigurable()
        assertTrue(cfg is SearchableConfigurable)
        assertTrue(cfg is Configurable.NoMargin)
        assertTrue(cfg is Configurable.NoScroll)
    }

    fun `test defaults match vs code`() {
        val cfg = TranscriptConfigurable()
        edt {
            val panel = cfg.createComponent()
            assertTrue("approval reason on by default", toggles(panel as Container)[0].isSelected)
            val combos = combos(panel)
            assertEquals(ReasoningDisplay.EXPANDED, combos[0].selectedItem)
            assertEquals(BlockDisplay.EXPANDED, combos[1].selectedItem)
            assertEquals(BlockDisplay.COLLAPSED, combos[2].selectedItem)
            assertEquals(BlockDisplay.COLLAPSED, combos[3].selectedItem)
            assertTrue("hover preview on by default", toggles(panel).last().isSelected)
            cfg.disposeUIResources()
        }
    }

    fun `test approval reason toggle persists and publishes the change`() {
        val events = mutableListOf<Boolean>()
        ApplicationManager.getApplication().messageBus.connect(testRootDisposable)
            .subscribe(ApprovalReasonVisibilityListener.TOPIC, ApprovalReasonVisibilityListener { events += it })
        val cfg = TranscriptConfigurable()
        edt {
            val panel = cfg.createComponent()
            toggles(panel as Container).first().doClick()
            assertFalse(KiloPluginSettings.getShowApprovalReason())
            assertEquals(listOf(false), events)
            cfg.disposeUIResources()
        }
    }

    fun `test reasoning combo persists selection`() {
        var events = 0
        ApplicationManager.getApplication().messageBus.connect(testRootDisposable)
            .subscribe(TranscriptDisplayListener.TOPIC, TranscriptDisplayListener { events++ })
        val cfg = TranscriptConfigurable()
        edt {
            val panel = cfg.createComponent()
            combos(panel as Container)[0].selectedItem = ReasoningDisplay.HEADLINE
            assertEquals(ReasoningDisplay.HEADLINE, KiloPluginSettings.getReasoningDisplay())
            assertEquals(1, events)
            cfg.disposeUIResources()
        }
    }

    fun `test terminal combo persists selection`() {
        val cfg = TranscriptConfigurable()
        edt {
            val panel = cfg.createComponent()
            combos(panel as Container)[1].selectedItem = BlockDisplay.COLLAPSED
            assertEquals(BlockDisplay.COLLAPSED, KiloPluginSettings.getTerminalCommandDisplay())
            cfg.disposeUIResources()
        }
    }

    fun `test code edit combo persists selection`() {
        val cfg = TranscriptConfigurable()
        edt {
            val panel = cfg.createComponent()
            combos(panel as Container)[2].selectedItem = BlockDisplay.EXPANDED
            assertEquals(BlockDisplay.EXPANDED, KiloPluginSettings.getCodeEditDisplay())
            cfg.disposeUIResources()
        }
    }

    fun `test mcp tool combo persists selection`() {
        val cfg = TranscriptConfigurable()
        edt {
            val panel = cfg.createComponent()
            combos(panel as Container)[3].selectedItem = BlockDisplay.EXPANDED
            assertEquals(BlockDisplay.EXPANDED, KiloPluginSettings.getMcpToolDisplay())
            cfg.disposeUIResources()
        }
    }

    fun `test hover preview toggle persists`() {
        val cfg = TranscriptConfigurable()
        edt {
            val panel = cfg.createComponent()
            toggles(panel as Container).last().doClick()
            assertFalse(KiloPluginSettings.getHoverPreview())
            cfg.disposeUIResources()
        }
    }

    fun `test page is inert because every control writes immediately`() {
        val cfg = TranscriptConfigurable()
        edt {
            val panel = cfg.createComponent()
            toggles(panel as Container).first().doClick()
            assertFalse("an immediate write leaves nothing to apply", cfg.isModified)
            cfg.apply()
            assertFalse(KiloPluginSettings.getShowApprovalReason())
            cfg.disposeUIResources()
        }
    }

    fun `test reset resyncs every control`() {
        val cfg = TranscriptConfigurable()
        edt {
            val panel = cfg.createComponent()
            KiloPluginSettings.setShowApprovalReason(false)
            KiloPluginSettings.setReasoningDisplay(ReasoningDisplay.HEADLINE)
            cfg.reset()
            assertFalse(toggles(panel as Container).first().isSelected)
            assertEquals(ReasoningDisplay.HEADLINE, combos(panel)[0].selectedItem)
            cfg.disposeUIResources()
        }
    }

    // -- helpers --

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun toggles(root: Container): List<OnOffButton> = buildList {
        for (comp in root.components) {
            if (comp is OnOffButton) add(comp)
            if (comp is Container) addAll(toggles(comp))
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun combos(root: Container): List<ComboBox<Any>> = buildList {
        for (comp in root.components) {
            if (comp is ComboBox<*>) add(comp as ComboBox<Any>)
            if (comp is Container) addAll(combos(comp))
        }
    }
}
