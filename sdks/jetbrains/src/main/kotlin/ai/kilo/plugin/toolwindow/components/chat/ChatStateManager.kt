package ai.kilo.plugin.toolwindow.components.chat

import ai.kilo.plugin.model.*
import ai.kilo.plugin.services.ChatUiStateManager
import ai.kilo.plugin.store.StoreEvent
import ai.kilo.plugin.toolwindow.components.MarkdownPanel
import ai.kilo.plugin.toolwindow.components.SessionEntityUIBlock
import ai.kilo.plugin.toolwindow.components.ToolPartWrapper
import ai.kilo.plugin.toolwindow.components.factory.PendingRequests
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/**
 * Manages chat state including messages, caches, and event handling.
 * Notifies listener of state changes for UI updates.
 */
class ChatStateManager(
    private val scope: CoroutineScope,
    private val store: ChatUiStateManager
) {
    private val log = Logger.getInstance(ChatStateManager::class.java)

    // Public state
    var currentSessionId: String? = null
        private set
    var currentSessionStartTime: Long? = null
        private set
    var currentAgent: String? = null
        private set
    var currentMessages: List<MessageWithParts> = emptyList()
        private set
    var isStreaming = false
        private set
    var pendingRequests = PendingRequests()
        private set

    // Caches - ChatMessageRenderer reads these
    val messageViewCache = mutableMapOf<String, SessionEntityUIBlock>()
    val textPartCache = mutableMapOf<String, MarkdownPanel>()
    val toolPartWrappers = mutableListOf<ToolPartWrapper>()
    val permissionMessageMap = mutableMapOf<String, String>()
    val questionMessageMap = mutableMapOf<String, String>()

    var lastMessageCount = 0
        private set

    private var listener: Listener? = null

    interface Listener {
        fun onSessionChanged(session: Session?)
        fun onMessagesUpdated(messages: List<MessageWithParts>, previousCount: Int)
        fun onStreamingStateChanged(isStreaming: Boolean)
        fun onStatusChanged(status: SessionStatus?)
        fun onErrorChanged(error: String?)
        fun onMessageRefreshNeeded(messageId: String)
        fun onFullRebuildNeeded()
    }

    fun setListener(listener: Listener) {
        this.listener = listener
    }

    fun subscribeToState() {
        subscribeToSessionChanges()
        subscribeToMessagesFlow()
        subscribeToStatusFlow()
        subscribeToPendingRequests()
        subscribeToError()
        subscribeToStoreEvents()
    }

    private fun subscribeToSessionChanges() {
        scope.launch {
            combine(
                store.currentSessionId,
                store.sessions
            ) { sessionId, sessions ->
                sessionId?.let { id -> sessions.find { it.id == id } }
            }.collectLatest { session ->
                listener?.onSessionChanged(session)
            }
        }
    }

    private fun subscribeToMessagesFlow() {
        scope.launch {
            var previousSessionId: String? = null
            store.currentSessionId.collectLatest { sessionId ->
                // Detect session change and reset state BEFORE loading new messages
                if (previousSessionId != sessionId) {
                    clearCachesForSessionChange()
                    currentSessionId = sessionId
                    currentSessionStartTime = null
                    lastMessageCount = 0
                    isStreaming = false
                    currentMessages = emptyList()
                    currentAgent = null
                    pendingRequests = PendingRequests()
                    previousSessionId = sessionId
                }

                if (sessionId != null) {
                    store.getMessagesForSession(sessionId)
                        .distinctUntilChanged { old, new ->
                            old.size == new.size &&
                            old.lastOrNull()?.info?.time?.completed == new.lastOrNull()?.info?.time?.completed &&
                            old.lastOrNull()?.parts?.size == new.lastOrNull()?.parts?.size
                        }
                        .collectLatest { messages ->
                            println("DEBUG ChatStateManager: ${messages.size} messages for session $sessionId")
                            val previousCount = lastMessageCount
                            currentMessages = messages
                            lastMessageCount = messages.size

                            // Use earliest message timestamp as session start time
                            if (currentSessionStartTime == null && messages.isNotEmpty()) {
                                currentSessionStartTime = messages.minOf { it.info.time.created }
                            }

                            val lastUser = messages.lastOrNull { it.info.role == "user" }
                            currentAgent = lastUser?.info?.agent

                            listener?.onMessagesUpdated(messages, previousCount)
                        }
                } else {
                    log.info("ChatStateManager: No session selected, clearing messages")
                    currentSessionStartTime = null
                    currentMessages = emptyList()
                    listener?.onMessagesUpdated(emptyList(), lastMessageCount)
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

    private fun subscribeToStoreEvents() {
        scope.launch {
            store.storeEvents.collect { event ->
                handleStoreEvent(event)
            }
        }
    }

    private fun handleStoreEvent(event: StoreEvent) {
        log.info("ChatStateManager: StoreEvent received: ${event::class.simpleName}")
        val activeSessionId = currentSessionId ?: return

        when (event) {
            is StoreEvent.MessageInserted,
            is StoreEvent.MessageUpdated,
            is StoreEvent.MessageRemoved -> {
                // Skip - let StateFlow path handle message changes
                println("DEBUG handleStoreEvent: SKIPPING message event (StateFlow handles it)")
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
                    listener?.onMessageRefreshNeeded(event.messageId)
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
                    listener?.onStatusChanged(event.status)
                }
            }
            is StoreEvent.MessagesLoaded -> {
                if (event.sessionId == activeSessionId) {
                    listener?.onFullRebuildNeeded()
                }
            }
            is StoreEvent.PartsLoaded -> {
                if (event.sessionId == activeSessionId) {
                    listener?.onMessageRefreshNeeded(event.messageId)
                }
            }
            else -> {}
        }
    }

    private fun handlePartInserted(event: StoreEvent.PartInserted) {
        println("DEBUG handlePartInserted: messageId=${event.messageId}, partId=${event.part.id}, type=${event.part.type}")
        if (!isStreaming) {
            listener?.onMessageRefreshNeeded(event.messageId)
        }
    }

    private fun handlePartUpdated(event: StoreEvent.PartUpdated) {
        println("DEBUG handlePartUpdated: messageId=${event.messageId}, partId=${event.part.id}, type=${event.part.type}, hasDelta=${event.delta != null}")

        // For tool parts, always refresh to update status
        if (event.part.type == "tool") {
            listener?.onMessageRefreshNeeded(event.messageId)
            return
        }

        // For text parts with delta, try to append directly to cached MarkdownPanel
        if (event.delta != null && event.part.type == "text") {
            val cachedPanel = textPartCache[event.part.id]
            if (cachedPanel != null) {
                cachedPanel.appendText(event.delta)
                listener?.onStreamingStateChanged(isStreaming) // Trigger scroll
                return
            }
            return
        }

        // For non-delta updates (part finished), always refresh
        if (event.delta != null) {
            listener?.onMessageRefreshNeeded(event.messageId)
            return
        }

        listener?.onMessageRefreshNeeded(event.messageId)
    }

    private fun handlePermissionInserted(event: StoreEvent.PermissionInserted) {
        val messageId = event.request.tool?.messageID ?: return
        permissionMessageMap[event.request.id] = messageId
        pendingRequests = pendingRequests.copy(permissions = pendingRequests.permissions + event.request)
        listener?.onMessageRefreshNeeded(messageId)
    }

    private fun handlePermissionRemoved(event: StoreEvent.PermissionRemoved) {
        val messageId = permissionMessageMap.remove(event.requestId) ?: return
        pendingRequests = pendingRequests.copy(permissions = pendingRequests.permissions.filter { it.id != event.requestId })
        listener?.onMessageRefreshNeeded(messageId)
    }

    private fun handleQuestionInserted(event: StoreEvent.QuestionInserted) {
        val messageId = event.request.tool?.messageID ?: return
        questionMessageMap[event.request.id] = messageId
        pendingRequests = pendingRequests.copy(questions = pendingRequests.questions + event.request)
        listener?.onMessageRefreshNeeded(messageId)
    }

    private fun handleQuestionRemoved(event: StoreEvent.QuestionRemoved) {
        val messageId = questionMessageMap.remove(event.requestId) ?: return
        pendingRequests = pendingRequests.copy(questions = pendingRequests.questions.filter { it.id != event.requestId })
        listener?.onMessageRefreshNeeded(messageId)
    }

    private fun updateStreamingState(status: SessionStatus?) {
        val wasStreaming = isStreaming
        isStreaming = status?.type == "busy" || status?.type == "retry"

        if (wasStreaming != isStreaming) {
            listener?.onStreamingStateChanged(isStreaming)
        }
    }

    private fun clearCachesForSessionChange() {
        permissionMessageMap.clear()
        questionMessageMap.clear()
        textPartCache.clear()
        toolPartWrappers.forEach { it.dispose() }
        toolPartWrappers.clear()
        messageViewCache.clear()
    }

    fun dispose() {
        toolPartWrappers.forEach { it.dispose() }
        toolPartWrappers.clear()
        messageViewCache.clear()
        textPartCache.clear()
        permissionMessageMap.clear()
        questionMessageMap.clear()
    }
}
