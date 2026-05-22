package ai.kilocode.backend.app

import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import ai.kilocode.jetbrains.api.client.DefaultApi
import ai.kilocode.jetbrains.api.model.GlobalSession
import ai.kilocode.jetbrains.api.model.SessionStatus
import ai.kilocode.rpc.dto.CloudSessionListDto
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
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
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
                        log.debug { "${ChatLogSummary.sid(pair.first)} evt=session.status ${ChatLogSummary.status(pair.second)}" }
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
        val raw = requireClient().sessionList(directory = dir, roots = JsonPrimitive(true))
        val mapped = raw.map(::dto)
        val ids = mapped.map { it.id }.toSet()
        val relevant = _statuses.value.filterKeys { it in ids }
        return SessionListDto(mapped, relevant)
    }

    fun recent(dir: String, limit: Int): SessionListDto {
        seed(dir)
        val raw = requireClient().experimentalSessionList(
            directory = dir,
            worktrees = true,
            roots = JsonPrimitive(true),
            limit = limit.toDouble(),
            archived = JsonPrimitive(false),
        )
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
            val dto = KiloCliDataParser.parseSession(raw!!)
            val meta = if (log.isDebugEnabled) ChatLogSummary.dir(dir) else "kind=session"
            log.info("${ChatLogSummary.sid(dto.id)} kind=session $meta created=true code=${response.code}")
            return dto
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

    /**
     * Rename a session by sending `PATCH /session/{id}?directory={dir}` with `{"title":"..."}`.
     *
     * Uses raw HTTP because the generated Kotlin client is build-time only and
     * this repo already uses raw HTTP for session create and cloud operations.
     */
    fun rename(id: String, dir: String, title: String): SessionDto {
        val h = http ?: throw IllegalStateException("Session manager not started")
        val url = base ?: throw IllegalStateException("Session manager not started")
        val json = """{"title":"${escape(title)}"}"""
        val patch = url.toHttpUrl().newBuilder()
            .addPathSegment("session")
            .addPathSegment(id)
            .addQueryParameter("directory", dir)
            .build()
        val request = Request.Builder()
            .url(patch)
            .method("PATCH", json.toRequestBody("application/json".toMediaType()))
            .build()

        h.newCall(request).execute().use { response ->
            val raw = response.body?.string()
            if (!response.isSuccessful) {
                log.warn("Session rename failed: HTTP ${response.code}, body=$raw")
                throw RuntimeException("Session rename failed: HTTP ${response.code} — $raw")
            }
            return KiloCliDataParser.parseSession(raw!!)
        }
    }

    fun cloudSessions(dir: String, cursor: String?, limit: Int, gitUrl: String?): CloudSessionListDto {
        val h = http ?: throw IllegalStateException("Session manager not started")
        val url = base ?: throw IllegalStateException("Session manager not started")
        val params = listOfNotNull(
            "directory=${encode(dir)}",
            cursor?.let { "cursor=${encode(it)}" },
            "limit=$limit",
            gitUrl?.let { "gitUrl=${encode(it)}" },
        ).joinToString("&")
        val path = "$url/kilo/cloud-sessions?$params"

        val request = Request.Builder()
            .url(path)
            .get()
            .build()

        h.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                log.warn("Cloud sessions failed: HTTP ${response.code}, body=$raw")
                throw RuntimeException("Cloud sessions failed: HTTP ${response.code} — $raw")
            }
            return KiloCliDataParser.parseCloudSessions(raw)
        }
    }

    fun importCloudSession(id: String, dir: String): SessionDto {
        val h = http ?: throw IllegalStateException("Session manager not started")
        val url = base ?: throw IllegalStateException("Session manager not started")
        val json = """{"sessionId":"${escape(id)}"}"""
        val request = Request.Builder()
            .url("$url/kilo/cloud/session/import?directory=${encode(dir)}")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()

        h.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                log.warn("Cloud session import failed: HTTP ${response.code}, body=$raw")
                throw RuntimeException("Cloud session import failed: HTTP ${response.code} — $raw")
            }
            return KiloCliDataParser.parseSession(raw)
        }
    }

    fun seed(dir: String) {
        try {
            val raw = requireClient().sessionStatus(directory = dir)
            val mapped = raw.mapValues { (_, v) -> statusDto(v) }
            _statuses.update { it + mapped }
            val meta = if (log.isDebugEnabled) ChatLogSummary.dir(dir) else "kind=status"
            log.info("kind=status $meta seeded=${mapped.size}")
        } catch (e: Exception) {
            log.warn("kind=status dir=${ChatLogSummary.dir(dir)} seed=true failed message=${e.message}", e)
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
            created = s.time.created.toDouble(),
            updated = s.time.updated.toDouble(),
            archived = s.time.archived,
        ),
        summary = s.summary?.let {
            SessionSummaryDto(
                additions = it.additions.safeInt(),
                deletions = it.deletions.safeInt(),
                files = it.files.safeInt(),
            )
        },
    )

    private fun dto(s: GlobalSession) = SessionDto(
        id = s.id,
        projectID = s.projectID,
        directory = s.directory,
        parentID = s.parentID,
        title = s.title,
        version = s.version,
        time = SessionTimeDto(
            created = s.time.created.toDouble(),
            updated = s.time.updated.toDouble(),
            archived = s.time.archived,
        ),
        summary = s.summary?.let {
            SessionSummaryDto(
                additions = it.additions.safeInt(),
                deletions = it.deletions.safeInt(),
                files = it.files.safeInt(),
            )
        },
    )

    private fun statusDto(s: SessionStatus) = SessionStatusDto(
        type = s.type.value,
        message = s.message.ifBlank { null },
        attempt = s.attempt.safeInt(),
        next = s.next,
        requestID = s.requestID.ifBlank { null },
    )

    private fun encode(value: String) = java.net.URLEncoder.encode(value, Charsets.UTF_8)

    private fun escape(value: String) = buildString {
        for (c in value) {
            when (c) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (c < '\u0020') append("\\u%04x".format(c.code)) else append(c)
            }
        }
    }

    private fun Long.safeInt() = coerceIn(Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong()).toInt()
}
