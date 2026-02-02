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
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.*
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent

private const val WIDE_BREAKPOINT = 600
private const val SESSION_LIST_PROPORTION = 0.20f

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
    kiloService: KiloProjectService
) : SimpleToolWindowPanel(true, true), Disposable {

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val state = kiloService.state!!

    private val sessionListPanel = SessionListPanel(project, state)
    private val chatPanel = ChatPanel(project, state)
    private val sidebarPanel = SidebarPanel(state)
    private val chatWithSidebarPanel: BorderLayoutPanel

    private var sidebarMode = SidebarMode.AUTO
    private var sidebarVisible = false

    private enum class SidebarMode { AUTO, SHOW, HIDE }

    init {
        chatWithSidebarPanel = BorderLayoutPanel().apply {
            addToCenter(chatPanel)
            addToRight(sidebarPanel)
        }

        val splitter = JBSplitter(false, SESSION_LIST_PROPORTION).apply {
            dividerWidth = 1
            border = JBUI.Borders.empty()
            firstComponent = sessionListPanel
            secondComponent = chatWithSidebarPanel
        }

        setContent(splitter)
        setupResponsiveSidebar()
        loadInitialTodos()
    }

    private fun setupResponsiveSidebar() {
        addComponentListener(object : ComponentAdapter() {
            override fun componentResized(e: ComponentEvent) {
                updateSidebarVisibility()
            }
        })
        updateSidebarVisibility()
    }

    private fun loadInitialTodos() {
        scope.launch {
            state.currentSessionId.value?.let { sessionId ->
                state.loadTodos(sessionId)
            }
        }
    }

    private fun updateSidebarVisibility() {
        val isWide = width > WIDE_BREAKPOINT

        sidebarVisible = when (sidebarMode) {
            SidebarMode.SHOW -> true
            SidebarMode.HIDE -> false
            SidebarMode.AUTO -> isWide
        }

        sidebarPanel.isVisible = sidebarVisible
        chatWithSidebarPanel.revalidate()
        chatWithSidebarPanel.repaint()
    }

    /**
     * Toggle the sidebar visibility.
     * Cycles through: auto -> show -> hide -> auto
     */
    fun toggleSidebar() {
        sidebarMode = when (sidebarMode) {
            SidebarMode.AUTO -> if (sidebarVisible) SidebarMode.HIDE else SidebarMode.SHOW
            SidebarMode.SHOW -> SidebarMode.HIDE
            SidebarMode.HIDE -> SidebarMode.AUTO
        }
        updateSidebarVisibility()
    }

    fun focusInput() = chatPanel.focusInput()

    fun abortGeneration() = chatPanel.abortGeneration()

    override fun dispose() {
        scope.cancel()
        sessionListPanel.dispose()
        chatPanel.dispose()
        sidebarPanel.dispose()
        KiloToolWindowFactory.removePanel(project)
    }
}
