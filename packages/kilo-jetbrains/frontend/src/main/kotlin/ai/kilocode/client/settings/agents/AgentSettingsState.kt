package ai.kilocode.client.settings.agents

import ai.kilocode.cli.KiloCliParser
import ai.kilocode.rpc.dto.AgentConfigPatchDto
import ai.kilocode.rpc.dto.AgentCreateDto
import ai.kilocode.rpc.dto.AgentDetailDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.PermissionRuleItemDto

internal data class AgentsDraft(
    val defaultAgent: String? = null,
    val agents: Map<String, AgentEditDraft> = emptyMap(),
    val created: Map<String, AgentCreateDto> = emptyMap(),
    val imported: Map<String, ConfigPatchDto> = emptyMap(),
    val deleted: Set<String> = emptySet(),
)

internal data class AgentDisplayRow(
    val agent: AgentEditDraft,
    val intent: AgentIntent,
)

internal enum class AgentIntent {
    Unchanged,
    Modified,
    New,
    PendingDelete,
}

internal data class AgentEditDraft(
    val name: String,
    val displayName: String? = null,
    val description: String? = null,
    val prompt: String? = null,
    val model: String? = null,
    val variant: String? = null,
    val mode: String = KiloCliParser.MODE_PRIMARY,
    val defaultMode: String = KiloCliParser.MODE_PRIMARY,
    val hidden: Boolean = false,
    val disable: Boolean = false,
    val native: Boolean = false,
    val removable: Boolean = false,
    val deprecated: Boolean = false,
    val temperature: Double? = null,
    val topP: Double? = null,
    val steps: Long? = null,
    val permission: List<PermissionRuleItemDto> = emptyList(),
)

internal fun canDelete(agent: AgentEditDraft) = agent.removable

internal fun canEditMode(agent: AgentEditDraft) = !agent.native

internal fun canEditVisibility(agent: AgentEditDraft) = !agent.native

internal fun canEditDescription(agent: AgentEditDraft) = !agent.native

internal fun agentsDraft(config: ConfigDto?, details: List<AgentDetailDto>): AgentsDraft {
    val items = details.associate { detail ->
        val cfg = config?.agent?.get(detail.name)
        detail.name to AgentEditDraft(
            name = detail.name,
            displayName = detail.displayName,
            description = cfg?.description ?: detail.description,
            prompt = cfg?.prompt,
            model = cfg?.model,
            variant = cfg?.variant,
            mode = cfg?.mode ?: detail.mode,
            defaultMode = detail.mode,
            hidden = cfg?.hidden ?: (detail.hidden == true),
            disable = cfg?.disable == true,
            native = detail.native == true,
            removable = detail.removable == true,
            deprecated = detail.deprecated == true,
            temperature = cfg?.temperature,
            topP = cfg?.top_p,
            steps = cfg?.steps,
            permission = detail.permission,
        )
    }
    val agent = config?.defaultAgent?.takeIf { name ->
        val item = items[name]
        item != null && KiloCliParser.defaultAgentCandidate(item.mode, item.hidden) && !item.disable
    }
    return AgentsDraft(defaultAgent = agent, agents = items)
}

internal fun updateAgent(draft: AgentsDraft, agent: AgentEditDraft): AgentsDraft {
    val restricted = !canEditMode(agent) || !canEditVisibility(agent)
    val clear = !restricted && (agent.hidden || agent.disable || KiloCliParser.isSubagent(agent.mode))
    val def = draft.defaultAgent.takeUnless { it == agent.name && clear }
    return draft.copy(defaultAgent = def, agents = draft.agents + (agent.name to agent))
}

internal fun patch(from: AgentsDraft, to: AgentsDraft): ConfigPatchDto? {
    val values = linkedMapOf<String, String?>()
    if (from.defaultAgent != to.defaultAgent) values[KiloCliParser.CONFIG_DEFAULT_AGENT] = to.defaultAgent

    val agents = linkedMapOf<String, AgentConfigPatchDto>()
    for (name in (from.agents.keys + to.agents.keys).sorted()) {
        if (name in to.deleted) continue
        val prev = from.agents[name] ?: continue
        val next = to.agents[name] ?: continue
        val item = patchAgent(prev, next)
        if (item != null) agents[name] = item
    }

    if (values.isEmpty() && agents.isEmpty()) return null
    return ConfigPatchDto(values = values, agents = agents)
}

