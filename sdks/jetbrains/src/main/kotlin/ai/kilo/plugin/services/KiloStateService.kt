package ai.kilo.plugin.services

import ai.kilo.plugin.model.*
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

/**
 * Reactive state management service for the Kilo plugin.
 * Maintains synchronized state with the server via SSE events.
 */
class KiloStateService(
    private val apiClient: KiloApiClient,
    private val eventService: KiloEventService
) : Disposable {
    private val log = Logger.getInstance(KiloStateService::class.java)
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    // Session state
    private val _sessions = MutableStateFlow<List<Session>>(emptyList())
    val sessions: StateFlow<List<Session>> = _sessions.asStateFlow()

    private val _currentSessionId = MutableStateFlow<String?>(null)
    val currentSessionId: StateFlow<String?> = _currentSessionId.asStateFlow()

    val currentSession: Flow<Session?> = combine(sessions, currentSessionId) { sessionList, id ->
        sessionList.find { it.id == id }
    }

    private val _sessionStatuses = MutableStateFlow<Map<String, SessionStatus>>(emptyMap())
    val sessionStatuses: StateFlow<Map<String, SessionStatus>> = _sessionStatuses.asStateFlow()

    // Message state (per session)
    private val _messages = MutableStateFlow<Map<String, List<MessageWithParts>>>(emptyMap())
    val messages: StateFlow<Map<String, List<MessageWithParts>>> = _messages.asStateFlow()

    fun getMessagesForSession(sessionId: String): Flow<List<MessageWithParts>> {
        return messages.map { it[sessionId] ?: emptyList() }
    }

    // Parts state (for streaming updates)
    private val _parts = MutableStateFlow<Map<String, Map<String, Part>>>(emptyMap())

    // Permission requests
    private val _pendingPermissions = MutableStateFlow<List<PermissionRequest>>(emptyList())
    val pendingPermissions: StateFlow<List<PermissionRequest>> = _pendingPermissions.asStateFlow()

    // Question requests
    private val _pendingQuestions = MutableStateFlow<List<QuestionRequest>>(emptyList())
    val pendingQuestions: StateFlow<List<QuestionRequest>> = _pendingQuestions.asStateFlow()

    // Providers
    private val _providers = MutableStateFlow<ProviderListResponse?>(null)
    val providers: StateFlow<ProviderListResponse?> = _providers.asStateFlow()

    // Agents
    private val _agents = MutableStateFlow<List<Agent>>(emptyList())
    val agents: StateFlow<List<Agent>> = _agents.asStateFlow()

    // Selected model for sending messages
    private val _selectedModel = MutableStateFlow<ModelRef?>(null)
    val selectedModel: StateFlow<ModelRef?> = _selectedModel.asStateFlow()

    // Selected agent for sending messages
    private val _selectedAgent = MutableStateFlow<String?>(null)
    val selectedAgent: StateFlow<String?> = _selectedAgent.asStateFlow()
    
    /**
     * Data class for attached file context.
     */
    data class AttachedFile(
        val absolutePath: String,
        val relativePath: String,
        val startLine: Int? = null,
        val endLine: Int? = null,
        val mime: String = "text/plain"
    ) {
        fun toFileUrl(): String {
            val base = "file://$absolutePath"
            return when {
                startLine != null && endLine != null -> "$base?start=$startLine&end=$endLine"
                startLine != null -> "$base?start=$startLine"
                else -> base
            }
        }

        fun toPromptPart(): FilePromptPart {
            return FilePromptPart(
                url = toFileUrl(),
                mime = mime,
                filename = relativePath
            )
        }
    }

    private val _attachedFiles = MutableStateFlow<List<AttachedFile>>(emptyList())
    val attachedFiles: StateFlow<List<AttachedFile>> = _attachedFiles.asStateFlow()
    
    private val _todos = MutableStateFlow<Map<String, List<Todo>>>(emptyMap())
    val todos: StateFlow<Map<String, List<Todo>>> = _todos.asStateFlow()

    fun getTodosForSession(sessionId: String): Flow<List<Todo>> {
        return todos.map { it[sessionId] ?: emptyList() }
    }
    
    private val _vcsInfo = MutableStateFlow<VcsInfo?>(null)
    val vcsInfo: StateFlow<VcsInfo?> = _vcsInfo.asStateFlow()
    
    // Loading state
    private val _isLoading = MutableStateFlow(true)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    // Error state
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    val connectionStatus: StateFlow<KiloEventService.ConnectionStatus>
        get() = eventService.connectionStatus

    init {
        // Subscribe to event streams
        subscribeToEvents()
    }

    private fun subscribeToEvents() {
        // Session events
        scope.launch {
            eventService.sessionEvents.collect { event ->
                when (event) {
                    is KiloEventService.SessionEvent.Created -> {
                        _sessions.update { sessions ->
                            if (sessions.none { it.id == event.session.id }) {
                                sessions + event.session
                            } else {
                                sessions
                            }
                        }
                    }
                    is KiloEventService.SessionEvent.Updated -> {
                        _sessions.update { sessions ->
                            sessions.map { if (it.id == event.session.id) event.session else it }
                        }
                    }
                    is KiloEventService.SessionEvent.Deleted -> {
                        _sessions.update { sessions ->
                            sessions.filter { it.id != event.sessionId }
                        }
                        // Clear current session if deleted
                        if (_currentSessionId.value == event.sessionId) {
                            _currentSessionId.value = null
                        }
                    }
                    is KiloEventService.SessionEvent.Status -> {
                        _sessionStatuses.update { statuses ->
                            statuses + (event.sessionId to event.status)
                        }
                    }
                    is KiloEventService.SessionEvent.Diff -> {
                        // Handle diff updates if needed
                    }
                }
            }
        }

        // Message events
        scope.launch {
            eventService.messageEvents.collect { event ->
                when (event) {
                    is KiloEventService.MessageEvent.Updated -> {
                        // Message header updated
                        updateMessageInState(event.message)
                    }
                    is KiloEventService.MessageEvent.Removed -> {
                        _messages.update { messageMap ->
                            val sessionMessages = messageMap[event.sessionId]?.toMutableList() ?: return@update messageMap
                            sessionMessages.removeAll { it.info.id == event.messageId }
                            messageMap + (event.sessionId to sessionMessages)
                        }
                    }
                    is KiloEventService.MessageEvent.PartUpdated -> {
                        updatePartInState(event.sessionId, event.messageId, event.part)
                    }
                    is KiloEventService.MessageEvent.PartRemoved -> {
                        removePartFromState(event.sessionId, event.messageId, event.partId)
                    }
                }
            }
        }

        // Permission events
        scope.launch {
            eventService.permissionEvents.collect { event ->
                when (event) {
                    is KiloEventService.PermissionEvent.Asked -> {
                        _pendingPermissions.update { it + event.request }
                    }
                    is KiloEventService.PermissionEvent.Replied -> {
                        _pendingPermissions.update { permissions ->
                            permissions.filter { it.id != event.requestId }
                        }
                    }
                }
            }
        }

        // Question events
        scope.launch {
            eventService.questionEvents.collect { event ->
                when (event) {
                    is KiloEventService.QuestionEvent.Asked -> {
                        _pendingQuestions.update { it + event.request }
                    }
                    is KiloEventService.QuestionEvent.Replied,
                    is KiloEventService.QuestionEvent.Rejected -> {
                        val requestId = when (event) {
                            is KiloEventService.QuestionEvent.Replied -> event.requestId
                            is KiloEventService.QuestionEvent.Rejected -> event.requestId
                            else -> return@collect
                        }
                        _pendingQuestions.update { questions ->
                            questions.filter { it.id != requestId }
                        }
                    }
                }
            }
        }

        scope.launch {
            eventService.todoEvents.collect { event ->
                when (event) {
                    is KiloEventService.TodoEvent.Updated -> {
                        _todos.update { it + (event.sessionId to event.todos) }
                    }
                }
            }
        }
        
        scope.launch {
            eventService.vcsEvents.collect { event ->
                when (event) {
                    is KiloEventService.VcsEvent.BranchUpdated -> {
                        _vcsInfo.update { VcsInfo(branch = event.branch) }
                    }
                }
            }
        }
    }

    private fun updateMessageInState(message: Message) {
        _messages.update { messageMap ->
            val sessionId = message.sessionID
            val sessionMessages = messageMap[sessionId]?.toMutableList() ?: mutableListOf()
            val index = sessionMessages.indexOfFirst { it.info.id == message.id }
            if (index >= 0) {
                val existing = sessionMessages[index]
                sessionMessages[index] = existing.copy(info = message)
            } else {
                sessionMessages.add(MessageWithParts(info = message, parts = emptyList()))
            }
            messageMap + (sessionId to sessionMessages)
        }
    }

    private fun updatePartInState(sessionId: String, messageId: String, part: Part) {
        _messages.update { messageMap ->
            val sessionMessages = messageMap[sessionId]?.toMutableList() ?: return@update messageMap
            val messageIndex = sessionMessages.indexOfFirst { it.info.id == messageId }
            if (messageIndex < 0) return@update messageMap

            val message = sessionMessages[messageIndex]
            val parts = message.parts.toMutableList()
            val partIndex = parts.indexOfFirst { it.id == part.id }

            if (partIndex >= 0) {
                parts[partIndex] = part
            } else {
                parts.add(part)
            }

            sessionMessages[messageIndex] = message.copy(parts = parts)
            messageMap + (sessionId to sessionMessages)
        }
    }

    private fun removePartFromState(sessionId: String, messageId: String, partId: String) {
        _messages.update { messageMap ->
            val sessionMessages = messageMap[sessionId]?.toMutableList() ?: return@update messageMap
            val messageIndex = sessionMessages.indexOfFirst { it.info.id == messageId }
            if (messageIndex < 0) return@update messageMap

            val message = sessionMessages[messageIndex]
            val parts = message.parts.filter { it.id != partId }

            sessionMessages[messageIndex] = message.copy(parts = parts)
            messageMap + (sessionId to sessionMessages)
        }
    }

    /**
     * Initialize state by loading data from the server.
     */
    suspend fun initialize() {
        _isLoading.value = true
        _error.value = null

        try {
            // Load sessions
            val sessionList = apiClient.listSessions()
            _sessions.value = sessionList.sortedByDescending { it.time.updated }

            // Load session statuses
            val statuses = apiClient.getSessionStatus()
            _sessionStatuses.value = statuses

            // Load providers
            _providers.value = apiClient.listProviders()

            // Load agents
            _agents.value = apiClient.listAgents()

            // Load pending permissions and questions
            _pendingPermissions.value = apiClient.listPermissions()
            _pendingQuestions.value = apiClient.listQuestions()

            try {
                _vcsInfo.value = apiClient.getVcsInfo()
            } catch (e: Exception) {
                log.debug("VCS info not available: ${e.message}")
            }
            
            log.info("State initialized: ${sessionList.size} sessions loaded")
        } catch (e: Exception) {
            log.error("Failed to initialize state", e)
            _error.value = e.message
        } finally {
            _isLoading.value = false
        }
    }

    /**
     * Select a session as the current session and load its messages.
     */
    suspend fun selectSession(sessionId: String?) {
        _currentSessionId.value = sessionId

        if (sessionId != null && !_messages.value.containsKey(sessionId)) {
            loadMessages(sessionId)
        }
    }

    /**
     * Load messages for a session.
     */
    suspend fun loadMessages(sessionId: String) {
        try {
            val messageList = apiClient.getMessages(sessionId)
            _messages.update { it + (sessionId to messageList) }
        } catch (e: Exception) {
            log.error("Failed to load messages for session $sessionId", e)
        }
    }

    /**
     * Create a new session.
     */
    suspend fun createSession(): Session? {
        return try {
            val session = apiClient.createSession()
            // SSE will handle adding to state
            selectSession(session.id)
            session
        } catch (e: Exception) {
            log.error("Failed to create session", e)
            _error.value = e.message
            null
        }
    }

    /**
     * Delete a session.
     */
    suspend fun deleteSession(sessionId: String): Boolean {
        return try {
            apiClient.deleteSession(sessionId)
            // SSE will handle removing from state
            true
        } catch (e: Exception) {
            log.error("Failed to delete session", e)
            _error.value = e.message
            false
        }
    }

    /**
     * Update a session's title.
     */
    suspend fun renameSession(sessionId: String, title: String): Session? {
        return try {
            val session = apiClient.updateSession(sessionId, title = title)
            // SSE will handle updating state
            session
        } catch (e: Exception) {
            log.error("Failed to rename session", e)
            _error.value = e.message
            null
        }
    }

    /**
     * Archive a session.
     */
    suspend fun archiveSession(sessionId: String): Session? {
        return try {
            val session = apiClient.updateSession(sessionId, archived = System.currentTimeMillis())
            // SSE will handle updating state, but also update locally
            _sessions.update { sessions ->
                sessions.map { if (it.id == sessionId) session else it }
            }
            // Clear current session if archived
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

    /**
     * Fork a session from a specific message.
     */
    suspend fun forkSession(sessionId: String, messageId: String? = null): Session? {
        return try {
            val session = apiClient.forkSession(sessionId, messageId)
            // SSE will handle adding to state
            selectSession(session.id)
            session
        } catch (e: Exception) {
            log.error("Failed to fork session", e)
            _error.value = e.message
            null
        }
    }

    /**
     * Revert session to a specific message.
     */
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
     * Uses the currently selected model and agent if not explicitly provided.
     * Includes any attached files in the message.
     * Auto-creates a new session if none exists.
     */
    suspend fun sendMessage(text: String, model: ModelRef? = null, agent: String? = null) {
        // Auto-create session if none exists
        val sessionId = _currentSessionId.value ?: run {
            val newSession = createSession()
            newSession?.id ?: return
        }

        try {
            val effectiveModel = model ?: _selectedModel.value
            val effectiveAgent = agent ?: _selectedAgent.value
            
            val files = _attachedFiles.value
            if (files.isNotEmpty()) {
                // Build mixed parts: text + files
                val parts = mutableListOf<PromptPart>()
                parts.add(TextPromptPart(text = text))
                files.forEach { file ->
                    parts.add(file.toPromptPart())
                }
                
                // Send with mixed parts
                apiClient.sendMessageAsyncMixed(sessionId, parts, effectiveModel, effectiveAgent)
                
                // Clear attached files after sending
                clearAttachedFiles()
            } else {
                // Use async endpoint - SSE will deliver the response
                apiClient.sendMessageAsync(sessionId, text, effectiveModel, effectiveAgent)
            }
        } catch (e: Exception) {
            log.error("Failed to send message", e)
            _error.value = e.message
        }
    }

    /**
     * Set the selected model for sending messages.
     */
    fun setSelectedModel(model: ModelRef?) {
        _selectedModel.value = model
    }

    /**
     * Set the selected agent for sending messages.
     */
    fun setSelectedAgent(agent: String?) {
        _selectedAgent.value = agent
    }
    
    /**
     * Add a file to the context.
     */
    fun addFileToContext(file: AttachedFile) {
        _attachedFiles.update { files ->
            // Don't add duplicates (same path and line range)
            if (files.any { it.absolutePath == file.absolutePath && 
                           it.startLine == file.startLine && 
                           it.endLine == file.endLine }) {
                files
            } else {
                files + file
            }
        }
    }

    /**
     * Remove a file from the context.
     */
    fun removeFileFromContext(absolutePath: String, startLine: Int? = null, endLine: Int? = null) {
        _attachedFiles.update { files ->
            files.filter { 
                !(it.absolutePath == absolutePath && 
                  it.startLine == startLine && 
                  it.endLine == endLine)
            }
        }
    }

    /**
     * Clear all attached files.
     */
    fun clearAttachedFiles() {
        _attachedFiles.value = emptyList()
    }

    /**
     * Search for files in the project.
     */
    suspend fun searchFiles(query: String, limit: Int = 50): List<String> {
        return try {
            apiClient.searchFiles(query, limit)
        } catch (e: Exception) {
            log.error("Failed to search files", e)
            emptyList()
        }
    }
    
    /**
     * Load todos for a session.
     */
    suspend fun loadTodos(sessionId: String) {
        try {
            val todoList = apiClient.getSessionTodos(sessionId)
            _todos.update { it + (sessionId to todoList) }
        } catch (e: Exception) {
            log.error("Failed to load todos for session $sessionId", e)
        }
    }
    
    /**
     * Abort the current session's generation.
     */
    suspend fun abortCurrentSession() {
        val sessionId = _currentSessionId.value ?: return

        try {
            apiClient.abortSession(sessionId)
        } catch (e: Exception) {
            log.error("Failed to abort session", e)
        }
    }

    /**
     * Reply to a permission request.
     */
    suspend fun replyPermission(requestId: String, reply: String) {
        try {
            apiClient.replyPermission(requestId, reply)
            // SSE will handle removing from state
        } catch (e: Exception) {
            log.error("Failed to reply to permission", e)
            _error.value = e.message
        }
    }

    /**
     * Reply to a question.
     */
    suspend fun replyQuestion(requestId: String, answers: List<List<String>>) {
        try {
            apiClient.replyQuestion(requestId, answers)
            // SSE will handle removing from state
        } catch (e: Exception) {
            log.error("Failed to reply to question", e)
            _error.value = e.message
        }
    }

    /**
     * Reject a question.
     */
    suspend fun rejectQuestion(requestId: String) {
        try {
            apiClient.rejectQuestion(requestId)
            // SSE will handle removing from state
        } catch (e: Exception) {
            log.error("Failed to reject question", e)
            _error.value = e.message
        }
    }

    /**
     * Clear any error state.
     */
    fun clearError() {
        _error.value = null
    }

    override fun dispose() {
        scope.cancel()
    }
}
