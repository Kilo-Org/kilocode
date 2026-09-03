package ai.kilocode.client.actions

import ai.kilocode.client.session.SessionActionsKeys
import ai.kilocode.client.telemetry.Telemetry
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware

/**
 * Opens the branch diff editor for the session directory: merge-base against the working tree, so it
 * covers commits on the branch plus staged, unstaged, and untracked changes.
 *
 * Hidden when git is unavailable in the session directory. Available in readonly hosts, since it only
 * reads.
 */
class CompareToBaseAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.getData(SessionActionsKeys.ACTIONS)?.git == true
    }

    override fun actionPerformed(e: AnActionEvent) {
        val actions = e.getData(SessionActionsKeys.ACTIONS) ?: return
        if (!actions.git) return
        Telemetry.send("Session Action", mapOf("action" to "compare_to_base"))
        actions.compare()
    }
}
