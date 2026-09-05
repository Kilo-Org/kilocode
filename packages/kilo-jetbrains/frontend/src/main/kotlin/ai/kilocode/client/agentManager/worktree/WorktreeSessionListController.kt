package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.util.edt
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.ui.CollectionListModel
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

class WorktreeSessionListController(
    private val service: KiloSessionService,
    private val dir: String,
    private val cs: CoroutineScope,
    private val telemetry: (String, Map<String, String>) -> Unit = { event, props -> Telemetry.send(event, props) },
) {
    val model = CollectionListModel<SessionDto>()

    /** Coalescing hop: many session changes in, at most one reload per quiet period out. */
    private val pings = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    init {
        // A session started in another project frame only reaches this list through the CLI's
        // event stream — nothing local fires, so without this the row never appears until the tab
        // is reopened.
        cs.launch {
            service.changes
                .filter { normalizeWorktreePath(it.directory) == normalizeWorktreePath(dir) }
                .collect { pings.emit(Unit) }
        }
        cs.launch {
            // collectLatest restarts the delay on every new ping, so a streaming title (one
            // session.updated per delta) costs one reload, not one per event.
            pings.collectLatest {
                delay(COALESCE_MS)
                reload()
            }
        }
    }

    /** Snapshot of the listed sessions, in model order. */
    @RequiresEdt
    fun sessions(): List<SessionDto> = (0 until model.size).map { model.getElementAt(it) }

    /** The listed session with [id], or null when it is not in the model. */
    @RequiresEdt
    fun session(id: String): SessionDto? = sessions().firstOrNull { it.id == id }

    fun reload(done: (() -> Unit)? = null) {
        cs.launch {
            try {
                val result = service.sessionsFor(dir)
                edt {
                    model.replaceAll(result.sessions)
                    capture("Worktree Session List Loaded", mapOf("count" to result.sessions.size.toString()))
                    done?.invoke()
                }
            } catch (e: Exception) {
                LOG.warn("worktree session list failed dir=$dir message=${e.message}", e)
                edt { done?.invoke() }
            }
        }
    }

    fun create(done: (SessionDto?) -> Unit) {
        cs.launch {
            try {
                val session = service.create(dir)
                edt {
                    val keep = (0 until model.size)
                        .map { model.getElementAt(it) }
                        .filter { it.id != session.id }
                    model.replaceAll(listOf(session) + keep)
                    done(session)
                    capture("Worktree Session Created", mapOf("sessionId" to session.id))
                }
            } catch (e: Exception) {
                LOG.warn("worktree session create failed dir=$dir message=${e.message}", e)
                edt { done(null) }
            }
        }
    }

    /**
     * Forks [id] into this list's directory, optionally truncating at [messageId].
     *
     * The forked session is inserted at the head the same way [create] does. That optimistic insert
     * is what lets the panel's own promotion rule react right away instead of waiting for the CLI's
     * `session.created` to arrive through [COALESCE_MS]; the later reload is idempotent.
     *
     * Unlike the neighbours here this reports no telemetry of its own: fork is reachable from three
     * different surfaces, so the event belongs where the surface and the outcome are both known
     * ([WorktreeSessionEditorManager.forkSession]).
     */
    fun fork(id: String, messageId: String?, done: (SessionDto?, String?) -> Unit) {
        cs.launch {
            try {
                val session = service.fork(id, dir, messageId)
                edt {
                    val keep = (0 until model.size)
                        .map { model.getElementAt(it) }
                        .filter { it.id != session.id }
                    model.replaceAll(listOf(session) + keep)
                    done(session, null)
                }
            } catch (e: Exception) {
                LOG.warn("worktree session fork failed id=$id dir=$dir message=${e.message}", e)
                edt { done(null, e.message) }
            }
        }
    }

    fun delete(id: String, done: (Boolean, String?) -> Unit) {
        if (id.isBlank()) return edt { done(false, "Missing session id") }
        cs.launch {
            val result = runCatching { service.deleteSession(id, dir) }
            if (result.isSuccess) {
                edt {
                    val keep = (0 until model.size)
                        .map { model.getElementAt(it) }
                        .filter { it.id != id }
                    model.replaceAll(keep)
                    done(true, null)
                    capture("Worktree Session Deleted", mapOf("sessionId" to id))
                }
                return@launch
            }
            val err = result.exceptionOrNull()
            LOG.warn("worktree session delete failed id=$id dir=$dir message=${err?.message}", err)
            edt { done(false, err?.message) }
            reload()
        }
    }

    @RequiresEdt
    fun rename(id: String, title: String, done: (Boolean, String?) -> Unit) {
        val name = title.trim()
        if (id.isBlank()) return edt { done(false, "Missing session id") }
        if (name.isBlank()) return edt { done(false, "Missing session title") }
        val prior = (0 until model.size)
            .map { model.getElementAt(it) }
            .firstOrNull { it.id == id }
            ?: return edt { done(false, "Session not found") }
        val optimistic = prior.copy(title = name)
        edt {
            index(id).takeIf { it >= 0 }?.let { model.setElementAt(optimistic, it) }
        }
        cs.launch {
            val result = runCatching { service.renameSession(id, dir, name) }
            val updated = result.getOrNull()
            if (updated != null) {
                edt {
                    index(id).takeIf { it >= 0 }?.let { model.setElementAt(updated, it) }
                    done(true, null)
                    capture("Worktree Session Renamed", mapOf("sessionId" to id))
                }
                return@launch
            }
            val err = result.exceptionOrNull()
            LOG.warn("worktree session rename failed id=$id dir=$dir message=${err?.message}", err)
            edt {
                index(id).takeIf { it >= 0 }?.let { model.setElementAt(prior, it) }
                done(false, err?.message)
            }
            reload()
        }
    }

    companion object {
        private val LOG = KiloLog.create(WorktreeSessionListController::class.java)
        private const val COALESCE_MS = 300L
    }

    private fun capture(event: String, props: Map<String, String>) {
        try {
            telemetry(event, props)
        } catch (e: Exception) {
            LOG.warn("worktree session telemetry failed event=$event message=${e.message}", e)
        }
    }

    private fun index(id: String): Int {
        return (0 until model.size).firstOrNull { model.getElementAt(it).id == id } ?: -1
    }
}
