package ai.kilocode.client.actions

import ai.kilocode.client.session.SessionActionsKeys
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware

/**
 * Forks the session the menu was triggered from. Hidden wherever forking does not apply — the
 * sidebar chat, read-only subagent tabs, and a session that has not been created yet.
 */
class ForkSessionAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.getData(SessionActionsKeys.ACTIONS)?.forkable == true
    }

    override fun actionPerformed(e: AnActionEvent) {
        val actions = e.getData(SessionActionsKeys.ACTIONS) ?: return
        if (actions.forkable) actions.fork()
    }
}
