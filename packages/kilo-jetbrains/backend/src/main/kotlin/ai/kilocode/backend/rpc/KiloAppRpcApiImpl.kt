@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.telemetry.KiloBackendTelemetry
import ai.kilocode.backend.app.ConfigWarning
import ai.kilocode.backend.app.LoadError
import ai.kilocode.backend.app.LoadProgress
import ai.kilocode.backend.app.ProfileResult
import ai.kilocode.jetbrains.api.model.AgentConfig
import ai.kilocode.jetbrains.api.model.Config
import ai.kilocode.jetbrains.api.model.ConfigAgent
import ai.kilocode.jetbrains.api.model.KiloProfile200Response
import ai.kilocode.rpc.dto.AgentConfigDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.KiloAppRpcApi
import ai.kilocode.rpc.dto.ConfigWarningDto
import ai.kilocode.rpc.dto.DeviceAuthDto
import ai.kilocode.rpc.dto.HealthDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.LoadErrorDto
import ai.kilocode.rpc.dto.LoadProgressDto
import ai.kilocode.rpc.dto.McpConfigDto
import ai.kilocode.rpc.dto.ModelFavoriteUpdateDto
import ai.kilocode.rpc.dto.ModelSelectionUpdateDto
import ai.kilocode.rpc.dto.ModelStateDto
import ai.kilocode.rpc.dto.ModelVariantUpdateDto
import ai.kilocode.rpc.dto.PermissionConfigDto
import ai.kilocode.rpc.dto.PermissionRuleDto
import ai.kilocode.rpc.dto.ProfileBalanceDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.ProfileOrganizationDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import ai.kilocode.rpc.dto.SkillsConfigDto
import ai.kilocode.rpc.dto.TelemetryCaptureDto
import com.intellij.openapi.components.service
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/**
 * Backend implementation of [KiloAppRpcApi].
 *
 * Delegates directly to the app-level [KiloBackendAppService] —
 * no project resolution needed since all operations are app-scoped.
 */
class KiloAppRpcApiImpl : KiloAppRpcApi {

    private val app: KiloBackendAppService get() = service()

    override suspend fun connect() = app.connect()

    override suspend fun state(): Flow<KiloAppStateDto> =
        app.appState.map(::dto).distinctUntilChanged()

    override suspend fun health(): HealthDto = app.health()

    override suspend fun retry() = app.retry()

    override suspend fun restart() = app.restart()

    override suspend fun reinstall() = app.reinstall()

    override suspend fun modelState(): ModelStateDto {
        app.requireReady()
        return app.models.state()
    }

    override suspend fun updateModelFavorite(update: ModelFavoriteUpdateDto): ModelStateDto {
        app.requireReady()
        return app.models.favorite(update)
    }

    override suspend fun updateModelSelection(update: ModelSelectionUpdateDto): ModelStateDto {
        app.requireReady()
        return app.models.selection(update)
    }

    override suspend fun clearModelSelection(agent: String): ModelStateDto {
        app.requireReady()
        return app.models.clear(agent)
    }

    override suspend fun updateModelVariant(update: ModelVariantUpdateDto): ModelStateDto {
        app.requireReady()
        return app.models.variant(update)
    }

    override suspend fun updateConfig(patch: ConfigPatchDto): KiloAppStateDto {
        app.requireReady()
        return appStateDto(app.updateConfig(patch))
    }

    override suspend fun refreshProfile(): ProfileDto? = app.refreshProfile()?.let(::profileDto)

    override suspend fun startLogin(directory: String?): DeviceAuthDto = app.startLogin(directory)

    override suspend fun completeLogin(directory: String?): ProfileDto? = app.completeLogin(directory)?.let(::profileDto)

    override suspend fun logout(): Boolean = app.logout()

    override suspend fun setOrganization(organizationId: String?): ProfileDto? =
        app.setOrganization(organizationId)?.let(::profileDto)

    override suspend fun captureTelemetry(capture: TelemetryCaptureDto) {
        service<KiloBackendTelemetry>().capture(app.http, app.port, capture.event, capture.properties)
    }

    private fun dto(state: KiloAppState): KiloAppStateDto =
        appStateDto(state)
}

internal fun appStateDto(state: KiloAppState): KiloAppStateDto =
    when (state) {
        KiloAppState.Disconnected -> KiloAppStateDto(KiloAppStatusDto.DISCONNECTED)
        KiloAppState.Connecting -> KiloAppStateDto(KiloAppStatusDto.CONNECTING)
        is KiloAppState.Loading -> KiloAppStateDto(
            status = KiloAppStatusDto.LOADING,
            progress = progress(state.progress),
        )
        is KiloAppState.MigrationRequired -> KiloAppStateDto(
            status = KiloAppStatusDto.MIGRATION_REQUIRED,
            migration = MigrationRpcMapper.toDto(state.detection),
        )
        is KiloAppState.Ready -> KiloAppStateDto(
            status = KiloAppStatusDto.READY,
            progress = LoadProgressDto(
                config = true,
                notifications = true,
                profile = if (state.data.profile != null) ProfileStatusDto.LOADED
                    else ProfileStatusDto.NOT_LOGGED_IN,
            ),
            warnings = state.data.warnings.map(::warning),
            config = config(state.data.config),
            profile = state.data.profile?.let(::profileDto),
        )
        is KiloAppState.Error -> KiloAppStateDto(
            status = KiloAppStatusDto.ERROR,
            error = state.message,
            errors = state.errors.map(::error),
        )
    }

