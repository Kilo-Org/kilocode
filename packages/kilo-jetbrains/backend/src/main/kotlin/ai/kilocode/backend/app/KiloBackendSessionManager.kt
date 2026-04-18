package ai.kilocode.backend.app

import ai.kilocode.backend.cli.KiloCliDataParser
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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
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
 *
 * All raw JSON parsing is delegated to [KiloCliDataParser].
 */
class KiloBackendSessionManager(
    private val cs: CoroutineScope,
    private val log: KiloLog,
) {
    /** Per-session directory overrides (sessionId → worktree path). */
    private val directories = ConcurrentHashMap<String, String>()

    private val _statuses = MutableStateFlow<Map<String, SessionStatusDto>>(emptyMap())
    val statuses: StateFlow<Map<String, SessionStatusDto>> = _statuses.asStateFlow()

    private var client: DefaultApi? = null
    private var http: OkHttpClient? = null
    private var base: String? = null
    private var watcher: Job? = null

    fun start(api: DefaultApi, httpClient: OkHttpClient, port: Int, events: SharedFlow<SseEvent>) {
        client = api
        http = httpClient
        base = "http://127.0.0.1:$port"
        if (watcher?.isActive == true) return
        watcher = cs.launch {
            events.collect { event ->
                if (event.type == "session.status") {
                    val pair = KiloCliDataParser.parseSessionStatus(event.data)
                    if (pair != null) {
                        _statuses.update { it + pair }
                    }
                }
            }
        }
        log.info("Session manager started")
    }

    fun stop() {
        watcher?.cancel()
        watcher = null
        client = null
        http = null
        base = null
        _statuses.value = emptyMap()
        log.info("Session manager stopped")
    }

    private fun requireClient(): DefaultApi =
        client ?: throw IllegalStateException("Session manager not started")

    // ------ session CRUD ------

    fun list(dir: String): SessionListDto {
        seed(dir)
        val raw = requireClient().sessionList(directory = dir, roots = true)
        val mapped = raw.map(::dto)
        val ids = mapped.map { it.id }.toSet()
        val relevant = _statuses.value.filterKeys { it in ids }
        return SessionListDto(mapped, relevant)
    }

    /**
     * Create a new session in the given directory.
     *
     * Uses raw HTTP because the generated client sends malformed JSON
     * for the optional request body (Content-Type set but empty body).
     */
    fun create(dir: String): SessionDto {
        val h = http ?: throw IllegalStateException("Session manager not started")
        val url = base ?: throw IllegalStateException("Session manager not started")
        val encoded = java.net.URLEncoder.encode(dir, "UTF-8")
        log.info("Creating session: POST $url/session?directory=$encoded")

        val request = Request.Builder()
            .url("$url/session?directory=$encoded")
            .post("{}".toRequestBody("application/json".toMediaType()))
            .build()

        h.newCall(request).execute().use { response ->
            val raw = response.body?.string()
            if (!response.isSuccessful) {
                log.warn("Session create failed: HTTP ${response.code}, body=$raw")
                throw RuntimeException("Session create failed: HTTP ${response.code} — $raw")
            }
            log.info("Session created: HTTP ${response.code}")
            return KiloCliDataParser.parseSession(raw!!)
        }
    }

    fun get(id: String, dir: String): SessionDto {
        val all = requireClient().sessionList(directory = dir)
        val raw = all.firstOrNull { it.id == id }
            ?: throw IllegalArgumentException("Session $id not found")
        return dto(raw)
    }

    fun delete(id: String, dir: String) {
        requireClient().sessionDelete(sessionID = id, directory = dir)
        directories.remove(id)
    }

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

    // ------ mapping (generated API model → DTO) ------

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
