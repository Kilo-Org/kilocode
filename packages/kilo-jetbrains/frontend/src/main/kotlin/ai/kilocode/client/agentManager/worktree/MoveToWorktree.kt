package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.MoveProgressDto
import ai.kilocode.rpc.dto.MoveStage
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Sidebar "Move to Worktree": aborts the running session, generates a friendly branch name, then
 * drives the backend move flow (capture → create → transfer → fork). On success it opens the
 * worktree session editor on the forked session; on error it notifies through the worktree pattern.
 * The source sidebar session stays in the sidebar (aborted, not deleted), matching VS Code fork
 * semantics.
 */
internal class MoveToWorktree(
    private val project: Project,
    private val cs: CoroutineScope,
) {
    private companion object {
        private val LOG = KiloLog.create(MoveToWorktree::class.java)
    }

    /** [progress] is invoked on the EDT for each stage so the dock button can reflect it. */
    @RequiresEdt
    fun launch(directory: String, sessionId: String, progress: (MoveStage, String?) -> Unit) {
        cs.launch {
            runCatching { service<KiloSessionService>().abort(sessionId, directory) }
                .onFailure { LOG.info("worktree move: abort failed (session may be idle): ${it.message}") }
            val known = service<KiloWorktreeService>().listBranches(directory).branches.toSet()
            val branch = WorktreeNames.generate(known)
            var stage = MoveStage.CAPTURING
            val flow = service<KiloWorktreeService>().moveToWorktree(directory, sessionId, branch)
            flow.collect { event ->
                if (event.stage != MoveStage.ERROR) stage = event.stage
                withContext(Dispatchers.Main) { handle(event, stage, progress) }
            }
        }
    }

    @RequiresEdt
    private fun handle(event: MoveProgressDto, failing: MoveStage, progress: (MoveStage, String?) -> Unit) {
        progress(event.stage, event.detail)
        when (event.stage) {
            MoveStage.DONE -> {
                val worktree = event.worktree ?: return
                ensureWorktreeSessionEditorKind()
                project.service<KiloVfsManager>().open(
                    WorktreeSessionEditorKind.ID,
                    worktreeSessionParams(worktree, session = event.session),
                )
                Telemetry.send("Continue in Worktree", mapOf("surface" to "sidebar"))
            }
            MoveStage.ERROR -> {
                LOG.warn("worktree move failed stage=$failing error=${event.error}")
                KiloNotifications.error(project, KiloBundle.message("session.dock.move.failed.title"), event.error)
                Telemetry.send("Continue in Worktree Failed", mapOf("stage" to failing.name))
            }
            else -> Unit
        }
    }
}
