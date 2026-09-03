package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.util.edt
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
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
 * Shared wiring to the project [WorktreeStatusService] for the surfaces that show worktree
 * stats/PR badges (the Agent Manager list and the worktree session editor). Owns the attach
 * handle and a coroutine scope, forwards each flow value to [onStats]/[onDirty]/[onPr] on the EDT,
 * and skips delivery once [parent] or the project is disposed. Cleanup is tied to [parent].
 */
internal class WorktreeStatusBinding(
    private val project: Project,
    private val parent: Disposable,
    private val onStats: (Map<String, WorktreeStatsDto>) -> Unit,
    private val onPr: (Map<String, WorktreePrDto>) -> Unit,
    private val onDirty: (Map<String, WorktreeDirtyDto>) -> Unit = {},
) {
    private val cs = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val handle: AutoCloseable

    init {
        val service = project.service<WorktreeStatusService>()
        handle = service.attach()
        cs.launch { service.stats.collectLatest { value -> alive { onStats(value) } } }
        cs.launch { service.dirty.collectLatest { value -> alive { onDirty(value) } } }
        cs.launch { service.pr.collectLatest { value -> alive { onPr(value) } } }
        Disposer.register(parent) { close() }
    }

    private fun alive(block: () -> Unit) = edt({ !project.isDisposed && !Disposer.isDisposed(parent) }, block)

    private fun close() {
        handle.close()
        cs.cancel()
    }
}
