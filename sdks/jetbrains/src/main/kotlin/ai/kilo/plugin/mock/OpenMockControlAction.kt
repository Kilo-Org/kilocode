package ai.kilo.plugin.mock

import ai.kilo.plugin.settings.KiloSettings
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

/**
 * Action to open the Mock Control dialog.
 * Only visible when mock mode is enabled in settings.
 */
class OpenMockControlAction : AnAction("Mock Control", "Inject mock data for UI testing", null) {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        MockControlDialog(project).show()
    }

    override fun update(e: AnActionEvent) {
        val settings = KiloSettings.getInstance()
        e.presentation.isEnabledAndVisible = e.project != null && settings.state.mockModeEnabled
    }
}
