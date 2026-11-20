package ai.kilocode.client.settings.agents

import ai.kilocode.cli.KiloCliParser
import ai.kilocode.rpc.dto.AgentConfigDto
import ai.kilocode.rpc.dto.AgentConfigPatchDto
import ai.kilocode.rpc.dto.AgentCreateDto
import ai.kilocode.rpc.dto.AgentDetailDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AgentSettingsStateTest {

    @Test
    fun `draft merges config with agent details`() {
        val draft = agentsDraft(
            ConfigDto(
                defaultAgent = "code",
                agent = mapOf("code" to AgentConfigDto(
                    model = "kilo/gpt-5",
                    description = "Configured",
                    mode = KiloCliParser.MODE_ALL,
                    hidden = true,
                    temperature = 0.4,
                    top_p = 0.8,
                    steps = 12,
                )),
            ),
            listOf(detail("code", description = "Resolved", mode = KiloCliParser.MODE_PRIMARY)),
        )

        val agent = draft.agents.getValue("code")
        assertNull(draft.defaultAgent)
        assertEquals("Configured", agent.description)
        assertEquals("kilo/gpt-5", agent.model)
        assertEquals(KiloCliParser.MODE_ALL, agent.mode)
        assertTrue(agent.hidden)
        assertEquals(0.4, agent.temperature)
        assertEquals(0.8, agent.topP)
        assertEquals(12, agent.steps)
    }

    @Test
    fun `draft preserves native details`() {
        val draft = agentsDraft(null, listOf(detail("ask", native = true)))

        assertTrue(draft.agents.getValue("ask").native)
    }

    @Test
    fun `delete requires removable capability`() {
        val draft = agentsDraft(null, listOf(
            detail("generated", native = false, removable = false),
            detail("custom", native = false, removable = true),
        ))

        assertFalse(canDelete(draft.agents.getValue("generated")))
        assertTrue(canDelete(draft.agents.getValue("custom")))
    }

    @Test
    fun `patch emits changed fields only`() {
        val from = AgentsDraft(agents = mapOf("code" to AgentEditDraft(name = "code", description = "Old")))
        val to = updateAgent(from, from.agents.getValue("code").copy(
            description = "New",
            prompt = "Prompt",
            model = "kilo/gpt-5",
            variant = "high",
            temperature = 0.3,
            topP = 0.9,
            steps = 4,
            hidden = true,
            disable = true,
        ))

        val agent = patch(from, to)?.agents?.get("code")
        assertEquals("New", agent?.description)
        assertEquals("Prompt", agent?.prompt)
        assertEquals("kilo/gpt-5", agent?.model)
        assertEquals("high", agent?.variant)
        assertEquals(0.3, agent?.temperature)
        assertEquals(0.9, agent?.top_p)
        assertEquals(4, agent?.steps)
        assertEquals(true, agent?.hidden)
        assertEquals(true, agent?.disable)
        assertEquals(emptyList(), agent?.clear)
    }

    @Test
    fun `patch emits custom mode and visibility changes`() {
        val from = AgentsDraft(agents = mapOf("custom" to AgentEditDraft(name = "custom")))
        val to = updateAgent(from, from.agents.getValue("custom").copy(
            mode = KiloCliParser.MODE_ALL,
            hidden = true,
            disable = true,
        ))

        val agent = patch(from, to)?.agents?.get("custom")
        assertEquals(KiloCliParser.MODE_ALL, agent?.mode)
        assertEquals(true, agent?.hidden)
        assertEquals(true, agent?.disable)
    }

    @Test
    fun `patch ignores native description mode and visibility changes`() {
        val from = AgentsDraft(agents = mapOf("ask" to AgentEditDraft(
            name = "ask",
            description = "Built in",
            native = true,
        )))
        val to = updateAgent(from, from.agents.getValue("ask").copy(
            description = "Changed",
            mode = KiloCliParser.MODE_SUBAGENT,
            hidden = true,
            disable = true,
            prompt = "Prompt",
        ))

        val agent = patch(from, to)?.agents?.get("ask")
        assertEquals("Prompt", agent?.prompt)
        assertNull(agent?.description)
        assertNull(agent?.mode)
        assertNull(agent?.hidden)
        assertNull(agent?.disable)
        assertEquals(emptyList(), agent?.clear)
    }

    @Test
    fun `patch emits explicit clears`() {
        val from = AgentsDraft(agents = mapOf("code" to AgentEditDraft(
            name = "code",
            description = "Old",
            prompt = "Prompt",
            model = "kilo/gpt-5",
            variant = "high",
            temperature = 0.3,
            topP = 0.9,
            steps = 4,
        )))
        val to = updateAgent(from, from.agents.getValue("code").copy(
            description = null,
            prompt = null,
            model = null,
            variant = null,
            temperature = null,
            topP = null,
            steps = null,
        ))

        val agent = patch(from, to)?.agents?.get("code")
        assertEquals(listOf("model", "variant", "prompt", "description", "temperature", "top_p", "steps"), agent?.clear)
    }

    @Test
    fun `patch emits default agent changes`() {
        val from = AgentsDraft(defaultAgent = "ask")
        val to = AgentsDraft(defaultAgent = "code")

        assertEquals("code", patch(from, to)?.values?.get(KiloCliParser.CONFIG_DEFAULT_AGENT))
    }

    @Test
    fun `hiding disabling or making custom default subagent clears default agent`() {
        val agent = AgentEditDraft(name = "code")
        val draft = AgentsDraft(defaultAgent = "code", agents = mapOf("code" to agent))

        assertNull(updateAgent(draft, agent.copy(hidden = true)).defaultAgent)
        assertNull(updateAgent(draft, agent.copy(disable = true)).defaultAgent)
        assertNull(updateAgent(draft, agent.copy(mode = KiloCliParser.MODE_SUBAGENT)).defaultAgent)
    }

    @Test
    fun `native restricted changes do not clear default agent`() {
        val agent = AgentEditDraft(name = "ask", native = true)
        val draft = AgentsDraft(defaultAgent = "ask", agents = mapOf("ask" to agent))

        assertEquals("ask", updateAgent(draft, agent.copy(hidden = true)).defaultAgent)
        assertEquals("ask", updateAgent(draft, agent.copy(disable = true)).defaultAgent)
        assertEquals("ask", updateAgent(draft, agent.copy(mode = KiloCliParser.MODE_SUBAGENT)).defaultAgent)
    }

    @Test
    fun `saved match compares known agents`() {
        val base = AgentsDraft(agents = mapOf("code" to AgentEditDraft(name = "code", model = "kilo/gpt-5")))

        assertTrue(savedMatches(base, base))
        assertFalse(savedMatches(base, base.copy(agents = base.agents + ("code" to base.agents.getValue("code").copy(model = "openai/gpt")))))
    }

    @Test
    fun `saved match includes staged intents`() {
        val base = AgentsDraft(agents = mapOf("code" to AgentEditDraft(name = "code")))

        assertFalse(savedMatches(base, base.copy(created = mapOf("new" to AgentCreateDto("new", "Prompt")))))
        assertFalse(savedMatches(base, base.copy(imported = mapOf("new" to ConfigPatchDto()))))
        assertFalse(savedMatches(base, base.copy(deleted = setOf("code"))))
    }

    @Test
    fun `patch skips deleted agents`() {
        val from = AgentsDraft(agents = mapOf("code" to AgentEditDraft(name = "code", description = "Old")))
        val to = from.copy(
            agents = mapOf("code" to AgentEditDraft(name = "code", description = "New")),
            deleted = setOf("code"),
        )

        assertNull(patch(from, to))
    }

    @Test
    fun `display rows expose staged intents`() {
        val base = AgentsDraft(agents = mapOf(
            "code" to AgentEditDraft(name = "code", description = "Old"),
            "hidden" to AgentEditDraft(name = "hidden"),
        ))
        val draft = base.copy(
            agents = base.agents + ("code" to AgentEditDraft(name = "code", description = "New")),
            created = mapOf("created" to AgentCreateDto("created", "Prompt", description = "Created")),
            imported = mapOf("imported" to ConfigPatchDto(agents = mapOf(
                "imported" to AgentConfigPatchDto(description = "Imported", mode = KiloCliParser.MODE_SUBAGENT),
            ))),
            deleted = setOf("hidden"),
        )

        val rows = displayRows(base, draft).associate { it.agent.name to it.intent }
        assertEquals(AgentIntent.Modified, rows["code"])
        assertEquals(AgentIntent.PendingDelete, rows["hidden"])
        assertEquals(AgentIntent.New, rows["created"])
        assertEquals(AgentIntent.New, rows["imported"])
    }

    private fun detail(
        name: String,
        description: String? = null,
        mode: String = KiloCliParser.MODE_PRIMARY,
        native: Boolean = false,
        removable: Boolean = true,
    ) = AgentDetailDto(name = name, displayName = name, description = description, mode = mode, native = native, removable = removable)
}
