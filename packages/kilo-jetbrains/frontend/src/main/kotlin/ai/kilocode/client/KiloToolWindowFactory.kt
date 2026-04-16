package ai.kilocode.client

import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob

/**
 * Creates the Kilo Code tool window content.
 *
 * Wires [KiloAppService] and [KiloProjectService] into a
 * [KiloWelcomeUi] panel that shows app + workspace initialization
 * status. All UI logic lives in [KiloWelcomeUi].
 */
class KiloToolWindowFactory : ToolWindowFactory {

    companion object {
        private val LOG = Logger.getInstance(KiloToolWindowFactory::class.java)
    }

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        try {
            val app = service<KiloAppService>()
            val workspace = project.service<KiloProjectService>()
            val scope = CoroutineScope(SupervisorJob())
            val ui = KiloWelcomeUi(app, workspace, scope)

            val content = ContentFactory.getInstance().createContent(ui, "", false)
            content.setDisposer(ui)
            toolWindow.contentManager.addContent(content)

            ActionManager.getInstance().getAction("Kilo.Settings")?.let {
                toolWindow.setTitleActions(listOf(it))
            }
        } catch (e: Exception) {
            LOG.error("Failed to create Kilo tool window content", e)
        }
    }
}
