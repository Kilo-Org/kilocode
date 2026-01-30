package ai.kilo.plugin.actions

import ai.kilo.plugin.toolwindow.KiloToolWindowFactory
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware

/**
 * Action to toggle the Kilo sidebar visibility.
 */
class ToggleSidebarAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        KiloToolWindowFactory.toggleSidebar(project)
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null
    }
}
