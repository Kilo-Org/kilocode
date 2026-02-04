package ai.kilo.plugin.actions

import ai.kilo.plugin.ui.KiloToolWindowFactory
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.wm.ToolWindowManager

/**
 * Action to start a new Kilo chat session.
 * Clears the current session and switches to chat view.
 * A new session is created lazily when the user sends their first message.
 */
class NewSessionAction : AnAction(), DumbAware {

    override fun displayTextInToolbar(): Boolean = true

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return

        // Ensure tool window is open
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Kilo")
        toolWindow?.show()

        // Start new session (clears current, switches to chat view)
        KiloToolWindowFactory.startNewSession(project)
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null
        e.presentation.text = "New Session"
    }
}
