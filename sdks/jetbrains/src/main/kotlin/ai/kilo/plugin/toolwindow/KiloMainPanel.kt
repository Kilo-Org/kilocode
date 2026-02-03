package ai.kilo.plugin.toolwindow

import ai.kilo.plugin.services.KiloProjectService
import ai.kilo.plugin.toolwindow.components.ChatPanel
import ai.kilo.plugin.toolwindow.components.SessionListPanel
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.SimpleToolWindowPanel
import kotlinx.coroutines.*
import java.awt.CardLayout
import javax.swing.JPanel
import javax.swing.SwingUtilities

private const val VIEW_CHAT = "chat"
private const val VIEW_SESSIONS = "sessions"

/**
 * Main panel for the Kilo tool window.
 *
 * Layout:
 * - Actions in tool window title bar (set by KiloToolWindowFactory)
 * - Content area: CardLayout switching between Chat and Sessions views
 *
 * Clicking the history icon shows the sessions list.
 * Selecting a session switches back to chat view.
 */
class KiloMainPanel(
    private val project: Project,
    kiloService: KiloProjectService
) : SimpleToolWindowPanel(true, true), Disposable {

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val state = kiloService.state!!

    private val cardLayout = CardLayout()
    private val contentPanel = JPanel(cardLayout)

    private val sessionListPanel: SessionListPanel
    private val chatPanel = ChatPanel(project, state)

    private var currentView = VIEW_CHAT

    init {
        // Create session list panel with callback to switch to chat when session selected
        sessionListPanel = SessionListPanel(project, state) {
            showChat()
        }

        // Setup content panel with card layout
        contentPanel.add(chatPanel, VIEW_CHAT)
        contentPanel.add(sessionListPanel, VIEW_SESSIONS)

        setContent(contentPanel)
        loadInitialTodos()

        // Autofocus input when panel opens
        SwingUtilities.invokeLater {
            focusInput()
        }
    }

    private fun loadInitialTodos() {
        scope.launch {
            state.currentSessionId.value?.let { sessionId ->
                state.loadTodos(sessionId)
            }
        }
    }

    fun showChat() {
        currentView = VIEW_CHAT
        cardLayout.show(contentPanel, VIEW_CHAT)
    }

    fun showSessions() {
        currentView = VIEW_SESSIONS
        cardLayout.show(contentPanel, VIEW_SESSIONS)
    }

    fun toggleSessions() {
        if (currentView == VIEW_SESSIONS) {
            showChat()
        } else {
            showSessions()
        }
    }

    fun focusInput() = chatPanel.focusInput()

    fun abortGeneration() = chatPanel.abortGeneration()

    override fun dispose() {
        scope.cancel()
        sessionListPanel.dispose()
        chatPanel.dispose()
        KiloToolWindowFactory.removePanel(project)
    }
}
