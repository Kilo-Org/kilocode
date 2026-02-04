package ai.kilo.plugin.api
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URI

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

    private val _events = MutableSharedFlow<ServerEvent>(replay = 0, extraBufferCapacity = 100)
    val events: SharedFlow<ServerEvent> = _events.asSharedFlow()

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
                    retryDelay = 2000L
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    log.warn("SSE connection error: ${e.message}")
                    _connectionStatus.value = ConnectionStatus.ERROR
                    if (shouldReconnect) {
                        delay(retryDelay)
                        retryDelay = (retryDelay * 2).coerceAtMost(maxDelay)
                    }
                }
            }
        }
    }

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
                readTimeout = 0  // SSE requires no read timeout
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
                    var eventTypeWire = "message"
                    val dataBuilder = StringBuilder()

                    while (shouldReconnect && isActive) {
                        val line = reader.readLine() ?: break

                        when {
                            line.startsWith("event:") -> {
                                eventTypeWire = line.substring(6).trim()
                            }
                            line.startsWith("data:") -> {
                                dataBuilder.append(line.substring(5).trim())
                            }
                            line.isEmpty() && dataBuilder.isNotEmpty() -> {
                                val data = dataBuilder.toString()
                                dataBuilder.clear()
                                processEvent(eventTypeWire, data)
                                eventTypeWire = "message"
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

    private suspend fun processEvent(fallbackWire: String, data: String) {
        try {
            val jsonElement = json.parseToJsonElement(data)
            val wire = jsonElement.jsonObject["type"]?.jsonPrimitive?.content ?: fallbackWire
            val properties = jsonElement.jsonObject["properties"]?.jsonObject ?: jsonElement.jsonObject

            val event = ServerEvent.fromJson(json, wire, properties)

            when (event) {
                null -> { }  // ignored event
                is ServerEvent.Unknown -> log.warn("Unknown event type: ${event.wire}")
                else -> _events.emit(event)
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
