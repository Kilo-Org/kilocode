package ai.kilocode.client

import ai.kilocode.client.actions.HistoryAction
import ai.kilocode.client.actions.NewSessionAction
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.SessionSidePanelManager
import ai.kilocode.log.KiloLog
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Creates the Kilo Code tool window and delegates session content management.
 *
 * Resolves the project directory through the backend (handles split-mode
 * where `project.basePath` is a synthetic frontend path) before creating
 * the workspace. The tool window shows a loading state until resolution
 * completes.
 */
class KiloToolWindowFactory : ToolWindowFactory, DumbAware {

    companion object {
        private val LOG = KiloLog.create(KiloToolWindowFactory::class.java)
    }

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        try {
            val workspaces = service<KiloWorkspaceService>()
            val cs = CoroutineScope(SupervisorJob())
            val hint = project.basePath ?: ""

            cs.launch {
                val dir = workspaces.resolveProjectDirectory(hint)
                val workspace = workspaces.workspace(dir)
                withContext(Dispatchers.Main) {
                    setup(project, toolWindow, workspace)
                }
            }
        } catch (e: Exception) {
            LOG.error("Failed to create Kilo tool window content", e)
        }
    }

    private fun setup(
        project: Project,
        toolWindow: ToolWindow,
        workspace: Workspace,
    ) {
        try {
            val manager = SessionSidePanelManager(project, workspace)
            val content = ContentFactory.getInstance().createContent(manager.component, "", false)
            content.setDisposer(manager)
            content.setPreferredFocusedComponent { manager.defaultFocusedComponent }
            toolWindow.contentManager.addContent(content)
            toolWindow.contentManager.setSelectedContent(content)
            manager.newSession()

            ActionManager.getInstance().getAction("Kilo.Settings")?.let { settings ->
                toolWindow.setTitleActions(listOf(NewSessionAction(), HistoryAction(), settings))
            }
        } catch (e: Exception) {
            LOG.error("Failed to set up Kilo tool window content", e)
        }
    }
}
