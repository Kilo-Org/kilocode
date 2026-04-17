@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import ai.kilocode.rpc.KiloSessionRpcApi
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
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
 * session IDs. [ai.kilocode.client.session.model.SessionModel] owns the
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
        private val LOG = Logger.getInstance(KiloSessionService::class.java)
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
                LOG.warn("session list failed", e)
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
                LOG.warn("session delete failed", e)
            }
        }
    }

    /** Register a worktree directory override for a session. */
    fun setDirectory(id: String, dir: String) {
        cs.launch {
            try {
                call { setDirectory(id, dir) }
            } catch (e: Exception) {
                LOG.warn("setDirectory failed", e)
            }
        }
    }

    // ------ Chat ops (explicit session ID) ------

    /** Send a text prompt to a session. */
    suspend fun prompt(id: String, dir: String, text: String) {
        LOG.info("prompt: session=$id, dir=$dir, text=${text.take(80)}")
        val dto = PromptDto(parts = listOf(PromptPartDto(type = "text", text = text)))
        call { prompt(id, dir, dto) }
        LOG.info("prompt: RPC returned successfully")
    }

    /** Abort ongoing processing for a session. */
    suspend fun abort(id: String, dir: String) {
        call { abort(id, dir) }
    }

    /** Load message history for a session. */
    suspend fun messages(id: String, dir: String): List<MessageWithPartsDto> =
        call { messages(id, dir) }

    /** Subscribe to streaming chat events for a session. */
    fun events(id: String, dir: String): Flow<ChatEventDto> {
        val api = rpc
        return if (api != null) flow {
            api.events(id, dir).collect { emit(it) }
        } else flow {
            durable { KiloSessionRpcApi.getInstance().events(id, dir).collect { emit(it) } }
        }
    }

    /** Update config (model, agent/mode, temperature). */
    suspend fun updateConfig(dir: String, config: ConfigUpdateDto) {
        call { updateConfig(dir, config) }
    }
}
