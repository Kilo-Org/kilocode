package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.ui.CollectionListModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

class WorktreeSessionListController(
    private val service: KiloSessionService,
    private val dir: String,
    private val cs: CoroutineScope,
    private val telemetry: (String, Map<String, String>) -> Unit = { event, props -> Telemetry.send(event, props) },
) {
    val model = CollectionListModel<SessionDto>()

    fun reload(done: (() -> Unit)? = null) {
        cs.launch {
            try {
                val result = service.list(dir)
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
                    capture("Worktree Session Created", mapOf("sessionId" to session.id))
                    done(session)
                }
            } catch (e: Exception) {
                LOG.warn("worktree session create failed dir=$dir message=${e.message}", e)
                edt { done(null) }
            }
        }
    }

    fun delete(ids: List<String>, done: () -> Unit) {
        val active = ids.distinct().filter { it.isNotBlank() }
        if (active.isEmpty()) {
            edt(done)
            return
        }
        cs.launch {
            try {
                active.forEach { id ->
                    service.deleteSession(id, dir)
                    capture("Worktree Session Deleted", mapOf("sessionId" to id))
                }
                edt {
                    val keep = (0 until model.size)
                        .map { model.getElementAt(it) }
                        .filter { it.id !in active }
                    model.replaceAll(keep)
                    done()
                }
            } catch (e: Exception) {
                LOG.warn("worktree session delete failed dir=$dir message=${e.message}", e)
                edt { done() }
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
}

private fun edt(block: () -> Unit) {
    val app = ApplicationManager.getApplication()
    if (app.isDispatchThread) {
        block()
        return
    }
    app.invokeLater(block)
}
