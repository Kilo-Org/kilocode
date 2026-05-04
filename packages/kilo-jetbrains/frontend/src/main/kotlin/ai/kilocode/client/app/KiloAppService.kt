@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import ai.kilocode.rpc.KiloAppRpcApi
import ai.kilocode.rpc.dto.HealthDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.openapi.components.Service
import ai.kilocode.log.KiloLog
import fleet.rpc.client.durable
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * App-level frontend service for Kilo CLI interaction.
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

    /** CLI version string from the last successful health check, or null if unknown. */
    @Volatile
    var version: String? = null
        private set

    internal val _state = MutableStateFlow(init)
    val state: StateFlow<KiloAppStateDto> = _state.asStateFlow()

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
            if (api != null) api.state().collect { _state.value = it }
            else durable { KiloAppRpcApi.getInstance().state().collect { _state.value = it } }
        }
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

    /** Kill the CLI process and restart it. */
    suspend fun restart() {
        LOG.info("restart: resetting state and sending RPC")
        started.set(false)
        version = null
        call { restart() }
        LOG.info("restart: RPC returned — backend restart complete")
    }

    /** Kill the CLI process, re-extract the binary, and restart. */
    suspend fun reinstall() {
        LOG.info("reinstall: resetting state and sending RPC")
        started.set(false)
        version = null
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

    /** Fetch the CLI version and cache it. Call once after connection is established. */
    fun fetchVersionAsync() {
        cs.launch {
            LOG.info("fetchVersion: requesting health check")
            val dto = health()
            if (dto == null) {
                LOG.warn("fetchVersion: health check returned null — version not available")
                return@launch
            }
            version = dto.version
            LOG.info("fetchVersion: CLI version is ${dto.version}")
        }
    }

    /**
     * Collect app state changes and invoke [fn] for each update.
     */
    fun watch(fn: (KiloAppStateDto) -> Unit): Job {
        return cs.launch {
            state.collect { next ->
                if (next.status == KiloAppStatusDto.READY) fetchVersionAsync()
                fn(next)
            }
        }
    }
}
