@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import ai.kilocode.log.ChatLogSummary
import ai.kilocode.rpc.KiloSessionRpcApi
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.toKind
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.CloudSessionListDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionChangeDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionListDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.components.Service
import ai.kilocode.log.KiloLog
import com.intellij.openapi.project.Project
import fleet.rpc.client.durable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Project-level frontend service for session management.
 *
 * Stateless with respect to "active session" — callers pass explicit
 * session IDs. [ai.kilocode.client.session.controller.SessionController] owns the
 * active session concept.
 */
@Service(Service.Level.PROJECT)
class KiloSessionService internal constructor(
    private val project: Project,
    private val cs: CoroutineScope,
    private val rpc: KiloSessionRpcApi?,
    private val log: KiloLog = LOG,
) {
    /** Platform constructor — resolves RPC from the service container. */
    constructor(project: Project, cs: CoroutineScope) : this(project, cs, null)

    companion object {
        private val LOG = KiloLog.create(KiloSessionService::class.java)
    }

    // Reflects the sessions from the most recent tracking [list]/[renameSession] call, which is
    // scoped to a single directory. It is NOT a per-workspace source of truth: a caller listing a
    // different directory (e.g. an Agent Manager worktree tab) overwrites it. Directory-scoped
    // callers must consume the return value of [list]/[sessionsFor], never this flow.
    private val _sessions = MutableStateFlow<List<SessionDto>>(emptyList())
    val sessions: StateFlow<List<SessionDto>> = _sessions.asStateFlow()

    // Sessions deleted this run. The backend does not always emit a status/activity clear for a
    // session left in a waiting or failed state, so a deleted question/error entry would otherwise
    // linger and keep its badge on the session list, worktree list, and tab attention dot. Pruning
    // it locally forces every derived status to re-evaluate the moment the delete resolves.
    private val removed = MutableStateFlow<Set<String>>(emptySet())

    /** Live session status map from SSE events, minus sessions deleted this run. */
    val statuses: StateFlow<Map<String, SessionStatusDto>> =
        combine(stream { statuses() }, removed) { map, gone -> map - gone }
            .stateIn(cs, SharingStarted.Eagerly, emptyMap())

    /** Live session activity map from backend global events, minus sessions deleted this run. */
    val activity: StateFlow<Map<String, SessionActivityDto>> =
        combine(stream { activity() }, removed) { map, gone -> map - gone }
            .stateIn(cs, SharingStarted.Eagerly, emptyMap())

    /**
     * Session create/update/delete across every directory the CLI serves, including sessions
     * started in another project frame. Consumers filter by directory and must coalesce: a single
     * turn produces many `session.updated` events as the title and summary stream in.
     */
    val changes: Flow<SessionChangeDto> = stream { changes() }

    // ------ RPC helpers ------

    private suspend fun <T> call(block: suspend KiloSessionRpcApi.() -> T): T {
        val api = rpc
        return if (api != null) block(api) else durable { block(KiloSessionRpcApi.getInstance()) }
    }

    private fun <T> stream(block: suspend KiloSessionRpcApi.() -> Flow<T>): Flow<T> = flow {
        val api = rpc
        if (api != null) block(api).collect { emit(it) }
        else durable { block(KiloSessionRpcApi.getInstance()).collect { emit(it) } }
    }

    // ------ Session CRUD ------

    /** Refresh the session list from the server. */
    fun refresh(dir: String) {
        cs.launch {
            try {
                list(dir)
            } catch (e: Exception) {
                log.warn("kind=session-list dir=${ChatLogSummary.dir(dir)} failed message=${e.message}", e)
            }
        }
    }

    /**
     * Per-session activity for history and session lists. [activity] is the richer source — it also
     * carries waiting and failed sessions, and it covers sessions that are not open — but it drops
     * sessions whose directory the backend cannot resolve, so the busy statuses stay as a fallback.
     *
     * [statuses] and [activity] prune [removed] through separate collectors, so one can still carry
     * a deleted session while the other has already dropped it. Subtracting [removed] here keeps the
     * merged snapshot consistent instead of briefly badging a deleted session as running.
     */
    internal fun activitySnapshot(): Map<String, SessionActivityKind> {
        val busy = statuses.value.filterValues { it.type == "busy" }.mapValues { SessionActivityKind.RUNNING }
        return (busy + activity.value.mapValues { it.value.kind.toKind() }) - removed.value
    }

    suspend fun list(dir: String): SessionListDto {
        val result = call { list(dir) }
        _sessions.value = result.sessions
        return result
    }

    /**
     * List sessions for [dir] without touching the shared [sessions] flow. Use this for
     * directory-scoped views (e.g. Agent Manager worktree tabs) that maintain their own model, so a
     * background refresh does not clobber the primary workspace's [sessions] snapshot.
     */
    suspend fun sessionsFor(dir: String): SessionListDto = call { list(dir) }

    /** Load recent sessions for the worktree containing [dir]; sibling worktrees are excluded. */
    suspend fun recent(dir: String, limit: Int): List<SessionDto> =
        call { recent(dir, limit) }.sessions

    /** Get a single session. */
    suspend fun get(id: String, dir: String): SessionDto =
        call { get(id, dir) }

    /** Create a new session. Caller awaits the result. */
    suspend fun create(dir: String): SessionDto {
        log.info("kind=session create=true dir=${ChatLogSummary.dir(dir)}")
        val session = call { create(dir) }
        log.info("${ChatLogSummary.sid(session.id)} kind=session create=true ok=true dir=${ChatLogSummary.dir(dir)}")
        refresh(dir)
        return session
    }

    /** Delete a session. */
    fun delete(id: String, dir: String) {
        cs.launch {
            try {
                deleteSession(id, dir)
            } catch (e: Exception) {
                log.warn("${ChatLogSummary.sid(id)} kind=session delete=true dir=${ChatLogSummary.dir(dir)} failed message=${e.message}", e)
            }
        }
    }

    suspend fun deleteSession(id: String, dir: String) {
        log.info("${ChatLogSummary.sid(id)} kind=session delete=true dir=${ChatLogSummary.dir(dir)}")
        call { delete(id, dir) }
        log.info("${ChatLogSummary.sid(id)} kind=session delete=true ok=true dir=${ChatLogSummary.dir(dir)}")
        removed.update { it + id }
        list(dir)
    }

    suspend fun renameSession(id: String, dir: String, newTitle: String): ai.kilocode.rpc.dto.SessionDto {
        val session = call { rename(id, dir, newTitle) }
        _sessions.value = _sessions.value.map { if (it.id == id) session else it }
        return session
    }

    suspend fun cloudSessions(dir: String, cursor: String?, limit: Int, gitUrl: String?): CloudSessionListDto =
        call { cloudSessions(dir, cursor, limit, gitUrl) }

    suspend fun importCloudSession(id: String, dir: String): SessionDto =
        call { importCloudSession(id, dir) }

    /** Register a worktree directory override for a session. */
    fun setDirectory(id: String, dir: String) {
        cs.launch {
            try {
                call { setDirectory(id, dir) }
            } catch (e: Exception) {
                log.warn("${ChatLogSummary.sid(id)} kind=session setDirectory=true dir=${ChatLogSummary.dir(dir)} failed message=${e.message}", e)
            }
        }
    }

    // ------ Chat ops (explicit session ID) ------

    suspend fun enhancePrompt(dir: String, text: String): String =
        call { enhancePrompt(dir, text) }

    /** Send a prompt to a session. */
    suspend fun prompt(id: String, dir: String, dto: PromptDto) {
        val meta = if (log.isDebugEnabled) {
            "${ChatLogSummary.dir(dir)} ${ChatLogSummary.prompt(dto)}"
        } else {
            "kind=prompt parts=${dto.parts.size}"
        }
        log.info("${ChatLogSummary.sid(id)} $meta")
        call { prompt(id, dir, dto) }
        log.info("${ChatLogSummary.sid(id)} kind=prompt ok=true")
    }

    suspend fun command(id: String, dir: String, command: String, args: String, dto: PromptDto) {
        log.info("${ChatLogSummary.sid(id)} kind=command command=$command parts=${dto.parts.size}")
        call { command(id, dir, command, args, dto) }
        log.info("${ChatLogSummary.sid(id)} kind=command ok=true")
    }

    /** Abort ongoing processing for a session. */
    suspend fun abort(id: String, dir: String) {
        log.info("${ChatLogSummary.sid(id)} kind=abort ${ChatLogSummary.dir(dir)}")
        call { abort(id, dir) }
        log.info("${ChatLogSummary.sid(id)} kind=abort ok=true")
    }

    /** Summarize/compact a session. */
    suspend fun compact(id: String, dir: String, model: ModelSelectionDto) {
        call { compact(id, dir, model) }
    }

    suspend fun revert(id: String, dir: String, message: String, part: String?) {
        log.info(
            "${ChatLogSummary.sid(id)} kind=revert ${ChatLogSummary.dir(dir)} " +
                "message=$message part=${part ?: "none"}",
        )
        call { revert(id, dir, message, part) }
        log.info("${ChatLogSummary.sid(id)} kind=revert ok=true")
    }

    suspend fun deleteMessage(id: String, dir: String, message: String): Boolean =
        call { deleteMessage(id, dir, message) }

    suspend fun unrevert(id: String, dir: String) {
        call { unrevert(id, dir) }
    }

    /** Load message history for a session. */
    suspend fun messages(id: String, dir: String): List<MessageWithPartsDto> =
        call { messages(id, dir) }
            .also { log.debug { "${ChatLogSummary.sid(id)} ${ChatLogSummary.history(it)} ${ChatLogSummary.dir(dir)}" } }

    // Errors propagate so the diff editor can distinguish a real failure (retry link) from "no changes".
    suspend fun diff(id: String, dir: String): List<DiffFileDto> =
        call { diff(id, dir) }

    suspend fun diffSides(sessionId: String?, dir: String, file: DiffFileDto, messageId: String?): DiffFileDto? =
        call { diffSides(sessionId, dir, file, messageId) }

    suspend fun attachmentPart(id: String, dir: String, message: String, part: String, key: String?): PartDto? =
        call { attachmentPart(id, dir, message, part, key) }

    /** Subscribe to streaming chat events for a session. */
    fun events(id: String, dir: String): Flow<ChatEventDto> {
        val api = rpc
        val events = if (api != null) flow {
            api.events(id, dir).collect {
                log.debug { ChatLogSummary.event(it) }
                ChatLogSummary.error(it)?.let { msg -> log.warn("${ChatLogSummary.sid(id)} route=client-events $msg") }
                emit(it)
            }
        } else flow {
            durable {
                KiloSessionRpcApi.getInstance().events(id, dir).collect {
                    log.debug { ChatLogSummary.event(it) }
                    ChatLogSummary.error(it)?.let { msg -> log.warn("${ChatLogSummary.sid(id)} route=client-events $msg") }
                    emit(it)
                }
            }
        }
        return events
            .onStart { log.info("${ChatLogSummary.sid(id)} kind=subscription route=client-events start=true dir=${ChatLogSummary.dir(dir)}") }
            .onCompletion { cause ->
                if (cause == null || cause is CancellationException) {
                    log.info("${ChatLogSummary.sid(id)} kind=subscription route=client-events stop=true cancelled=${cause is CancellationException}")
                    return@onCompletion
                }
                log.warn("${ChatLogSummary.sid(id)} kind=subscription route=client-events stop=true failed message=${cause.message}", cause)
            }
    }

    /** Update config (model, agent/mode, temperature). */
    suspend fun updateConfig(dir: String, config: ConfigUpdateDto) {
        call { updateConfig(dir, config) }
    }

    // ------ permission / question resolution ------

    /** Reply to a pending permission request. */
    suspend fun replyPermission(requestId: String, dir: String, reply: PermissionReplyDto) {
        call { replyPermission(requestId, dir, reply) }
    }

    /** Save always-rules for a pending permission request. */
    suspend fun savePermissionRules(requestId: String, dir: String, rules: PermissionAlwaysRulesDto) {
        call { savePermissionRules(requestId, dir, rules) }
    }

    /** Reply to a pending question with user answers. */
    suspend fun replyQuestion(requestId: String, dir: String, answers: QuestionReplyDto) {
        call { replyQuestion(requestId, dir, answers) }
    }

    /** Reject a pending question. */
    suspend fun rejectQuestion(requestId: String, dir: String) {
        call { rejectQuestion(requestId, dir) }
    }

    /** List pending permissions (caller filters by session ID). */
    suspend fun pendingPermissions(dir: String): List<PermissionRequestDto> =
        call { pendingPermissions(dir) }

    /** List pending questions (caller filters by session ID). */
    suspend fun pendingQuestions(dir: String): List<QuestionRequestDto> =
        call { pendingQuestions(dir) }
}
