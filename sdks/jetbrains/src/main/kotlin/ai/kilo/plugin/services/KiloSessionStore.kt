package ai.kilo.plugin.services

import ai.kilo.plugin.model.*
import ai.kilo.plugin.store.StoreEvent
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.util.concurrent.ConcurrentHashMap

/**
 * Session data store for the Kilo plugin.
 *
 * Manages:
 * - Sessions and their statuses
 * - Messages and parts
 * - Permissions and questions
 * - Todos and diffs
 *
 * Features:
 * - Fine-grained incremental UI updates via StoreEvent
 * - Binary search for O(log n) sorted insertion/lookup
 * - StateFlows for reactive UI binding
 *
 * This is separate from KiloAppState which manages app-level config (agents, providers, etc.)
 */
class KiloSessionStore(
    private val apiClient: KiloApiClient,
    private val eventService: KiloEventService
) : Disposable {

    private val log = Logger.getInstance(KiloSessionStore::class.java)
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    // ==================== Internal Sorted State ====================

    private val sessionsLock = Any()
    private val sessionsList = mutableListOf<Session>()

    private val messagesMap = ConcurrentHashMap<String, MutableList<Message>>()
    private val partsMap = ConcurrentHashMap<String, MutableList<Part>>()
    private val permissionsMap = ConcurrentHashMap<String, MutableList<PermissionRequest>>()
    private val questionsMap = ConcurrentHashMap<String, MutableList<QuestionRequest>>()
    private val sessionStatusesMap = ConcurrentHashMap<String, SessionStatus>()
    private val todosMap = ConcurrentHashMap<String, List<Todo>>()

    // ==================== Fine-Grained Events ====================

    private val _storeEvents = MutableSharedFlow<StoreEvent>(
        replay = 0,
        extraBufferCapacity = 100
    )
    val storeEvents: SharedFlow<StoreEvent> = _storeEvents.asSharedFlow()

    // ==================== StateFlows for UI Binding ====================

    private val _sessions = MutableStateFlow<List<Session>>(emptyList())
    val sessions: StateFlow<List<Session>> = _sessions.asStateFlow()

    private val _currentSessionId = MutableStateFlow<String?>(null)
    val currentSessionId: StateFlow<String?> = _currentSessionId.asStateFlow()

    val currentSession: Flow<Session?> = combine(sessions, currentSessionId) { list, id ->
        list.find { it.id == id }
    }

    private val _sessionStatuses = MutableStateFlow<Map<String, SessionStatus>>(emptyMap())
    val sessionStatuses: StateFlow<Map<String, SessionStatus>> = _sessionStatuses.asStateFlow()

    private val _messages = MutableStateFlow<Map<String, List<MessageWithParts>>>(emptyMap())
    val messages: StateFlow<Map<String, List<MessageWithParts>>> = _messages.asStateFlow()

    private val _pendingPermissions = MutableStateFlow<List<PermissionRequest>>(emptyList())
    val pendingPermissions: StateFlow<List<PermissionRequest>> = _pendingPermissions.asStateFlow()

    private val _pendingQuestions = MutableStateFlow<List<QuestionRequest>>(emptyList())
    val pendingQuestions: StateFlow<List<QuestionRequest>> = _pendingQuestions.asStateFlow()

    private val _todos = MutableStateFlow<Map<String, List<Todo>>>(emptyMap())
    val todos: StateFlow<Map<String, List<Todo>>> = _todos.asStateFlow()

    private val _isLoading = MutableStateFlow(true)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    // ==================== Initialization ====================

    init {
        subscribeToEventService()
    }

    suspend fun initialize() {
        _isLoading.value = true
        _error.value = null

        try {
            // Load sessions
            val sessionList = apiClient.listSessions()
            synchronized(sessionsLock) {
                sessionsList.clear()
                sessionsList.addAll(sessionList.sortedBy { it.id })
            }
            syncSessionsFlow()

            // Load session statuses
            val statuses = apiClient.getSessionStatus()
            sessionStatusesMap.clear()
            sessionStatusesMap.putAll(statuses)
            _sessionStatuses.value = statuses

            // Load pending permissions
            val permissions = apiClient.listPermissions()
            permissionsMap.clear()
            for (p in permissions) {
                permissionsMap.getOrPut(p.sessionID) { mutableListOf() }.addSorted(p) { it.id }
            }
            _pendingPermissions.value = permissions

            // Load pending questions
            val questions = apiClient.listQuestions()
            questionsMap.clear()
            for (q in questions) {
                questionsMap.getOrPut(q.sessionID) { mutableListOf() }.addSorted(q) { it.id }
            }
            _pendingQuestions.value = questions

            _storeEvents.emit(StoreEvent.SessionsLoaded(sessionList))
            log.info("KiloSessionStore initialized: ${sessionList.size} sessions")
        } catch (e: Exception) {
            log.error("Failed to initialize", e)
            _error.value = e.message
        } finally {
            _isLoading.value = false
        }
    }

    // ==================== Event Subscription ====================

    private fun subscribeToEventService() {
        scope.launch { eventService.sessionEvents.collect { handleSessionEvent(it) } }
        scope.launch { eventService.messageEvents.collect { handleMessageEvent(it) } }
        scope.launch { eventService.permissionEvents.collect { handlePermissionEvent(it) } }
        scope.launch { eventService.questionEvents.collect { handleQuestionEvent(it) } }
        scope.launch { eventService.todoEvents.collect { handleTodoEvent(it) } }
    }

    // ==================== Session Event Handlers ====================

    private suspend fun handleSessionEvent(event: KiloEventService.SessionEvent) {
        when (event) {
            is KiloEventService.SessionEvent.Created -> {
                val index: Int
                synchronized(sessionsLock) {
                    val i = sessionsList.binarySearch { it.id.compareTo(event.session.id) }
                    if (i >= 0) {
                        sessionsList[i] = event.session
                        syncSessionsFlow()
                        _storeEvents.tryEmit(StoreEvent.SessionUpdated(event.session, i))
                        return
                    }
                    index = -(i + 1)
                    sessionsList.add(index, event.session)
                }
                syncSessionsFlow()
                _storeEvents.emit(StoreEvent.SessionCreated(event.session, index))
            }
            is KiloEventService.SessionEvent.Updated -> {
                val index: Int
                val wasInserted: Boolean
                synchronized(sessionsLock) {
                    val i = sessionsList.binarySearch { it.id.compareTo(event.session.id) }
                    if (i >= 0) {
                        sessionsList[i] = event.session
                        index = i
                        wasInserted = false
                    } else {
                        index = -(i + 1)
                        sessionsList.add(index, event.session)
                        wasInserted = true
                    }
                }
                syncSessionsFlow()
                if (wasInserted) {
                    _storeEvents.emit(StoreEvent.SessionCreated(event.session, index))
                } else {
                    _storeEvents.emit(StoreEvent.SessionUpdated(event.session, index))
                }
            }
            is KiloEventService.SessionEvent.Deleted -> {
                val index: Int
                synchronized(sessionsLock) {
                    val i = sessionsList.binarySearch { it.id.compareTo(event.sessionId) }
                    if (i < 0) return
                    sessionsList.removeAt(i)
                    index = i
                }
                messagesMap.remove(event.sessionId)
                permissionsMap.remove(event.sessionId)
                questionsMap.remove(event.sessionId)
                sessionStatusesMap.remove(event.sessionId)
                todosMap.remove(event.sessionId)

                syncSessionsFlow()
                syncMessagesFlow()
                syncPermissionsFlow()
                syncQuestionsFlow()
                _sessionStatuses.value = sessionStatusesMap.toMap()
                _todos.value = todosMap.toMap()

                if (_currentSessionId.value == event.sessionId) {
                    _currentSessionId.value = null
                }
                _storeEvents.emit(StoreEvent.SessionDeleted(event.sessionId, index))
            }
            is KiloEventService.SessionEvent.Status -> {
                sessionStatusesMap[event.sessionId] = event.status
                _sessionStatuses.value = sessionStatusesMap.toMap()
                _storeEvents.emit(StoreEvent.SessionStatusChanged(event.sessionId, event.status))
            }
            is KiloEventService.SessionEvent.Diff -> {
                _storeEvents.emit(StoreEvent.SessionDiffUpdated(event.sessionId, event.diffs))
            }
        }
    }

    // ==================== Message Event Handlers ====================

    private suspend fun handleMessageEvent(event: KiloEventService.MessageEvent) {
        log.info("KiloSessionStore: MessageEvent received: ${event::class.simpleName}")
        when (event) {
            is KiloEventService.MessageEvent.Updated -> {
                val sessionId = event.message.sessionID
                log.info("KiloSessionStore: Message.Updated - id=${event.message.id}, role=${event.message.role}, sessionId=$sessionId")
                val list = messagesMap.getOrPut(sessionId) { mutableListOf() }
                val i = list.binarySearch { it.id.compareTo(event.message.id) }
                if (i >= 0) {
                    list[i] = event.message
                    syncMessagesFlow()
                    _storeEvents.emit(StoreEvent.MessageUpdated(sessionId, event.message, i))
                } else {
                    val index = -(i + 1)
                    list.add(index, event.message)
                    syncMessagesFlow()
                    log.info("KiloSessionStore: Emitting MessageInserted at index $index")
                    _storeEvents.emit(StoreEvent.MessageInserted(sessionId, event.message, index))
                }
            }
            is KiloEventService.MessageEvent.Removed -> {
                val list = messagesMap[event.sessionId] ?: return
                val i = list.binarySearch { it.id.compareTo(event.messageId) }
                if (i >= 0) {
                    list.removeAt(i)
                    partsMap.remove(event.messageId)
                    syncMessagesFlow()
                    _storeEvents.emit(StoreEvent.MessageRemoved(event.sessionId, event.messageId, i))
                }
            }
            is KiloEventService.MessageEvent.PartUpdated -> {
                log.info("KiloSessionStore: Part.Updated - messageId=${event.messageId}, partId=${event.part.id}, type=${event.part.type}")
                val list = partsMap.getOrPut(event.messageId) { mutableListOf() }
                val i = list.binarySearch { it.id.compareTo(event.part.id) }
                if (i >= 0) {
                    list[i] = event.part
                    syncMessagesFlow()
                    _storeEvents.emit(StoreEvent.PartUpdated(event.sessionId, event.messageId, event.part, i, event.delta))
                } else {
                    val index = -(i + 1)
                    list.add(index, event.part)
                    syncMessagesFlow()
                    log.info("KiloSessionStore: Emitting PartInserted at index $index")
                    _storeEvents.emit(StoreEvent.PartInserted(event.sessionId, event.messageId, event.part, index))
                }
            }
            is KiloEventService.MessageEvent.PartRemoved -> {
                val list = partsMap[event.messageId] ?: return
                val i = list.binarySearch { it.id.compareTo(event.partId) }
                if (i >= 0) {
                    list.removeAt(i)
                    syncMessagesFlow()
                    _storeEvents.emit(StoreEvent.PartRemoved(event.sessionId, event.messageId, event.partId, i))
                }
            }
        }
    }

    // ==================== Permission/Question Event Handlers ====================

    private suspend fun handlePermissionEvent(event: KiloEventService.PermissionEvent) {
        when (event) {
            is KiloEventService.PermissionEvent.Asked -> {
                val list = permissionsMap.getOrPut(event.request.sessionID) { mutableListOf() }
                val index = list.addSorted(event.request) { it.id }
                syncPermissionsFlow()
                _storeEvents.emit(StoreEvent.PermissionInserted(event.request.sessionID, event.request, index))
            }
            is KiloEventService.PermissionEvent.Replied -> {
                for ((sessionId, list) in permissionsMap) {
                    val i = list.binarySearch { it.id.compareTo(event.requestId) }
                    if (i >= 0) {
                        list.removeAt(i)
                        syncPermissionsFlow()
                        _storeEvents.emit(StoreEvent.PermissionRemoved(sessionId, event.requestId, i))
                        break
                    }
                }
            }
        }
    }

    private suspend fun handleQuestionEvent(event: KiloEventService.QuestionEvent) {
        when (event) {
            is KiloEventService.QuestionEvent.Asked -> {
                val list = questionsMap.getOrPut(event.request.sessionID) { mutableListOf() }
                val index = list.addSorted(event.request) { it.id }
                syncQuestionsFlow()
                _storeEvents.emit(StoreEvent.QuestionInserted(event.request.sessionID, event.request, index))
            }
            is KiloEventService.QuestionEvent.Replied -> {
                removeQuestion(event.requestId)
            }
            is KiloEventService.QuestionEvent.Rejected -> {
                removeQuestion(event.requestId)
            }
        }
    }

    private suspend fun removeQuestion(requestId: String) {
        for ((sessionId, list) in questionsMap) {
            val i = list.binarySearch { it.id.compareTo(requestId) }
            if (i >= 0) {
                list.removeAt(i)
                syncQuestionsFlow()
                _storeEvents.emit(StoreEvent.QuestionRemoved(sessionId, requestId, i))
                break
            }
        }
    }

    private suspend fun handleTodoEvent(event: KiloEventService.TodoEvent) {
        when (event) {
            is KiloEventService.TodoEvent.Updated -> {
                todosMap[event.sessionId] = event.todos
                _todos.value = todosMap.toMap()
                _storeEvents.emit(StoreEvent.TodosUpdated(event.sessionId, event.todos))
            }
        }
    }

    // ==================== StateFlow Sync ====================

    private fun syncSessionsFlow() {
        synchronized(sessionsLock) {
            _sessions.value = sessionsList.toList()
        }
    }

    private fun syncMessagesFlow() {
        val result = mutableMapOf<String, List<MessageWithParts>>()
        for ((sessionId, messageList) in messagesMap) {
            result[sessionId] = messageList.map { msg ->
                MessageWithParts(
                    info = msg,
                    parts = partsMap[msg.id]?.toList() ?: emptyList()
                )
            }
        }
        _messages.value = result
    }

    private fun syncPermissionsFlow() {
        _pendingPermissions.value = permissionsMap.values.flatten()
    }

    private fun syncQuestionsFlow() {
        _pendingQuestions.value = questionsMap.values.flatten()
    }

    // ==================== Read-Only Accessors ====================

    fun getMessagesForSession(sessionId: String): Flow<List<MessageWithParts>> {
        return messages.map { it[sessionId] ?: emptyList() }
    }

    fun getTodosForSession(sessionId: String): Flow<List<Todo>> {
        return todos.map { it[sessionId] ?: emptyList() }
    }

    fun getSession(sessionId: String): Session? {
        synchronized(sessionsLock) {
            val i = sessionsList.binarySearch { it.id.compareTo(sessionId) }
            return if (i >= 0) sessionsList[i] else null
        }
    }

    fun getMessage(sessionId: String, messageId: String): Message? {
        val list = messagesMap[sessionId] ?: return null
        val i = list.binarySearch { it.id.compareTo(messageId) }
        return if (i >= 0) list[i] else null
    }

    fun getPartsForMessage(messageId: String): List<Part> {
        return partsMap[messageId]?.toList() ?: emptyList()
    }

    fun getPermissionsForSession(sessionId: String): List<PermissionRequest> {
        return permissionsMap[sessionId]?.toList() ?: emptyList()
    }

    fun getQuestionsForSession(sessionId: String): List<QuestionRequest> {
        return questionsMap[sessionId]?.toList() ?: emptyList()
    }

    // ==================== Session Operations ====================

    suspend fun selectSession(sessionId: String?) {
        _currentSessionId.value = sessionId
        if (sessionId != null && !messagesMap.containsKey(sessionId)) {
            loadMessages(sessionId)
        }
    }

    suspend fun loadMessages(sessionId: String) {
        try {
            val messageList = apiClient.getMessages(sessionId)
            messagesMap[sessionId] = messageList.map { it.info }.sortedBy { it.id }.toMutableList()
            for (mwp in messageList) {
                if (mwp.parts.isNotEmpty()) {
                    partsMap[mwp.info.id] = mwp.parts.sortedBy { it.id }.toMutableList()
                }
            }
            syncMessagesFlow()
            _storeEvents.emit(StoreEvent.MessagesLoaded(sessionId, messageList.map { it.info }))
        } catch (e: Exception) {
            log.error("Failed to load messages for session $sessionId", e)
        }
    }

    suspend fun createSession(): Session? {
        return try {
            val session = apiClient.createSession()
            synchronized(sessionsLock) {
                val i = sessionsList.binarySearch { it.id.compareTo(session.id) }
                if (i < 0) {
                    sessionsList.add(-(i + 1), session)
                }
            }
            syncSessionsFlow()
            clearError()
            selectSession(session.id)
            session
        } catch (e: Exception) {
            log.error("Failed to create session", e)
            _error.value = e.message
            null
        }
    }

    suspend fun deleteSession(sessionId: String): Boolean {
        return try {
            apiClient.deleteSession(sessionId)
            true
        } catch (e: Exception) {
            log.error("Failed to delete session", e)
            _error.value = e.message
            false
        }
    }

    suspend fun clearAllSessions(): Boolean {
        return try {
            val sessionIds = synchronized(sessionsLock) { sessionsList.map { it.id } }
            for (id in sessionIds) {
                apiClient.deleteSession(id)
            }
            _currentSessionId.value = null
            true
        } catch (e: Exception) {
            log.error("Failed to clear sessions", e)
            _error.value = e.message
            false
        }
    }

    suspend fun renameSession(sessionId: String, title: String): Session? {
        return try {
            apiClient.updateSession(sessionId, title = title)
        } catch (e: Exception) {
            log.error("Failed to rename session", e)
            _error.value = e.message
            null
        }
    }

    suspend fun archiveSession(sessionId: String): Session? {
        return try {
            val session = apiClient.updateSession(sessionId, archived = System.currentTimeMillis())
            if (_currentSessionId.value == sessionId) {
                _currentSessionId.value = null
            }
            session
        } catch (e: Exception) {
            log.error("Failed to archive session", e)
            _error.value = e.message
            null
        }
    }

    suspend fun forkSession(sessionId: String, messageId: String? = null): Session? {
        return try {
            val session = apiClient.forkSession(sessionId, messageId)
            selectSession(session.id)
            session
        } catch (e: Exception) {
            log.error("Failed to fork session", e)
            _error.value = e.message
            null
        }
    }

    suspend fun revertToMessage(sessionId: String, messageId: String, restoreFiles: Boolean = false): Session? {
        return try {
            apiClient.revertMessage(sessionId, messageId, restoreFiles)
        } catch (e: Exception) {
            log.error("Failed to revert to message", e)
            _error.value = e.message
            null
        }
    }

    /**
     * Send a message to the current session.
     *
     * @param text The message text
     * @param model Optional model reference (from KiloAppState.selectedModel)
     * @param agent Optional agent name (from KiloAppState.selectedAgent)
     * @param attachedFiles Optional list of attached files (from KiloAppState.attachedFiles)
     */
    suspend fun sendMessage(
        text: String,
        model: ModelRef? = null,
        agent: String? = null,
        attachedFiles: List<AttachedFile> = emptyList()
    ) {
        val sessionId = _currentSessionId.value ?: run {
            createSession()?.id ?: return
        }

        try {
            if (attachedFiles.isNotEmpty()) {
                val parts = mutableListOf<PromptPart>()
                parts.add(TextPromptPart(text = text))
                attachedFiles.forEach { parts.add(it.toPromptPart()) }
                apiClient.sendMessageAsyncMixed(sessionId, parts, model, agent)
            } else {
                apiClient.sendMessageAsync(sessionId, text, model, agent)
            }
        } catch (e: Exception) {
            log.error("Failed to send message", e)
            _error.value = e.message
        }
    }

    suspend fun abortCurrentSession() {
        val sessionId = _currentSessionId.value ?: return
        try {
            apiClient.abortSession(sessionId)
        } catch (e: Exception) {
            log.error("Failed to abort session", e)
        }
    }

    suspend fun replyPermission(requestId: String, reply: String) {
        try {
            apiClient.replyPermission(requestId, reply)
        } catch (e: Exception) {
            log.error("Failed to reply to permission", e)
            _error.value = e.message
        }
    }

    suspend fun replyQuestion(requestId: String, answers: List<List<String>>) {
        try {
            apiClient.replyQuestion(requestId, answers)
        } catch (e: Exception) {
            log.error("Failed to reply to question", e)
            _error.value = e.message
        }
    }

    suspend fun rejectQuestion(requestId: String) {
        try {
            apiClient.rejectQuestion(requestId)
        } catch (e: Exception) {
            log.error("Failed to reject question", e)
            _error.value = e.message
        }
    }

    suspend fun loadTodos(sessionId: String) {
        try {
            val todoList = apiClient.getSessionTodos(sessionId)
            todosMap[sessionId] = todoList
            _todos.value = todosMap.toMap()
        } catch (e: Exception) {
            log.error("Failed to load todos for session $sessionId", e)
        }
    }

    // ==================== Error Handling ====================

    fun clearError() {
        _error.value = null
    }

    // ==================== Lifecycle ====================

    override fun dispose() {
        scope.cancel()
    }
}

/** Insert item into sorted list, returning the insertion index. */
private inline fun <T> MutableList<T>.addSorted(item: T, crossinline selector: (T) -> String): Int {
    val id = selector(item)
    val i = binarySearch { selector(it).compareTo(id) }
    val index = if (i >= 0) i else -(i + 1)
    add(index, item)
    return index
}
