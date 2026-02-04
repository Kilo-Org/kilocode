package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.model.*
import ai.kilo.plugin.services.AttachedFile
import ai.kilo.plugin.services.KiloAppState
import ai.kilo.plugin.services.KiloEventService
import ai.kilo.plugin.services.KiloSessionStore
import ai.kilo.plugin.store.StoreEvent
import com.intellij.openapi.diagnostic.Logger
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
import kotlinx.coroutines.flow.distinctUntilChanged
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
    private val store: KiloSessionStore,
    private val appState: KiloAppState
) : BorderLayoutPanel() {

    private val log = Logger.getInstance(ChatPanel::class.java)
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val messagesPanel = MessagesPanel()
    private val scrollPane: JBScrollPane
    private val promptInput: PromptInputPanel
    private val emptyStateLabel = JBLabel("Start typing to begin a new conversation")
    private val headerPanel = HeaderPanel()

    private var currentSessionId: String? = null
    private var currentSessionStartTime: Long? = null
    private var currentAgent: String? = null
    private var autoScroll = true
    private var lastMessageCount = 0
    private var isStreaming = false
    private val typingIndicator = TypingIndicator()

    private var pendingRequests = PendingRequests()
    private var currentMessages: List<MessageWithParts> = emptyList()
    private val toolPartWrappers = mutableListOf<ToolPartWrapper>()

    // Incremental update support
    private val messageViewCache = mutableMapOf<String, SessionEntityUIBlock>()

    // Track requestId -> messageId for targeted refresh on permission/question removal
    private val permissionMessageMap = mutableMapOf<String, String>()
    private val questionMessageMap = mutableMapOf<String, String>()

    // Cache for text part MarkdownPanels to enable streaming delta appends
    private val textPartCache = mutableMapOf<String, MarkdownPanel>()

    private val attachedFilesPanel = AttachedFilesPanel(project, appState)
    private var fileAutocomplete: FileAutocomplete? = null
    
    private val errorBanner = ErrorBanner(
        onRetry = { scope.launch { store.clearError() } },
        onDismiss = { store.clearError() }
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

        // Wrapper to hold content + typing indicator (outside scroll)
        val contentWrapper = BorderLayoutPanel().apply {
            isOpaque = false
            addToCenter(contentPanel)
            addToBottom(typingIndicator)
        }
        typingIndicator.isVisible = false

        addToCenter(contentWrapper)

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
        
        subscribeToState(contentPanel)

        setupAutoScroll()

        setupDragAndDrop()
    }


    private fun subscribeToState(contentPanel: ContentPanel) {
        // Track session changes and update header/content panel
        scope.launch {
            combine(
                store.currentSessionId,
                store.sessions
            ) { sessionId, sessions ->
                sessionId?.let { id -> sessions.find { it.id == id } }
            }.collectLatest { session ->
                headerPanel.updateSession(session)

                if (session == null) {
                    contentPanel.showEmpty()
                } else {
                    contentPanel.showContent()
                }
                promptInput.isEnabled = true
            }
        }

        // Handle session changes and messages - single flow to avoid races
        scope.launch {
            var previousSessionId: String? = null
            store.currentSessionId.collectLatest { sessionId ->
                // Detect session change and reset state BEFORE loading new messages
                if (previousSessionId != sessionId) {
                    currentSessionId = sessionId
                    currentSessionStartTime = null
                    lastMessageCount = 0
                    autoScroll = true
                    isStreaming = false
                    currentMessages = emptyList()
                    currentAgent = null
                    pendingRequests = PendingRequests()
                    permissionMessageMap.clear()
                    questionMessageMap.clear()
                    textPartCache.clear()
                    toolPartWrappers.forEach { it.dispose() }
                    toolPartWrappers.clear()
                    messageViewCache.clear()
                    messagesPanel.removeAll()
                    messagesPanel.revalidate()
                    messagesPanel.repaint()
                    previousSessionId = sessionId
                }

                if (sessionId != null) {
                    store.getMessagesForSession(sessionId)
                        .distinctUntilChanged { old, new ->
                            // Skip if same message count, same last message completion status, and same parts count
                            old.size == new.size &&
                            old.lastOrNull()?.info?.time?.completed == new.lastOrNull()?.info?.time?.completed &&
                            old.lastOrNull()?.parts?.size == new.lastOrNull()?.parts?.size
                        }
                        .collectLatest { messages ->
                            println("DEBUG ChatPanel: ${messages.size} messages for session $sessionId")
                            currentMessages = messages
                            // Use earliest message timestamp as session start time
                            if (currentSessionStartTime == null && messages.isNotEmpty()) {
                                currentSessionStartTime = messages.minOf { it.info.time.created }
                                println("DEBUG ChatPanel: sessionStartTime=$currentSessionStartTime (min of ${messages.size} messages)")
                            }
                            // Log all message timestamps for debugging
                            messages.forEachIndexed { idx, msg ->
                                val offset = msg.info.time.created - (currentSessionStartTime ?: 0L)
                                println("DEBUG ChatPanel: msg[$idx] created=${msg.info.time.created} offset=${offset}ms")
                            }
                            val lastUser = messages.lastOrNull { it.info.role == "user" }
                            currentAgent = lastUser?.info?.agent
                            updateMessages()
                        }
                } else {
                    log.info("ChatPanel: No session selected, clearing messages")
                    currentSessionStartTime = null
                    updateMessages()
                }
            }
        }

        scope.launch {
            combine(
                store.currentSessionId,
                store.sessionStatuses
            ) { sessionId, statuses ->
                sessionId?.let { statuses[it] }
            }.collectLatest { status ->
                promptInput.updateStatus(status)
                updateStreamingState(status)
            }
        }

        scope.launch {
            combine(
                store.pendingPermissions,
                store.pendingQuestions
            ) { permissions, questions ->
                PendingRequests(permissions, questions)
            }.collectLatest { pending ->
                // Populate maps for requests that existed before we started listening to events
                for (perm in pending.permissions) {
                    if (perm.id !in permissionMessageMap) {
                        perm.tool?.messageID?.let { permissionMessageMap[perm.id] = it }
                    }
                }
                for (q in pending.questions) {
                    if (q.id !in questionMessageMap) {
                        q.tool?.messageID?.let { questionMessageMap[q.id] = it }
                    }
                }
                pendingRequests = pending
                // UI updates handled by StoreEvent handlers for targeted refresh
            }
        }
        
        scope.launch {
            store.error.collectLatest { error ->
                errorBanner.setError(error)
            }
        }

        // Subscribe to store events for incremental updates
        scope.launch {
            store.storeEvents.collect { event ->
                handleStoreEvent(event)
            }
        }
    }

    /**
     * Handle fine-grained store events for incremental UI updates.
     * This enables efficient updates without full rebuilds.
     */
    private fun handleStoreEvent(event: StoreEvent) {
        log.info("ChatPanel: StoreEvent received: ${event::class.simpleName}")
        val activeSessionId = currentSessionId ?: return

        when (event) {
            is StoreEvent.MessageInserted -> {
                if (event.sessionId == activeSessionId) {
                    handleMessageInserted(event)
                }
            }
            is StoreEvent.MessageUpdated -> {
                if (event.sessionId == activeSessionId) {
                    handleMessageUpdated(event)
                }
            }
            is StoreEvent.MessageRemoved -> {
                if (event.sessionId == activeSessionId) {
                    handleMessageRemoved(event)
                }
            }
            is StoreEvent.PartInserted -> {
                if (event.sessionId == activeSessionId) {
                    handlePartInserted(event)
                }
            }
            is StoreEvent.PartUpdated -> {
                if (event.sessionId == activeSessionId) {
                    handlePartUpdated(event)
                }
            }
            is StoreEvent.PartRemoved -> {
                if (event.sessionId == activeSessionId) {
                    handlePartRemoved(event)
                }
            }
            is StoreEvent.PermissionInserted -> {
                if (event.sessionId == activeSessionId) {
                    handlePermissionInserted(event)
                }
            }
            is StoreEvent.PermissionRemoved -> {
                if (event.sessionId == activeSessionId) {
                    handlePermissionRemoved(event)
                }
            }
            is StoreEvent.QuestionInserted -> {
                if (event.sessionId == activeSessionId) {
                    handleQuestionInserted(event)
                }
            }
            is StoreEvent.QuestionRemoved -> {
                if (event.sessionId == activeSessionId) {
                    handleQuestionRemoved(event)
                }
            }
            is StoreEvent.SessionStatusChanged -> {
                if (event.sessionId == activeSessionId) {
                    updateStreamingState(event.status)
                    promptInput.updateStatus(event.status)
                }
            }
            is StoreEvent.MessagesLoaded -> {
                if (event.sessionId == activeSessionId) {
                    // Full rebuild for bulk load
                    rebuildMessages()
                }
            }
            is StoreEvent.PartsLoaded -> {
                if (event.sessionId == activeSessionId) {
                    // Refresh the message that received new parts
                    refreshMessageView(event.messageId)
                }
            }
            // Other events that don't affect current UI
            else -> {}
        }
    }

    private fun handleMessageInserted(event: StoreEvent.MessageInserted) {
        // Skip - let StateFlow path (updateMessages) handle message inserts
        // This avoids race conditions between StoreEvent and StateFlow paths
        println("DEBUG handleMessageInserted: SKIPPING (StateFlow handles message inserts)")
    }

    private fun handleMessageUpdated(event: StoreEvent.MessageUpdated) {
        // Skip - let StateFlow path handle message updates
        println("DEBUG handleMessageUpdated: SKIPPING (StateFlow handles message updates)")
    }

    private fun handleMessageRemoved(event: StoreEvent.MessageRemoved) {
        // Skip - let StateFlow path handle message removals
        println("DEBUG handleMessageRemoved: SKIPPING (StateFlow handles message removals)")
    }

    private fun handlePartInserted(event: StoreEvent.PartInserted) {
        println("DEBUG handlePartInserted: messageId=${event.messageId}, partId=${event.part.id}, type=${event.part.type}")
        // Skip rebuild during streaming - the StateFlow will handle full updates
        // Only refresh for non-streaming scenarios (e.g., loading old messages)
        if (!isStreaming) {
            refreshMessageView(event.messageId)
        } else {
            println("DEBUG handlePartInserted: SKIPPING rebuild (streaming, StateFlow handles it)")
        }
    }

    private fun handlePartUpdated(event: StoreEvent.PartUpdated) {
        println("DEBUG handlePartUpdated: messageId=${event.messageId}, partId=${event.part.id}, type=${event.part.type}, hasDelta=${event.delta != null}, toolStatus=${event.part.toolStatus}")

        // For tool parts, always refresh to update status
        if (event.part.type == "tool") {
            println("DEBUG handlePartUpdated: tool part status=${event.part.toolStatus} -> REFRESH")
            refreshMessageView(event.messageId)
            return
        }

        // For text parts with delta, try to append directly to cached MarkdownPanel
        if (event.delta != null && event.part.type == "text") {
            val cachedPanel = textPartCache[event.part.id]
            if (cachedPanel != null) {
                println("DEBUG handlePartUpdated: appending delta to cached panel")
                cachedPanel.appendText(event.delta)
                scrollToBottomIfNeeded()
                return
            }
            // No cached panel yet - let StateFlow handle the next refresh which will create it
            println("DEBUG handlePartUpdated: NO cached panel for text part, waiting for StateFlow")
            return
        }

        // For reasoning/other parts with delta, we need to refresh to show updates
        // (these don't have cached panels that support incremental updates)
        if (event.delta != null) {
            println("DEBUG handlePartUpdated: delta for ${event.part.type} -> REFRESH")
            refreshMessageView(event.messageId)
            return
        }

        // For non-delta updates (part finished), always refresh
        println("DEBUG handlePartUpdated: non-delta -> REFRESH")
        refreshMessageView(event.messageId)
    }

    private fun handlePartRemoved(event: StoreEvent.PartRemoved) {
        // Refresh the message view that contains this part
        refreshMessageView(event.messageId)
    }

    private fun handlePermissionInserted(event: StoreEvent.PermissionInserted) {
        println("DEBUG handlePermissionInserted: requestId=${event.request.id}, toolCallID=${event.request.tool?.callID}, toolMessageID=${event.request.tool?.messageID}")
        val messageId = event.request.tool?.messageID ?: run {
            println("DEBUG handlePermissionInserted: NO messageID in tool reference, skipping")
            return
        }
        permissionMessageMap[event.request.id] = messageId
        // Update pendingRequests immediately so the rebuild uses it
        pendingRequests = pendingRequests.copy(permissions = pendingRequests.permissions + event.request)
        println("DEBUG handlePermissionInserted: pendingRequests now has ${pendingRequests.permissions.size} permissions")
        refreshMessageView(messageId)
    }

    private fun handlePermissionRemoved(event: StoreEvent.PermissionRemoved) {
        println("DEBUG handlePermissionRemoved: requestId=${event.requestId}")
        val messageId = permissionMessageMap.remove(event.requestId) ?: return
        pendingRequests = pendingRequests.copy(permissions = pendingRequests.permissions.filter { it.id != event.requestId })
        refreshMessageView(messageId)
    }

    private fun handleQuestionInserted(event: StoreEvent.QuestionInserted) {
        println("DEBUG handleQuestionInserted: requestId=${event.request.id}, toolCallID=${event.request.tool?.callID}, toolMessageID=${event.request.tool?.messageID}")
        val messageId = event.request.tool?.messageID ?: run {
            println("DEBUG handleQuestionInserted: NO messageID in tool reference, skipping")
            return
        }
        questionMessageMap[event.request.id] = messageId
        // Update pendingRequests immediately so the rebuild uses it
        pendingRequests = pendingRequests.copy(questions = pendingRequests.questions + event.request)
        println("DEBUG handleQuestionInserted: pendingRequests now has ${pendingRequests.questions.size} questions")
        refreshMessageView(messageId)
    }

    private fun handleQuestionRemoved(event: StoreEvent.QuestionRemoved) {
        println("DEBUG handleQuestionRemoved: requestId=${event.requestId}")
        val messageId = questionMessageMap.remove(event.requestId) ?: return
        pendingRequests = pendingRequests.copy(questions = pendingRequests.questions.filter { it.id != event.requestId })
        refreshMessageView(messageId)
    }

    private fun refreshMessageView(messageId: String) {
        println("DEBUG refreshMessageView: messageId=$messageId")
        val sessionId = currentSessionId ?: return

        val message = store.getMessage(sessionId, messageId) ?: return
        val parts = store.getPartsForMessage(messageId)
        val messageWithParts = MessageWithParts(info = message, parts = parts)

        val oldView = messageViewCache.remove(messageId)
        if (oldView != null) {
            println("DEBUG refreshMessageView: REBUILDING message block with ${parts.size} parts")
            val newView = createMessageBlock(messageWithParts)
            messageViewCache[messageId] = newView
            replaceMessageView(oldView, newView)
        } else {
            println("DEBUG refreshMessageView: NO cached view for message, skipping")
        }
    }

    private fun createMessageBlock(messageWithParts: MessageWithParts): SessionEntityUIBlock {
        return SessionEntityFactory.createMessageBlock(
            project = project,
            messageWithParts = messageWithParts,
            pendingRequests = pendingRequests,
            sessionStartTime = currentSessionStartTime,
            agentColor = KiloTheme.getAgentColor(currentAgent),
            onPermissionReply = { requestId, reply ->
                scope.launch { store.replyPermission(requestId, reply) }
            },
            onQuestionReply = { requestId, answers ->
                scope.launch { store.replyQuestion(requestId, answers) }
            },
            onQuestionReject = { requestId ->
                scope.launch { store.rejectQuestion(requestId) }
            },
            toolPartWrappers = toolPartWrappers,
            textPartCache = textPartCache,
            onFork = { messageId ->
                currentSessionId?.let { sessionId ->
                    scope.launch { store.forkSession(sessionId, messageId) }
                }
            },
            onRevert = { messageId ->
                currentSessionId?.let { sessionId ->
                    scope.launch { store.revertToMessage(sessionId, messageId, restoreFiles = true) }
                }
            }
        )
    }

    private fun insertMessageViewAt(view: SessionEntityUIBlock, index: Int) {
        view.alignmentX = Component.LEFT_ALIGNMENT

        // Calculate the UI index (each message has a spacer after it)
        val uiIndex = index * 2

        // Remove the vertical glue at the end if present
        val componentCount = messagesPanel.componentCount
        if (componentCount > 0 && messagesPanel.getComponent(componentCount - 1) is Box.Filler) {
            messagesPanel.remove(componentCount - 1)
        }

        // Insert the message and spacer
        if (uiIndex <= messagesPanel.componentCount) {
            messagesPanel.add(view, uiIndex)
            messagesPanel.add(Box.createVerticalStrut(KiloSpacing.xxl), uiIndex + 1)
        } else {
            messagesPanel.add(view)
            messagesPanel.add(Box.createVerticalStrut(KiloSpacing.xxl))
        }

        // Add back the vertical glue
        messagesPanel.add(Box.createVerticalGlue())

        messagesPanel.revalidate()
        messagesPanel.repaint()
    }

    private fun replaceMessageView(oldView: SessionEntityUIBlock, newView: SessionEntityUIBlock) {
        val index = messagesPanel.components.indexOf(oldView)
        if (index >= 0) {
            newView.alignmentX = Component.LEFT_ALIGNMENT
            messagesPanel.remove(index)
            messagesPanel.add(newView, index)
            messagesPanel.revalidate()
            messagesPanel.repaint()
        }
    }

    private fun removeMessageView(view: SessionEntityUIBlock) {
        val index = messagesPanel.components.indexOf(view)
        if (index >= 0) {
            messagesPanel.remove(index)
            // Also remove the spacer after it
            if (index < messagesPanel.componentCount && messagesPanel.getComponent(index) is Component) {
                val comp = messagesPanel.getComponent(index)
                if (comp is Box.Filler || comp.preferredSize?.height == KiloSpacing.xxl) {
                    messagesPanel.remove(index)
                }
            }
            messagesPanel.revalidate()
            messagesPanel.repaint()
        }
    }

    private fun rebuildMessages() {
        // Fall back to full rebuild via the existing mechanism
        updateMessages()
    }

    private fun scrollToBottomIfNeeded() {
        if (autoScroll) {
            SwingUtilities.invokeLater {
                val vertical = scrollPane.verticalScrollBar
                vertical.value = vertical.maximum
            }
        }
    }

    private fun updateMessages() {
        println("DEBUG updateMessages: called with ${currentMessages.size} messages, lastCount=$lastMessageCount, cacheSize=${messageViewCache.size}")
        val messages = currentMessages
        val messageCountChanged = messages.size != lastMessageCount
        val previousCount = lastMessageCount
        lastMessageCount = messages.size

        when {
            // First load or session change - full rebuild
            messageViewCache.isEmpty() -> {
                println("DEBUG updateMessages: cache empty -> FULL REBUILD")
                fullRebuild(messages)
            }
            // New message added - append it
            messages.size > previousCount && previousCount > 0 -> {
                println("DEBUG updateMessages: message count increased ${previousCount} -> ${messages.size} -> APPEND")
                appendNewMessages(messages, previousCount)
            }
            // Message removed - full rebuild
            messages.size < previousCount -> {
                println("DEBUG updateMessages: message count decreased -> FULL REBUILD")
                fullRebuild(messages)
            }
            // Same count - during streaming, refresh the last message to show new parts
            else -> {
                if (isStreaming && messages.isNotEmpty()) {
                    val lastMessage = messages.last()
                    println("DEBUG updateMessages: same count, streaming -> REFRESH last message (${lastMessage.parts.size} parts)")
                    refreshMessageView(lastMessage.info.id)
                } else {
                    println("DEBUG updateMessages: same count -> SKIP")
                }
            }
        }

        // Update typing indicator visibility
        typingIndicator.isVisible = isStreaming && messages.isNotEmpty() &&
            messages.last().let { it.info.role == "assistant" && it.info.finish == null }

        messagesPanel.revalidate()
        messagesPanel.repaint()

        scrollToBottomIfNeeded()
    }

    private fun fullRebuild(messages: List<MessageWithParts>) {
        println("DEBUG fullRebuild: rebuilding ${messages.size} messages")
        toolPartWrappers.forEach { it.dispose() }
        toolPartWrappers.clear()
        textPartCache.clear()
        messageViewCache.clear()

        messagesPanel.removeAll()

        for (messageWithParts in messages) {
            val messageBlock = createMessageBlock(messageWithParts)
            messageBlock.alignmentX = Component.LEFT_ALIGNMENT
            messageViewCache[messageWithParts.info.id] = messageBlock
            messagesPanel.add(messageBlock)
            messagesPanel.add(Box.createVerticalStrut(KiloSpacing.xxl))
        }

        messagesPanel.add(Box.createVerticalGlue())
    }

    private fun appendNewMessages(messages: List<MessageWithParts>, fromIndex: Int) {
        // Remove the glue at the end
        val componentCount = messagesPanel.componentCount
        if (componentCount > 0 && messagesPanel.getComponent(componentCount - 1) is Box.Filler) {
            messagesPanel.remove(componentCount - 1)
        }

        // Add new messages
        for (i in fromIndex until messages.size) {
            val messageWithParts = messages[i]
            val messageBlock = createMessageBlock(messageWithParts)
            messageBlock.alignmentX = Component.LEFT_ALIGNMENT
            messageViewCache[messageWithParts.info.id] = messageBlock
            messagesPanel.add(messageBlock)
            messagesPanel.add(Box.createVerticalStrut(KiloSpacing.xxl))
        }

        // Add glue back
        messagesPanel.add(Box.createVerticalGlue())
    }

    private fun updateStreamingState(status: SessionStatus?) {
        val wasStreaming = isStreaming
        isStreaming = status?.type == "busy" || status?.type == "retry"

        if (wasStreaming != isStreaming) {
            // Update typing indicator visibility
            typingIndicator.isVisible = isStreaming && currentMessages.isNotEmpty() &&
                currentMessages.last().let { it.info.role == "assistant" && it.info.finish == null }

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

        val attachedFile = AttachedFile(
            absolutePath = file.absolutePath,
            relativePath = relativePath,
            startLine = null,
            endLine = null,
            mime = mime
        )

        appState.addFileToContext(attachedFile)
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
        if (isStreaming) {
            stopGeneration()
        }
    }

    fun clearForNewSession() {
        promptInput.clearText()
        appState.clearAttachedFiles()
    }

    fun dispose() {
        scope.cancel()
        toolPartWrappers.forEach { it.dispose() }
        toolPartWrappers.clear()
        messageViewCache.clear()
        textPartCache.clear()
        permissionMessageMap.clear()
        questionMessageMap.clear()
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
                appState.connectionStatus.collectLatest { status ->
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

/**
 * Factory for creating SessionEntityUIBlock instances for different entity types.
 */
private object SessionEntityFactory {

    fun createMessageBlock(
        project: Project,
        messageWithParts: MessageWithParts,
        pendingRequests: PendingRequests,
        sessionStartTime: Long?,
        agentColor: Color,
        onPermissionReply: (requestId: String, reply: String) -> Unit,
        onQuestionReply: (requestId: String, answers: List<List<String>>) -> Unit,
        onQuestionReject: (requestId: String) -> Unit,
        toolPartWrappers: MutableList<ToolPartWrapper>,
        textPartCache: MutableMap<String, MarkdownPanel>,
        onFork: ((String) -> Unit)? = null,
        onRevert: ((String) -> Unit)? = null
    ): SessionEntityUIBlock {
        val message = messageWithParts.info
        val entityType = if (message.isUser) {
            SessionEntityType.UserMessage(
                agent = message.agent,
                modelId = message.model?.modelID,
                providerId = message.model?.providerID
            )
        } else {
            SessionEntityType.AssistantMessage(message.modelID)
        }

        val content = createMessageContent(
            project, messageWithParts, pendingRequests, sessionStartTime,
            onPermissionReply, onQuestionReply, onQuestionReject,
            toolPartWrappers, textPartCache
        )

        return SessionEntityUIBlock(
            entityType = entityType,
            content = content,
            timestamp = message.time.created,
            sessionStartTime = sessionStartTime
        )
    }

    private fun createMessageContent(
        project: Project,
        messageWithParts: MessageWithParts,
        pendingRequests: PendingRequests,
        sessionStartTime: Long?,
        onPermissionReply: (requestId: String, reply: String) -> Unit,
        onQuestionReply: (requestId: String, answers: List<List<String>>) -> Unit,
        onQuestionReject: (requestId: String) -> Unit,
        toolPartWrappers: MutableList<ToolPartWrapper>,
        textPartCache: MutableMap<String, MarkdownPanel>
    ): JComponent {
        val contentPanel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
        }

        val messageTimestamp = messageWithParts.info.time.created

        for (part in messageWithParts.parts) {
            // Skip step markers - they're internal API boundaries
            if (part.type == "step-start" || part.type == "step-finish") continue

            val partView = createPartContent(
                project, part, pendingRequests, messageTimestamp, sessionStartTime,
                onPermissionReply, onQuestionReply, onQuestionReject,
                toolPartWrappers, textPartCache
            )
            partView.alignmentX = Component.LEFT_ALIGNMENT
            contentPanel.add(partView)
            contentPanel.add(Box.createVerticalStrut(KiloSpacing.md))
        }

        return contentPanel
    }

    private fun createPartContent(
        project: Project,
        part: Part,
        pendingRequests: PendingRequests,
        messageTimestamp: Long,
        sessionStartTime: Long?,
        onPermissionReply: (requestId: String, reply: String) -> Unit,
        onQuestionReply: (requestId: String, answers: List<List<String>>) -> Unit,
        onQuestionReject: (requestId: String) -> Unit,
        toolPartWrappers: MutableList<ToolPartWrapper>,
        textPartCache: MutableMap<String, MarkdownPanel>
    ): JComponent {
        val (entityType, content) = when (part.type) {
            "text" -> {
                val markdownPanel = MarkdownPanel(project).apply {
                    isOpaque = false
                    setMarkdown(part.text ?: "")
                }
                textPartCache[part.id] = markdownPanel
                SessionEntityType.Text(part.callID) to markdownPanel
            }
            "tool" -> {
                val permission = pendingRequests.getPermissionForTool(part.callID)
                val question = pendingRequests.getQuestionForTool(part.callID)
                val toolContent = createToolContent(part, permission, question, onPermissionReply, onQuestionReply, onQuestionReject, toolPartWrappers)

                val entityType = when {
                    permission != null -> SessionEntityType.Permission(permission.id, part.tool)
                    question != null -> SessionEntityType.Question(question.id, part.tool, question.questions?.firstOrNull()?.question)
                    else -> getToolEntityType(part)
                }
                entityType to toolContent
            }
            "reasoning" -> {
                val reasoningText = part.text ?: ""
                val content = JBLabel("<html>${reasoningText.take(500)}${if (reasoningText.length > 500) "..." else ""}</html>").apply {
                    foreground = KiloTheme.textWeak
                }
                SessionEntityType.Reasoning(part.callID) to content
            }
            else -> {
                val content = JBLabel("Unknown part data").apply {
                    foreground = KiloTheme.textWeak
                }
                SessionEntityType.Unknown(part.type, part.callID) to content
            }
        }

        return SessionEntityUIBlock(
            entityType = entityType,
            content = content,
            timestamp = messageTimestamp,
            sessionStartTime = sessionStartTime
        )
    }

    private fun getToolEntityType(part: Part): SessionEntityType {
        val toolName = part.tool ?: "Unknown"
        val callId = part.callID

        return when (toolName.lowercase()) {
            "read" -> SessionEntityType.ToolRead(callId, part.metadata?.get("file_path")?.toString()?.trim('"'))
            "write" -> SessionEntityType.ToolWrite(callId, part.metadata?.get("file_path")?.toString()?.trim('"'))
            "edit" -> SessionEntityType.ToolEdit(callId, part.metadata?.get("file_path")?.toString()?.trim('"'))
            "bash" -> SessionEntityType.ToolBash(callId, part.metadata?.get("command")?.toString()?.trim('"'))
            "glob" -> SessionEntityType.ToolGlob(callId, part.metadata?.get("pattern")?.toString()?.trim('"'))
            "grep" -> SessionEntityType.ToolGrep(callId, part.metadata?.get("pattern")?.toString()?.trim('"'))
            "ls", "list" -> SessionEntityType.ToolList(callId, part.metadata?.get("path")?.toString()?.trim('"'))
            "webfetch" -> SessionEntityType.ToolWebFetch(callId, part.metadata?.get("url")?.toString()?.trim('"'))
            "websearch" -> SessionEntityType.ToolWebSearch(callId, part.metadata?.get("query")?.toString()?.trim('"'))
            "task" -> SessionEntityType.ToolTask(callId, part.metadata?.get("description")?.toString()?.trim('"'))
            "todoread" -> SessionEntityType.ToolTodoRead(callId)
            "todowrite" -> SessionEntityType.ToolTodoWrite(callId)
            "applypatch" -> SessionEntityType.ToolApplyPatch(callId)
            else -> SessionEntityType.ToolGeneric(callId, toolName)
        }
    }

    private fun createToolContent(
        part: Part,
        permission: PermissionRequest?,
        question: QuestionRequest?,
        onPermissionReply: (requestId: String, reply: String) -> Unit,
        onQuestionReply: (requestId: String, answers: List<List<String>>) -> Unit,
        onQuestionReject: (requestId: String) -> Unit,
        toolPartWrappers: MutableList<ToolPartWrapper>
    ): JComponent {
        // Question: use simple InlineQuestionPrompt directly
        if (question != null) {
            return InlineQuestionPrompt(
                request = question,
                onReply = { answers -> onQuestionReply(question.id, answers) },
                onReject = { onQuestionReject(question.id) }
            )
        }

        // Permission: use simple InlinePermissionPrompt directly
        if (permission != null) {
            return InlinePermissionPrompt(
                request = permission,
                onReply = { reply -> onPermissionReply(permission.id, reply) }
            )
        }

        return CollapsibleToolPanel(part)
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
    private val store: KiloSessionStore,
    private val appState: KiloAppState,
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

    // Model selection from server
    private var selectedModel: Model? = null
    private var selectedProvider: Provider? = null
    private var providers: ProviderListResponse? = null

    private val modelLabel = JBLabel("Model \u25BE").apply {
        foreground = KiloTheme.textWeak
        font = font.deriveFont(13f)
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

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
        subscribeToProviders()
    }

    private fun subscribeToProviders() {
        scope.launch {
            appState.providers.collectLatest { providerResponse ->
                providers = providerResponse
                if (selectedModel == null && providerResponse != null) {
                    selectDefaultModel(providerResponse)
                }
            }
        }
    }

    private fun selectDefaultModel(providerResponse: ProviderListResponse) {
        // Try to use default model from provider response
        val defaultProviderId = providerResponse.default["provider"]
        val defaultModelId = providerResponse.default["model"]

        if (defaultProviderId != null && defaultModelId != null) {
            val provider = providerResponse.all.find { it.id == defaultProviderId }
            val model = provider?.models?.get(defaultModelId)
            if (provider != null && model != null) {
                selectedProvider = provider
                selectedModel = model
                updateModelLabel()
                return
            }
        }

        // Fallback: use first connected provider's first model
        val connectedProvider = providerResponse.all
            .filter { it.id in providerResponse.connected }
            .firstOrNull { it.models.isNotEmpty() }

        if (connectedProvider != null) {
            selectedProvider = connectedProvider
            selectedModel = connectedProvider.models.values.firstOrNull()
            updateModelLabel()
        }
    }

    private fun updateModelLabel() {
        val modelName = selectedModel?.name ?: selectedModel?.id ?: "Model"
        modelLabel.text = "$modelName \u25BE"

        // Update appState with selection
        selectedProvider?.let { provider ->
            selectedModel?.let { model ->
                appState.setSelectedModel(ModelRef(providerID = provider.id, modelID = model.id))
            }
        }
    }

    private fun setupFileAutocomplete() {
        fileAutocomplete = FileAutocomplete(
            project = project,
            textComponent = textArea,
            appState = appState,
            onFileSelected = { attachedFile, _ ->
                appState.addFileToContext(attachedFile)
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
        val providerResponse = providers
        val connectedProviders = providerResponse?.all?.filter { it.id in (providerResponse.connected) } ?: emptyList()

        return JPopupMenu().apply {
            add(JLabel("  Model").apply {
                font = font.deriveFont(Font.BOLD)
                border = JBUI.Borders.empty(8, 8, 4, 8)
            })
            addSeparator()

            if (connectedProviders.isEmpty()) {
                add(JLabel("  No providers connected").apply {
                    foreground = KiloTheme.textWeaker
                    border = JBUI.Borders.empty(4, 8)
                })
            } else {
                // Group models by provider
                for (provider in connectedProviders) {
                    if (provider.models.isEmpty()) continue

                    // Add provider header
                    add(JLabel("  ${provider.name}").apply {
                        font = font.deriveFont(Font.BOLD, 11f)
                        foreground = KiloTheme.textInteractive
                        border = JBUI.Borders.empty(4, 8, 2, 8)
                    })

                    // Add models for this provider
                    for ((_, model) in provider.models) {
                        val isSelected = selectedModel?.id == model.id && selectedProvider?.id == provider.id
                        add(createModelMenuItem(model, provider, isSelected))
                    }
                    addSeparator()
                }
            }
        }
    }

    private fun createModelMenuItem(model: Model, provider: Provider, isSelected: Boolean): JMenuItem {
        val displayName = model.name ?: model.id
        return JMenuItem(displayName).apply {
            if (isSelected) {
                icon = AllIcons.Actions.Checked
            }
            addActionListener {
                selectedModel = model
                selectedProvider = provider
                updateModelLabel()
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
        scope.cancel()
        fileAutocomplete?.dispose()
    }

    fun clearText() {
        textArea.text = ""
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