internal fun savedMatches(base: AgentsDraft, draft: AgentsDraft): Boolean {
    if (base.created != draft.created) return false
    if (base.imported != draft.imported) return false
    if (base.deleted != draft.deleted) return false
    if (base.defaultAgent != draft.defaultAgent) return false
    if (base.agents.keys != draft.agents.keys) return false
    for ((name, item) in draft.agents) {
        if (base.agents[name] != item) return false
    }
    return true
}

internal fun displayRows(base: AgentsDraft, draft: AgentsDraft): List<AgentDisplayRow> {
    val rows = draft.agents.values.map { agent ->
        val intent = when {
            agent.name in draft.deleted -> AgentIntent.PendingDelete
            base.agents[agent.name] != agent -> AgentIntent.Modified
            else -> AgentIntent.Unchanged
        }
        AgentDisplayRow(agent, intent)
    }
    val created = draft.created.values.map { input ->
        AgentDisplayRow(
            AgentEditDraft(
                name = input.name,
                description = input.description,
                prompt = input.prompt,
                mode = input.mode,
                defaultMode = input.mode,
                removable = true,
            ),
            AgentIntent.New,
        )
    }
    val imported = draft.imported.map { (name, patch) ->
        val cfg = patch.agents[name]
        AgentDisplayRow(
            AgentEditDraft(
                name = name,
                description = cfg?.description,
                prompt = cfg?.prompt,
                model = cfg?.model,
                variant = cfg?.variant,
                mode = cfg?.mode ?: KiloCliParser.MODE_PRIMARY,
                defaultMode = cfg?.mode ?: KiloCliParser.MODE_PRIMARY,
                hidden = cfg?.hidden == true,
                disable = cfg?.disable == true,
                removable = true,
                temperature = cfg?.temperature,
                topP = cfg?.top_p,
                steps = cfg?.steps,
            ),
            AgentIntent.New,
        )
    }
    return rows + created + imported
}

internal fun rebaseAgents(base: AgentsDraft, edit: AgentsDraft): AgentsDraft = edit.copy(
    agents = base.agents + edit.agents,
)

private fun patchAgent(from: AgentEditDraft, to: AgentEditDraft): AgentConfigPatchDto? {
    val clear = mutableListOf<String>()
    fun text(field: String, before: String?, after: String?) = after.takeIf { before != after } ?: run {
        if (before != after) clear += field
        null
    }
    fun number(field: String, before: Double?, after: Double?) = after.takeIf { before != after } ?: run {
        if (before != after) clear += field
        null
    }
    fun long(field: String, before: Long?, after: Long?) = after.takeIf { before != after } ?: run {
        if (before != after) clear += field
        null
    }

    val modeEditable = canEditMode(from) && canEditMode(to)
    val visibilityEditable = canEditVisibility(from) && canEditVisibility(to)
    val descriptionEditable = canEditDescription(from) && canEditDescription(to)
    val mode = if (modeEditable && from.mode != to.mode && to.mode != to.defaultMode) to.mode else null
    if (modeEditable && from.mode != to.mode && to.mode == to.defaultMode) clear += "mode"

    val patch = AgentConfigPatchDto(
        clear = clear,
        model = text("model", from.model, to.model),
        variant = text("variant", from.variant, to.variant),
        prompt = text("prompt", from.prompt, to.prompt),
        description = if (descriptionEditable) text("description", from.description, to.description) else null,
        mode = mode,
        hidden = to.hidden.takeIf { visibilityEditable && from.hidden != to.hidden },
        disable = to.disable.takeIf { visibilityEditable && from.disable != to.disable },
        temperature = number("temperature", from.temperature, to.temperature),
        top_p = number("top_p", from.topP, to.topP),
        steps = long("steps", from.steps, to.steps),
    )
    if (patch.clear.isEmpty() && patch == AgentConfigPatchDto()) return null
    return patch
}
