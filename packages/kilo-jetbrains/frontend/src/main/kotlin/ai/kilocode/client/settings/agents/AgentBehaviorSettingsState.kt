package ai.kilocode.client.settings.agents

import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto

internal data class AgentBehaviorDraft(
    val swarm: Boolean = true,
)

/**
 * Kilo Swarm is enabled unless config explicitly opts out, matching the CLI's
 * `BoardEnabled.resolve` and the VS Code toggle's `config().shared_agent_board ?? true`.
 */
internal fun agentBehaviorDraft(config: ConfigDto?): AgentBehaviorDraft = AgentBehaviorDraft(
    swarm = config?.shared_agent_board ?: true,
)

/** Always writes an explicit boolean, like VS Code, so "off" survives the default-on resolution. */
internal fun patch(from: AgentBehaviorDraft, to: AgentBehaviorDraft): ConfigPatchDto? {
    if (from.swarm == to.swarm) return null
    return ConfigPatchDto(shared_agent_board = to.swarm)
}

internal fun savedMatches(base: AgentBehaviorDraft, draft: AgentBehaviorDraft): Boolean =
    base.swarm == draft.swarm
