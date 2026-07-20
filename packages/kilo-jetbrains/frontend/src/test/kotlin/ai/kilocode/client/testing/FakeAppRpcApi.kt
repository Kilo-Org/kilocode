package ai.kilocode.client.testing

import ai.kilocode.rpc.KiloAppRpcApi
import ai.kilocode.rpc.dto.AgentConfigDto
import ai.kilocode.rpc.dto.CompactionConfigDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.DeviceAuthDto
import ai.kilocode.rpc.dto.HealthDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ModelFavoriteUpdateDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ModelSelectionUpdateDto
import ai.kilocode.rpc.dto.ModelStateDto
import ai.kilocode.rpc.dto.ModelVariantUpdateDto
import ai.kilocode.rpc.dto.PermissionConfigDto
import ai.kilocode.rpc.dto.PermissionRuleDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.SkillsConfigDto
import ai.kilocode.rpc.dto.TelemetryCaptureDto
import ai.kilocode.rpc.dto.WatcherConfigDto
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Fake [KiloAppRpcApi] for testing.
 *
 * Push state changes via [state]. Health check returns [health].
 *
 * Every `suspend` method asserts it is NOT called on the EDT.
 */
class FakeAppRpcApi : KiloAppRpcApi {

    val state = MutableStateFlow(KiloAppStateDto(KiloAppStatusDto.DISCONNECTED))
    var health = HealthDto(healthy = true, version = "1.0.0")
    var cliVersion = "1.0.0"
    var cliPlatform = "darwin-arm64"
    var cliInfoGate: CompletableDeferred<Unit>? = null
    var cliInfoError: Exception? = null
    var cliVersionCalls = 0
        private set
    var cliPlatformCalls = 0
        private set
    var models = ModelStateDto()
    val selections = mutableListOf<ModelSelectionUpdateDto>()
    val cleared = mutableListOf<String>()
    val variants = mutableListOf<ModelVariantUpdateDto>()
    val configPatches = mutableListOf<ConfigPatchDto>()
    var configUpdateAttempts = 0
        private set
    var configUpdateGate: CompletableDeferred<Unit>? = null
    var configUpdateError: Exception? = null
    var configUpdateReturnStale = false
    var afterConfig: (suspend (ConfigPatchDto) -> Unit)? = null

    var connected = false
        private set
    var retries = 0
        private set
    var restarts = 0
        private set
    var reinstalls = 0
        private set

    override suspend fun connect() {
        assertNotEdt("connect")
        connected = true
    }

    override suspend fun state(): Flow<KiloAppStateDto> {
        assertNotEdt("state")
        return state
    }

    override suspend fun health(): HealthDto {
        assertNotEdt("health")
        return health
    }

    override suspend fun cliVersion(): String {
        assertNotEdt("cliVersion")
        cliVersionCalls += 1
        cliInfoGate?.await()
        cliInfoError?.let { throw it }
        return cliVersion
    }

    override suspend fun cliPlatform(): String {
        assertNotEdt("cliPlatform")
        cliPlatformCalls += 1
        cliInfoError?.let { throw it }
        return cliPlatform
    }

    override suspend fun retry() {
        assertNotEdt("retry")
        retries += 1
    }

    override suspend fun restart() {
        assertNotEdt("restart")
        restarts += 1
    }

    override suspend fun reinstall() {
        assertNotEdt("reinstall")
        reinstalls += 1
    }

    override suspend fun modelState(): ModelStateDto {
        assertNotEdt("modelState")
        return models
    }

    override suspend fun updateModelFavorite(update: ModelFavoriteUpdateDto): ModelStateDto {
        assertNotEdt("updateModelFavorite")
        val key = update.providerID to update.modelID
        val next = when (update.action) {
            "add" -> if (models.favorite.any { it.providerID to it.modelID == key }) {
                models.favorite
            } else {
                listOf(ModelSelectionDto(update.providerID, update.modelID)) + models.favorite
            }
            "remove" -> models.favorite.filterNot { it.providerID to it.modelID == key }
            else -> models.favorite
        }
        models = models.copy(favorite = next)
        return models
    }

