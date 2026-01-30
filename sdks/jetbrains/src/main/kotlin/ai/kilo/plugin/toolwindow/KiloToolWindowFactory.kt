package ai.kilo.plugin.toolwindow

import ai.kilo.plugin.services.KiloProjectService
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ui.content.ContentFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Factory for creating the Kilo tool window.
 */
class KiloToolWindowFactory : ToolWindowFactory, DumbAware {
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val kiloService = KiloProjectService.getInstance(project)

        // Initialize services when tool window is opened
        scope.launch {
            kiloService.initialize()
        }

        // Create the main panel
        val mainPanel = KiloMainPanel(project, kiloService)

        // Register the main panel for static access
        mainPanels[project] = mainPanel

        // Add content to tool window
        val contentFactory = ContentFactory.getInstance()
        val content = contentFactory.createContent(mainPanel, "", false)
        content.isCloseable = false

        toolWindow.contentManager.addContent(content)
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
