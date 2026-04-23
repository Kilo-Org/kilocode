@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.workspace.AgentData
import ai.kilocode.backend.workspace.AgentInfo
import ai.kilocode.backend.workspace.CommandInfo
import ai.kilocode.backend.workspace.KiloBackendWorkspaceManager
import ai.kilocode.backend.workspace.KiloWorkspaceLoadProgress
import ai.kilocode.backend.workspace.KiloWorkspaceState
import ai.kilocode.backend.workspace.ModelInfo
import ai.kilocode.backend.workspace.ProviderData
import ai.kilocode.backend.workspace.ProviderInfo
import ai.kilocode.backend.workspace.SkillInfo
import ai.kilocode.rpc.KiloWorkspaceRpcApi
import ai.kilocode.rpc.dto.AgentDto
import ai.kilocode.rpc.dto.AgentsDto
import ai.kilocode.rpc.dto.CommandDto
import ai.kilocode.rpc.dto.KiloWorkspaceLoadProgressDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.rpc.dto.ProvidersDto
import ai.kilocode.rpc.dto.SkillDto
import com.intellij.openapi.components.service
import com.intellij.openapi.project.ProjectManager
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * Backend implementation of [KiloWorkspaceRpcApi].
 *
 * Routes through the [KiloBackendWorkspaceManager] to get a workspace
 * for the given directory. No [ProjectManager] dependency — any
 * directory (including worktrees) can get a workspace.
 */
class KiloWorkspaceRpcApiImpl : KiloWorkspaceRpcApi {

    private val app: KiloBackendAppService get() = service()

    private val manager: KiloBackendWorkspaceManager
        get() = app.workspaces

    override suspend fun resolveProjectDirectory(hint: String): String {
        // In monolith mode, find the open project whose basePath matches the hint.
        // In split mode, the backend's project.basePath is the real directory.
        val projects = ProjectManager.getInstance().openProjects
        val match = projects.firstOrNull { !it.isDefault }
        return match?.basePath ?: hint
    }

    /**
     * Emits workspace state for [directory]. Waits for the app to
     * reach [KiloAppState.Ready] before creating the workspace —
     * until then, emits [KiloWorkspaceStatusDto.PENDING].
     *
     * When the app leaves Ready (e.g. during restart/reconnect),
     * the flow falls back to PENDING again and re-subscribes to
     * the new workspace once Ready returns.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    override suspend fun state(directory: String): Flow<KiloWorkspaceStateDto> =
        app.appState.flatMapLatest { state ->
            if (state is KiloAppState.Ready) {
                manager.get(directory).state.map(::dto)
            } else {
                flowOf(KiloWorkspaceStateDto(KiloWorkspaceStatusDto.PENDING))
            }
        }.distinctUntilChanged()

    override suspend fun reload(directory: String) {
        if (app.appState.value !is KiloAppState.Ready) return
        manager.get(directory).reload()
    }

    // ------ mapping: domain model → DTO ------

    private fun dto(state: KiloWorkspaceState): KiloWorkspaceStateDto =
        when (state) {
            KiloWorkspaceState.Pending -> KiloWorkspaceStateDto(KiloWorkspaceStatusDto.PENDING)
            is KiloWorkspaceState.Loading -> KiloWorkspaceStateDto(
                status = KiloWorkspaceStatusDto.LOADING,
                progress = progress(state.progress),
            )
            is KiloWorkspaceState.Ready -> KiloWorkspaceStateDto(
                status = KiloWorkspaceStatusDto.READY,
                providers = providers(state.providers),
                agents = agents(state.agents),
                commands = state.commands.map(::command),
                skills = state.skills.map(::skill),
            )
            is KiloWorkspaceState.Error -> KiloWorkspaceStateDto(
                status = KiloWorkspaceStatusDto.ERROR,
                error = state.message,
            )
        }

    private fun progress(p: KiloWorkspaceLoadProgress) = KiloWorkspaceLoadProgressDto(
        providers = p.providers,
        agents = p.agents,
        commands = p.commands,
        skills = p.skills,
    )

    private fun providers(d: ProviderData) = ProvidersDto(
        providers = d.providers.map(::provider),
        connected = d.connected,
        defaults = d.defaults,
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
        status = m.status,
    )

    private fun agents(d: AgentData) = AgentsDto(
        agents = d.agents.map(::agent),
        all = d.all.map(::agent),
        default = d.default,
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

    private fun command(c: CommandInfo) = CommandDto(
        name = c.name,
        description = c.description,
        source = c.source,
        hints = c.hints,
    )

    private fun skill(s: SkillInfo) = SkillDto(
        name = s.name,
        description = s.description,
        location = s.location,
    )
}
