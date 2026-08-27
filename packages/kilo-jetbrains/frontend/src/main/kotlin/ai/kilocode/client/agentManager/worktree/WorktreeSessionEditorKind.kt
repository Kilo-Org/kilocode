package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionUiFactory
import ai.kilocode.client.vfs.KiloEditorKind
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloVirtualFile
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.cancel
import javax.swing.Icon
import javax.swing.JComponent

object WorktreeSessionEditorKind : KiloEditorKind {
    const val ID = "worktree-session"

    override val id: String = ID

    override fun title(params: Map<String, String>): String = params[PATH]?.let { path ->
        service<WorktreeNameCache>().title(path)
    } ?: KiloBundle.message("worktree.session.title")
    override fun icon(params: Map<String, String>): Icon = WorktreeIcons.branch
    override fun fileType(params: Map<String, String>): FileType = WorktreeSessionFileType
    override fun presentablePath(params: Map<String, String>): String = params[PATH] ?: title(params)
    override fun isValid(params: Map<String, String>): Boolean = !params[PATH].isNullOrBlank()

    @RequiresEdt
    override fun preferredFocus(component: JComponent): JComponent? = (component as? WorktreeSessionEditorPanel)?.preferredFocus()

    @RequiresEdt
    override fun createContent(project: Project, file: KiloVirtualFile, parent: Disposable): JComponent {
        val path = file.path.params[PATH]?.takeIf { it.isNotBlank() } ?: return BorderLayoutPanel()
        // A move queues its forked session here rather than in the params, which are this editor's
        // identity: a second param would open a rival tab for the same worktree.
        val session = service<PendingWorktreeSession>().take(path)
        val worktree = service<KiloWorkspaceService>().workspace(path)
        val cs = service<SessionUiFactory>().scope()
        Disposer.register(parent) { cs.cancel() }
        val controller = WorktreeSessionListController(project.service<KiloSessionService>(), path, cs)
        val manager = WorktreeSessionEditorManager(parent, project, worktree, controller, session = session)
        return WorktreeSessionEditorPanel(parent, manager, controller, worktree, project)
    }

    private const val PATH = "path"
}

fun ensureWorktreeSessionEditorKind() {
    service<KiloEditorKindRegistry>().register(WorktreeSessionEditorKind)
}

internal fun unregisterWorktreeSessionEditorKind() {
    service<KiloEditorKindRegistry>().unregister(WorktreeSessionEditorKind.ID)
}

/** Editor identity for a worktree session tab: the worktree path and nothing else. */
internal fun worktreeSessionParams(item: WorktreeDto): Map<String, String> = mapOf("path" to item.path)

internal fun openWorktreeSession(project: Project, worktree: WorktreeDto, focus: Boolean = true) {
    ensureWorktreeSessionEditorKind()
    project.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(worktree), focus)
}
