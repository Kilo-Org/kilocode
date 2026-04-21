package ai.kilocode.client

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.session.SessionUi
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
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
 * Creates the Kilo Code tool window with a single [SessionUi].
 *
 * Resolves the project directory through the backend (handles split-mode
 * where `project.basePath` is a synthetic frontend path) before creating
 * the workspace. The tool window shows a loading state until resolution
 * completes.
 */
class KiloToolWindowFactory : ToolWindowFactory, DumbAware {

    companion object {
        private val LOG = Logger.getInstance(KiloToolWindowFactory::class.java)
    }

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        try {
            val workspaces = service<KiloWorkspaceService>()
            val sessions = project.service<KiloSessionService>()
            val app = service<KiloAppService>()
            val cs = CoroutineScope(SupervisorJob())
            val hint = project.basePath ?: ""

            cs.launch {
                val dir = workspaces.resolveProjectDirectory(hint)
                val workspace = workspaces.workspace(dir)
                withContext(Dispatchers.Main) {
                    setup(project, toolWindow, workspace, sessions, app, cs)
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
        sessions: KiloSessionService,
        app: KiloAppService,
        cs: CoroutineScope,
    ) {
        try {
            val chat = SessionUi(project, workspace, sessions, app, cs)
            val content = ContentFactory.getInstance()
                .createContent(chat, "", false)
            content.setDisposer(chat)
            toolWindow.contentManager.addContent(content)

            ActionManager.getInstance().getAction("Kilo.Settings")?.let {
                toolWindow.setTitleActions(listOf(it))
            }
        } catch (e: Exception) {
            LOG.error("Failed to set up Kilo tool window content", e)
        }
    }
}
