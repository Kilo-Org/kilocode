package ai.kilo.plugin.toolwindow

import ai.kilo.plugin.services.KiloProjectService
import ai.kilo.plugin.toolwindow.components.ChatPanel
import ai.kilo.plugin.toolwindow.components.SessionListPanel
import ai.kilo.plugin.toolwindow.components.SidebarPanel
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.SimpleToolWindowPanel
import com.intellij.ui.JBSplitter
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.*
import java.awt.BorderLayout
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import javax.swing.JPanel

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
    private val wideBreakpoint = 600
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    private var sessionListPanel: SessionListPanel? = null
    private var chatPanel: ChatPanel? = null
    private var sidebarPanel: SidebarPanel? = null

    private var sidebarMode: String = "auto" // "auto", "show", "hide"
    private var sidebarVisible = false
    private var chatWithSidebarPanel: JPanel? = null

    private val state = kiloService.state!!

    init {

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
        val isWide = width > wideBreakpoint
        
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
