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
import com.intellij.util.ui.components.BorderLayoutPanel
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

class ChatPanel(
    private val project: Project,
    private val stateService: KiloStateService
) : BorderLayoutPanel() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val messagesPanel = MessagesPanel()
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

        val headerArea = HeaderArea(headerPanel, errorBanner)
        addToTop(headerArea)

        scrollPane = MessagesScrollPane(messagesPanel)

        emptyStateLabel.horizontalAlignment = SwingConstants.CENTER
        emptyStateLabel.foreground = KiloTheme.textWeak
        emptyStateLabel.font = emptyStateLabel.font.deriveFont(KiloTypography.fontSizeMedium)

        val contentPanel = ContentPanel(
            emptyStatePanel = EmptyStatePanel(emptyStateLabel),
            messagesScrollPane = scrollPane
        )
        addToCenter(contentPanel)

        promptInput = PromptInputPanel(
            project = project,
            stateService = stateService,
            onSend = { text -> sendMessage(text) },
            onStop = { stopGeneration() }
        )

        val promptArea = PromptArea(
            attachedFilesPanel = attachedFilesPanel,
            promptInput = promptInput
        )
        addToBottom(promptArea)
        
        subscribeToState(contentPanel)

        setupAutoScroll()

        setupDragAndDrop()
    }


    private fun subscribeToState(contentPanel: ContentPanel) {
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
                    contentPanel.showEmpty()
                } else {
                    contentPanel.showContent()
                }
                promptInput.isEnabled = true
            }
        }

        scope.launch {
            stateService.currentSessionId.collectLatest { sessionId ->
                if (sessionId != null) {
                    stateService.getMessagesForSession(sessionId).collectLatest { messages ->
                        currentMessages = messages
                        val lastUser = messages.lastOrNull { it.info.role == "user" }
                        currentAgent = lastUser?.info?.agent
                        updateMessages()
                    }
                }
            }
        }

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
        
        val isIncrementalUpdate = messages.size == lastMessageCount && messages.isNotEmpty()
        lastMessageCount = messages.size

        toolPartWrappers.forEach { it.dispose() }
        toolPartWrappers.clear()

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
            messagesPanel.add(Box.createVerticalStrut(KiloSpacing.xxl))
        }

        if (isStreaming && messages.isNotEmpty()) {
            val last = messages.last()
            if (last.info.role == "assistant" && last.info.finish == null) {
                typingIndicator.alignmentX = Component.LEFT_ALIGNMENT
                messagesPanel.add(typingIndicator)
                messagesPanel.add(Box.createVerticalStrut(KiloSpacing.lg))
            }
        }

        messagesPanel.add(Box.createVerticalGlue())

        messagesPanel.revalidate()
        messagesPanel.repaint()

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

                autoScroll = value + extent >= max - 50
            }
        }
    }

    private fun setupDragAndDrop() {
        val dropTargetListener = object : DropTargetAdapter() {
            private var originalBorder: javax.swing.border.Border? = null

            override fun dragEnter(event: DropTargetDragEvent) {
                if (isFileDropSupported(event)) {
                    event.acceptDrag(DnDConstants.ACTION_COPY)
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
                scrollPane.border = originalBorder ?: JBUI.Borders.empty()
            }

            override fun drop(event: DropTargetDropEvent) {
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

        scrollPane.dropTarget = DropTarget(scrollPane, DnDConstants.ACTION_COPY, dropTargetListener, true)
    }

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

    fun focusInput() {
        promptInput.requestFocusInWindow()
    }



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

    private inner class HeaderPanel : BorderLayoutPanel() {
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

            val leftPanel = JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.xs, 0)).apply {
                isOpaque = false
            }

            connectionIndicator.text = "\u25CF"
            connectionIndicator.font = connectionIndicator.font.deriveFont(KiloTypography.fontSizeXSmall)
            connectionIndicator.toolTipText = "Connection status"
            leftPanel.add(connectionIndicator)

            titleLabel.font = titleLabel.font.deriveFont(Font.BOLD, KiloTypography.fontSizeMedium)
            titleLabel.foreground = KiloTheme.textStrong
            leftPanel.add(titleLabel)

            addToCenter(leftPanel)

            statusLabel.foreground = KiloTheme.textWeak
            statusLabel.font = statusLabel.font.deriveFont(KiloTypography.fontSizeBase)
            addToRight(statusLabel)

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

private class TypingIndicator : JBPanel<JBPanel<*>>(FlowLayout(FlowLayout.LEFT, KiloSpacing.xs, KiloSpacing.xs)) {
    init {
        isOpaque = false
        border = JBUI.Borders.emptyLeft(KiloSpacing.xxxl)

        val label = JBLabel("Generating response", AllIcons.Process.Step_2, SwingConstants.LEFT).apply {
            foreground = KiloTheme.textWeak
            font = font.deriveFont(Font.ITALIC, KiloTypography.fontSizeBase)
        }
        add(label)

        val dots = JBLabel("...").apply {
            foreground = KiloTheme.textWeak
            font = font.deriveFont(Font.ITALIC, KiloTypography.fontSizeBase)
        }
        add(dots)
    }
}

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
) : BorderLayoutPanel() {

    companion object {
        private val timeFormat = SimpleDateFormat("HH:mm")
        private val dateFormat = SimpleDateFormat("MMM d, HH:mm")
    }

    init {
        isOpaque = true

        val message = messageWithParts.info
        val isUser = message.role == "user"

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

        val leftHeader = JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.sm, 0)).apply {
            isOpaque = false
            val icon = if (isUser) AllIcons.General.User else AllIcons.Nodes.Favorite
            val roleLabel = JBLabel(if (isUser) "You" else "Assistant", icon, SwingConstants.LEFT)
            roleLabel.font = roleLabel.font.deriveFont(Font.BOLD, KiloTypography.fontSizeBase)
            roleLabel.foreground = KiloTheme.textStrong
            add(roleLabel)

            val timestamp = formatTimestamp(message.time.created)
            val timeLabel = JBLabel(timestamp).apply {
                foreground = KiloTheme.textWeaker
                font = font.deriveFont(KiloTypography.fontSizeSmall)
            }
            add(timeLabel)
        }

        val actionsPanel = createActionsPanel(message)

        val header = BorderLayoutPanel().apply {
            isOpaque = false
            addToLeft(leftHeader)
            addToRight(actionsPanel)
        }
        addToTop(header)

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

        addToCenter(contentPanel)
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

            if (!message.isUser && onFork != null) {
                val forkButton = createActionButton(AllIcons.Vcs.Branch, "Fork from here") {
                    onFork.invoke(message.id)
                }
                add(forkButton)
            }

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

        message.cost?.let { cost ->
            if (cost > 0) {
                val costText = String.format("$%.4f", cost)
                footer.add(JBLabel(costText).apply {
                    foreground = KiloTheme.textWeaker
                    font = font.deriveFont(KiloTypography.fontSizeSmall)
                })
            }
        }

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

        return createSimpleToolPartView(part)
    }

    private fun createSimpleToolPartView(part: Part): JComponent {
        return CollapsibleToolPanel(part)
    }

    private fun createReasoningPartView(part: Part): JComponent {
        val header = JBLabel("Thinking...", AllIcons.General.InspectionsEye, SwingConstants.LEFT).apply {
            font = font.deriveFont(Font.ITALIC, KiloTypography.fontSizeBase)
            foreground = KiloTheme.textWeak
        }

        val panel = BorderLayoutPanel().apply {
            isOpaque = true
            background = KiloTheme.surfaceInfo
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createMatteBorder(0, 3, 0, 0, KiloTheme.borderInfo),
                JBUI.Borders.empty(KiloSpacing.md)
            )
            addToTop(header)
        }

        val reasoningText = part.text
        if (reasoningText != null && reasoningText.isNotBlank()) {
            val content = JBLabel("<html>${reasoningText.take(200)}${if (reasoningText.length > 200) "..." else ""}</html>").apply {
                foreground = KiloTheme.textWeak
            }
            panel.addToCenter(content)
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


private val modeNames = listOf("Code", "Architect", "Ask", "Debug")


private class ModeSelector : JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)) {

