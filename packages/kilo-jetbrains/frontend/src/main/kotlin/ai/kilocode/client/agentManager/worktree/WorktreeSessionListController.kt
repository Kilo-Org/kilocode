package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.util.edt
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.ui.CollectionListModel
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

class WorktreeSessionListController(
    private val service: KiloSessionService,
    private val dir: String,
    private val cs: CoroutineScope,
    private val telemetry: (String, Map<String, String>) -> Unit = { event, props -> Telemetry.send(event, props) },
) {
    val model = CollectionListModel<SessionDto>()

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
