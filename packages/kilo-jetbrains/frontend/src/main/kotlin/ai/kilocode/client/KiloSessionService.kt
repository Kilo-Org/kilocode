@file:Suppress("UnstableApiUsage")

package ai.kilocode.client

import ai.kilocode.rpc.KiloSessionRpcApi
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import fleet.rpc.client.durable
import kotlinx.coroutines.CoroutineScope
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
 * Provides session CRUD, active session tracking, and live
 * status updates via [KiloSessionRpcApi]. All operations are
 * scoped to the project's [directory] by default, with support
 * for per-session worktree directory overrides.
 */
@Service(Service.Level.PROJECT)
class KiloSessionService(
    private val project: Project,
    private val cs: CoroutineScope,
) {
    companion object {
        private val LOG = Logger.getInstance(KiloSessionService::class.java)
    }

    private val directory: String get() = project.basePath ?: ""

    private val _sessions = MutableStateFlow<List<SessionDto>>(emptyList())
    val sessions: StateFlow<List<SessionDto>> = _sessions.asStateFlow()

    private val _active = MutableStateFlow<SessionDto?>(null)
    val active: StateFlow<SessionDto?> = _active.asStateFlow()

    /** Live session status map from SSE events. */
    val statuses: StateFlow<Map<String, SessionStatusDto>> = flow {
        durable {
            KiloSessionRpcApi.getInstance()
                .statuses()
                .collect { emit(it) }
        }
    }.stateIn(cs, SharingStarted.Eagerly, emptyMap())

    /** Refresh the session list from the server. */
    fun refresh() {
        cs.launch {
            try {
                val result = durable { KiloSessionRpcApi.getInstance().list(directory) }
                _sessions.value = result.sessions
            } catch (e: Exception) {
                LOG.warn("session list failed", e)
            }
        }
    }

    /** Create a new session and make it active. */
    fun create() {
        cs.launch {
            try {
                val session = durable { KiloSessionRpcApi.getInstance().create(directory) }
                _active.value = session
                refresh()
            } catch (e: Exception) {
                LOG.warn("session create failed", e)
            }
        }
    }

    /** Select an existing session as active. */
    fun select(id: String) {
        cs.launch {
            try {
                val session = durable { KiloSessionRpcApi.getInstance().get(id, directory) }
                _active.value = session
            } catch (e: Exception) {
                LOG.warn("session select failed", e)
            }
        }
    }

    /** Delete a session. Clears active if it was the deleted one. */
    fun delete(id: String) {
        cs.launch {
            try {
                durable { KiloSessionRpcApi.getInstance().delete(id, directory) }
                if (_active.value?.id == id) _active.value = null
                refresh()
            } catch (e: Exception) {
                LOG.warn("session delete failed", e)
            }
        }
    }

    /** Register a worktree directory override for a session. */
    fun setDirectory(id: String, dir: String) {
        cs.launch {
            try {
                durable { KiloSessionRpcApi.getInstance().setDirectory(id, dir) }
            } catch (e: Exception) {
                LOG.warn("setDirectory failed", e)
            }
        }
    }
}
