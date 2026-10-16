package ai.kilocode.client.actions

import ai.kilocode.client.session.SessionActionsKeys
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware

/**
 * Opens the shared agent board viewer for the session the menu was triggered from. Hidden
 * wherever the board does not apply — see [ai.kilocode.client.session.SessionActions.board].
 */
class ShowSessionBoardAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.getData(SessionActionsKeys.ACTIONS)?.board == true
    }

    override fun actionPerformed(e: AnActionEvent) {
        val actions = e.getData(SessionActionsKeys.ACTIONS) ?: return
        if (actions.board) actions.showBoard()
    }
}
