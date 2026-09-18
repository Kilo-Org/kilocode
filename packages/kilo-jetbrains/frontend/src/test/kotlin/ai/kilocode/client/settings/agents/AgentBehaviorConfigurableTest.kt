package ai.kilocode.client.settings.agents

import ai.kilocode.client.settings.rules.RulesConfigurable
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class AgentBehaviorConfigurableTest : BasePlatformTestCase() {

    fun `test id matches xml registration`() {
        val cfg = AgentBehaviorConfigurable()

        assertEquals("ai.kilocode.jetbrains.settings.agentBehavior", cfg.id)
    }

    fun `test child ids match xml registration`() {
        assertEquals("ai.kilocode.jetbrains.settings.agentBehavior.agents", AgentsConfigurable.ID)
        assertEquals("ai.kilocode.jetbrains.settings.agentBehavior.mcp", McpConfigurable.ID)
        assertEquals("ai.kilocode.jetbrains.settings.agentBehavior.skills", SkillsConfigurable.ID)
        assertEquals("ai.kilocode.jetbrains.settings.agentBehavior.workflows", WorkflowsConfigurable.ID)
        assertEquals("ai.kilocode.jetbrains.settings.agentBehavior.rules", RulesConfigurable.ID)
    }

    /**
     * The page now hosts the Kilo Swarm toggle, so it is a draft page rather than an inert
     * navigation stub. Child links and toggle behavior are covered by AgentBehaviorSettingsUiTest,
     * which can drive a ready app state; before the app is ready this page has no draft to modify.
     */
    fun `test page is a searchable draft page that is unmodified before app state arrives`() {
        val cfg = AgentBehaviorConfigurable()

        assertTrue(cfg is SearchableConfigurable)
        assertFalse(cfg.isModified)
        cfg.apply()
        assertFalse(cfg.isModified)
    }
}
