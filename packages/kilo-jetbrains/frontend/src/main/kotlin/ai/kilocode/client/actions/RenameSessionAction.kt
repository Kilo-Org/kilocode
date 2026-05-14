package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.history.HistoryDataKeys
import ai.kilocode.client.session.history.title
import ai.kilocode.client.session.SessionManager
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages

class RenameSessionAction : AnAction() {
    /** Overridable in tests to avoid showing a real modal dialog. */
    internal var input: (project: Project?, current: String) -> String? = { project, current ->
        Messages.showInputDialog(
            project,
            KiloBundle.message("history.rename.prompt"),
            KiloBundle.message("history.rename.title"),
            null,
            current,
            null,
        )
    }

    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val selection = e.getData(HistoryDataKeys.SELECTION)
        val manager = e.getData(SessionManager.KEY)
        e.presentation.isEnabledAndVisible = manager != null &&
            selection != null &&
            selection.selectedLocal.size == 1
    }

    override fun actionPerformed(e: AnActionEvent) {
        val selection = e.getData(HistoryDataKeys.SELECTION) ?: return
        val controller = e.getData(HistoryDataKeys.CONTROLLER) ?: return
        val item = selection.selectedLocal.singleOrNull() ?: return

        val current = title(item)
        val newTitle = input(e.project, current)?.trim() ?: return

        if (newTitle.isBlank() || newTitle == current) return
        controller.rename(item, newTitle)
    }
}
