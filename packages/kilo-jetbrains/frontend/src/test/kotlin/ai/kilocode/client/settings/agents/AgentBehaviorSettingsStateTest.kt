package ai.kilocode.client.settings.agents

import ai.kilocode.rpc.dto.ConfigDto
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AgentBehaviorSettingsStateTest {
    @Test
    fun `draft defaults to on when the key is unset`() {
        assertTrue(agentBehaviorDraft(null).swarm)
        assertTrue(agentBehaviorDraft(ConfigDto()).swarm)
    }

    @Test
    fun `draft reads an explicit opt-out`() {
        assertFalse(agentBehaviorDraft(ConfigDto(shared_agent_board = false)).swarm)
    }

    @Test
    fun `draft reads an explicit opt-in`() {
        assertTrue(agentBehaviorDraft(ConfigDto(shared_agent_board = true)).swarm)
    }

    @Test
    fun `unchanged draft emits no patch`() {
        assertNull(patch(AgentBehaviorDraft(swarm = true), AgentBehaviorDraft(swarm = true)))
        assertNull(patch(AgentBehaviorDraft(swarm = false), AgentBehaviorDraft(swarm = false)))
    }

    @Test
    fun `turning it off emits an explicit false so it survives the default`() {
        val result = patch(AgentBehaviorDraft(swarm = true), AgentBehaviorDraft(swarm = false))
        assertEquals(false, result?.shared_agent_board)
    }

    @Test
    fun `turning it back on emits an explicit true`() {
        val result = patch(AgentBehaviorDraft(swarm = false), AgentBehaviorDraft(swarm = true))
        assertEquals(true, result?.shared_agent_board)
    }

    @Test
    fun `savedMatches compares swarm only`() {
        assertTrue(savedMatches(AgentBehaviorDraft(swarm = true), AgentBehaviorDraft(swarm = true)))
        assertFalse(savedMatches(AgentBehaviorDraft(swarm = true), AgentBehaviorDraft(swarm = false)))
    }
}