    override suspend fun updateModelSelection(update: ModelSelectionUpdateDto): ModelStateDto {
        assertNotEdt("updateModelSelection")
        selections.add(update)
        models = models.copy(model = models.model + (update.agent to ModelSelectionDto(update.providerID, update.modelID)))
        return models
    }

    override suspend fun clearModelSelection(agent: String): ModelStateDto {
        assertNotEdt("clearModelSelection")
        cleared.add(agent)
        models = models.copy(model = models.model - agent)
        return models
    }

    override suspend fun updateModelVariant(update: ModelVariantUpdateDto): ModelStateDto {
        assertNotEdt("updateModelVariant")
        variants.add(update)
        models = models.copy(variant = models.variant + (update.key to update.value))
        return models
    }

    override suspend fun updateConfig(patch: ConfigPatchDto): KiloAppStateDto {
        assertNotEdt("updateConfig")
        configUpdateAttempts += 1
        configUpdateGate?.await()
        configUpdateError?.let { throw it }
        configPatches.add(patch)
        afterConfig?.invoke(patch)
        val current = state.value
        val next = current.copy(config = applyPatch(current.config ?: ConfigDto(), patch))
        state.value = next
        if (configUpdateReturnStale) return current
        return next
    }

    private fun applyPatch(config: ConfigDto, patch: ConfigPatchDto): ConfigDto {
        val values = patch.values
        val agents = patch.agents.entries.fold(config.agent) { acc, (name, item) ->
            val cfg = acc[name] ?: AgentConfigDto()
            val cleared = item.clear.fold(cfg) { next, field ->
                when (field) {
                    "model" -> next.copy(model = null)
                    "variant" -> next.copy(variant = null)
                    "prompt" -> next.copy(prompt = null)
                    "description" -> next.copy(description = null)
                    "mode" -> next.copy(mode = null)
                    "temperature" -> next.copy(temperature = null)
                    "top_p" -> next.copy(top_p = null)
                    "steps" -> next.copy(steps = null)
                    "permission" -> next.copy(permission = null)
                    else -> next
                }
            }
            acc + (name to cleared.copy(
                model = item.model ?: cleared.model,
                variant = item.variant ?: cleared.variant,
                prompt = item.prompt ?: cleared.prompt,
                description = item.description ?: cleared.description,
                mode = item.mode ?: cleared.mode,
                hidden = item.hidden ?: cleared.hidden,
                disable = item.disable ?: cleared.disable,
                temperature = item.temperature ?: cleared.temperature,
                top_p = item.top_p ?: cleared.top_p,
                steps = item.steps ?: cleared.steps,
                permission = item.permission ?: cleared.permission,
            ))
        }
        val mcp = patch.mcp?.entries?.fold(config.mcp) { acc, (name, item) ->
            if (item == null) acc - name else acc + (name to item)
        } ?: config.mcp
        val watcher = patch.watcher?.let { item ->
            val cfg = config.watcher
            cfg?.copy(ignore = item.ignore ?: cfg.ignore)
                ?: WatcherConfigDto(ignore = item.ignore ?: emptyList())
        } ?: config.watcher
        val compaction = patch.compaction?.let { item ->
            val cfg = item.clear.fold(config.compaction ?: CompactionConfigDto()) { next, field ->
                when (field) {
                    "threshold_percent" -> next.copy(threshold_percent = null)
                    "auto" -> next.copy(auto = null)
                    "prune" -> next.copy(prune = null)
                    else -> next
                }
            }
            cfg.copy(
                auto = item.auto ?: cfg.auto,
                threshold_percent = item.threshold_percent ?: cfg.threshold_percent,
                prune = item.prune ?: cfg.prune,
            )
        } ?: config.compaction
        return config.copy(
            defaultAgent = if (values.containsKey("default_agent")) values["default_agent"] else config.defaultAgent,
            model = if (values.containsKey("model")) values["model"] else config.model,
            smallModel = if (values.containsKey("small_model")) values["small_model"] else config.smallModel,
            subagentModel = if (values.containsKey("subagent_model")) values["subagent_model"] else config.subagentModel,
            subagentVariant = if (values.containsKey("subagent_variant")) values["subagent_variant"] else config.subagentVariant,
            watcher = watcher,
            compaction = compaction,
            instructions = patch.instructions ?: config.instructions,
            skills = patch.skills?.let { SkillsConfigDto(paths = it.paths.orEmpty(), urls = it.urls.orEmpty()) } ?: config.skills,
            mcp = mcp,
            agent = agents,
            permission = mergePermission(config.permission, patch.permission),
        )
    }

