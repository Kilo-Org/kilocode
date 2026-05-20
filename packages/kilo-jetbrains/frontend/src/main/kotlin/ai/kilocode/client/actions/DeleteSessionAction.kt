package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.history.HistoryDataKeys
import ai.kilocode.client.session.SessionManager
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages

class DeleteSessionAction : AnAction() {
    /** Overridable in tests to avoid showing a real modal dialog. */
    internal var confirm: (project: Project?, msg: String) -> Boolean = { project, msg ->
        Messages.showYesNoDialog(
            project,
            msg,
            KiloBundle.message("history.delete.confirm.title"),
            Messages.getWarningIcon(),
        ) == Messages.YES
    }

    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val selection = e.getData(HistoryDataKeys.SELECTION)
        val manager = e.getData(SessionManager.KEY)
        e.presentation.isEnabledAndVisible = manager != null &&
            selection != null &&
            selection.selectedLocal.isNotEmpty()
    }

    override fun actionPerformed(e: AnActionEvent) {
        val selection = e.getData(HistoryDataKeys.SELECTION) ?: return
        val controller = e.getData(HistoryDataKeys.CONTROLLER) ?: return
        val items = selection.selectedLocal.filter { !controller.deleting(it) }
        if (items.isEmpty()) return

        val msg = if (items.size == 1)
            KiloBundle.message("history.delete.confirm.message", ai.kilocode.client.session.history.title(items[0]))
        else
            KiloBundle.message("history.delete.confirm.message.multiple", items.size)

        if (!confirm(e.project, msg)) return
        items.forEach { controller.delete(it) }
    }
}
