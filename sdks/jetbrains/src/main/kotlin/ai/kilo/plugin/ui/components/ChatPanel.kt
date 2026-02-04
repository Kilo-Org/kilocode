package ai.kilo.plugin.ui.components

import ai.kilo.plugin.model.*
import ai.kilo.plugin.services.KiloAppState
import ai.kilo.plugin.store.ChatUiStateManager
import ai.kilo.plugin.ui.KiloTheme
import ai.kilo.plugin.ui.KiloSpacing
import ai.kilo.plugin.ui.KiloTypography
import ai.kilo.plugin.ui.components.chat.ChatDragDropHandler
import ai.kilo.plugin.renderer.ChatUiRenderer
import ai.kilo.plugin.ui.components.header.ChatHeaderPanel
import ai.kilo.plugin.ui.components.input.PromptInputPanel
import com.intellij.icons.AllIcons
import com.intellij.openapi.project.Project
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.*
import java.awt.*
import javax.swing.*

class ChatPanel(
    private val project: Project,
    private val store: ChatUiStateManager,
    private val appState: KiloAppState
) : BorderLayoutPanel() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    // UI Components
    private val messagesPanel = MessagesPanel()
    private val scrollPane: JBScrollPane
    private val promptInput: PromptInputPanel
    private val emptyStateLabel = JBLabel("Start typing to begin a new conversation")
    private val headerPanel = ChatHeaderPanel(scope, appState)
    private val typingIndicator = TypingIndicator()
    private val attachedFilesPanel = AttachedFilesPanel(project, appState)
    private val errorBanner = ErrorBanner(
        onRetry = { scope.launch { store.clearError() } },
        onDismiss = { store.clearError() }
    )

    // Renderer (service #3)
    private val renderer: ChatUiRenderer
    private val dragDropHandler: ChatDragDropHandler

    // Auto-scroll state
    private var autoScroll = true

    init {
        border = JBUI.Borders.empty()
        isOpaque = true
        background = KiloTheme.backgroundStronger

        // Header area
        val headerArea = HeaderArea(headerPanel, errorBanner)
        addToTop(headerArea)

        // Scroll pane for messages
        scrollPane = MessagesScrollPane(messagesPanel)

        // Empty state
        emptyStateLabel.horizontalAlignment = SwingConstants.CENTER
        emptyStateLabel.foreground = KiloTheme.textWeak
        emptyStateLabel.font = emptyStateLabel.font.deriveFont(KiloTypography.fontSizeMedium)

        val contentPanel = ContentPanel(
            emptyStatePanel = EmptyStatePanel(emptyStateLabel),
            messagesScrollPane = scrollPane
        )

        // Content wrapper with typing indicator
        val contentWrapper = BorderLayoutPanel().apply {
            isOpaque = false
            addToCenter(contentPanel)
            addToBottom(typingIndicator)
        }
        typingIndicator.isVisible = false

        addToCenter(contentWrapper)

        // Prompt input
        promptInput = PromptInputPanel(
            project = project,
            store = store,
            appState = appState,
            onSend = { text -> sendMessage(text) },
            onStop = { stopGeneration() }
        )

        val promptArea = PromptArea(
            attachedFilesPanel = attachedFilesPanel,
            promptInput = promptInput
        )
        addToBottom(promptArea)

        // Initialize renderer
        renderer = ChatUiRenderer(project, scope, store, messagesPanel)
        renderer.setListener(createRendererListener(contentPanel))
        renderer.start()

        // Initialize drag-drop handler
        dragDropHandler = ChatDragDropHandler(project, appState, scrollPane)
        dragDropHandler.setup()

        setupAutoScroll()
    }

    private fun createRendererListener(contentPanel: ContentPanel): ChatUiRenderer.Listener {
        return object : ChatUiRenderer.Listener {
            override fun onSessionChanged(session: Session?) {
                headerPanel.updateSession(session)
                if (session == null) {
                    contentPanel.showEmpty()
                } else {
                    contentPanel.showContent()
                }
                promptInput.isEnabled = true
            }

            override fun onStatusChanged(status: SessionStatus?) {
                promptInput.updateStatus(status)
                headerPanel.updateStatus(status)
            }

            override fun onErrorChanged(error: String?) {
                errorBanner.setError(error)
            }

            override fun onStreamingStateChanged(isStreaming: Boolean) {
                updateTypingIndicator()
                messagesPanel.revalidate()
                messagesPanel.repaint()
                scrollToBottomIfNeeded()
            }

            override fun onScrollToBottomNeeded() {
                scrollToBottomIfNeeded()
            }
        }
    }

    private fun updateTypingIndicator() {
        val messages = renderer.messages
        typingIndicator.isVisible = renderer.streaming && messages.isNotEmpty() &&
            messages.last().let { it.info.role == "assistant" && it.info.finish == null }
    }

    private fun setupAutoScroll() {
        val scrollBar = scrollPane.verticalScrollBar
        scrollBar.addAdjustmentListener { e ->
            if (!e.valueIsAdjusting) {
                val extent = scrollBar.model.extent
                val max = scrollBar.model.maximum
                val value = scrollBar.model.value
                autoScroll = value + extent >= max - 50
            }
        }
    }

    private fun scrollToBottomIfNeeded() {
        if (autoScroll) {
            SwingUtilities.invokeLater {
                val vertical = scrollPane.verticalScrollBar
                vertical.value = vertical.maximum
            }
        }
    }

    private fun sendMessage(text: String) {
        if (text.isBlank()) return

        scope.launch {
            val model = appState.selectedModel.value
            val agent = appState.selectedAgent.value
            val files = appState.attachedFiles.value
            store.sendMessage(text, model, agent, files)
            appState.clearAttachedFiles()
        }
    }

    private fun stopGeneration() {
        scope.launch {
            store.abortCurrentSession()
        }
    }

    fun focusInput() {
        promptInput.requestFocusInWindow()
    }

    fun abortGeneration() {
        if (renderer.streaming) {
            stopGeneration()
        }
    }

    fun clearForNewSession() {
        promptInput.clearText()
        appState.clearAttachedFiles()
    }

    fun dispose() {
        scope.cancel()
        renderer.dispose()
        attachedFilesPanel.dispose()
        promptInput.dispose()
    }
}

