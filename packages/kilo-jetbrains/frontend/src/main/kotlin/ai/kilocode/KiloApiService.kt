@file:Suppress("UnstableApiUsage")

package ai.kilocode

import ai.kilocode.rpc.KiloProjectRpcApi
import ai.kilocode.rpc.dto.ConnectionStateDto
import ai.kilocode.rpc.dto.ConnectionStatusDto
import ai.kilocode.rpc.dto.HealthDto
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.platform.project.projectId
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
 * Frontend project-level service for Kilo CLI interaction.
 *
 * Communicates with the backend via [KiloProjectRpcApi], passing
 * [project.projectId] on every call so the backend can resolve the
 * correct project-level service without scanning ProjectManager.
 */
@Service(Service.Level.PROJECT)
class KiloApiService(
    private val project: Project,
    private val cs: CoroutineScope,
) {
    companion object {
        private val LOG = Logger.getInstance(KiloApiService::class.java)
        private val init = ConnectionStateDto(ConnectionStatusDto.DISCONNECTED)
    }

    private val started = AtomicBoolean(false)

    /** CLI version string from the last successful health check, or null if unknown. */
    @Volatile
    var version: String? = null
        private set

    val state: StateFlow<ConnectionStateDto> = flow {
        durable {
            KiloProjectRpcApi.getInstance()
                .state(project.projectId())
                .collect { emit(it) }
        }
    }.stateIn(cs, SharingStarted.Eagerly, init)

    fun connect() {
        if (!started.compareAndSet(false, true)) return
        cs.launch {
            durable {
                KiloProjectRpcApi.getInstance().connect(project.projectId())
            }
        }
    }

    /** One-shot health check. Returns null on failure. */
    suspend fun health(): HealthDto? = try {
        durable { KiloProjectRpcApi.getInstance().health(project.projectId()) }
    } catch (e: Exception) {
        LOG.warn("health check failed", e)
        null
    }

    /** Kill the CLI process and restart it. */
    suspend fun restart() {
        LOG.info("restart: resetting state and sending RPC")
        started.set(false)
        version = null
        durable { KiloProjectRpcApi.getInstance().restart(project.projectId()) }
        LOG.info("restart: RPC returned — backend restart complete")
    }

    /** Kill the CLI process, re-extract the binary, and restart. */
    suspend fun reinstall() {
        LOG.info("reinstall: resetting state and sending RPC")
        started.set(false)
        version = null
        durable { KiloProjectRpcApi.getInstance().reinstall(project.projectId()) }
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

    fun watch(fn: (String) -> Unit): Job {
        val mgr = ToolWindowManager.getInstance(project)
        return cs.launch {
            state.collect { next ->
                // Fetch CLI version when we become connected
                if (next.status == ConnectionStatusDto.CONNECTED) fetchVersionAsync()
                mgr.invokeLater {
                    fn(text(next))
                }
            }
        }
    }

    private fun text(state: ConnectionStateDto): String =
        when (state.status) {
            ConnectionStatusDto.DISCONNECTED -> KiloBundle.message("toolwindow.status.disconnected")
            ConnectionStatusDto.CONNECTING -> KiloBundle.message("toolwindow.status.connecting")
            ConnectionStatusDto.CONNECTED -> KiloBundle.message("toolwindow.status.connected")
            ConnectionStatusDto.ERROR -> KiloBundle.message(
                "toolwindow.status.error",
                state.error ?: KiloBundle.message("toolwindow.error.unknown"),
            )
        }
}
