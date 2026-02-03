package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.model.*
import ai.kilo.plugin.services.KiloEventService
import ai.kilo.plugin.services.KiloStateService
import ai.kilo.plugin.settings.KiloSettings
import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloTypography
import ai.kilo.plugin.toolwindow.KiloRadius
import ai.kilo.plugin.toolwindow.KiloSizes
import com.intellij.icons.AllIcons
import com.intellij.ide.CopyPasteManagerEx
import com.intellij.openapi.project.Project
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import java.awt.*
import java.awt.datatransfer.DataFlavor
import java.awt.datatransfer.StringSelection
import java.awt.dnd.*
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import javax.swing.*
import javax.swing.border.EmptyBorder

/**
 * Data class holding pending permission and question requests.
 */
data class PendingRequests(
    val permissions: List<PermissionRequest> = emptyList(),
    val questions: List<QuestionRequest> = emptyList()
) {
    fun getPermissionForTool(callID: String?): PermissionRequest? {
        if (callID == null) return null
        return permissions.find { it.tool?.callID == callID }
    }

    fun getQuestionForTool(callID: String?): QuestionRequest? {
        if (callID == null) return null
        return questions.find { it.tool?.callID == callID }
    }
}

/**
 * Panel displaying the chat conversation and input.
 * Permission and question prompts are displayed inline with tool parts.
 * 
 * Redesigned to match web client UI/UX patterns.
 */