// ===== Private UI Components =====

private class HeaderArea(
    headerPanel: JComponent,
    errorBanner: JComponent
) : JPanel() {
    init {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        isOpaque = false
        headerPanel.alignmentX = LEFT_ALIGNMENT
        add(headerPanel)
        errorBanner.alignmentX = LEFT_ALIGNMENT
        add(errorBanner)
    }
}

private class MessagesPanel : JBPanel<JBPanel<*>>() {
    init {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        border = JBUI.Borders.empty(KiloSpacing.lg, KiloSpacing.xl)
        isOpaque = true
        background = KiloTheme.backgroundStronger
    }
}

private class MessagesScrollPane(
    messagesPanel: JComponent
) : JBScrollPane(messagesPanel) {
    init {
        border = JBUI.Borders.empty()
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        isOpaque = true
        viewport.isOpaque = true
        viewport.background = KiloTheme.backgroundStronger
    }
}

private class EmptyStatePanel(
    label: JComponent
) : JPanel(GridBagLayout()) {
    init {
        isOpaque = true
        background = KiloTheme.backgroundStronger
        add(label)
    }
}

private class ContentPanel(
    emptyStatePanel: JComponent,
    messagesScrollPane: JComponent
) : JPanel(CardLayout()) {
    init {
        isOpaque = true
        background = KiloTheme.backgroundStronger
        add(emptyStatePanel, "empty")
        add(messagesScrollPane, "content")
    }

    fun showEmpty() {
        (layout as CardLayout).show(this, "empty")
    }

    fun showContent() {
        (layout as CardLayout).show(this, "content")
    }
}

private class FeedbackLabel : JBLabel("Share feedback ↗") {
    init {
        foreground = KiloTheme.textWeak
        font = font.deriveFont(Font.PLAIN, 12f)
        horizontalAlignment = SwingConstants.CENTER
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        border = JBUI.Borders.empty(KiloSpacing.xs, 0, KiloSpacing.md, 0)
    }
}

private class PromptArea(
    attachedFilesPanel: JComponent,
    promptInput: JComponent
) : BorderLayoutPanel() {
    init {
        isOpaque = true
        background = KiloTheme.backgroundStronger
        border = BorderFactory.createCompoundBorder(
            JBUI.Borders.customLine(KiloTheme.borderWeak, 1, 0, 0, 0),
            JBUI.Borders.empty(KiloSpacing.md, KiloSpacing.lg, KiloSpacing.sm, KiloSpacing.lg)
        )
        addToTop(attachedFilesPanel)
        addToCenter(promptInput)
        addToBottom(FeedbackLabel())
    }
}

private class TypingIndicator : JBPanel<JBPanel<*>>(FlowLayout(FlowLayout.LEFT, KiloSpacing.xs, 0)) {
    init {
        isOpaque = true
        background = KiloTheme.backgroundStronger
        border = JBUI.Borders.empty(KiloSpacing.sm, KiloSpacing.xl)

        val label = JBLabel("Generating response...", AllIcons.Process.Step_2, SwingConstants.LEFT).apply {
            foreground = KiloTheme.textWeak
        }
        add(label)
    }
}
