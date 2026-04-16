package ai.kilocode.backend.app

import ai.kilocode.backend.util.KiloLog
import ai.kilocode.jetbrains.api.client.DefaultApi
import ai.kilocode.jetbrains.api.model.SessionStatus
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionListDto
import ai.kilocode.rpc.dto.SessionStatusDto
import ai.kilocode.rpc.dto.SessionSummaryDto
import ai.kilocode.rpc.dto.SessionTimeDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

/**
 * Session gateway that handles session CRUD and live status tracking
 * across all directories (workspace roots and worktrees).
 *
 * **Not an IntelliJ service** — owned by [KiloBackendAppService] which
 * calls [start] after the CLI server reaches [KiloAppState.Ready] and
 * [stop] on disconnect. The API client is guaranteed non-null between
 * start/stop — no defensive null checks in CRUD methods.
 *
 * SSE `session.status` events are consumed directly from the events
 * flow passed to [start], keeping the live [statuses] map current.
 */
class KiloBackendSessionManager(
    private val cs: CoroutineScope,
    private val log: KiloLog,
) {
    companion object {
        private val FIELD_RE = ConcurrentHashMap<String, Regex>()

        /** Extract a top-level string field from JSON without a full parser. */
        internal fun extractField(json: String, field: String): String? {
            val re = FIELD_RE.getOrPut(field) {
                Regex(""""$field"\s*:\s*"([^"]+)"""")
            }
            return re.find(json)?.groupValues?.get(1)
        }

        /** Extract a string field nested one level deep. */
        internal fun extractNested(json: String, outer: String, inner: String): String? {
            val block = Regex(""""$outer"\s*:\s*\{([^}]+)}""")
                .find(json)?.groupValues?.get(1) ?: return null
            return extractField("{$block}", inner)
        }
    }

    /** Per-session directory overrides (sessionId → worktree path). */
    private val directories = ConcurrentHashMap<String, String>()

    private val _statuses = MutableStateFlow<Map<String, SessionStatusDto>>(emptyMap())
    val statuses: StateFlow<Map<String, SessionStatusDto>> = _statuses.asStateFlow()

    private var client: DefaultApi? = null
    private var watcher: Job? = null

    /**
     * Activate the session manager with a connected API client and SSE stream.
     * Called by [KiloBackendAppService] after [KiloAppState.Ready].
     */
    fun start(api: DefaultApi, events: SharedFlow<SseEvent>) {
        client = api
        if (watcher?.isActive == true) return
        watcher = cs.launch {
            events.collect { event ->
                if (event.type == "session.status") {
                    handleStatus(event.data)
                }
            }
        }
        log.info("Session manager started")
    }

    /**
     * Deactivate the session manager. Called by [KiloBackendAppService] on disconnect.
     */
    fun stop() {
        watcher?.cancel()
        watcher = null
        client = null
        _statuses.value = emptyMap()
        log.info("Session manager stopped")
    }

    private fun requireClient(): DefaultApi =
        client ?: throw IllegalStateException("Session manager not started")

    // ------ session CRUD ------

    /** List root sessions for a directory and include current statuses. */
    fun list(dir: String): SessionListDto {
        seed(dir)
        val raw = requireClient().sessionList(directory = dir, roots = true)
        val mapped = raw.map(::dto)
        val ids = mapped.map { it.id }.toSet()
        val relevant = _statuses.value.filterKeys { it in ids }
        return SessionListDto(mapped, relevant)
    }

    /** Create a new session in the given directory. */
    fun create(dir: String): SessionDto =
        dto(requireClient().sessionCreate(directory = dir))

    /**
     * Get a single session by ID.
     *
     * Uses the session list endpoint and filters by ID since
     * [DefaultApi] does not expose the single-session GET.
     */
    fun get(id: String, dir: String): SessionDto {
        val all = requireClient().sessionList(directory = dir)
        val raw = all.firstOrNull { it.id == id }
            ?: throw IllegalArgumentException("Session $id not found")
        return dto(raw)
    }

    /** Delete a session. */
    fun delete(id: String, dir: String) {
        requireClient().sessionDelete(sessionID = id, directory = dir)
        directories.remove(id)
    }

    /** Seed status map from the server for a specific directory. */
    fun seed(dir: String) {
        try {
            val raw = requireClient().sessionStatus(directory = dir)
            val mapped = raw.mapValues { (_, v) -> statusDto(v) }
            _statuses.update { it + mapped }
            log.info("Seeded ${mapped.size} session statuses for $dir")
        } catch (e: Exception) {
            log.warn("Session status seed failed: ${e.message}", e)
        }
    }

    // ------ worktree directory management ------

    fun setDirectory(id: String, dir: String) {
        directories[id] = dir
    }

    fun getDirectory(id: String, fallback: String): String =
        directories[id] ?: fallback

    // ------ SSE event handling ------

    private fun handleStatus(data: String) {
        val id = extractField(data, "sessionID") ?: return
        val type = extractNested(data, "status", "type") ?: "idle"
        val msg = extractNested(data, "status", "message")
        _statuses.update { it + (id to SessionStatusDto(type, msg)) }
    }

    // ------ mapping ------

    private fun dto(s: ai.kilocode.jetbrains.api.model.Session) = SessionDto(
        id = s.id,
        projectID = s.projectID,
        directory = s.directory,
        parentID = s.parentID,
        title = s.title,
        version = s.version,
        time = SessionTimeDto(
            created = s.time.created,
            updated = s.time.updated,
            archived = s.time.archived,
        ),
        summary = s.summary?.let {
            SessionSummaryDto(
                additions = it.additions.toInt(),
                deletions = it.deletions.toInt(),
                files = it.files.toInt(),
            )
        },
    )

    private fun statusDto(s: SessionStatus) = SessionStatusDto(
        type = s.type.value,
        message = s.message.ifBlank { null },
    )
}
