package ai.kilocode.client.settings.agents

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.ActionLink
import java.awt.Container

@Suppress("UnstableApiUsage")
class AgentBehaviorConfigurableTest : BasePlatformTestCase() {

    fun `test id matches xml registration`() {
        val cfg = AgentBehaviorConfigurable()

        assertEquals("ai.kilocode.jetbrains.settings.agentBehavior", cfg.id)
    }

    fun `test child ids match xml registration`() {
        assertEquals("ai.kilocode.jetbrains.settings.agentBehavior.agents", AgentsConfigurable.ID)
        assertEquals("ai.kilocode.jetbrains.settings.agentBehavior.mcp", McpConfigurable.ID)
    }

    fun `test createComponent contains child links in order`() {
        val cfg = AgentBehaviorConfigurable()

        edt {
            val panel = cfg.createComponent()
            val labels = links(panel as Container).map { it.text }
            assertEquals(listOf("Agents", "MCP Servers"), labels)
        }
    }

    fun `test navigation page is inert`() {
        val cfg = AgentBehaviorConfigurable()

        assertTrue(cfg is SearchableConfigurable)
        assertFalse(cfg.isModified)
        cfg.apply()
        assertFalse(cfg.isModified)
    }

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun links(root: Container): List<ActionLink> = buildList {
        for (comp in root.components) {
            if (comp is ActionLink) add(comp)
            if (comp is Container) addAll(links(comp))
        }
    }
}
