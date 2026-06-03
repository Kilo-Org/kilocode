package ai.kilocode.client.testing

import ai.kilocode.rpc.KiloAppRpcApi
import ai.kilocode.rpc.dto.AgentConfigDto
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
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.TelemetryCaptureDto
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
    var models = ModelStateDto()
    val selections = mutableListOf<ModelSelectionUpdateDto>()
    val cleared = mutableListOf<String>()
    val variants = mutableListOf<ModelVariantUpdateDto>()
    val configPatches = mutableListOf<ConfigPatchDto>()
    var configUpdateAttempts = 0
        private set
    var configUpdateGate: CompletableDeferred<Unit>? = null
    var configUpdateError: Exception? = null

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
        val current = state.value
        val next = current.copy(config = applyPatch(current.config ?: ConfigDto(), patch))
        state.value = next
        return next
    }

    private fun applyPatch(config: ConfigDto, patch: ConfigPatchDto): ConfigDto {
        val values = patch.values
        val agents = patch.agents.entries.fold(config.agent) { acc, (name, item) ->
            acc + (name to (acc[name] ?: AgentConfigDto()).copy(model = item.model))
        }
        return config.copy(
            model = if (values.containsKey("model")) values["model"] else config.model,
            smallModel = if (values.containsKey("small_model")) values["small_model"] else config.smallModel,
            subagentModel = if (values.containsKey("subagent_model")) values["subagent_model"] else config.subagentModel,
            subagentVariant = if (values.containsKey("subagent_variant")) values["subagent_variant"] else config.subagentVariant,
            agent = agents,
        )
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
