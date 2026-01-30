package ai.kilo.plugin.actions

import ai.kilo.plugin.toolwindow.KiloToolWindowFactory
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.wm.ToolWindowManager

/**
 * Action to focus the Kilo chat input field.
 * Also opens the tool window if it's not visible.
 */
class FocusInputAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Kilo") ?: return

        // Show the tool window if not visible
        if (!toolWindow.isVisible) {
            toolWindow.show()
        }

        // Focus the input via the main panel
        KiloToolWindowFactory.focusInput(project)
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null
    }
}
