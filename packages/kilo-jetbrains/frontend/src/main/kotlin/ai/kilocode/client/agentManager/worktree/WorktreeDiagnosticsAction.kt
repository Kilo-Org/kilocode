package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.app.kiloRoot
import ai.kilocode.client.util.edt
import com.intellij.notification.Notification
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import kotlinx.coroutines.launch
import java.awt.datatransfer.StringSelection

/**
 * Collects the worktree-health report and puts it on the clipboard.
 *
 * The previous way to answer "why is Agent Manager not showing anything?" was reading kilo.log and
 * inferring intent from per-poll failures. This gathers the same facts the VS Code diagnostics
 * command reports — tool availability, per-worktree status with failure reasons, leftover
 * directories — in one paste-able block.
 */
internal object WorktreeDiagnosticsAction {

    fun copy() {
        val project = ProjectManager.getInstance().openProjects.firstOrNull { !it.isDefault } ?: run {
            notify(null, NotificationType.WARNING, KiloBundle.message("worktree.diagnostics.noProject"))
            return
        }
        val app = service<KiloAppService>()
        app.scope.launch {
            val text = runCatching { collect(project) }.getOrElse { err ->
                "Kilo Agent Manager — worktree health\nfailed to collect: ${err.message}"
            }
            // CopyPasteManager.setContents is an EDT API (see ui/Clipboard.kt), and this runs on the
            // service's Dispatchers.Default scope.
            edt { CopyPasteManager.getInstance().setContents(StringSelection(text)) }
            notify(project, NotificationType.INFORMATION, KiloBundle.message("worktree.diagnostics.copied"))
        }
    }

    private suspend fun collect(project: Project): String {
        val root = project.kiloRoot() ?: return "Kilo Agent Manager — worktree health\nno backend root resolved"
        val service = service<KiloWorktreeService>()
        val listed = service.list(root)
        return WorktreeDiagnostics.render(
            WorktreeDiagnostics.Input(
                root = root,
                gh = service.ghStatus(root),
                worktrees = listed.worktrees,
                orphans = listed.orphans,
                stats = service.stats(root).items.associateBy { normalizeWorktreePath(it.path) },
                dirty = service.dirty(root).items.associateBy { normalizeWorktreePath(it.path) },
            ),
        )
    }

    private fun notify(project: Project?, type: NotificationType, title: String) {
        ApplicationManager.getApplication().invokeLater {
            val notification = NotificationGroupManager.getInstance()
                .getNotificationGroup("Kilo Code")
                ?.createNotification(title, "", type)
                ?: Notification("Kilo Code", title, "", type)
            notification.notify(project)
        }
    }
}