class ChatPanel(
    private val project: Project,
    private val stateService: KiloStateService
) : JPanel(BorderLayout()) {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val messagesPanel = JBPanel<JBPanel<*>>()
    private val scrollPane: JBScrollPane
    private val promptInput: PromptInputPanel
    private val emptyStateLabel = JBLabel("Start typing to begin a new conversation")
    private val headerPanel = HeaderPanel()
    
    private var currentSessionId: String? = null
    private var currentAgent: String? = null
    private var autoScroll = true
    private var lastMessageCount = 0
    private var isStreaming = false
    private val typingIndicator = TypingIndicator()
    
    private var pendingRequests = PendingRequests()
    private var currentMessages: List<MessageWithParts> = emptyList()
    private val toolPartWrappers = mutableListOf<ToolPartWrapper>()
    
    private val attachedFilesPanel = AttachedFilesPanel(project, stateService)
    private var fileAutocomplete: FileAutocomplete? = null
    
    private val errorBanner = ErrorBanner(
        onRetry = { scope.launch { stateService.clearError() } },
        onDismiss = { stateService.clearError() }
    )
    
    init {
        border = JBUI.Borders.empty()
        isOpaque = true
        background = KiloTheme.backgroundStronger

        val headerArea = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
        }
        headerPanel.alignmentX = LEFT_ALIGNMENT
        headerArea.add(headerPanel)
        errorBanner.alignmentX = LEFT_ALIGNMENT
        headerArea.add(errorBanner)
        add(headerArea, BorderLayout.NORTH)

        // Messages area
        messagesPanel.layout = BoxLayout(messagesPanel, BoxLayout.Y_AXIS)
        messagesPanel.border = JBUI.Borders.empty(KiloSpacing.lg, KiloSpacing.xl)
        messagesPanel.isOpaque = true
        messagesPanel.background = KiloTheme.backgroundStronger

        scrollPane = JBScrollPane(messagesPanel).apply {
            border = JBUI.Borders.empty()
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            isOpaque = true
            viewport.isOpaque = true
            viewport.background = KiloTheme.backgroundStronger
        }

        // Empty state
        emptyStateLabel.horizontalAlignment = SwingConstants.CENTER
        emptyStateLabel.foreground = KiloTheme.textWeak
        emptyStateLabel.font = emptyStateLabel.font.deriveFont(KiloTypography.fontSizeMedium)

        // Card layout for empty/content
        val contentPanel = JPanel(CardLayout()).apply {
            isOpaque = true
            background = KiloTheme.backgroundStronger
            add(createCenteredPanel(emptyStateLabel), "empty")
            add(scrollPane, "content")
        }
        add(contentPanel, BorderLayout.CENTER)

        // Prompt input with attached files above it and feedback below
        val promptArea = JPanel(BorderLayout()).apply {
            isOpaque = true
            background = KiloTheme.backgroundStronger
            border = BorderFactory.createCompoundBorder(
                JBUI.Borders.customLine(KiloTheme.borderWeak, 1, 0, 0, 0),
                JBUI.Borders.empty(KiloSpacing.md, KiloSpacing.lg, KiloSpacing.sm, KiloSpacing.lg)
            )

            // Attached files panel above input
            add(attachedFilesPanel, BorderLayout.NORTH)
        }

        promptInput = PromptInputPanel(
            project = project,
            stateService = stateService,
            onSend = { text -> sendMessage(text) },
            onStop = { stopGeneration() }
        )
        promptArea.add(promptInput, BorderLayout.CENTER)

        // Feedback link below input
        val feedbackLabel = JBLabel("Share feedback ↗").apply {
            foreground = KiloTheme.textWeak
            font = font.deriveFont(Font.PLAIN, 12f)
            horizontalAlignment = SwingConstants.CENTER
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            border = JBUI.Borders.empty(KiloSpacing.xs, 0, KiloSpacing.md, 0)
        }
        promptArea.add(feedbackLabel, BorderLayout.SOUTH)

        add(promptArea, BorderLayout.SOUTH)
        
        // Subscribe to state
        subscribeToState(contentPanel)

        // Auto-scroll handling
        setupAutoScroll()

        setupDragAndDrop()
    }

    private fun createCenteredPanel(component: JComponent): JPanel {
        return JPanel(GridBagLayout()).apply {
            isOpaque = true
            background = KiloTheme.backgroundStronger
            add(component)
        }
    }

    private fun subscribeToState(contentPanel: JPanel) {
        val cardLayout = contentPanel.layout as CardLayout

        // Subscribe to current session
        scope.launch {
            combine(
                stateService.currentSessionId,
                stateService.sessions
            ) { sessionId, sessions ->
                sessionId?.let { id -> sessions.find { it.id == id } }
            }.collectLatest { session ->
                currentSessionId = session?.id
                headerPanel.updateSession(session)

                if (session == null) {
                    cardLayout.show(contentPanel, "empty")
                } else {
                    cardLayout.show(contentPanel, "content")
                }
                // Input is always enabled - will auto-create session on send
                promptInput.isEnabled = true
            }
        }

        // Subscribe to messages for current session
        scope.launch {
            stateService.currentSessionId.collectLatest { sessionId ->
                if (sessionId != null) {
                    stateService.getMessagesForSession(sessionId).collectLatest { messages ->
                        currentMessages = messages
                        // Extract agent from last user message
                        val lastUser = messages.lastOrNull { it.info.role == "user" }
                        currentAgent = lastUser?.info?.agent
                        updateMessages()
                    }
                }
            }
        }

        // Subscribe to session status for current session
        scope.launch {
            combine(
                stateService.currentSessionId,
                stateService.sessionStatuses
            ) { sessionId, statuses ->
                sessionId?.let { statuses[it] }
            }.collectLatest { status ->
                promptInput.updateStatus(status)
                updateStreamingState(status)
            }
        }

        scope.launch {
            combine(
                stateService.pendingPermissions,
                stateService.pendingQuestions
            ) { permissions, questions ->
                PendingRequests(permissions, questions)
            }.collectLatest { pending ->
                pendingRequests = pending
                // Re-render messages when pending requests change
                updateMessages()
            }
        }
        
        scope.launch {
            stateService.error.collectLatest { error ->
                errorBanner.setError(error)
            }
        }
    }

    private fun updateMessages() {
        val messages = currentMessages
        
        // Check if this is a streaming update (same message count, likely content change)
        val isIncrementalUpdate = messages.size == lastMessageCount && messages.isNotEmpty()
        lastMessageCount = messages.size

        // Dispose old tool part wrappers
        toolPartWrappers.forEach { it.dispose() }
        toolPartWrappers.clear()

        // Full rebuild
        messagesPanel.removeAll()

        for (messageWithParts in messages) {
            val messageView = MessageView(
                messageWithParts = messageWithParts,
                pendingRequests = pendingRequests,
                agentColor = KiloTheme.getAgentColor(currentAgent),
                onPermissionReply = { requestId, reply ->
                    scope.launch { stateService.replyPermission(requestId, reply) }
                },
                onQuestionReply = { requestId, answers ->
                    scope.launch { stateService.replyQuestion(requestId, answers) }
                },
                onQuestionReject = { requestId ->
                    scope.launch { stateService.rejectQuestion(requestId) }
                },
                isStreaming = isStreaming,
                toolPartWrappers = toolPartWrappers,
                onFork = { messageId ->
                    currentSessionId?.let { sessionId ->
                        scope.launch { stateService.forkSession(sessionId, messageId) }
                    }
                },
                onRevert = { messageId ->
                    currentSessionId?.let { sessionId ->
                        scope.launch { stateService.revertToMessage(sessionId, messageId, restoreFiles = true) }
                    }
                }
            )
            messageView.alignmentX = Component.LEFT_ALIGNMENT
            messagesPanel.add(messageView)
            messagesPanel.add(Box.createVerticalStrut(KiloSpacing.xxl)) // 18px gap like web client
        }

        // Show typing indicator if streaming and last message is from assistant
        if (isStreaming && messages.isNotEmpty()) {
            val last = messages.last()
            if (last.info.role == "assistant" && last.info.finish == null) {
                typingIndicator.alignmentX = Component.LEFT_ALIGNMENT
                messagesPanel.add(typingIndicator)
                messagesPanel.add(Box.createVerticalStrut(KiloSpacing.lg))
            }
        }

        // Add spacer at bottom
        messagesPanel.add(Box.createVerticalGlue())

        messagesPanel.revalidate()
        messagesPanel.repaint()

        // Auto-scroll to bottom
        if (autoScroll) {
            SwingUtilities.invokeLater {
                val vertical = scrollPane.verticalScrollBar
                vertical.value = vertical.maximum
            }
        }
    }

    private fun updateStreamingState(status: SessionStatus?) {
        val wasStreaming = isStreaming
        isStreaming = status?.type == "busy" || status?.type == "retry"

        // If streaming state changed, trigger a repaint
        if (wasStreaming != isStreaming) {
            messagesPanel.revalidate()
            messagesPanel.repaint()
        }
    }

    private fun setupAutoScroll() {
        val scrollBar = scrollPane.verticalScrollBar
        scrollBar.addAdjustmentListener { e ->
            if (!e.valueIsAdjusting) {
                val extent = scrollBar.model.extent
                val max = scrollBar.model.maximum
                val value = scrollBar.model.value

                // If user scrolled up (not at bottom), disable auto-scroll
                autoScroll = value + extent >= max - 50
            }
        }
    }

    /**
     * Setup drag and drop support for file attachment.
     * Users can drag files from the project explorer or file system
     * into the chat area to attach them as context.
     */
    private fun setupDragAndDrop() {
        val dropTargetListener = object : DropTargetAdapter() {
            private var originalBorder: javax.swing.border.Border? = null

            override fun dragEnter(event: DropTargetDragEvent) {
                if (isFileDropSupported(event)) {
                    event.acceptDrag(DnDConstants.ACTION_COPY)
                    // Show visual feedback - highlight border
                    originalBorder = scrollPane.border
                    scrollPane.border = BorderFactory.createCompoundBorder(
                        BorderFactory.createLineBorder(KiloTheme.borderWarning, 2),
                        JBUI.Borders.empty()
                    )
                } else {
                    event.rejectDrag()
                }
            }

            override fun dragOver(event: DropTargetDragEvent) {
                if (isFileDropSupported(event)) {
                    event.acceptDrag(DnDConstants.ACTION_COPY)
                } else {
                    event.rejectDrag()
                }
            }

            override fun dragExit(event: DropTargetEvent) {
                // Restore original border
                scrollPane.border = originalBorder ?: JBUI.Borders.empty()
            }

            override fun drop(event: DropTargetDropEvent) {
                // Restore original border
                scrollPane.border = originalBorder ?: JBUI.Borders.empty()

                try {
                    if (!event.isDataFlavorSupported(DataFlavor.javaFileListFlavor)) {
                        event.rejectDrop()
                        return
                    }

                    event.acceptDrop(DnDConstants.ACTION_COPY)
                    val transferable = event.transferable
                    
                    @Suppress("UNCHECKED_CAST")
                    val files = transferable.getTransferData(DataFlavor.javaFileListFlavor) as? List<File>
                    
                    files?.forEach { file ->
                        addDroppedFile(file)
                    }

                    event.dropComplete(true)
                } catch (e: Exception) {
                    event.dropComplete(false)
                }
            }

            private fun isFileDropSupported(event: DropTargetDragEvent): Boolean {
                return event.isDataFlavorSupported(DataFlavor.javaFileListFlavor)
            }
        }

        // Apply drop target to the scroll pane
        scrollPane.dropTarget = DropTarget(scrollPane, DnDConstants.ACTION_COPY, dropTargetListener, true)
    }

    /**
     * Add a dropped file to the attached files context.
     */
    private fun addDroppedFile(file: File) {
        val basePath = project.basePath
        val relativePath = if (basePath != null && file.absolutePath.startsWith(basePath)) {
            file.absolutePath.removePrefix(basePath).removePrefix("/").removePrefix("\\")
        } else {
            file.name
        }

        val mime = if (file.isDirectory) "application/x-directory" else "text/plain"

        val attachedFile = KiloStateService.AttachedFile(
            absolutePath = file.absolutePath,
            relativePath = relativePath,
            startLine = null,
            endLine = null,
            mime = mime
        )

        stateService.addFileToContext(attachedFile)
    }
    
    private fun sendMessage(text: String) {
        if (text.isBlank()) return

        scope.launch {
            stateService.sendMessage(text)
        }
    }

    private fun stopGeneration() {
        scope.launch {
            stateService.abortCurrentSession()
        }
    }

    /**
     * Focus the prompt input field.
     */
    fun focusInput() {
        promptInput.requestFocusInWindow()
    }



    /**
     * Abort the current AI generation.
     */
    fun abortGeneration() {
        if (isStreaming) {
            stopGeneration()
        }
    }

    fun dispose() {
        scope.cancel()
        toolPartWrappers.forEach { it.dispose() }
        toolPartWrappers.clear()
        attachedFilesPanel.dispose()
        promptInput.dispose()
    }

    /**
     * Header panel showing session info and connection status.
     */
    private inner class HeaderPanel : JPanel(BorderLayout()) {
        private val titleLabel = JBLabel()
        private val statusLabel = JBLabel()
        private val connectionIndicator = JBLabel()

        init {
            border = JBUI.Borders.compound(
                JBUI.Borders.customLine(KiloTheme.borderWeak, 0, 0, 1, 0),
                JBUI.Borders.empty(KiloSpacing.md, KiloSpacing.lg)
            )
            background = KiloTheme.backgroundStronger
            isOpaque = true

            // Left: connection indicator + title
            val leftPanel = JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.xs, 0)).apply {
                isOpaque = false
            }

            connectionIndicator.text = "\u25CF" // Filled circle
            connectionIndicator.font = connectionIndicator.font.deriveFont(KiloTypography.fontSizeXSmall)
            connectionIndicator.toolTipText = "Connection status"
            leftPanel.add(connectionIndicator)

            titleLabel.font = titleLabel.font.deriveFont(Font.BOLD, KiloTypography.fontSizeMedium)
            titleLabel.foreground = KiloTheme.textStrong
            leftPanel.add(titleLabel)

            add(leftPanel, BorderLayout.CENTER)

            statusLabel.foreground = KiloTheme.textWeak
            statusLabel.font = statusLabel.font.deriveFont(KiloTypography.fontSizeBase)
            add(statusLabel, BorderLayout.EAST)

            // Subscribe to connection status
            subscribeToConnectionStatus()
        }

        private fun subscribeToConnectionStatus() {
            scope.launch {
                stateService.connectionStatus.collectLatest { status ->
                    updateConnectionIndicator(status)
                }
            }
        }

        private fun updateConnectionIndicator(status: KiloEventService.ConnectionStatus) {
            when (status) {
                KiloEventService.ConnectionStatus.CONNECTED -> {
                    connectionIndicator.foreground = KiloTheme.iconSuccessActive
                    connectionIndicator.toolTipText = "Connected"
                }
                KiloEventService.ConnectionStatus.DISCONNECTED -> {
                    connectionIndicator.foreground = KiloTheme.iconCritical
                    connectionIndicator.toolTipText = "Disconnected"
                }
                KiloEventService.ConnectionStatus.RECONNECTING -> {
                    connectionIndicator.foreground = KiloTheme.iconWarningActive
                    connectionIndicator.toolTipText = "Reconnecting..."
                }
                KiloEventService.ConnectionStatus.ERROR -> {
                    connectionIndicator.foreground = KiloTheme.iconCritical
                    connectionIndicator.toolTipText = "Connection error"
                }
            }
        }

        fun updateSession(session: Session?) {
            titleLabel.text = session?.title?.ifBlank { "Untitled" } ?: ""
            titleLabel.icon = if (session != null) AllIcons.General.Balloon else null
        }

        fun updateStatus(status: SessionStatus?) {
            statusLabel.text = when (status?.type) {
                "busy" -> "Thinking..."
                "retry" -> "Retrying (${status.attempt ?: 0})..."
                else -> ""
            }
        }
    }
}

