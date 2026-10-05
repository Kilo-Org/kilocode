package ai.kilocode.client.actions

import ai.kilocode.client.session.SessionActionsKeys
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ToggleAction
import com.intellij.openapi.project.DumbAware

/** Toggles sandbox confinement for the current session. */
class SessionSandboxAction : ToggleAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        super.update(e)
        val actions = e.getData(SessionActionsKeys.ACTIONS)
        e.presentation.isVisible = actions != null && !actions.readonly && actions.sandbox != null
        e.presentation.isEnabled = e.presentation.isVisible && actions?.sandboxMutable == true
    }

    override fun isSelected(e: AnActionEvent): Boolean = e.getData(SessionActionsKeys.ACTIONS)?.sandbox == true

    override fun setSelected(e: AnActionEvent, state: Boolean) {
        val actions = e.getData(SessionActionsKeys.ACTIONS) ?: return
        if (!actions.sandboxMutable || actions.sandbox == state) return
        actions.toggleSandbox()
    }
}
