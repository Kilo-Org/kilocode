package ai.kilocode.backend.app

import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import ai.kilocode.jetbrains.api.client.DefaultApi
import ai.kilocode.jetbrains.api.model.GlobalSession
import ai.kilocode.jetbrains.api.model.SessionStatus
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.CloudSessionListDto
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionListDto
import ai.kilocode.rpc.dto.SessionRuntimeDto
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

    private val _runtime = MutableStateFlow(SessionRuntimeDto())
    val runtime: StateFlow<SessionRuntimeDto> = _runtime.asStateFlow()

    private val costs = ConcurrentHashMap<String, ConcurrentHashMap<String, Double>>()

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
                when (event.type) {
                    "session.status" -> {
                    val pair = KiloCliDataParser.parseSessionStatus(event.data)
                    if (pair != null) {
                        val prev = _statuses.value[pair.first]
                        mergeRuntime(statuses = mapOf(pair))
                        syncActivity(pair.first)
                        val total = _statuses.value.size
                        log.debug { "${ChatLogSummary.sid(pair.first)} evt=session.status ${ChatLogSummary.status(pair.second)}" }
                        if (pair.second.type != "busy") {
                            log.info(
                                "${ChatLogSummary.sid(pair.first)} kind=status route=session-map " +
                                    "${ChatLogSummary.status(pair.second)} prev=${prev?.type ?: "none"} total=$total bytes=${event.data.length}",
                            )
                        }
                    }
                }
                    "permission.asked", "permission.replied", "question.asked", "question.replied", "question.rejected",
                    "message.updated", "session.error", "session.turn.open" -> updateRuntime(event)
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
        _runtime.value = SessionRuntimeDto()
        costs.clear()
        log.info("Session manager stopped")
    }

    private fun requireClient(): DefaultApi =
        client ?: throw IllegalStateException("Session manager not started")

    // ------ session CRUD ------

    fun list(dir: String): SessionListDto {
        return overview(dir, limit = null, worktrees = false)
    }

    fun recent(dir: String, limit: Int): SessionListDto {
        return overview(dir, limit = limit, worktrees = true)
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
            mergeRuntime(statuses = mapped)
            val meta = if (log.isDebugEnabled) ChatLogSummary.dir(dir) else "kind=status"
            log.info("kind=status $meta seeded=${mapped.size}")
        } catch (e: Exception) {
            log.warn("kind=status dir=${ChatLogSummary.dir(dir)} seed=true failed message=${e.message}", e)
        }
    }

    private fun overview(dir: String, limit: Int?, worktrees: Boolean): SessionListDto {
        val h = http ?: throw IllegalStateException("Session manager not started")
        val url = base ?: throw IllegalStateException("Session manager not started")
        val builder = "$url/kilocode/session/overview".toHttpUrl().newBuilder()
            .addQueryParameter("directory", dir)
            .addQueryParameter("roots", "true")
            .addQueryParameter("worktrees", worktrees.toString())
            .addQueryParameter("archived", "false")
        if (limit != null) builder.addQueryParameter("limit", limit.toString())
        val request = Request.Builder().url(builder.build()).get().build()
        h.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                log.warn("Session overview failed: HTTP ${response.code}, body=$raw")
                throw RuntimeException("Session overview failed: HTTP ${response.code} — $raw")
            }
            val parsed = KiloCliDataParser.parseSessionOverview(raw)
            val ids = parsed.sessions.map { it.id }.toSet()
            val result = parsed.copy(
                statuses = parsed.statuses.filterKeys { it in ids },
                activities = parsed.activities.filterKeys { it in ids },
                costs = parsed.costs.filterKeys { it in ids },
            )
            mergeRuntime(parsed.statuses, parsed.activities, parsed.costs)
            return result
        }
    }

    private fun updateRuntime(event: SseEvent) {
        val parsed = KiloCliDataParser.parseChatEvent(event.type, event.data) ?: return
        when (parsed) {
            is ChatEventDto.PermissionAsked -> mergeRuntime(activities = mapOf(parsed.sessionID to SessionActivityDto("permission", parsed.request.id)))
            is ChatEventDto.PermissionReplied -> clearActivity(parsed.sessionID, parsed.requestID)
            is ChatEventDto.QuestionAsked -> {
                val kind = if (parsed.request.questions.any { it.questionKey == "plan.followup.question" || it.headerKey == "plan.followup.header" }) "plan" else "question"
                mergeRuntime(activities = mapOf(parsed.sessionID to SessionActivityDto(kind, parsed.request.id)))
            }
            is ChatEventDto.QuestionReplied -> clearActivity(parsed.sessionID, parsed.requestID)
            is ChatEventDto.QuestionRejected -> clearActivity(parsed.sessionID, parsed.requestID)
            is ChatEventDto.MessageUpdated -> {
                val cost = parsed.info.cost
                if (parsed.info.role == "assistant" && cost != null) updateCost(parsed.info.sessionID, parsed.info.id, cost)
                clearLogin(parsed.info.sessionID)
            }
            is ChatEventDto.Error -> parsed.sessionID?.let { mergeRuntime(activities = mapOf(it to SessionActivityDto("login_required", message = parsed.error?.message))) }
            is ChatEventDto.TurnOpen -> clearLogin(parsed.sessionID)
            else -> Unit
        }
    }

    private fun mergeRuntime(
        statuses: Map<String, SessionStatusDto> = emptyMap(),
        activities: Map<String, SessionActivityDto> = emptyMap(),
        costs: Map<String, Double> = emptyMap(),
    ) {
        _runtime.update {
            SessionRuntimeDto(
                statuses = it.statuses + statuses,
                activities = it.activities + activities,
                costs = it.costs + costs,
            )
        }
        _statuses.value = _runtime.value.statuses
    }

    private fun clearActivity(id: String, request: String) {
        _runtime.update {
            val activity = it.activities[id]
            if (activity?.requestID != request) return@update it
            it.copy(activities = it.activities - id)
        }
        syncActivity(id)
    }

    private fun syncActivity(id: String) {
        val status = _runtime.value.statuses[id]
        val current = _runtime.value.activities[id]
        if (status?.type == "busy" && current == null) {
            mergeRuntime(activities = mapOf(id to SessionActivityDto("running")))
            return
        }
        if (status?.type != "busy" && current?.kind == "running") {
            _runtime.update { it.copy(activities = it.activities - id) }
        }
    }

    private fun clearLogin(id: String) {
        _runtime.update {
            if (it.activities[id]?.kind != "login_required") return@update it
            it.copy(activities = it.activities - id)
        }
    }

    private fun updateCost(id: String, msg: String, cost: Double) {
        val session = costs.getOrPut(id) { ConcurrentHashMap() }
        val prev = session.put(msg, cost)
        val next = if (prev == null) (_runtime.value.costs[id] ?: 0.0) + cost else (_runtime.value.costs[id] ?: 0.0) - prev + cost
        mergeRuntime(costs = mapOf(id to next))
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
