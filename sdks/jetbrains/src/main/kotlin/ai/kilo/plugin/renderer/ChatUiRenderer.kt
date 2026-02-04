package ai.kilo.plugin.renderer

import ai.kilo.plugin.model.*
import ai.kilo.plugin.store.ChatUiStateManager
import ai.kilo.plugin.store.MessageChange
import ai.kilo.plugin.store.StoreEvent
import ai.kilo.plugin.ui.KiloSpacing
import ai.kilo.plugin.ui.KiloTheme
import ai.kilo.plugin.ui.components.chat.message.parts.MarkdownPanel
import ai.kilo.plugin.ui.components.chat.message.ChatContentBlock
import ai.kilo.plugin.ui.components.chat.message.parts.ToolPartWrapper
import ai.kilo.plugin.ui.components.factory.PendingRequests
import ai.kilo.plugin.ui.components.factory.ChatComponentBuilder
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import java.awt.Component
import javax.swing.Box
import javax.swing.JPanel

/**
 * Renders chat UI by consuming streams from ChatUiStateManager.
 *
 * This is service #3 in the architecture:
 * 1. KiloEventService     → SSE → ServerEvent stream
 * 2. ChatUiStateManager   → ServerEvent → MessageChange stream
 * 3. ChatUiRenderer       → MessageChange → Swing components
 */
