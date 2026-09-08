package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.kiloRoot
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.RunStateDto
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicInteger

/**
 * Project-level fan-in for the backend per-worktree run-state stream. One [KiloRunService.states]
 * subscription is shared by every worktree editor surface (mirrors [WorktreeStatusService]); each
 * surface [attach]es, reads [states], and filters the list by its own worktree.
 *
 * The single stream is re-established with backoff when the backend project is not yet resolved or
 * the stream ends, so a transient failure or an early open does not silently freeze the run
 * indicators for the rest of the session (a plain one-shot collect would never recover).
 */
@Service(Service.Level.PROJECT)
class WorktreeRunStatusService internal constructor(
    private val project: Project,
    private val cs: CoroutineScope,
) {
    companion object {
        private val LOG = KiloLog.create(WorktreeRunStatusService::class.java)
        private const val RETRY_MS = 3_000L
    }

    private val flow = MutableStateFlow<List<RunStateDto>>(emptyList())
    private val refs = AtomicInteger()

    @Volatile
    private var job: Job? = null

    val states: StateFlow<List<RunStateDto>> get() = flow

    fun attach(): AutoCloseable {
        if (refs.incrementAndGet() == 1) start()
        return AutoCloseable { if (refs.decrementAndGet() == 0) stop() }
    }

    private fun start() {
        job = cs.launch {
            while (isActive) {
                val root = project.kiloRoot()
                if (root == null) {
                    delay(RETRY_MS)
                    continue
                }
                runCatching { service<KiloRunService>().states(root).collect { flow.value = it } }
                    .onFailure { err ->
                        if (err is CancellationException) throw err
                        LOG.warn("run states stream failed for $root", err)
                    }
                if (!isActive) break
                // The stream completed or failed (backend not ready, reconnect); retry so the run
                // indicator recovers instead of staying frozen.
                delay(RETRY_MS)
            }
        }
    }

    private fun stop() {
        job?.cancel()
        job = null
        flow.value = emptyList()
    }
}