/**
 * Typing indicator shown while assistant is generating response.
 * Redesigned with theme colors and pulsing animation.
 */
private class TypingIndicator : JBPanel<JBPanel<*>>(FlowLayout(FlowLayout.LEFT, KiloSpacing.xs, KiloSpacing.xs)) {
    init {
        isOpaque = false
        border = JBUI.Borders.emptyLeft(KiloSpacing.xxxl)

        val label = JBLabel("Generating response", AllIcons.Process.Step_2, SwingConstants.LEFT).apply {
            foreground = KiloTheme.textWeak
            font = font.deriveFont(Font.ITALIC, KiloTypography.fontSizeBase)
        }
        add(label)

        // Add animated dots
        val dots = JBLabel("...").apply {
            foreground = KiloTheme.textWeak
            font = font.deriveFont(Font.ITALIC, KiloTypography.fontSizeBase)
        }
        add(dots)
    }
}

/**
 * Individual message view component.
 * Now supports inline permission and question prompts for tool parts.
 */
private class MessageView(
    private val messageWithParts: MessageWithParts,
    private val pendingRequests: PendingRequests,
    private val agentColor: Color,
    private val onPermissionReply: (requestId: String, reply: String) -> Unit,
    private val onQuestionReply: (requestId: String, answers: List<List<String>>) -> Unit,
    private val onQuestionReject: (requestId: String) -> Unit,
    private val isStreaming: Boolean = false,
    private val toolPartWrappers: MutableList<ToolPartWrapper>,
    private val onFork: ((String) -> Unit)? = null,
    private val onRevert: ((String) -> Unit)? = null
) : JBPanel<JBPanel<*>>() {

    companion object {
        private val timeFormat = SimpleDateFormat("HH:mm")
        private val dateFormat = SimpleDateFormat("MMM d, HH:mm")
    }

    init {
        layout = BorderLayout()
        isOpaque = true

        val message = messageWithParts.info
        val isUser = message.role == "user"

        // Background and border styling (matching web client)
        if (isUser) {
            background = KiloTheme.surfaceRaisedBase
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createMatteBorder(0, 3, 0, 0, agentColor),
                BorderFactory.createCompoundBorder(
                    JBUI.Borders.customLine(KiloTheme.borderWeaker, 1),
                    JBUI.Borders.empty(KiloSpacing.lg, KiloSpacing.xl)
                )
            )
        } else {
            background = KiloTheme.backgroundStronger
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createMatteBorder(0, 1, 0, 0, KiloTheme.borderBase),
                JBUI.Borders.empty(KiloSpacing.lg, KiloSpacing.xl)
            )
        }

        val header = JPanel(BorderLayout()).apply {
            isOpaque = false
        }

        // Left side: role icon and label
        val leftHeader = JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.sm, 0)).apply {
            isOpaque = false
            val icon = if (isUser) AllIcons.General.User else AllIcons.Nodes.Favorite
            val roleLabel = JBLabel(if (isUser) "You" else "Assistant", icon, SwingConstants.LEFT)
            roleLabel.font = roleLabel.font.deriveFont(Font.BOLD, KiloTypography.fontSizeBase)
            roleLabel.foreground = KiloTheme.textStrong
            add(roleLabel)

            // Timestamp
            val timestamp = formatTimestamp(message.time.created)
            val timeLabel = JBLabel(timestamp).apply {
                foreground = KiloTheme.textWeaker
                font = font.deriveFont(KiloTypography.fontSizeSmall)
            }
            add(timeLabel)
        }
        header.add(leftHeader, BorderLayout.WEST)

        // Right side: action buttons (visible on hover)
        val actionsPanel = createActionsPanel(message)
        header.add(actionsPanel, BorderLayout.EAST)

        add(header, BorderLayout.NORTH)
        
        // Content
        val contentPanel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
            border = JBUI.Borders.emptyTop(KiloSpacing.md)
        }

        for (part in messageWithParts.parts) {
            val partView = createPartView(part)
            partView.alignmentX = Component.LEFT_ALIGNMENT
            contentPanel.add(partView)
            contentPanel.add(Box.createVerticalStrut(KiloSpacing.md))
        }

        if (!isUser && (message.tokens != null || message.cost != null)) {
            contentPanel.add(Box.createVerticalStrut(KiloSpacing.md))
            contentPanel.add(createFooter(message))
        }
        
        add(contentPanel, BorderLayout.CENTER)
    }

    private fun formatTimestamp(timestamp: Long): String {
        val now = System.currentTimeMillis()
        val diff = now - timestamp

        return when {
            diff < 60_000 -> "just now"
            diff < 3600_000 -> "${diff / 60_000}m ago"
            diff < 86400_000 -> timeFormat.format(Date(timestamp))
            else -> dateFormat.format(Date(timestamp))
        }
    }

    private fun createActionsPanel(message: Message): JPanel {
        return JPanel(FlowLayout(FlowLayout.RIGHT, KiloSpacing.xxs, 0)).apply {
            isOpaque = false

            // Copy button
            val copyButton = createActionButton(AllIcons.Actions.Copy, "Copy message") {
                val text = messageWithParts.parts
                    .filter { it.type == "text" }
                    .mapNotNull { it.text }
                    .joinToString("\n\n")
                if (text.isNotBlank()) {
                    CopyPasteManagerEx.getInstance().setContents(StringSelection(text))
                }
            }
            add(copyButton)

            // Fork button (assistant messages only)
            if (!message.isUser && onFork != null) {
                val forkButton = createActionButton(AllIcons.Vcs.Branch, "Fork from here") {
                    onFork.invoke(message.id)
                }
                add(forkButton)
            }

            // Revert button (assistant messages only)
            if (!message.isUser && onRevert != null) {
                val revertButton = createActionButton(AllIcons.Actions.Rollback, "Revert to here") {
                    onRevert.invoke(message.id)
                }
                add(revertButton)
            }
        }
    }

    private fun createActionButton(icon: Icon, tooltip: String, action: () -> Unit): JButton {
        return JButton(icon).apply {
            this.toolTipText = tooltip
            isFocusable = false
            isContentAreaFilled = false
            isBorderPainted = false
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            preferredSize = Dimension(KiloSizes.iconLg, KiloSizes.iconLg)
            foreground = KiloTheme.iconWeak
            addActionListener { action() }

            addMouseListener(object : MouseAdapter() {
                override fun mouseEntered(e: MouseEvent) {
                    background = KiloTheme.buttonGhostHover
                    isContentAreaFilled = true
                }
                override fun mouseExited(e: MouseEvent) {
                    isContentAreaFilled = false
                }
            })
        }
    }

    private fun createFooter(message: Message): JComponent {
        val footer = JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.md, 0)).apply {
            isOpaque = false
            alignmentX = Component.LEFT_ALIGNMENT
        }

        // Token usage
        message.tokens?.let { tokens ->
            val totalTokens = tokens.input + tokens.output + tokens.reasoning
            val tokenText = buildString {
                append("${totalTokens} tokens")
                if (tokens.reasoning > 0) {
                    append(" (${tokens.reasoning} reasoning)")
                }
            }
            footer.add(JBLabel(tokenText).apply {
                foreground = KiloTheme.textWeaker
                font = font.deriveFont(KiloTypography.fontSizeSmall)
                icon = AllIcons.Actions.InlayGlobe
            })
        }

        // Cost
        message.cost?.let { cost ->
            if (cost > 0) {
                val costText = String.format("$%.4f", cost)
                footer.add(JBLabel(costText).apply {
                    foreground = KiloTheme.textWeaker
                    font = font.deriveFont(KiloTypography.fontSizeSmall)
                })
            }
        }

        // Model info
        message.modelID?.let { modelId ->
            footer.add(JBLabel(modelId).apply {
                foreground = KiloTheme.textWeaker
                font = font.deriveFont(KiloTypography.fontSizeSmall)
            })
        }

        return footer
    }
    
    private fun createPartView(part: Part): JComponent {
        return when (part.type) {
            "text" -> createTextPartView(part)
            "tool" -> createToolPartView(part)
            "reasoning" -> createReasoningPartView(part)
            "step-start" -> createStepStartView(part)
            "step-finish" -> createStepFinishView(part)
            else -> JBLabel("${part.type}").apply { foreground = KiloTheme.textWeak }
        }
    }

    private fun createTextPartView(part: Part): JComponent {
        val text = part.text ?: ""

        // Use MarkdownPanel for proper markdown rendering
        val markdownPanel = MarkdownPanel().apply {
            isOpaque = false
            border = JBUI.Borders.empty(KiloSpacing.xs)
            setMarkdown(text)
        }

        return markdownPanel
    }
    
    private fun createToolPartView(part: Part): JComponent {
        val permission = pendingRequests.getPermissionForTool(part.callID)
        val question = pendingRequests.getQuestionForTool(part.callID)

        // If there's a pending permission or question, use ToolPartWrapper
        if (permission != null || question != null) {
            val wrapper = ToolPartWrapper(
                part = part,
                permission = permission,
                question = question,
                onPermissionReply = onPermissionReply,
                onQuestionReply = onQuestionReply,
                onQuestionReject = onQuestionReject
            )
            toolPartWrappers.add(wrapper)
            return wrapper
        }

        // Otherwise use simple tool display
        return createSimpleToolPartView(part)
    }

    private fun createSimpleToolPartView(part: Part): JComponent {
        return CollapsibleToolPanel(part)
    }

    private fun createReasoningPartView(part: Part): JComponent {
        val panel = JPanel(BorderLayout()).apply {
            isOpaque = true
            background = KiloTheme.surfaceInfo
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createMatteBorder(0, 3, 0, 0, KiloTheme.borderInfo),
                JBUI.Borders.empty(KiloSpacing.md)
            )
        }

        val header = JBLabel("Thinking...", AllIcons.General.InspectionsEye, SwingConstants.LEFT).apply {
            font = font.deriveFont(Font.ITALIC, KiloTypography.fontSizeBase)
            foreground = KiloTheme.textWeak
        }
        panel.add(header, BorderLayout.NORTH)

        // Reasoning parts use "text" for the content
        val reasoningText = part.text
        if (reasoningText != null && reasoningText.isNotBlank()) {
            val content = JBLabel("<html>${reasoningText.take(200)}${if (reasoningText.length > 200) "..." else ""}</html>").apply {
                foreground = KiloTheme.textWeak
            }
            panel.add(content, BorderLayout.CENTER)
        }

        return panel
    }

    private fun createStepStartView(part: Part): JComponent {
        return JBLabel("Step started", AllIcons.Actions.Execute, SwingConstants.LEFT).apply {
            foreground = KiloTheme.textWeak
            font = font.deriveFont(Font.ITALIC, KiloTypography.fontSizeBase)
        }
    }

    private fun createStepFinishView(part: Part): JComponent {
        val reason = part.reason ?: "completed"
        return JBLabel("Step finished: $reason", AllIcons.Actions.Checked, SwingConstants.LEFT).apply {
            foreground = KiloTheme.textWeak
            font = font.deriveFont(Font.ITALIC, KiloTypography.fontSizeBase)
        }
    }
}