class ChatUiRenderer(
    private val project: Project,
    private val scope: CoroutineScope,
    private val store: ChatUiStateManager,
    private val messagesPanel: JPanel
) {
    private val log = Logger.getInstance(ChatUiRenderer::class.java)

    // Current state
    private var currentSessionId: String? = null
    private var currentSessionStartTime: Long? = null
    private var currentAgent: String? = null
    private var currentMessages: List<MessageWithParts> = emptyList()
    private var isStreaming = false
    private var pendingRequests = PendingRequests()

    // Component caches
    private val messageViewCache = mutableMapOf<String, ChatContentBlock>()
    private val textPartCache = mutableMapOf<String, MarkdownPanel>()
    private val toolPartWrappers = mutableListOf<ToolPartWrapper>()
    private val permissionMessageMap = mutableMapOf<String, String>()
    private val questionMessageMap = mutableMapOf<String, String>()

    // Callback for ChatPanel (thin UI updates only)
    private var listener: Listener? = null

    interface Listener {
        fun onSessionChanged(session: Session?)
        fun onStatusChanged(status: SessionStatus?)
        fun onErrorChanged(error: String?)
        fun onStreamingStateChanged(isStreaming: Boolean)
        fun onScrollToBottomNeeded()
    }

    fun setListener(listener: Listener) {
        this.listener = listener
    }

    fun start() {
        subscribeToSessionChanges()
        subscribeToMessageChanges()
        subscribeToStatusFlow()
        subscribeToPendingRequests()
        subscribeToError()
    }

    // ==================== Subscriptions ====================

    private fun subscribeToSessionChanges() {
        scope.launch {
            combine(
                store.currentSessionId,
                store.sessions
            ) { sessionId, sessions ->
                sessionId?.let { id -> sessions.find { it.id == id } }
            }.collectLatest { session ->
                // Detect session change
                val newSessionId = session?.id
                if (currentSessionId != newSessionId) {
                    clearCachesForSessionChange()
                    currentSessionId = newSessionId
                    currentSessionStartTime = null
                    currentMessages = emptyList()
                    currentAgent = null
                    pendingRequests = PendingRequests()
                }
                listener?.onSessionChanged(session)
            }
        }
    }

    /**
     * Single subscription for all message-related changes.
     */
    private fun subscribeToMessageChanges() {
        scope.launch {
            store.messageChanges.collect { change ->
                // Only process changes for current session
                if (change.sessionId != currentSessionId) return@collect

                when (change) {
                    is MessageChange.InitialLoad -> {
                        currentMessages = change.messages
                        updateSessionMetadata(change.messages)
                        renderInitialMessages(change.messages)
                        listener?.onScrollToBottomNeeded()
                    }
                    is MessageChange.MessageAdded -> {
                        currentMessages = currentMessages + change.message
                        updateSessionMetadata(currentMessages)
                        appendMessage(change.message)
                        listener?.onScrollToBottomNeeded()
                    }
                    is MessageChange.MessageRemoved -> {
                        currentMessages = currentMessages.filter { it.info.id != change.messageId }
                        removeMessageView(change.messageId)
                    }
                    is MessageChange.PartAdded -> {
                        updateCurrentMessageParts(change.messageId, change.part)
                        if (!isStreaming) {
                            refreshMessageView(change.messageId)
                        }
                    }
                    is MessageChange.PartUpdated -> {
                        updateCurrentMessageParts(change.messageId, change.part)
                        handlePartUpdated(change.messageId, change.part, change.delta)
                    }
                    is MessageChange.PartRemoved -> {
                        refreshMessageView(change.messageId)
                    }
                }
            }
        }
    }

    private fun subscribeToStatusFlow() {
        scope.launch {
            combine(
                store.currentSessionId,
                store.sessionStatuses
            ) { sessionId, statuses ->
                sessionId?.let { statuses[it] }
            }.collectLatest { status ->
                listener?.onStatusChanged(status)
                updateStreamingState(status)
            }
        }
    }

    private fun subscribeToPendingRequests() {
        scope.launch {
            store.storeEvents.collect { event ->
                val activeSessionId = currentSessionId ?: return@collect
                when (event) {
                    is StoreEvent.PermissionInserted -> {
                        if (event.sessionId == activeSessionId) {
                            val messageId = event.request.tool?.messageID ?: return@collect
                            permissionMessageMap[event.request.id] = messageId
                            pendingRequests = pendingRequests.copy(permissions = pendingRequests.permissions + event.request)
                            refreshMessageView(messageId)
                        }
                    }
                    is StoreEvent.PermissionRemoved -> {
                        if (event.sessionId == activeSessionId) {
                            val messageId = permissionMessageMap.remove(event.requestId) ?: return@collect
                            pendingRequests = pendingRequests.copy(permissions = pendingRequests.permissions.filter { it.id != event.requestId })
                            refreshMessageView(messageId)
                        }
                    }
                    is StoreEvent.QuestionInserted -> {
                        if (event.sessionId == activeSessionId) {
                            val messageId = event.request.tool?.messageID ?: return@collect
                            questionMessageMap[event.request.id] = messageId
                            pendingRequests = pendingRequests.copy(questions = pendingRequests.questions + event.request)
                            refreshMessageView(messageId)
                        }
                    }
                    is StoreEvent.QuestionRemoved -> {
                        if (event.sessionId == activeSessionId) {
                            val messageId = questionMessageMap.remove(event.requestId) ?: return@collect
                            pendingRequests = pendingRequests.copy(questions = pendingRequests.questions.filter { it.id != event.requestId })
                            refreshMessageView(messageId)
                        }
                    }
                    else -> {}
                }
            }
        }
    }

    private fun subscribeToError() {
        scope.launch {
            store.error.collectLatest { error ->
                listener?.onErrorChanged(error)
            }
        }
    }

    // ==================== Event Handlers ====================

    private fun updateSessionMetadata(messages: List<MessageWithParts>) {
        if (currentSessionStartTime == null && messages.isNotEmpty()) {
            currentSessionStartTime = messages.minOf { it.info.time.created }
        }
        val lastUser = messages.lastOrNull { it.info.role == "user" }
        currentAgent = lastUser?.info?.agent
    }

    private fun updateCurrentMessageParts(messageId: String, part: Part) {
        currentMessages = currentMessages.map { msg ->
            if (msg.info.id == messageId) {
                val updatedParts = msg.parts.map { p ->
                    if (p.id == part.id) part else p
                }.let { parts ->
                    if (parts.none { it.id == part.id }) parts + part else parts
                }
                msg.copy(parts = updatedParts)
            } else msg
        }
    }

    private fun handlePartUpdated(messageId: String, part: Part, delta: String?) {
        // For tool parts, always refresh
        if (part.type == "tool") {
            refreshMessageView(messageId)
            return
        }

        // For text parts with delta, append directly (streaming optimization)
        if (delta != null && part.type == "text") {
            val cachedPanel = textPartCache[part.id]
            if (cachedPanel != null) {
                cachedPanel.appendText(delta)
                listener?.onStreamingStateChanged(isStreaming)
                return
            }
        }

        refreshMessageView(messageId)
    }

    private fun updateStreamingState(status: SessionStatus?) {
        val wasStreaming = isStreaming
        isStreaming = status?.type == "busy" || status?.type == "retry"
        if (wasStreaming != isStreaming) {
            listener?.onStreamingStateChanged(isStreaming)
        }
    }

    // ==================== Rendering ====================

    private fun renderInitialMessages(messages: List<MessageWithParts>) {
        toolPartWrappers.forEach { it.dispose() }
        toolPartWrappers.clear()
        textPartCache.clear()
        messageViewCache.clear()
        messagesPanel.removeAll()

        for (message in messages) {
            val block = createMessageBlock(message)
            block.alignmentX = Component.LEFT_ALIGNMENT
            messageViewCache[message.info.id] = block
            messagesPanel.add(block)
            messagesPanel.add(Box.createVerticalStrut(KiloSpacing.xxl))
        }

        messagesPanel.revalidate()
        messagesPanel.repaint()
    }

    private fun appendMessage(message: MessageWithParts) {
        val block = createMessageBlock(message)
        block.alignmentX = Component.LEFT_ALIGNMENT
        messageViewCache[message.info.id] = block
        messagesPanel.add(block)
        messagesPanel.add(Box.createVerticalStrut(KiloSpacing.xxl))
        messagesPanel.revalidate()
        messagesPanel.repaint()
    }

    private fun refreshMessageView(messageId: String) {
        val sessionId = currentSessionId ?: return
        val message = store.getMessage(sessionId, messageId) ?: return

        val parts = store.getPartsForMessage(messageId)
        val messageWithParts = MessageWithParts(info = message, parts = parts)

        val oldView = messageViewCache.remove(messageId)
        if (oldView != null) {
            val newView = createMessageBlock(messageWithParts)
            messageViewCache[messageId] = newView

            val index = messagesPanel.components.indexOf(oldView)
            if (index >= 0) {
                newView.alignmentX = Component.LEFT_ALIGNMENT
                messagesPanel.remove(index)
                messagesPanel.add(newView, index)
                messagesPanel.revalidate()
                messagesPanel.repaint()
            }
        }
    }

    private fun removeMessageView(messageId: String) {
        val view = messageViewCache.remove(messageId) ?: return

        val index = messagesPanel.components.indexOf(view)
        if (index >= 0) {
            messagesPanel.remove(index)
            // Remove spacing strut after it
            if (index < messagesPanel.componentCount) {
                val next = messagesPanel.getComponent(index)
                if (next is Box.Filler) {
                    messagesPanel.remove(index)
                }
            }
            messagesPanel.revalidate()
            messagesPanel.repaint()
        }

        textPartCache.keys.removeIf { it.startsWith(messageId) }
    }

    private fun clearPanel() {
        messagesPanel.removeAll()
        messagesPanel.revalidate()
        messagesPanel.repaint()
    }

    private fun createMessageBlock(message: MessageWithParts): ChatContentBlock {
        return ChatComponentBuilder.createMessageBlock(
            project = project,
            messageWithParts = message,
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
            onFork = { msgId ->
                currentSessionId?.let { sessionId ->
                    scope.launch { store.forkSession(sessionId, msgId) }
                }
            },
            onRevert = { msgId ->
                currentSessionId?.let { sessionId ->
                    scope.launch { store.revertToMessage(sessionId, msgId, restoreFiles = true) }
                }
            }
        )
    }

    private fun clearCachesForSessionChange() {
        permissionMessageMap.clear()
        questionMessageMap.clear()
        textPartCache.clear()
        toolPartWrappers.forEach { it.dispose() }
        toolPartWrappers.clear()
        messageViewCache.clear()
        clearPanel()
    }

    // ==================== Public API ====================

    val streaming: Boolean get() = isStreaming
    val messages: List<MessageWithParts> get() = currentMessages

    fun dispose() {
        toolPartWrappers.forEach { it.dispose() }
        toolPartWrappers.clear()
        messageViewCache.clear()
        textPartCache.clear()
        permissionMessageMap.clear()
        questionMessageMap.clear()
    }
}
