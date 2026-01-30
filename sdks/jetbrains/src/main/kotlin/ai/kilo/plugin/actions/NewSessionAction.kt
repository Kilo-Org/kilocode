package ai.kilo.plugin.actions

import ai.kilo.plugin.services.KiloProjectService
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.wm.ToolWindowManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Action to create a new Kilo chat session.
 */
class NewSessionAction : AnAction(), DumbAware {
    private val scope = CoroutineScope(Dispatchers.Default)

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val kiloService = KiloProjectService.getInstance(project)

        // Ensure tool window is open
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Kilo")
        toolWindow?.show()

        // Create new session
        scope.launch {
            if (!kiloService.isReady) {
                kiloService.initialize()
            }
            kiloService.state?.createSession()
        }
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null
    }
}