// ========== Mode Data ==========

private val modeNames = listOf("Code", "Architect", "Ask", "Debug")

// ========== Mode Selector Component ==========

private class ModeSelector : JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)) {

    private var selectedMode = modeNames[0] // Default to Code
    private val modeLabel = JBLabel("$selectedMode \u25BE").apply {
        foreground = KiloTheme.textWeak
        font = font.deriveFont(13f)
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    init {
        isOpaque = false
        add(modeLabel)

        modeLabel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                showModePopup()
            }
            override fun mouseEntered(e: MouseEvent) {
                modeLabel.foreground = KiloTheme.textInteractive
            }
            override fun mouseExited(e: MouseEvent) {
                modeLabel.foreground = KiloTheme.textWeak
            }
        })
    }

    private fun showModePopup() {
        val popup = JPopupMenu().apply {
            add(JLabel("  Mode").apply {
                font = font.deriveFont(Font.BOLD)
                border = JBUI.Borders.empty(8, 8, 4, 8)
            })
            addSeparator()

            for (mode in modeNames) {
                add(JMenuItem(mode).apply {
                    if (mode == selectedMode) {
                        icon = AllIcons.Actions.Checked
                    }
                    addActionListener {
                        selectedMode = mode
                        modeLabel.text = "$mode \u25BE"
                    }
                })
            }
        }
        popup.show(modeLabel, 0, -popup.preferredSize.height)
    }

    fun getSelectedMode(): String = selectedMode
}

