package ai.kilo.plugin.toolwindow

import ai.kilo.plugin.services.KiloProjectService
import ai.kilo.plugin.toolwindow.components.ChatPanel
import ai.kilo.plugin.toolwindow.components.SessionListPanel
import ai.kilo.plugin.toolwindow.components.SidebarPanel
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.SimpleToolWindowPanel
import com.intellij.ui.JBSplitter
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.*
import java.awt.BorderLayout
import java.awt.GridBagLayout
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import javax.swing.JPanel
import javax.swing.SwingConstants

/**
 * Main panel for the Kilo tool window.
 * Contains a split view with sessions list on the left, chat in the center, and sidebar on the right.
 * 
 * Responsive behavior (matching web client):
 * - Wide screens (>600px): Sidebar auto-shows as inline panel
 * - Narrow screens: Sidebar hidden, can be toggled
 * 
 * Note: Permission and question prompts are now handled inline within ChatPanel
 * rather than as separate dialogs/panels (matching web client UX).
 */
class KiloMainPanel(
    private val project: Project,
    private val kiloService: KiloProjectService
) : SimpleToolWindowPanel(true, true), Disposable {

    companion object {
        // Breakpoint for wide screen (matching web client ~120 chars)
        const val WIDE_BREAKPOINT = 600
    }

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    
    private var sessionListPanel: SessionListPanel? = null
    private var chatPanel: ChatPanel? = null
    private var sidebarPanel: SidebarPanel? = null
    private var initialized = false
    
    private var sidebarMode: String = "auto" // "auto", "show", "hide"
    private var sidebarVisible = false
    private var chatWithSidebarPanel: JPanel? = null
    
    init {
        // Show loading message initially
        showLoadingState()
        
        // Initialize when service is ready
        scope.launch {
            waitForServiceAndInitialize()
        }
    }

    private fun showLoadingState() {
        val loadingLabel = JBLabel("Starting Kilo...", SwingConstants.CENTER)
        val panel = JBPanel<JBPanel<*>>(GridBagLayout())
        panel.add(loadingLabel)
        setContent(panel)
    }

    private fun showErrorState(message: String) {
        val errorLabel = JBLabel("<html><center>Error: $message</center></html>", SwingConstants.CENTER)
        val panel = JBPanel<JBPanel<*>>(GridBagLayout())
        panel.add(errorLabel)
        setContent(panel)
    }

    private suspend fun waitForServiceAndInitialize() {
        // Wait for service to be ready
        var attempts = 0
        while (!kiloService.isReady && attempts < 100) {
            delay(100)
            attempts++
            if (!isDisplayable) return
        }

        if (!kiloService.isReady) {
            withContext(Dispatchers.Main) {
                showErrorState("Kilo service failed to start")
            }
            return
        }

        // Initialize UI on main thread
        withContext(Dispatchers.Main) {
            createMainUI()
        }
    }

    private fun createMainUI() {
        if (initialized) return
        initialized = true
        
        val state = kiloService.state
        if (state == null) {
            showErrorState("Kilo state not available")
            return
        }

        // Create the main splitter (sessions | chat+sidebar)
        val splitter = JBSplitter(false, 0.20f).apply {
            dividerWidth = 1
            border = JBUI.Borders.empty()
        }

        // Create session list panel
        sessionListPanel = SessionListPanel(project, state)
        splitter.firstComponent = sessionListPanel

        // Create chat panel (handles permissions and questions inline)
        chatPanel = ChatPanel(project, state)

        // Create sidebar panel
        sidebarPanel = SidebarPanel(state)

        // Create panel containing chat and sidebar
        chatWithSidebarPanel = JPanel(BorderLayout()).apply {
            add(chatPanel, BorderLayout.CENTER)
            add(sidebarPanel, BorderLayout.EAST)
        }

        splitter.secondComponent = chatWithSidebarPanel

        // Set as content
        setContent(splitter)

        // Add resize listener for responsive sidebar
        addComponentListener(object : ComponentAdapter() {
            override fun componentResized(e: ComponentEvent) {
                updateSidebarVisibility()
            }
        })

        // Initial sidebar visibility
        updateSidebarVisibility()
        
        // Force repaint
        revalidate()
        repaint()

        // Load todos for initial session if any
        scope.launch {
            state.currentSessionId.value?.let { sessionId ->
                state.loadTodos(sessionId)
            }
        }
    }

    private fun updateSidebarVisibility() {
        val isWide = width > WIDE_BREAKPOINT
        
        sidebarVisible = when (sidebarMode) {
            "show" -> true
            "hide" -> false
            "auto" -> isWide
            else -> isWide
        }

        sidebarPanel?.isVisible = sidebarVisible
        chatWithSidebarPanel?.revalidate()
        chatWithSidebarPanel?.repaint()
    }

    /**
     * Toggle the sidebar visibility.
     * Cycles through: auto -> show -> hide -> auto
     */
    fun toggleSidebar() {
        sidebarMode = when (sidebarMode) {
            "auto" -> if (sidebarVisible) "hide" else "show"
            "show" -> "hide"
            "hide" -> "auto"
            else -> "auto"
        }
        updateSidebarVisibility()
    }
    
    /**
     * Focus the chat input field.
     */
    fun focusInput() {
        chatPanel?.focusInput()
    }

    /**
     * Abort the current AI generation.
     */
    fun abortGeneration() {
        chatPanel?.abortGeneration()
    }

    override fun dispose() {
        scope.cancel()
        sessionListPanel?.dispose()
        chatPanel?.dispose()
        sidebarPanel?.dispose()
        KiloToolWindowFactory.removePanel(project)
    }
}
