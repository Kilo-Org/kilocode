package ai.kilocode.client.settings.integrations

import ai.kilocode.client.agentManager.worktree.GithubIntegrationListener
import ai.kilocode.client.agentManager.worktree.setGithubIntegration
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.util.edtWait
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.OnOffButton
import java.awt.Container
import javax.swing.JComponent
import javax.swing.JLabel

@Suppress("UnstableApiUsage")
class IntegrationsConfigurableTest : BasePlatformTestCase() {

    override fun tearDown() {
        try {
            KiloPluginSettings.unsetGithub()
        } finally {
            super.tearDown()
        }
    }

    fun `test id matches xml registration`() {
        assertEquals("ai.kilocode.jetbrains.settings.integrations", IntegrationsConfigurable().id)
    }

    fun `test page is searchable and opts out of platform margin and scrollpane`() {
        val cfg: Configurable = IntegrationsConfigurable()
        assertTrue(cfg is SearchableConfigurable)
        assertTrue(cfg is Configurable.NoMargin)
        assertTrue(cfg is Configurable.NoScroll)
    }

    fun `test github toggle renders on by default`() {
        val cfg = IntegrationsConfigurable()
        edt {
            val panel = cfg.createComponent()
            val all = text(panel as Container)
            assertTrue("expected the GitHub section", all.contains("GitHub"))
            assertTrue("expected the toggle row", all.contains("Enable GitHub Integration"))
            assertTrue("default must be on", toggle(panel).isSelected)
            cfg.disposeUIResources()
        }
    }

    fun `test toggling off persists the setting and publishes the change`() {
        val events = mutableListOf<Boolean>()
        ApplicationManager.getApplication().messageBus.connect(testRootDisposable)
            .subscribe(GithubIntegrationListener.TOPIC, GithubIntegrationListener { events += it })
        val cfg = IntegrationsConfigurable()
        edt {
            val panel = cfg.createComponent()
            toggle(panel as Container).doClick()
            assertFalse(KiloPluginSettings.getGithub())
            assertEquals(listOf(false), events)
            toggle(panel).doClick()
            assertTrue(KiloPluginSettings.getGithub())
            assertEquals(listOf(false, true), events)
            cfg.disposeUIResources()
        }
    }

    fun `test page is inert because the toggle writes immediately`() {
        val cfg = IntegrationsConfigurable()
        edt {
            val panel = cfg.createComponent()
            toggle(panel as Container).doClick()
            assertFalse("an immediate write leaves nothing to apply", cfg.isModified)
            cfg.apply()
            assertFalse(KiloPluginSettings.getGithub())
            cfg.disposeUIResources()
        }
    }

    fun `test open page follows a change made elsewhere`() {
        val cfg = IntegrationsConfigurable()
        edt {
            val panel = cfg.createComponent()
            assertTrue(toggle(panel as Container).isSelected)
            // The gh banner turning the integration off while the page is open.
            setGithubIntegration(false, "worktree_gh_banner")
            assertFalse(toggle(panel).isSelected)
            cfg.disposeUIResources()
        }
    }

    fun `test reset resyncs the toggle`() {
        val cfg = IntegrationsConfigurable()
        edt {
            val panel = cfg.createComponent()
            val button = toggle(panel as Container)
            // Bypass the publisher so only reset() can bring the toggle back in line.
            KiloPluginSettings.setGithub(false)
            assertTrue(button.isSelected)
            cfg.reset()
            assertFalse(button.isSelected)
            cfg.disposeUIResources()
        }
    }

    // -- helpers --

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun toggle(root: Container): OnOffButton = buttons(root).single()

    private fun buttons(root: Container): List<OnOffButton> = buildList {
        for (comp in root.components) {
            if (comp is OnOffButton) add(comp)
            if (comp is Container) addAll(buttons(comp))
        }
    }

    private fun text(root: Container): String {
        val acc = mutableListOf<String>()
        collect(root, acc)
        return acc.joinToString("\n")
    }

    private fun collect(root: Container, acc: MutableList<String>) {
        for (comp in root.components) {
            if (comp is JLabel) comp.text?.let { acc.add(it) }
            if (comp is JComponent) comp.toolTipText?.let { acc.add(it) }
            if (comp is Container) collect(comp, acc)
        }
    }
}
