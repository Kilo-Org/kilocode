package ai.kilo.plugin.actions

import ai.kilo.plugin.ui.KiloToolWindowFactory
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.Toggleable
import com.intellij.openapi.actionSystem.ToggleAction
import com.intellij.openapi.project.DumbAware

/**
 * Action to toggle the sessions list visibility.
 * Shows as selected (with background) when sessions panel is active.
 */
class ToggleSessionsAction : ToggleAction(), DumbAware {
    override fun isSelected(e: AnActionEvent): Boolean {
        val project = e.project ?: return false
        return KiloToolWindowFactory.isSessionsViewActive(project)
    }

    override fun setSelected(e: AnActionEvent, state: Boolean) {
        val project = e.project ?: return
        KiloToolWindowFactory.toggleSessions(project)
    }

    override fun update(e: AnActionEvent) {
        super.update(e)
        e.presentation.isEnabledAndVisible = e.project != null
    }
}
