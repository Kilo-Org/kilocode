package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.util.edt
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * Shared wiring to the project [WorktreeRunStatusService] for the Agent Manager list, which replaces
 * the resting icon on any worktree row with the platform live-run indicator (see
 * [WorktreeIcons.runIndicator]) while that worktree has a live run-configuration process. Mirrors
 * [WorktreeStatusBinding]: owns the attach handle and a coroutine scope, forwards the running-worktree
 * set to [onRunning] on the EDT, and skips delivery once [parent] or the project is disposed. Cleanup
 * is tied to [parent].
 */
internal class WorktreeRunBinding(
    private val project: Project,
    private val parent: Disposable,
    private val onRunning: (Set<String>) -> Unit,
) {
    private val cs = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val handle: AutoCloseable

    init {
        val service = project.service<WorktreeRunStatusService>()
        handle = service.attach()
        cs.launch {
            service.states.collectLatest { states ->
                val worktrees = states.map { normalizeWorktreePath(it.worktree) }.toSet()
                alive { onRunning(worktrees) }
            }
        }
        Disposer.register(parent) { close() }
    }

    private fun alive(block: () -> Unit) = edt({ !project.isDisposed && !Disposer.isDisposed(parent) }, block)

    private fun close() {
        handle.close()
        cs.cancel()
    }
}