    private var selectedMode = modeNames[0]
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

    private val topPanel = BorderLayoutPanel().apply {
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

        placeholderLabel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                textArea.requestFocusInWindow()
            }
        })

        addToCenter(layeredPane)
    }

    private val modeSelector = ModeSelector()

    private var selectedModel = "Claude 4.5 Opus"
    private val modelLabel = JBLabel("$selectedModel \u25BE").apply {
        foreground = KiloTheme.textWeak
        font = font.deriveFont(13f)
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    private val sendButton = JBLabel(AllIcons.Actions.Execute).apply {
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toolTipText = "Send (Enter)"
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (!isBusy) send()
            }
        })
    }

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

    private val bottomPanel = BorderLayoutPanel().apply {
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

        addToLeft(leftPanel)
        addToRight(rightPanel)
    }

    init {
        layout = null
        isOpaque = false
        isDoubleBuffered = true
        background = KiloTheme.surfaceRaisedStrong
        border = JBUI.Borders.empty(KiloSpacing.md, KiloSpacing.lg)
        preferredSize = Dimension(0, collapsedHeight)

        add(expandButton)
        add(topPanel)
        add(bottomPanel)

        textArea.inputMap.put(KeyStroke.getKeyStroke("ENTER"), "send")
        textArea.actionMap.put("send", object : AbstractAction() {
            override fun actionPerformed(e: java.awt.event.ActionEvent?) {
                if (!isBusy) send()
            }
        })
        textArea.inputMap.put(KeyStroke.getKeyStroke("shift ENTER"), "insert-break")

        textArea.inputMap.put(KeyStroke.getKeyStroke("ESCAPE"), "unfocus")
        textArea.actionMap.put("unfocus", object : AbstractAction() {
            override fun actionPerformed(e: java.awt.event.ActionEvent?) {
                textArea.transferFocus()
            }
        })

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

        val bottomPref = bottomPanel.preferredSize
        bottomPanel.setBounds(insets.left, height - insets.bottom - bottomPref.height, w, bottomPref.height)

        topPanel.setBounds(insets.left, insets.top, w, h - bottomPref.height)

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

        g2.color = background
        g2.fill(java.awt.geom.RoundRectangle2D.Float(
            strokeWidth, strokeWidth,
            width - strokeWidth * 2, height - strokeWidth * 2,
            radius, radius
        ))

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
