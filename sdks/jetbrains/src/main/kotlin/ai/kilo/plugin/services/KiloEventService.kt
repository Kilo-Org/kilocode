package ai.kilo.plugin.services

import ai.kilo.plugin.model.*
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URI

/**
 * Service for handling Server-Sent Events (SSE) from the Kilo server.
 */
class KiloEventService(
    private val eventUrl: String
) : Disposable {
    private val log = Logger.getInstance(KiloEventService::class.java)
    private val json = Json { ignoreUnknownKeys = true }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var connectionJob: Job? = null

    @Volatile
    private var isConnected = false

    @Volatile
    private var shouldReconnect = true

    enum class ConnectionStatus { CONNECTED, DISCONNECTED, RECONNECTING, ERROR }

    private val _connectionStatus = MutableStateFlow(ConnectionStatus.DISCONNECTED)
    val connectionStatus: StateFlow<ConnectionStatus> = _connectionStatus.asStateFlow()

    // Event flows for different event types
    private val _events = MutableSharedFlow<ServerEvent>(replay = 0, extraBufferCapacity = 100)
    val events: SharedFlow<ServerEvent> = _events

    // Typed event flows
    private val _sessionEvents = MutableSharedFlow<SessionEvent>(replay = 0, extraBufferCapacity = 50)
    val sessionEvents: SharedFlow<SessionEvent> = _sessionEvents

    private val _messageEvents = MutableSharedFlow<MessageEvent>(replay = 0, extraBufferCapacity = 100)
    val messageEvents: SharedFlow<MessageEvent> = _messageEvents

    private val _permissionEvents = MutableSharedFlow<PermissionEvent>(replay = 0, extraBufferCapacity = 10)
    val permissionEvents: SharedFlow<PermissionEvent> = _permissionEvents

    private val _questionEvents = MutableSharedFlow<QuestionEvent>(replay = 0, extraBufferCapacity = 10)
    val questionEvents: SharedFlow<QuestionEvent> = _questionEvents

    private val _todoEvents = MutableSharedFlow<TodoEvent>(replay = 0, extraBufferCapacity = 10)
    val todoEvents: SharedFlow<TodoEvent> = _todoEvents

    private val _vcsEvents = MutableSharedFlow<VcsEvent>(replay = 0, extraBufferCapacity = 10)
    val vcsEvents: SharedFlow<VcsEvent> = _vcsEvents

    sealed class SessionEvent {
        data class Created(val session: Session) : SessionEvent()
        data class Updated(val session: Session) : SessionEvent()
        data class Deleted(val sessionId: String) : SessionEvent()
        data class Status(val sessionId: String, val status: SessionStatus) : SessionEvent()
        data class Diff(val sessionId: String, val diffs: List<FileDiff>) : SessionEvent()
    }

    sealed class MessageEvent {
        data class Updated(val message: Message) : MessageEvent()
        data class Removed(val sessionId: String, val messageId: String) : MessageEvent()
        data class PartUpdated(
            val sessionId: String,
            val messageId: String,
            val part: Part,
            val delta: String?
        ) : MessageEvent()
        data class PartRemoved(val sessionId: String, val messageId: String, val partId: String) : MessageEvent()
    }

    sealed class PermissionEvent {
        data class Asked(val request: PermissionRequest) : PermissionEvent()
        data class Replied(val requestId: String, val reply: String) : PermissionEvent()
    }

    sealed class QuestionEvent {
        data class Asked(val request: QuestionRequest) : QuestionEvent()
        data class Replied(val requestId: String, val answers: List<List<String>>) : QuestionEvent()
        data class Rejected(val requestId: String) : QuestionEvent()
    }

    sealed class TodoEvent {
        data class Updated(val sessionId: String, val todos: List<Todo>) : TodoEvent()
    }
    
    sealed class VcsEvent {
        data class BranchUpdated(val branch: String) : VcsEvent()
    }
    
    /**
     * Start listening for events.
     */
    fun connect() {
        if (isConnected) return

        shouldReconnect = true
        connectionJob = scope.launch {
            var retryDelay = 2000L
            val maxDelay = 30000L
            
            while (shouldReconnect && isActive) {
                try {
                    _connectionStatus.value = ConnectionStatus.RECONNECTING
                    connectToEventStream()
                    retryDelay = 2000L // Reset delay on successful connection
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    log.warn("SSE connection error: ${e.message}")
                    _connectionStatus.value = ConnectionStatus.ERROR
                    if (shouldReconnect) {
                        delay(retryDelay)
                        // Exponential backoff
                        retryDelay = (retryDelay * 2).coerceAtMost(maxDelay)
                    }
                }
            }
        }
    }

    /**
     * Stop listening for events.
     */
    fun disconnect() {
        shouldReconnect = false
        isConnected = false
        _connectionStatus.value = ConnectionStatus.DISCONNECTED
        connectionJob?.cancel()
        connectionJob = null
    }

    private suspend fun connectToEventStream() {
        val url = URI.create(eventUrl).toURL()
        val connection = withContext(Dispatchers.IO) {
            (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                setRequestProperty("Accept", "text/event-stream")
                setRequestProperty("Cache-Control", "no-cache")
                connectTimeout = 10_000
                readTimeout = 0 // No timeout for SSE
                doInput = true
            }
        }

        try {
            if (connection.responseCode != 200) {
                log.warn("SSE connection failed with status ${connection.responseCode}")
                return
            }

            isConnected = true
            _connectionStatus.value = ConnectionStatus.CONNECTED
            log.info("SSE connection established to $eventUrl")

            withContext(Dispatchers.IO) {
                BufferedReader(InputStreamReader(connection.inputStream)).use { reader ->
                    var eventType = "message"
                    val dataBuilder = StringBuilder()

                    while (shouldReconnect && isActive) {
                        val line = reader.readLine() ?: break

                        when {
                            line.startsWith("event:") -> {
                                eventType = line.substring(6).trim()
                            }
                            line.startsWith("data:") -> {
                                dataBuilder.append(line.substring(5).trim())
                            }
                            line.isEmpty() && dataBuilder.isNotEmpty() -> {
                                // End of event, process it
                                val data = dataBuilder.toString()
                                dataBuilder.clear()
                                processEvent(eventType, data)
                                eventType = "message"
                            }
                        }
                    }
                }
            }
        } finally {
            isConnected = false
            _connectionStatus.value = ConnectionStatus.DISCONNECTED
            connection.disconnect()
            log.info("SSE connection closed")
        }
    }

    private suspend fun processEvent(eventType: String, data: String) {
        try {
            val jsonElement = json.parseToJsonElement(data)
            val type = jsonElement.jsonObject["type"]?.jsonPrimitive?.content ?: eventType
            val properties = jsonElement.jsonObject["properties"]?.jsonObject ?: jsonElement.jsonObject

            val event = ServerEvent(type, properties)
            _events.emit(event)

            // Parse and emit typed events
            when (type) {
                EventTypes.SESSION_CREATED -> {
                    // Session is nested in properties.info
                    val sessionJson = properties["info"]?.jsonObject ?: properties
                    val session = json.decodeFromJsonElement<Session>(sessionJson)
                    _sessionEvents.emit(SessionEvent.Created(session))
                }
                EventTypes.SESSION_UPDATED -> {
                    // Session is nested in properties.info
                    val sessionJson = properties["info"]?.jsonObject ?: properties
                    val session = json.decodeFromJsonElement<Session>(sessionJson)
                    _sessionEvents.emit(SessionEvent.Updated(session))
                }
                EventTypes.SESSION_DELETED -> {
                    // Session info is nested in properties.info
                    val sessionInfo = properties["info"]?.jsonObject ?: return
                    val sessionId = sessionInfo["id"]?.jsonPrimitive?.content ?: return
                    _sessionEvents.emit(SessionEvent.Deleted(sessionId))
                }
                EventTypes.SESSION_STATUS -> {
                    val sessionId = properties["sessionID"]?.jsonPrimitive?.content ?: return
                    // Status is an object with type, attempt, message, next fields
                    val statusObj = properties["status"]?.jsonObject ?: return
                    val status = json.decodeFromJsonElement<SessionStatus>(statusObj)
                    _sessionEvents.emit(SessionEvent.Status(sessionId, status))
                }
                EventTypes.SESSION_DIFF -> {
                    val sessionId = properties["sessionID"]?.jsonPrimitive?.content ?: return
                    val diffs = json.decodeFromJsonElement<List<FileDiff>>(
                        properties["diff"] ?: return  // Note: "diff" not "diffs"
                    )
                    _sessionEvents.emit(SessionEvent.Diff(sessionId, diffs))
                }
                EventTypes.MESSAGE_UPDATED -> {
                    // Message is nested in properties.info
                    val messageJson = properties["info"]?.jsonObject ?: properties
                    val message = json.decodeFromJsonElement<Message>(messageJson)
                    _messageEvents.emit(MessageEvent.Updated(message))
                }
                EventTypes.MESSAGE_REMOVED -> {
                    val sessionId = properties["sessionID"]?.jsonPrimitive?.content ?: return
                    val messageId = properties["messageID"]?.jsonPrimitive?.content ?: return
                    _messageEvents.emit(MessageEvent.Removed(sessionId, messageId))
                }
                EventTypes.MESSAGE_PART_UPDATED -> {
                    // Part is nested in properties.part
                    val partJson = properties["part"]?.jsonObject ?: return
                    val part = json.decodeFromJsonElement<Part>(partJson)
                    val delta = properties["delta"]?.jsonPrimitive?.content
                    _messageEvents.emit(MessageEvent.PartUpdated(part.sessionID, part.messageID, part, delta))
                }
                EventTypes.MESSAGE_PART_REMOVED -> {
                    val sessionId = properties["sessionID"]?.jsonPrimitive?.content ?: return
                    val messageId = properties["messageID"]?.jsonPrimitive?.content ?: return
                    val partId = properties["partID"]?.jsonPrimitive?.content ?: return
                    _messageEvents.emit(MessageEvent.PartRemoved(sessionId, messageId, partId))
                }
                EventTypes.PERMISSION_ASKED -> {
                    val request = json.decodeFromJsonElement<PermissionRequest>(properties)
                    _permissionEvents.emit(PermissionEvent.Asked(request))
                }
                EventTypes.PERMISSION_REPLIED -> {
                    val requestId = properties["requestID"]?.jsonPrimitive?.content ?: return
                    val reply = properties["reply"]?.jsonPrimitive?.content ?: return
                    _permissionEvents.emit(PermissionEvent.Replied(requestId, reply))
                }
                EventTypes.QUESTION_ASKED -> {
                    val request = json.decodeFromJsonElement<QuestionRequest>(properties)
                    _questionEvents.emit(QuestionEvent.Asked(request))
                }
                EventTypes.QUESTION_REPLIED -> {
                    val requestId = properties["requestID"]?.jsonPrimitive?.content ?: return
                    // Answers is array of arrays - each question can have multiple selected answers
                    val answers = json.decodeFromJsonElement<List<List<String>>>(
                        properties["answers"] ?: return
                    )
                    _questionEvents.emit(QuestionEvent.Replied(requestId, answers))
                }
                EventTypes.QUESTION_REJECTED -> {
                    val requestId = properties["requestID"]?.jsonPrimitive?.content ?: return
                    _questionEvents.emit(QuestionEvent.Rejected(requestId))
                }
                EventTypes.TODO_UPDATED -> {
                    val sessionId = properties["sessionID"]?.jsonPrimitive?.content ?: return
                    val todos = json.decodeFromJsonElement<List<Todo>>(properties["todos"] ?: return)
                    _todoEvents.emit(TodoEvent.Updated(sessionId, todos))
                }
                EventTypes.VCS_BRANCH_UPDATED -> {
                    val branch = properties["branch"]?.jsonPrimitive?.content ?: return
                    _vcsEvents.emit(VcsEvent.BranchUpdated(branch))
                }
            }
        } catch (e: Exception) {
            log.warn("Failed to process event: $data", e)
        }
    }

    override fun dispose() {
        disconnect()
        scope.cancel()
    }
}
