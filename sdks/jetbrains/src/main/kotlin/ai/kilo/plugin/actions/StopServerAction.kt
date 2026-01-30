package ai.kilo.plugin.actions

import ai.kilo.plugin.services.KiloProjectService
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware

/**
 * Action to stop the Kilo server.
 */
class StopServerAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val kiloService = KiloProjectService.getInstance(project)
        kiloService.shutdown()
    }

    override fun update(e: AnActionEvent) {
        val project = e.project
        if (project == null) {
            e.presentation.isEnabledAndVisible = false
            return
        }

        val kiloService = KiloProjectService.getInstance(project)
        e.presentation.isEnabled = kiloService.isReady
    }
}
