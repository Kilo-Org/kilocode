package ai.kilocode.client.settings.agents

import ai.kilocode.cli.KiloCliParser
import ai.kilocode.rpc.dto.AgentCreateDto

internal enum class AgentCreateField { NAME, PROMPT, MODE, SCOPE }

internal data class AgentCreateError(
    val field: AgentCreateField,
    val key: String,
)

internal fun validateAgentCreate(input: AgentCreateDto, names: Collection<String>): List<AgentCreateError> {
    val errors = mutableListOf<AgentCreateError>()
    val name = input.name.trim()
    if (name.isBlank()) errors += AgentCreateError(AgentCreateField.NAME, "settings.agentBehavior.agents.create.name.required")
    if (name.isNotBlank() && !AGENT_ID.matches(name)) errors += AgentCreateError(AgentCreateField.NAME, "settings.agentBehavior.agents.create.name.invalid")
    if (names.any { it == name }) errors += AgentCreateError(AgentCreateField.NAME, "settings.agentBehavior.agents.create.name.duplicate")
    if (input.prompt.isBlank()) errors += AgentCreateError(AgentCreateField.PROMPT, "settings.agentBehavior.agents.create.prompt.invalid")
    if (input.mode !in MODES) errors += AgentCreateError(AgentCreateField.MODE, "settings.agentBehavior.agents.create.mode.invalid")
    if (input.scope !in SCOPES) errors += AgentCreateError(AgentCreateField.SCOPE, "settings.agentBehavior.agents.create.scope.invalid")
    return errors
}

internal val AGENT_ID = Regex("^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")
private val MODES = setOf(KiloCliParser.MODE_PRIMARY, KiloCliParser.MODE_SUBAGENT, KiloCliParser.MODE_ALL)
private val SCOPES = setOf("project", "global")