    /** Mirrors the CLI's PATCH deep-merge for `config.permission`: `null` deletes a tool/pattern. */
    private fun mergePermission(base: PermissionConfigDto?, patch: PermissionConfigDto?): PermissionConfigDto? {
        if (patch == null) return base
        val result = (base ?: emptyMap()).toMutableMap()
        for ((tool, rule) in patch) {
            when (rule) {
                is PermissionRuleDto.Level -> {
                    if (rule.value == null) result.remove(tool) else result[tool] = rule
                }
                is PermissionRuleDto.Patterns -> {
                    val merged = ((result[tool] as? PermissionRuleDto.Patterns)?.map ?: emptyMap()).toMutableMap()
                    for ((pattern, level) in rule.map) {
                        if (level == null) merged.remove(pattern) else merged[pattern] = level
                    }
                    if (merged.isEmpty()) result.remove(tool) else result[tool] = PermissionRuleDto.Patterns(merged)
                }
            }
        }
        return result.takeIf { it.isNotEmpty() }
    }

    var fakeProfile: ProfileDto? = null
    var fakeDeviceAuth = DeviceAuthDto(code = "TEST-1234", verificationUrl = "https://auth.kilo.ai/device")
    val orgProfiles = mutableMapOf<String?, ProfileDto?>()
    val orgSelections = mutableListOf<String?>()
    val telemetry = mutableListOf<TelemetryCaptureDto>()

    /** When set, [completeLogin] will await this deferred before returning. */
    var completeGate: CompletableDeferred<Unit>? = null

    /** When set, [completeLogin] will throw this exception (after awaiting [completeGate] if set). */
    var completeError: Exception? = null

    /** When set, [startLogin] will throw this exception. */
    var startError: Exception? = null

    /** When set, [logout] will throw this exception instead of returning [logoutResult]. */
    var logoutError: Exception? = null

    /** Result returned by [logout] when [logoutError] is null. */
    var logoutResult = true

    /** When set, [refreshProfile] will throw this exception. */
    var refreshError: Exception? = null

    /** When set, [setOrganization] will throw this exception. */
    var organizationError: Exception? = null

    /** Directories passed to [startLogin] in order. */
    val startDirectories = mutableListOf<String?>()

    /** Directories passed to [completeLogin] in order. */
    val completeDirectories = mutableListOf<String?>()

    var starts = 0
        private set
    var completes = 0
        private set

    override suspend fun refreshProfile(): ProfileDto? {
        assertNotEdt("refreshProfile")
        refreshError?.let { throw it }
        return fakeProfile
    }

    override suspend fun startLogin(directory: String?): DeviceAuthDto {
        assertNotEdt("startLogin")
        starts++
        startDirectories.add(directory)
        startError?.let { throw it }
        return fakeDeviceAuth
    }

    override suspend fun completeLogin(directory: String?): ProfileDto? {
        assertNotEdt("completeLogin")
        completes++
        completeDirectories.add(directory)
        completeGate?.await()
        completeError?.let { throw it }
        return fakeProfile
    }

    override suspend fun logout(): Boolean {
        assertNotEdt("logout")
        logoutError?.let { throw it }
        if (logoutResult) fakeProfile = null
        return logoutResult
    }

    override suspend fun setOrganization(organizationId: String?): ProfileDto? {
        assertNotEdt("setOrganization")
        organizationError?.let { throw it }
        orgSelections.add(organizationId)
        if (orgProfiles.containsKey(organizationId)) fakeProfile = orgProfiles[organizationId]
        return fakeProfile
    }

    override suspend fun captureTelemetry(capture: TelemetryCaptureDto) {
        assertNotEdt("captureTelemetry")
        telemetry.add(capture)
    }
}
