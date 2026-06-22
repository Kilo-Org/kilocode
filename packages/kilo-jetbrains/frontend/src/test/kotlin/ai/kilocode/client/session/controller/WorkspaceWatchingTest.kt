package ai.kilocode.client.session.controller

import ai.kilocode.rpc.dto.AgentDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.ProviderDto

class WorkspaceWatchingTest : SessionControllerTestBase() {

    fun `test workspace ready populates agents and models`() {
        val m = controller()
        val events = collect(m)
        flush()
        events.clear()

        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf(
                        "gpt-5" to ModelDto(
                            id = "gpt-5",
                            name = "GPT-5",
                            mayTrainOnYourPrompts = true,
                        ),
                    ),
                ),
            ),
        )
        flush()

        assertEquals(1, m.model.agents.size)
        assertEquals("code", m.model.agents[0].name)
        assertEquals(1, m.model.models.size)
        assertEquals("gpt-5", m.model.models[0].id)
        assertTrue(m.model.models[0].mayTrainOnYourPrompts)
        assertFalse(m.model.isReady())
        assertControllerEvents("""
            AccountOverlayChanged show loggedIn=false
            ViewChanged recents=0
            WorkspaceChanged
            WorkspaceReady
        """, events)
        assertSession(
            """
            [code] [kilo/gpt-5] [app: DISCONNECTED] [workspace: READY]
            """,
            m,
            show = false,
        )
    }

    fun `test workspace ready sets default agent and model`() {
        val m = controller()
        collect(m)
        flush()

        projectRpc.state.value = workspaceReady()
        flush()

        assertEquals("code", m.model.agent)
        assertEquals("kilo/gpt-5", m.model.model)
    }

    fun `test workspace ready preserves agent metadata`() {
        val m = controller()
        collect(m)
        flush()

        projectRpc.state.value = workspaceReady(
            agents = listOf(
                AgentDto(
                    name = "debug-mode",
                    description = "Diagnose issues",
                    mode = "primary",
                    deprecated = true,
                ),
            ),
            default = "debug-mode",
        )
        flush()

        val item = m.model.agents.single()
        assertEquals("debug-mode", item.name)
        assertEquals("Debug Mode", item.display)
        assertEquals("Diagnose issues", item.description)
        assertTrue(item.deprecated)
    }
}
