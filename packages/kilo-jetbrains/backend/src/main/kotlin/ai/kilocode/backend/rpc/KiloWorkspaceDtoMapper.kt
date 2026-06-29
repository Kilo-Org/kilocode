package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.LoadError
import ai.kilocode.backend.workspace.AgentData
import ai.kilocode.backend.workspace.AgentInfo
import ai.kilocode.backend.workspace.CommandInfo
import ai.kilocode.backend.workspace.KiloWorkspaceLoadProgress
import ai.kilocode.backend.workspace.ModelInfo
import ai.kilocode.backend.workspace.ProviderData
import ai.kilocode.backend.workspace.ProviderInfo
import ai.kilocode.backend.workspace.SkillInfo
import ai.kilocode.rpc.dto.AgentDto
import ai.kilocode.rpc.dto.AgentsDto
import ai.kilocode.rpc.dto.CommandDto
import ai.kilocode.rpc.dto.KiloWorkspaceLoadProgressDto
import ai.kilocode.rpc.dto.LoadErrorDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.ModelLimitDto
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.rpc.dto.ProvidersDto
import ai.kilocode.rpc.dto.SkillDto

internal object KiloWorkspaceDtoMapper {
    fun error(e: LoadError) = LoadErrorDto(
        resource = e.resource,
        status = e.status,
        detail = e.detail,
    )

    fun progress(p: KiloWorkspaceLoadProgress) = KiloWorkspaceLoadProgressDto(
        providers = p.providers,
        agents = p.agents,
        commands = p.commands,
        skills = p.skills,
    )

    fun providers(d: ProviderData) = ProvidersDto(
        providers = d.providers.map(::provider),
        connected = d.connected,
        defaults = d.defaults,
    )

    fun agents(d: AgentData) = AgentsDto(
        agents = d.agents.map(::agent),
        all = d.all.map(::agent),
        default = d.default,
    )

    fun command(c: CommandInfo) = CommandDto(
        name = c.name,
        description = c.description,
        source = c.source,
        hints = c.hints,
    )

    fun skill(s: SkillInfo) = SkillDto(
        name = s.name,
        description = s.description,
        location = s.location,
    )

    private fun provider(p: ProviderInfo) = ProviderDto(
        id = p.id,
        name = p.name,
        source = p.source,
        models = p.models.mapValues { (_, m) -> model(m) },
    )

    private fun model(m: ModelInfo) = ModelDto(
        id = m.id,
        name = m.name,
        attachment = m.attachment,
        reasoning = m.reasoning,
        temperature = m.temperature,
        toolCall = m.toolCall,
        free = m.free,
        byok = m.byok,
        status = m.status,
        recommendedIndex = m.recommendedIndex,
        variants = m.variants,
        limit = m.limit?.let { ModelLimitDto(it.context, it.input, it.output) },
        mayTrainOnYourPrompts = m.mayTrainOnYourPrompts,
    )

    private fun agent(a: AgentInfo) = AgentDto(
        name = a.name,
        displayName = a.displayName,
        description = a.description,
        mode = a.mode,
        native = a.native,
        hidden = a.hidden,
        color = a.color,
        deprecated = a.deprecated,
    )
}
