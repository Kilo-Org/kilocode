@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import ai.kilocode.rpc.KiloAppRpcApi
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
import ai.kilocode.rpc.dto.ProfileStatusDto
import ai.kilocode.log.KiloLog
import com.intellij.openapi.components.Service
import fleet.rpc.client.durable
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * App-level frontend service for Kilo Core interaction.
 *
 * Communicates with the backend via [KiloAppRpcApi]. All operations
 * are app-scoped — no project context is needed.
 */
@Service(Service.Level.APP)
class KiloAppService internal constructor(
    private val cs: CoroutineScope,
    private val rpc: KiloAppRpcApi?,
) {
    /** Platform constructor — resolves RPC from the service container. */
    constructor(cs: CoroutineScope) : this(cs, null)

    companion object {
        private val LOG = KiloLog.create(KiloAppService::class.java)
        private val init = KiloAppStateDto(KiloAppStatusDto.DISCONNECTED)
    }

    private val started = AtomicBoolean(false)

    /** Core version and platform from the backend, or null if unknown. */
    @Volatile
    private var info: CoreInfo? = null
    private val coreLock = Any()
    private val coreDone = mutableListOf<(CoreInfo?) -> Unit>()
    private var coreJob: Job? = null

    val core: CoreInfo? get() = info

    val version: String? get() = info?.version

    internal val _state = MutableStateFlow(init)
    val state: StateFlow<KiloAppStateDto> = _state.asStateFlow()
    private val _models = MutableStateFlow(ModelStateDto())
    val models: StateFlow<ModelStateDto> = _models.asStateFlow()
    private val _favorites = MutableStateFlow<List<ModelSelectionDto>>(emptyList())
    val favorites: StateFlow<List<ModelSelectionDto>> = _favorites.asStateFlow()

    // ------ RPC helper ------

    private suspend fun <T> call(block: suspend KiloAppRpcApi.() -> T): T {
        val api = rpc
        return if (api != null) block(api) else durable { block(KiloAppRpcApi.getInstance()) }
    }

    // ------ Lifecycle ------

    fun connect() {
        if (!started.compareAndSet(false, true)) return
        cs.launch { call { connect() } }
        cs.launch {
            val api = rpc
            if (api != null) api.state().collect { onState(it) }
            else durable { KiloAppRpcApi.getInstance().state().collect { onState(it) } }
        }
    }

    private fun onState(state: KiloAppStateDto) {
        val version = state.downloadVersion
        val platform = state.downloadPlatform
        if (version != null && platform != null) info = CoreInfo(version, platform)
        _state.value = state
        if (state.status == KiloAppStatusDto.READY) refreshModelFavoritesAsync()
    }

    /** One-shot health check. Returns null on failure. */
    suspend fun health(): HealthDto? = try {
        call { health() }
    } catch (e: Exception) {
        LOG.warn("health check failed", e)
        null
    }

    suspend fun retry() {
        LOG.info("retry: sending RPC")
        call { retry() }
    }

    /** Kill the Core process and restart it. */
    suspend fun restart() {
        LOG.info("restart: resetting state and sending RPC")
        started.set(false)
        info = null
        call { restart() }
        LOG.info("restart: RPC returned — backend restart complete")
    }

    /** Kill the Core process, re-download the binary, and restart. */
    suspend fun reinstall() {
        LOG.info("reinstall: resetting state and sending RPC")
        started.set(false)
        info = null
        call { reinstall() }
        LOG.info("reinstall: RPC returned — backend reinstall complete")
    }

    /** Fire-and-forget restart from non-suspend context (e.g. action handlers). */
    fun restartAsync() {
        LOG.info("restartAsync: launching restart")
        cs.launch { restart() }
    }

    fun retryAsync() {
        LOG.info("retryAsync: launching retry")
        cs.launch { retry() }
    }

    /** Fire-and-forget reinstall from non-suspend context (e.g. action handlers). */
    fun reinstallAsync() {
        LOG.info("reinstallAsync: launching reinstall")
        cs.launch { reinstall() }
    }

    suspend fun coreInfo(): CoreInfo? = try {
        val next = CoreInfo(
            version = call { cliVersion() },
            platform = call { cliPlatform() },
        )
        info = next
        next
    } catch (e: Exception) {
        LOG.warn("core info failed", e)
        null
    }

    /** Fetch the pinned Core version and platform and cache it. */
    fun fetchCoreInfoAsync(done: (CoreInfo?) -> Unit = {}) {
        val cached = info
        if (cached != null) {
            done(cached)
            return
        }

        synchronized(coreLock) {
            val current = info
            if (current != null) {
                done(current)
                return
            }
            coreDone.add(done)
            if (coreJob != null) return
            coreJob = cs.launch {
                fetchCoreInfo()
            }
        }
    }

    private suspend fun fetchCoreInfo() {
        LOG.info("fetchCoreInfo: requesting Core version and platform")
        val next = coreInfo()
        val list = synchronized(coreLock) {
            val items = coreDone.toList()
            coreDone.clear()
            coreJob = null
            items
        }
        list.forEach { it(next) }
        if (next != null) {
            LOG.info("fetchCoreInfo: Core version is ${next.version} (${next.platform})")
        }
    }

    /** Fetch the pinned Core version and cache it. */
    fun fetchVersionAsync(done: (String?) -> Unit = {}) {
        fetchCoreInfoAsync { done(it?.version) }
    }

    fun refreshModelFavoritesAsync() {
        cs.launch {
            try {
                setModelState(call { modelState() })
            } catch (e: Exception) {
                LOG.warn("model favorites refresh failed", e)
            }
        }
    }

    fun toggleModelFavorite(providerID: String, modelID: String) {
        val key = providerID to modelID
        val prev = _favorites.value
        val exists = prev.any { it.providerID to it.modelID == key }
        val action = if (exists) "remove" else "add"
        val next = if (exists) {
            _models.value.copy(favorite = prev.filterNot { it.providerID to it.modelID == key })
        } else {
            _models.value.copy(favorite = listOf(ModelSelectionDto(providerID, modelID)) + prev)
        }
        setModelState(next)
        cs.launch {
            try {
                setModelState(call { updateModelFavorite(ModelFavoriteUpdateDto(action, providerID, modelID)) })
            } catch (e: Exception) {
                LOG.warn("model favorite update failed", e)
                setModelState(_models.value.copy(favorite = prev))
            }
        }
    }

    fun selectModel(agent: String, providerID: String, modelID: String) {
        val prev = _models.value
        setModelState(prev.copy(model = prev.model + (agent to ModelSelectionDto(providerID, modelID))))
        cs.launch {
            try {
                setModelState(call { updateModelSelection(ModelSelectionUpdateDto(agent, providerID, modelID)) })
            } catch (e: Exception) {
                LOG.warn("model selection update failed", e)
                setModelState(prev)
            }
        }
    }

    fun clearModel(agent: String) {
        val prev = _models.value
        setModelState(prev.copy(model = prev.model - agent))
        cs.launch {
            try {
                setModelState(call { clearModelSelection(agent) })
            } catch (e: Exception) {
                LOG.warn("model selection clear failed", e)
                setModelState(prev)
            }
        }
    }

    fun selectVariant(key: String, value: String) {
        val prev = _models.value
        setModelState(prev.copy(variant = prev.variant + (key to value)))
        cs.launch {
            try {
                setModelState(call { updateModelVariant(ModelVariantUpdateDto(key, value)) })
            } catch (e: Exception) {
                LOG.warn("model variant update failed", e)
                setModelState(prev)
            }
        }
    }

    suspend fun updateConfig(patch: ConfigPatchDto): KiloAppStateDto? = try {
        LOG.info("config update: sending RPC ${summary(patch)}")
        val next = call { updateConfig(patch) }
        _state.value = next
        LOG.info("config update: RPC completed ${summary(patch)}")
        next
    } catch (e: Exception) {
        LOG.warn("config update failed ${summary(patch)}", e)
        null
    }

    fun updateConfigAsync(
        patch: ConfigPatchDto,
        done: (KiloAppStateDto?) -> Unit,
    ): Job = cs.launch {
        val state = updateConfig(patch)
        done(state)
    }

    private fun setModelState(state: ModelStateDto) {
        _models.value = state
        _favorites.value = state.favorite
    }

    /** Refresh the user profile and return the latest data. Null = not logged in. */
    suspend fun refreshProfile(): ProfileDto? = try {
        call { refreshProfile() }.also { setProfile(it) }
    } catch (e: Exception) {
        LOG.warn("profile refresh failed", e)
        null
    }

    /** Refresh profile in fire-and-forget fashion from non-suspend context. */
    fun refreshProfileAsync() {
        cs.launch { refreshProfile() }
    }

    /**
     * Start the Kilo device auth login flow.
     * Returns [DeviceAuthDto] with the URL/code to display.
     * Throws on failure.
     */
    suspend fun startLogin(directory: String? = null): DeviceAuthDto = call { startLogin(directory) }

    /**
     * Complete the login flow. Blocks until authentication finishes.
     * Returns the user profile, or null if unavailable.
     */
    suspend fun completeLogin(directory: String? = null): ProfileDto? = try {
        call { completeLogin(directory) }.also { setProfile(it) }
    } catch (e: Exception) {
        LOG.warn("login completion failed", e)
        null
    }

    /** Log out and clear the user profile. */
    suspend fun logout(): Boolean = try {
        call { logout() }.also { ok ->
            if (ok) setProfile(null)
        }
    } catch (e: Exception) {
        LOG.warn("logout failed", e)
        false
    }

    /**
     * Switch active account context.
     * Pass null for personal account, organization ID for org context.
     * Returns the updated profile, or null if not logged in.
     */
    suspend fun setOrganization(organizationId: String?): ProfileDto? = try {
        call { setOrganization(organizationId) }.also { setProfile(it) }
    } catch (e: Exception) {
        LOG.warn("organization switch failed", e)
        null
    }

    /**
     * Collect app state changes and invoke [fn] for each update.
     */
    fun watch(fn: (KiloAppStateDto) -> Unit): Job {
        return cs.launch {
            state.collect { next ->
                if (next.status == KiloAppStatusDto.READY) fetchCoreInfoAsync()
                fn(next)
            }
        }
    }

    private fun setProfile(profile: ProfileDto?) {
        val current = _state.value
        val progress = current.progress?.copy(
            profile = if (profile == null) ProfileStatusDto.NOT_LOGGED_IN else ProfileStatusDto.LOADED,
        )
        _state.value = current.copy(profile = profile, progress = progress)
    }
}

data class CoreInfo(val version: String, val platform: String)

private fun summary(patch: ConfigPatchDto): String {
    val values = patch.values.keys.sorted().joinToString(",").ifEmpty { "none" }
    return "values=$values agents=${patch.agents.size}"
}
