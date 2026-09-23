package ai.kilocode.backend.app

import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.jetbrains.api.client.DefaultApi
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.SandboxStatusDto
import ai.kilocode.rpc.dto.SandboxSupportDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.nio.file.Path

/**
 * Sandbox confinement gateway: backend-host support probing, per-session status/toggle
 * reconciliation, and the global `sandbox.status.changed` SSE stream.
 *
 * **Not an IntelliJ service** — owned by [KiloBackendAppService], which calls [start] after
 * [KiloAppState.Ready] and [stop] on disconnect. The API client is guaranteed non-null between
 * start/stop — no defensive null checks in the request methods.
 *
 * All state here is connection-scoped: [stop] clears everything, so a reconnect or CLI restart
 * starts from an unknown state instead of replaying a stale cache. Directory identity is the
 * caller's responsibility — every method takes an explicit backend-host directory, matching the
 * CLI server's directory-based routing. Capability must always reflect the connected backend host,
 * which matters in Remote Development split mode where the frontend and backend can run on
 * different OSes.
 */
class KiloBackendSandboxManager(
    private val cs: CoroutineScope,
    private val log: KiloLog,
) {
    // Field, not created in start(), so frontend subscribers survive a disconnect/reconnect.
    private val _statusChanges = MutableSharedFlow<SandboxStatusDto>(extraBufferCapacity = 64)
    val statusChanges: SharedFlow<SandboxStatusDto> = _statusChanges.asSharedFlow()

    private var client: DefaultApi? = null
    private var watcher: Job? = null

    fun start(api: DefaultApi, events: SharedFlow<SseEvent>) {
        client = api
        if (watcher?.isActive == true) return
        watcher = cs.launch {
            events.collect { event ->
                if (event.type != "sandbox.status.changed") return@collect
                val status = KiloCliDataParser.parseSandboxStatusChanged(event.data) ?: return@collect
                log.debug {
                    "${ChatLogSummary.sid(status.sessionID)} evt=sandbox.status.changed " +
                        "enabled=${status.enabled} available=${status.available} version=${status.version}"
                }
                _statusChanges.emit(status)
            }
        }
        log.info("Sandbox manager started")
    }

    fun stop() {
        watcher?.cancel()
        watcher = null
        client = null
        log.info("Sandbox manager stopped")
    }

    private fun requireClient(): DefaultApi = client ?: throw IllegalStateException("Sandbox manager not started")

    suspend fun support(directory: String): SandboxSupportDto = withContext(Dispatchers.IO) {
        val response = requireClient().sandboxSupport(directory = directory)
        SandboxSupportDto(available = response.available, reason = response.reason)
    }

    suspend fun status(sessionID: String, directory: String): SandboxStatusDto = withContext(Dispatchers.IO) {
        val response = requireClient().sandboxStatus(sessionID = sessionID, directory = directory)
        require(sameDirectory(directory, response.directory)) {
            "Sandbox status returned a different directory: requested=$directory returned=${response.directory}"
        }
        toDto(sessionID, response.directory, response.enabled, response.available, response.reason, response.version)
    }

    /**
     * Reconcile [sessionID]'s sandbox state to [enabled].
     *
     * The CLI's toggle endpoint only flips state (it takes no target), so this reads current
     * status first and only POSTs when the effective state actually needs to change, then re-reads
     * status once to confirm the final state. A POST is never sent while the backend reports
     * unavailable, since an effective `enabled=false` can mask a stored desired-on policy the
     * backend simply cannot enforce right now — toggling from that ambiguous state would turn the
     * desired policy off instead of on.
     */
    suspend fun setEnabled(sessionID: String, directory: String, enabled: Boolean): SandboxStatusDto {
        val current = status(sessionID, directory)
        if (!current.available || current.enabled == enabled) return current
        log.info("${ChatLogSummary.sid(sessionID)} kind=sandbox-toggle target=$enabled")
        withContext(Dispatchers.IO) { requireClient().sandboxToggle(sessionID = sessionID, directory = directory) }
        val confirmed = status(sessionID, directory)
        check(confirmed.available && confirmed.enabled == enabled) {
            confirmed.reason ?: "Sandbox did not reach requested state: requested=$enabled actual=${confirmed.enabled}"
        }
        log.info(
            "${ChatLogSummary.sid(sessionID)} kind=sandbox-toggle target=$enabled " +
                "enabled=${confirmed.enabled} available=${confirmed.available}",
        )
        return confirmed
    }

    private fun toDto(
        sessionID: String,
        directory: String,
        enabled: Boolean,
        available: Boolean,
        reason: String?,
        version: Long,
    ) = SandboxStatusDto(
        sessionID = sessionID,
        directory = directory,
        enabled = enabled,
        available = available,
        reason = reason,
        version = version,
    )

    private fun sameDirectory(requested: String, returned: String): Boolean =
        runCatching { Path.of(requested).toAbsolutePath().normalize() == Path.of(returned).toAbsolutePath().normalize() }
            .getOrDefault(false)
}
