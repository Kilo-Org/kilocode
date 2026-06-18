package ai.kilocode.client.actions

import ai.kilocode.client.session.history.HistoryDataKeys
import ai.kilocode.client.session.SessionManager
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

class OpenSessionAction : AnAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val selection = e.getData(HistoryDataKeys.SELECTION)
        val manager = e.getData(SessionManager.KEY)
        e.presentation.isEnabledAndVisible = manager != null &&
            selection != null &&
            (selection.selectedLocal.size == 1 || selection.cloudItems.size == 1)
    }

    override fun actionPerformed(e: AnActionEvent) {
        val selection = e.getData(HistoryDataKeys.SELECTION) ?: return
        val controller = e.getData(HistoryDataKeys.CONTROLLER) ?: return
        selection.selectedLocal.singleOrNull()?.let { controller.open(it); return }
        selection.cloudItems.singleOrNull()?.let { controller.open(it) }
    }
}