internal fun profileDto(p: KiloProfile200Response): ProfileDto = ProfileDto(
    email = p.profile.email,
    name = p.profile.name,
    organizations = p.profile.organizations.orEmpty().map { org ->
        ProfileOrganizationDto(id = org.id, name = org.name, role = org.role)
    },
    balance = p.balance?.let { ProfileBalanceDto(balance = it.balance) },
    currentOrgId = p.currentOrgId,
)

private fun progress(p: LoadProgress) = LoadProgressDto(
    config = p.config,
    notifications = p.notifications,
    profile = when (p.profile) {
        ProfileResult.PENDING -> ProfileStatusDto.PENDING
        ProfileResult.LOADED -> ProfileStatusDto.LOADED
        ProfileResult.NOT_LOGGED_IN -> ProfileStatusDto.NOT_LOGGED_IN
    },
)

private fun error(e: LoadError) = LoadErrorDto(
    resource = e.resource,
    status = e.status,
    detail = e.detail,
)

private fun warning(w: ConfigWarning) = ConfigWarningDto(
    path = w.path,
    message = w.message,
    detail = w.detail,
)

private fun config(c: Config) = ConfigDto(
    model = c.model,
    smallModel = c.smallModel,
    subagentModel = c.subagentModel,
    subagentVariant = c.subagentVariant,
    defaultAgent = c.defaultAgent,
    instructions = c.instructions.orEmpty(),
    skills = skills(c.skills),
    mcp = mcp(c.mcp),
    agent = agents(c.agent),
)

private fun agents(cfg: ConfigAgent?): Map<String, AgentConfigDto> {
    if (cfg == null) return emptyMap()
    val known = listOf(
        "plan" to cfg.plan,
        "build" to cfg.build,
        "debug" to cfg.debug,
        "orchestrator" to cfg.orchestrator,
        "ask" to cfg.ask,
        "general" to cfg.general,
        "explore" to cfg.explore,
        "title" to cfg.title,
        "summary" to cfg.summary,
        "compaction" to cfg.compaction,
    ).mapNotNull { (name, item) -> item?.let { name to agent(it) } }.toMap()
    val extra = cfg.entries.associate { (name, item) -> name to agent(item) }
    return known + extra
}

private fun agent(cfg: AgentConfig) = AgentConfigDto(
    model = cfg.model,
    variant = cfg.variant,
    prompt = cfg.prompt,
    description = cfg.description,
    mode = cfg.mode?.value,
    hidden = cfg.hidden,
    disable = cfg.disable,
    temperature = cfg.temperature,
    top_p = cfg.topP,
    steps = cfg.steps,
    permission = permission(cfg.permission),
)

private fun skills(cfg: Any?): SkillsConfigDto? {
    if (cfg == null) return null
    return SkillsConfigDto(
        paths = stringList(prop(cfg, "paths")),
        urls = stringList(prop(cfg, "urls")),
    )
}

private fun mcp(cfg: Any?): Map<String, McpConfigDto> {
    val map = cfg as? Map<*, *> ?: return emptyMap()
    return map.mapNotNull { (name, item) ->
        if (name !is String || item == null) return@mapNotNull null
        name to McpConfigDto(
            type = prop(item, "type") as? String,
            command = stringList(prop(item, "command")).takeIf { it.isNotEmpty() },
            url = prop(item, "url") as? String,
            environment = stringMap(prop(item, "environment")).takeIf { it.isNotEmpty() },
        )
    }.toMap()
}

private fun permission(cfg: Any?): PermissionConfigDto? {
    val map = cfg as? Map<*, *> ?: return null
    return map.mapNotNull { (tool, rule) ->
        if (tool !is String) return@mapNotNull null
        val value = when (rule) {
            null -> PermissionRuleDto.Level(null)
            is String -> PermissionRuleDto.Level(rule)
            is Map<*, *> -> PermissionRuleDto.Patterns(rule.mapNotNull { (pattern, level) ->
                if (pattern !is String) return@mapNotNull null
                pattern to (level as? String)
            }.toMap())
            else -> null
        }
        value?.let { tool to it }
    }.toMap().takeIf { it.isNotEmpty() }
}

private fun prop(obj: Any, name: String): Any? {
    val suffix = name.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
    val getter = obj.javaClass.methods.firstOrNull { it.parameterCount == 0 && it.name == "get$suffix" }
        ?: obj.javaClass.methods.firstOrNull { it.parameterCount == 0 && it.name == name }
    return getter?.invoke(obj)
}

private fun stringList(value: Any?): List<String> = (value as? List<*>)?.filterIsInstance<String>().orEmpty()

private fun stringMap(value: Any?): Map<String, String> = (value as? Map<*, *>)
    ?.mapNotNull { (key, item) -> if (key is String && item is String) key to item else null }
    ?.toMap()
    .orEmpty()
