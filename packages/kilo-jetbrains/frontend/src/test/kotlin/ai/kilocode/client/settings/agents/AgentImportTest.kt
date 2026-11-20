package ai.kilocode.client.settings.agents

import ai.kilocode.cli.KiloCliParser
import ai.kilocode.rpc.dto.PermissionRuleDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class AgentImportTest {

    @Test
    fun `parses valid agent definition`() {
        val result = parseAgentImport("""
            {
                "name": "reviewer",
                "description": "Reviews code",
                "prompt": "Review carefully",
                "model": "kilo/gpt-5",
                "mode": "subagent",
                "temperature": 0.2,
                "top_p": 0.8,
                "steps": 5,
                "permission": {
                    "bash": {
                        "*": "deny",
                        "uname": "allow"
                    },
                    "edit": "ask"
                }
            }
        """.trimIndent(), emptyList())

        val agent = result.patch.agents.getValue("reviewer")
        assertEquals("reviewer", result.name)
        assertEquals("Reviews code", agent.description)
        assertEquals("Review carefully", agent.prompt)
        assertEquals("kilo/gpt-5", agent.model)
        assertEquals(KiloCliParser.MODE_SUBAGENT, agent.mode)
        assertEquals(0.2, agent.temperature)
        assertEquals(0.8, agent.top_p)
        assertEquals(5, agent.steps)
        assertEquals(PermissionRuleDto.Patterns(mapOf("*" to "deny", "uname" to "allow")), agent.permission?.get("bash"))
        assertEquals(PermissionRuleDto.Level("ask"), agent.permission?.get("edit"))
    }

    @Test
    fun `defaults mode and omits malformed optional fields`() {
        val result = parseAgentImport("""
            {
                "name": "reviewer",
                "description": 42,
                "mode": "bad",
                "temperature": "0.2",
                "top_p": null,
                "steps": "5",
                "permission": {
                    "bash": "allow",
                    "edit": "bad",
                    "read": {
                        "*": "ask",
                        "bad": true
                    }
                }
            }
        """.trimIndent(), emptyList())

        val agent = result.patch.agents.getValue("reviewer")
        assertNull(agent.description)
        assertEquals(KiloCliParser.MODE_PRIMARY, agent.mode)
        assertNull(agent.temperature)
        assertNull(agent.top_p)
        assertNull(agent.steps)
        assertEquals(PermissionRuleDto.Level("allow"), agent.permission?.get("bash"))
        assertNull(agent.permission?.get("edit"))
        assertEquals(PermissionRuleDto.Patterns(mapOf("*" to "ask")), agent.permission?.get("read"))
    }

    @Test
    fun `rejects invalid JSON`() {
        val err = assertFailsWith<AgentImportException> { parseAgentImport("{", emptyList()) }

        assertEquals(AgentImportError.INVALID_JSON, err.error)
    }

    @Test
    fun `rejects invalid name`() {
        val err = assertFailsWith<AgentImportException> { parseAgentImport("""{"name":"bad name!"}""", emptyList()) }

        assertEquals(AgentImportError.INVALID_NAME, err.error)
    }

    @Test
    fun `accepts names valid for agent creation`() {
        val result = parseAgentImport("""{"name":"Bad_Name.1"}""", emptyList())

        assertEquals("Bad_Name.1", result.name)
    }

    @Test
    fun `rejects duplicate name`() {
        val err = assertFailsWith<AgentImportException> { parseAgentImport("""{"name":"code"}""", listOf("code")) }

        assertEquals(AgentImportError.NAME_TAKEN, err.error)
    }
}
