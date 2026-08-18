package ai.kilocode.client.settings.agents

import ai.kilocode.cli.KiloCliParser
import ai.kilocode.rpc.dto.AgentCreateDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AgentCreateStateTest {
    @Test
    fun `valid input passes`() {
        assertTrue(validateAgentCreate(AgentCreateDto("reviewer", "Review code"), emptyList()).isEmpty())
    }

    @Test
    fun `blank name is invalid`() {
        val errors = validateAgentCreate(AgentCreateDto(" ", "Prompt"), emptyList())

        assertEquals(listOf(AgentCreateField.NAME), errors.map { it.field })
        assertEquals(listOf("settings.agentBehavior.agents.create.name.required"), errors.map { it.key })
    }

    @Test
    fun `invalid name is rejected`() {
        val errors = validateAgentCreate(AgentCreateDto("-bad", "Prompt"), emptyList())

        assertEquals(listOf("settings.agentBehavior.agents.create.name.invalid"), errors.map { it.key })
    }

    @Test
    fun `duplicate name is rejected`() {
        val errors = validateAgentCreate(AgentCreateDto("reviewer", "Prompt"), listOf("reviewer"))

        assertEquals(listOf("settings.agentBehavior.agents.create.name.duplicate"), errors.map { it.key })
    }

    @Test
    fun `blank prompt is invalid`() {
        val errors = validateAgentCreate(AgentCreateDto("reviewer", " "), emptyList())

        assertEquals(listOf(AgentCreateField.PROMPT), errors.map { it.field })
    }

    @Test
    fun `invalid mode is rejected`() {
        val errors = validateAgentCreate(AgentCreateDto("reviewer", "Prompt", mode = "bad"), emptyList())

        assertEquals(listOf(AgentCreateField.MODE), errors.map { it.field })
    }

    @Test
    fun `all valid modes pass`() {
        val modes = listOf(KiloCliParser.MODE_PRIMARY, KiloCliParser.MODE_SUBAGENT, KiloCliParser.MODE_ALL)

        assertTrue(modes.all { validateAgentCreate(AgentCreateDto("reviewer-$it", "Prompt", mode = it), emptyList()).isEmpty() })
    }
}