/**
 * Simple input component with mode selector, attachment popup, and send functionality.
 */
private class PromptInputPanel(
    private val project: Project,
    private val stateService: KiloStateService,
    private val onSend: (String) -> Unit,
    private val onStop: () -> Unit
) : JPanel() {

    private val focusedColor = JBColor(0x3574F0, 0x3574F0)
    private val unfocusedColor = KiloTheme.borderWeak
    private var borderColor = unfocusedColor
    private var isFocused = false
    private var isExpanded = false
    private var isBusy = false
    private val collapsedHeight = 120
    private val expandedHeight = 300

    private val textArea = com.intellij.ui.components.JBTextArea().apply {
        lineWrap = true
        wrapStyleWord = true
        rows = 2
        border = JBUI.Borders.empty()
        isOpaque = false
        background = KiloTheme.surfaceRaisedStrong
        foreground = KiloTheme.textBase
        caretColor = KiloTheme.textBase
        font = JBUI.Fonts.label(14f)
    }

    private val placeholderLabel = JBLabel("Ask Kilo anything...").apply {
        foreground = KiloTheme.textWeaker
        font = JBUI.Fonts.label(14f)
        isOpaque = false
    }

    private var fileAutocomplete: FileAutocomplete? = null

    // Expand button (will be positioned absolutely)
    private val expandButton = JButton(AllIcons.General.ExpandComponent).apply {
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toolTipText = "Expand"
        isContentAreaFilled = false
        isBorderPainted = false
        isFocusPainted = false
        isOpaque = false
        margin = Insets(0, 0, 0, 0)
        border = null
        val iconSize = AllIcons.General.ExpandComponent.iconWidth
        preferredSize = Dimension(iconSize, iconSize)
        minimumSize = Dimension(iconSize, iconSize)
        maximumSize = Dimension(iconSize, iconSize)
        addActionListener { toggleExpand() }
    }

    // TOP PANEL: text editor area with placeholder overlay
    private val topPanel = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.empty(8, 10, 4, 10)

        textArea.addFocusListener(object : java.awt.event.FocusAdapter() {
            override fun focusGained(e: java.awt.event.FocusEvent?) {
                borderColor = focusedColor
                isFocused = true
                this@PromptInputPanel.repaint()
            }
            override fun focusLost(e: java.awt.event.FocusEvent?) {
                borderColor = unfocusedColor
                isFocused = false
                this@PromptInputPanel.repaint()
            }
        })

        // Listen for text changes to show/hide placeholder
        textArea.document.addDocumentListener(object : javax.swing.event.DocumentListener {
            override fun insertUpdate(e: javax.swing.event.DocumentEvent?) = updatePlaceholder()
            override fun removeUpdate(e: javax.swing.event.DocumentEvent?) = updatePlaceholder()
            override fun changedUpdate(e: javax.swing.event.DocumentEvent?) = updatePlaceholder()
            private fun updatePlaceholder() {
                placeholderLabel.isVisible = textArea.text.isEmpty()
            }
        })

        val scrollPane = JBScrollPane(textArea).apply {
            border = JBUI.Borders.empty()
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
            isOpaque = false
            viewport.isOpaque = false
        }

        // Use layered pane to overlay placeholder on text area
        val layeredPane = JLayeredPane().apply {
            layout = object : java.awt.LayoutManager {
                override fun addLayoutComponent(name: String?, comp: Component?) {}
                override fun removeLayoutComponent(comp: Component?) {}
                override fun preferredLayoutSize(parent: Container?) = scrollPane.preferredSize
                override fun minimumLayoutSize(parent: Container?) = scrollPane.minimumSize
                override fun layoutContainer(parent: Container?) {
                    val bounds = parent?.bounds ?: return
                    scrollPane.setBounds(0, 0, bounds.width, bounds.height)
                    placeholderLabel.setBounds(4, 2, bounds.width - 8, 20)
                }
            }
            add(scrollPane, JLayeredPane.DEFAULT_LAYER)
            add(placeholderLabel, JLayeredPane.PALETTE_LAYER)
        }

        // Make placeholder click-through
        placeholderLabel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                textArea.requestFocusInWindow()
            }
        })

        add(layeredPane, BorderLayout.CENTER)
    }

    // Mode selector
    private val modeSelector = ModeSelector()

    private var selectedModel = "Claude 4.5 Opus"
    private val modelLabel = JBLabel("$selectedModel \u25BE").apply {
        foreground = KiloTheme.textWeak
        font = font.deriveFont(13f)
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    // Send button (icon only)
    private val sendButton = JBLabel(AllIcons.Actions.Execute).apply {
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toolTipText = "Send (Enter)"
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (!isBusy) send()
            }
        })
    }

    // Stop button
    private val stopButton = JBLabel(AllIcons.Actions.Suspend).apply {
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toolTipText = "Stop"
        isVisible = false
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                onStop()
            }
        })
    }

    // BOTTOM PANEL: toolbar
    private val bottomPanel = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.empty(4, 10, 8, 10)

        val leftPanel = JPanel(FlowLayout(FlowLayout.LEFT, 8, 0)).apply {
            isOpaque = false
            add(modeSelector)
        }

        val rightPanel = JPanel(FlowLayout(FlowLayout.RIGHT, 8, 0)).apply {
            isOpaque = false
            add(modelLabel)
            add(stopButton)
            add(sendButton)
        }

        add(leftPanel, BorderLayout.WEST)
        add(rightPanel, BorderLayout.EAST)
    }

    init {
        layout = null // Use absolute positioning
        isOpaque = false
        isDoubleBuffered = true
        background = KiloTheme.surfaceRaisedStrong
        border = JBUI.Borders.empty(KiloSpacing.md, KiloSpacing.lg)
        preferredSize = Dimension(0, collapsedHeight)

        // Add components - expand button first for z-order
        add(expandButton)
        add(topPanel)
        add(bottomPanel)

        // Handle Enter to send (Shift+Enter for newline)
        textArea.inputMap.put(KeyStroke.getKeyStroke("ENTER"), "send")
        textArea.actionMap.put("send", object : AbstractAction() {
            override fun actionPerformed(e: java.awt.event.ActionEvent?) {
                if (!isBusy) send()
            }
        })
        textArea.inputMap.put(KeyStroke.getKeyStroke("shift ENTER"), "insert-break")

        // Handle ESC to unfocus
        textArea.inputMap.put(KeyStroke.getKeyStroke("ESCAPE"), "unfocus")
        textArea.actionMap.put("unfocus", object : AbstractAction() {
            override fun actionPerformed(e: java.awt.event.ActionEvent?) {
                textArea.transferFocus()
            }
        })

        // Model selector click handler
        modelLabel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                val popup = createModelPopup()
                popup.show(modelLabel, 0, -popup.preferredSize.height)
            }
            override fun mouseEntered(e: MouseEvent) {
                modelLabel.foreground = KiloTheme.textInteractive
            }
            override fun mouseExited(e: MouseEvent) {
                modelLabel.foreground = KiloTheme.textWeak
            }
        })

        setupFileAutocomplete()
    }

    private fun setupFileAutocomplete() {
        fileAutocomplete = FileAutocomplete(
            project = project,
            textComponent = textArea,
            stateService = stateService,
            onFileSelected = { attachedFile, _ ->
                stateService.addFileToContext(attachedFile)
                val text = textArea.text
                val atIndex = text.lastIndexOf('@')
                if (atIndex >= 0) {
                    val caret = textArea.caretPosition
                    val newText = text.substring(0, atIndex) + text.substring(caret.coerceAtMost(text.length))
                    textArea.text = newText.trimEnd()
                    if (newText.isNotEmpty() && !newText.endsWith(" ")) {
                        textArea.text = newText + " "
                    }
                    textArea.caretPosition = atIndex.coerceAtMost(textArea.text.length)
                }
            }
        )
    }

    override fun doLayout() {
        val insets = insets
        val w = width - insets.left - insets.right
        val h = height - insets.top - insets.bottom

        // Bottom panel at bottom
        val bottomPref = bottomPanel.preferredSize
        bottomPanel.setBounds(insets.left, height - insets.bottom - bottomPref.height, w, bottomPref.height)

        // Top panel fills remaining space
        topPanel.setBounds(insets.left, insets.top, w, h - bottomPref.height)

        // Expand button in top-right corner
        val btnSize = expandButton.preferredSize
        expandButton.setBounds(width - btnSize.width - 14, 12, btnSize.width, btnSize.height)
    }

    private fun toggleExpand() {
        isExpanded = !isExpanded
        val newHeight = if (isExpanded) expandedHeight else collapsedHeight
        preferredSize = Dimension(preferredSize.width, newHeight)
        textArea.rows = if (isExpanded) 10 else 2
        expandButton.icon = if (isExpanded) AllIcons.General.CollapseComponent else AllIcons.General.ExpandComponent
        expandButton.toolTipText = if (isExpanded) "Collapse" else "Expand"
        revalidate()
        repaint()
        parent?.revalidate()
        parent?.repaint()
    }

    private fun createModelPopup(): JPopupMenu {
        return JPopupMenu().apply {
            add(JLabel("  Model").apply {
                font = font.deriveFont(Font.BOLD)
                border = JBUI.Borders.empty(8, 8, 4, 8)
            })
            addSeparator()

            add(createModelMenuItem("Auto", "GPT-5.2", selectedModel == "Auto"))
            addSeparator()

            add(createModelMenuItem("Claude 4.5 Haiku", null, selectedModel == "Claude 4.5 Haiku"))
            add(createModelMenuItem("Claude 4.5 Opus", null, selectedModel == "Claude 4.5 Opus"))
            add(createModelMenuItem("Claude 4.5 Sonnet", null, selectedModel == "Claude 4.5 Sonnet"))
            add(createModelMenuItem("Claude 4 Sonnet", null, selectedModel == "Claude 4 Sonnet"))
            addSeparator()

            add(createModelMenuItem("Gemini 3 Flash", null, selectedModel == "Gemini 3 Flash"))
            add(createModelMenuItem("Gemini 3 Pro", null, selectedModel == "Gemini 3 Pro"))
            add(createModelMenuItem("GPT-4o", null, selectedModel == "GPT-4o"))
            add(createModelMenuItem("GPT-5.1", null, selectedModel == "GPT-5.1"))
            add(createModelMenuItem("GPT-5.2", null, selectedModel == "GPT-5.2"))
            addSeparator()

            add(JMenuItem("More Models..."))
            addSeparator()

            add(JLabel("  Third-Party Providers").apply {
                font = font.deriveFont(Font.BOLD, 11f)
                foreground = KiloTheme.textWeaker
                border = JBUI.Borders.empty(4, 8)
            })
            add(JMenuItem("Manage Models..."))
        }
    }

    private fun createModelMenuItem(name: String, subtitle: String?, isSelected: Boolean): JMenuItem {
        val text = if (subtitle != null) "$name  $subtitle" else name
        return JMenuItem(text).apply {
            if (isSelected) {
                icon = AllIcons.Actions.Checked
            }
            addActionListener {
                selectedModel = name
                modelLabel.text = "$name \u25BE"
            }
        }
    }

    private fun send() {
        val text = textArea.text.trim()
        if (text.isNotEmpty()) {
            onSend(text)
            textArea.text = ""
        }
    }

    fun updateStatus(status: SessionStatus?) {
        isBusy = status?.type == "busy" || status?.type == "retry"
        sendButton.isVisible = !isBusy
        stopButton.isVisible = isBusy
    }

    override fun setEnabled(enabled: Boolean) {
        super.setEnabled(enabled)
        textArea.isEnabled = enabled
        sendButton.isVisible = enabled && !isBusy
    }

    override fun requestFocusInWindow(): Boolean {
        return textArea.requestFocusInWindow()
    }

    fun dispose() {
        fileAutocomplete?.dispose()
    }

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)

        val radius = 12f
        val strokeWidth = if (isFocused) 2f else 1.5f
        val offset = strokeWidth / 2f

        // Fill background
        g2.color = background
        g2.fill(java.awt.geom.RoundRectangle2D.Float(
            strokeWidth, strokeWidth,
            width - strokeWidth * 2, height - strokeWidth * 2,
            radius, radius
        ))

        // Draw border
        g2.color = borderColor
        g2.stroke = BasicStroke(strokeWidth)
        g2.draw(java.awt.geom.RoundRectangle2D.Float(
            offset, offset,
            width - strokeWidth, height - strokeWidth,
            radius, radius
        ))

        g2.dispose()
    }
}
