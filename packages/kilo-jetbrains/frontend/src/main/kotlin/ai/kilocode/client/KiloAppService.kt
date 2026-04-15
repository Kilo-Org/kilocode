@file:Suppress("UnstableApiUsage")

package ai.kilocode.client

import ai.kilocode.rpc.KiloAppRpcApi
import ai.kilocode.rpc.dto.HealthDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import fleet.rpc.client.durable
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * App-level frontend service for Kilo CLI interaction.
 *
 * Communicates with the backend via [KiloAppRpcApi]. All operations
 * are app-scoped — no project context is needed.
 *
 * Callers of [watch] are responsible for scheduling UI updates on
 * the EDT and converting [KiloAppStateDto] to display text.
 */
@Service(Service.Level.APP)
class KiloAppService(private val cs: CoroutineScope) {
    companion object {
        private val LOG = Logger.getInstance(KiloAppService::class.java)
        private val init = KiloAppStateDto(KiloAppStatusDto.DISCONNECTED)
    }

    private val started = AtomicBoolean(false)

    /** CLI version string from the last successful health check, or null if unknown. */
    @Volatile
    var version: String? = null
        private set

    val state: StateFlow<KiloAppStateDto> = flow {
        durable {
            KiloAppRpcApi.getInstance()
                .state()
                .collect { emit(it) }
        }
    }.stateIn(cs, SharingStarted.Eagerly, init)

    fun connect() {
        if (!started.compareAndSet(false, true)) return
        cs.launch {
            durable {
                KiloAppRpcApi.getInstance().connect()
            }
        }
    }

    /** One-shot health check. Returns null on failure. */
    suspend fun health(): HealthDto? = try {
        durable { KiloAppRpcApi.getInstance().health() }
    } catch (e: Exception) {
        LOG.warn("health check failed", e)
        null
    }

    /** Kill the CLI process and restart it. */
    suspend fun restart() {
        LOG.info("restart: resetting state and sending RPC")
        started.set(false)
        version = null
        durable { KiloAppRpcApi.getInstance().restart() }
        LOG.info("restart: RPC returned — backend restart complete")
    }

    /** Kill the CLI process, re-extract the binary, and restart. */
    suspend fun reinstall() {
        LOG.info("reinstall: resetting state and sending RPC")
        started.set(false)
        version = null
        durable { KiloAppRpcApi.getInstance().reinstall() }
        LOG.info("reinstall: RPC returned — backend reinstall complete")
    }

    /** Fire-and-forget restart from non-suspend context (e.g. action handlers). */
    fun restartAsync() {
        LOG.info("restartAsync: launching restart")
        cs.launch { restart() }
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
     *
     * The callback receives raw [KiloAppStateDto] — the caller is
     * responsible for converting to display text and scheduling on the EDT.
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
