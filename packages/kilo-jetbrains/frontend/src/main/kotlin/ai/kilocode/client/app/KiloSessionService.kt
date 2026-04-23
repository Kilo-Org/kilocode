@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import ai.kilocode.log.ChatLogSummary
import ai.kilocode.rpc.KiloSessionRpcApi
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.components.Service
import ai.kilocode.log.KiloLog
import com.intellij.openapi.project.Project
import fleet.rpc.client.durable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Project-level frontend service for session management.
 *
 * Stateless with respect to "active session" — callers pass explicit
 * session IDs. [ai.kilocode.client.session.SessionController] owns the
 * active session concept.
 */
@Service(Service.Level.PROJECT)
class KiloSessionService internal constructor(
    private val project: Project,
    private val cs: CoroutineScope,
    private val rpc: KiloSessionRpcApi?,
) {
    /** Platform constructor — resolves RPC from the service container. */
    constructor(project: Project, cs: CoroutineScope) : this(project, cs, null)

    companion object {
        private val LOG = KiloLog.create(KiloSessionService::class.java)
    }

    private val _sessions = MutableStateFlow<List<SessionDto>>(emptyList())
    val sessions: StateFlow<List<SessionDto>> = _sessions.asStateFlow()

    /** Live session status map from SSE events. */
    val statuses: StateFlow<Map<String, SessionStatusDto>> =
        stream { statuses() }.stateIn(cs, SharingStarted.Eagerly, emptyMap())

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
                val result = call { list(dir) }
                _sessions.value = result.sessions
            } catch (e: Exception) {
                LOG.warn("kind=session-list dir=${ChatLogSummary.dir(dir)} failed message=${e.message}", e)
            }
        }
    }

    /** Create a new session. Caller awaits the result. */
    suspend fun create(dir: String): SessionDto {
        LOG.info("create: dir=$dir")
        val session = call { create(dir) }
        LOG.info("create: id=${session.id}")
        refresh(dir)
        return session
    }

    /** Delete a session. */
    fun delete(id: String, dir: String) {
        cs.launch {
            try {
                call { delete(id, dir) }
                refresh(dir)
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(id)} kind=session delete=true dir=${ChatLogSummary.dir(dir)} failed message=${e.message}", e)
            }
        }
    }

    /** Register a worktree directory override for a session. */
    fun setDirectory(id: String, dir: String) {
        cs.launch {
            try {
                call { setDirectory(id, dir) }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(id)} kind=session setDirectory=true dir=${ChatLogSummary.dir(dir)} failed message=${e.message}", e)
            }
        }
    }

    // ------ Chat ops (explicit session ID) ------

    /** Send a text prompt to a session. */
    suspend fun prompt(id: String, dir: String, text: String) {
        val meta = if (LOG.isDebugEnabled) {
            "${ChatLogSummary.dir(dir)} ${ChatLogSummary.prompt(text)}"
        } else {
            "kind=prompt chars=${text.length}"
        }
        LOG.info("${ChatLogSummary.sid(id)} $meta")
        val dto = PromptDto(parts = listOf(PromptPartDto(type = "text", text = text)))
        call { prompt(id, dir, dto) }
        LOG.info("${ChatLogSummary.sid(id)} kind=prompt ok=true")
    }

    /** Abort ongoing processing for a session. */
    suspend fun abort(id: String, dir: String) {
        call { abort(id, dir) }
    }

    /** Load message history for a session. */
    suspend fun messages(id: String, dir: String): List<MessageWithPartsDto> =
        call { messages(id, dir) }
            .also { LOG.debug { "${ChatLogSummary.sid(id)} ${ChatLogSummary.history(it)} ${ChatLogSummary.dir(dir)}" } }

    /** Subscribe to streaming chat events for a session. */
    fun events(id: String, dir: String): Flow<ChatEventDto> {
        val api = rpc
        return if (api != null) flow {
            api.events(id, dir).collect {
                LOG.debug { ChatLogSummary.event(it) }
                emit(it)
            }
        } else flow {
            durable {
                KiloSessionRpcApi.getInstance().events(id, dir).collect {
                    LOG.debug { ChatLogSummary.event(it) }
                    emit(it)
                }
            }
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
