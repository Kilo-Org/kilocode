package ai.kilo.plugin.toolwindow

import ai.kilo.plugin.services.KiloProjectService
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
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
         * Toggle the sidebar visibility for the given project.
         */
        fun toggleSidebar(project: Project) {
            mainPanels[project]?.toggleSidebar()
        }

        /**
         * Abort the current generation for the given project.
         */
        fun abortGeneration(project: Project) {
            mainPanels[project]?.abortGeneration()
        }

        /**
         * Remove the main panel reference when project is closed.
         */
        fun removePanel(project: Project) {
            mainPanels.remove(project)
        }
    }
}
