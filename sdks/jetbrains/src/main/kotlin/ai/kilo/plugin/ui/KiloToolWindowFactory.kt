package ai.kilo.plugin.ui

import ai.kilo.plugin.services.KiloProjectService
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.openapi.wm.ex.ToolWindowEx
import com.intellij.ui.content.ContentFactory
import kotlinx.coroutines.*

/**
 * Factory for creating the Kilo tool window.
 * Handles service initialization and shows loading/error states.
 */
class KiloToolWindowFactory : ToolWindowFactory, DumbAware {
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val kiloService = KiloProjectService.getInstance(project)
        val contentFactory = ContentFactory.getInstance()

        // Set title bar actions
        setupTitleActions(toolWindow)

        val loadingContent = contentFactory.createContent(LoadingPanel(), "", false)
        loadingContent.isCloseable = false
        toolWindow.contentManager.addContent(loadingContent)

        // Initialize service in background, then create UI on main thread
        scope.launch {
            kiloService.initialize()
                .onSuccess {
                    withContext(Dispatchers.Main) {
                        toolWindow.contentManager.removeAllContents(true)
                        val mainPanel = KiloMainPanel(project, kiloService).also { mainPanels[project] = it }
                        val content = contentFactory.createContent(mainPanel, "", false)
                        content.isCloseable = false
                        toolWindow.contentManager.addContent(content)
                    }
                }
                .onFailure {
                    withContext(Dispatchers.Main) {
                        toolWindow.contentManager.removeAllContents(true)
                        val content = contentFactory.createContent(ErrorPanel("Failed to start Kilo"), "", false)
                        toolWindow.contentManager.addContent(content)
                    }
                }
        }
    }

    private fun setupTitleActions(toolWindow: ToolWindow) {
        val actionManager = ActionManager.getInstance()
        val actions = listOfNotNull(
            actionManager.getAction("Kilo.NewSession"),
            actionManager.getAction("Kilo.ToggleSessions"),
            actionManager.getAction("Kilo.ToggleSidebar")
        )
        toolWindow.setTitleActions(actions)

        // Add gear menu actions
        if (toolWindow is ToolWindowEx) {
            val gearActions = DefaultActionGroup().apply {
                actionManager.getAction("Kilo.ClearSessions")?.let { add(it) }
                actionManager.getAction("Kilo.ServerInfo")?.let { add(it) }
                actionManager.getAction("Kilo.MockControl")?.let { add(it) }
                addSeparator()
                actionManager.getAction("Kilo.Toolbar.Settings")?.let { add(it) }
            }
            toolWindow.setAdditionalGearActions(gearActions)
        }
    }

    override fun shouldBeAvailable(project: Project): Boolean {
        // Always available
        return true
    }

    companion object {
        private val mainPanels = mutableMapOf<Project, KiloMainPanel>()

        /**
         * Focus the chat input field for the given project.
         */
        fun focusInput(project: Project) {
            mainPanels[project]?.focusInput()
        }

        /**
         * Toggle the sessions list visibility for the given project.
         */
        fun toggleSessions(project: Project) {
            mainPanels[project]?.toggleSessions()
        }

        /**
         * Check if sessions view is currently active for the given project.
         */
        fun isSessionsViewActive(project: Project): Boolean {
            return mainPanels[project]?.isSessionsViewActive() ?: false
        }

        /**
         * Abort the current generation for the given project.
         */
        fun abortGeneration(project: Project) {
            mainPanels[project]?.abortGeneration()
        }

        /**
         * Start a new session for the given project.
         * Clears current session and switches to chat view.
         */
        fun startNewSession(project: Project) {
            mainPanels[project]?.startNewSession()
        }

        /**
         * Remove the main panel reference when project is closed.
         */
        fun removePanel(project: Project) {
            mainPanels.remove(project)
        }
    }
}
