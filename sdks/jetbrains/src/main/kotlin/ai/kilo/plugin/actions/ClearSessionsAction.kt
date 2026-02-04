package ai.kilo.plugin.actions

import ai.kilo.plugin.services.KiloProjectService
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.Messages
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Action to clear all Kilo chat sessions.
 */
class ClearSessionsAction : AnAction(), DumbAware {
    private val scope = CoroutineScope(Dispatchers.Default)

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return

        val result = Messages.showYesNoDialog(
            project,
            "Are you sure you want to clear all sessions? This cannot be undone.",
            "Clear Sessions",
            Messages.getQuestionIcon()
        )

        if (result == Messages.YES) {
            val kiloService = KiloProjectService.getInstance(project)
            scope.launch {
                kiloService.initialize().onSuccess { services ->
                    services.sessionStore.clearAllSessions()
                }
            }
        }
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null
    }
}
