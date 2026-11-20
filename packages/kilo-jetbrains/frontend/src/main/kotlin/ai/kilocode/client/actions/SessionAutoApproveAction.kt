package ai.kilocode.client.actions

import ai.kilocode.client.session.SessionActionsKeys
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ToggleAction
import com.intellij.openapi.project.DumbAware

/**
 * Toggles auto-approve from the session context menu.
 *
 * The setting is IDE-level, not per session: it is stored in `PropertiesComponent` and shared by
 * every session in this IDE. The bundle text says so, because a per-session reading would be wrong.
 */
class SessionAutoApproveAction : ToggleAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        super.update(e)
        val actions = e.getData(SessionActionsKeys.ACTIONS)
        e.presentation.isEnabledAndVisible = actions != null && !actions.readonly
    }

    override fun isSelected(e: AnActionEvent): Boolean = e.getData(SessionActionsKeys.ACTIONS)?.auto == true

    override fun setSelected(e: AnActionEvent, state: Boolean) {
        val actions = e.getData(SessionActionsKeys.ACTIONS) ?: return
        if (actions.readonly) return
        actions.setAuto(state)
    }
}
