package ai.kilocode.backend.app

import ai.kilocode.backend.util.IntellijLog
import ai.kilocode.backend.util.KiloLog
import ai.kilocode.jetbrains.api.client.DefaultApi
import ai.kilocode.jetbrains.api.infrastructure.ClientError
import ai.kilocode.jetbrains.api.infrastructure.ClientException
import ai.kilocode.jetbrains.api.infrastructure.ServerError
import ai.kilocode.jetbrains.api.infrastructure.ServerException
import ai.kilocode.jetbrains.api.model.Config
import ai.kilocode.jetbrains.api.model.KiloNotifications200ResponseInner
import ai.kilocode.jetbrains.api.model.KiloProfile200Response
import ai.kilocode.rpc.dto.HealthDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.util.concurrent.atomic.AtomicReference

/**
 * App-level orchestrator that owns the CLI server lifecycle and
 * loads project-independent data after the connection is established.
 *
 * This is the single entry point for the CLI backend. The frontend
 * reaches it via [KiloAppRpcApi][ai.kilocode.rpc.KiloAppRpcApi] RPC.
 *
 * All lifecycle operations ([connect], [restart], [reinstall], and
 * internal reconnect) are serialized by a single [Mutex]. The owned
 * [KiloBackendCliManager] and [KiloConnectionService] perform no
 * internal synchronization — they rely on this mutex.
 *
 * After the CLI server connects, the app enters a [KiloAppState.Loading]
 * phase. Config and notifications are required (retried up to 3×).
 * Profile is optional — 401 (not logged in) is not an error.
 */
@Service(Service.Level.APP)
class KiloBackendAppService private constructor(
  private val cs: CoroutineScope,
  private val server: CliServer,
  private val log: KiloLog,
) : Disposable {

    /** IntelliJ service injection entry point. */
    constructor(cs: CoroutineScope) : this(
        cs,
        KiloBackendCliManager(),
      IntellijLog(KiloBackendAppService::class.java),
    )

    companion object {
        private const val MAX_RETRIES = 3
        private const val RETRY_DELAY_MS = 1000L

        /** Test factory — no IntelliJ deps needed. */
        internal fun create(
          cs: CoroutineScope,
          server: CliServer,
          log: KiloLog,
        ) = KiloBackendAppService(cs, server, log)
    }

    private val mutex = Mutex()
    private val connection = KiloConnectionService(cs, server, onReconnect = {
        cs.launch { reconnect() }
    }, log = log)

    private var router: Job? = null
    private var loader: Job? = null

    private val _appState = MutableStateFlow<KiloAppState>(KiloAppState.Disconnected)
    val appState: StateFlow<KiloAppState> = _appState.asStateFlow()

    val events: SharedFlow<SseEvent> get() = connection.events
    val api: DefaultApi? get() = connection.api

    @Volatile var profile: KiloProfile200Response? = null
        private set

    @Volatile var config: Config? = null
        private set

    @Volatile var notifications: List<KiloNotifications200ResponseInner> = emptyList()
        private set

    suspend fun connect() {
        mutex.withLock {
            val current = _appState.value
            if (current is KiloAppState.Ready || current is KiloAppState.Connecting || current is KiloAppState.Loading) return
            connection.connect()
        }
    }

    suspend fun restart() {
        mutex.withLock {
            clear()
            connection.restart()
        }
    }

    suspend fun reinstall() {
        mutex.withLock {
            clear()
            connection.reinstall()
        }
    }

    /** One-shot health check via the generated API client. */
    suspend fun health(): HealthDto {
        val client = api ?: throw IllegalStateException("Not connected")
        val response = client.globalHealth()
        return HealthDto(healthy = response.healthy, version = response.version)
    }

    private suspend fun reconnect() {
        mutex.withLock {
            val current = _appState.value
            if (current is KiloAppState.Ready || current is KiloAppState.Connecting || current is KiloAppState.Loading) {
                log.info("reconnect: already ${current::class.simpleName} — skipping")
                return
            }
            log.info("reconnect: full restart under mutex")
            connection.restart()
        }
    }

    init {
        cs.launch {
            connection.state.collect { next ->
                when (next) {
                    ConnectionState.Disconnected -> _appState.value = KiloAppState.Disconnected
                    ConnectionState.Connecting -> _appState.value = KiloAppState.Connecting
                    is ConnectionState.Connected -> load()
                    is ConnectionState.Error -> _appState.value = KiloAppState.Error(next.message)
                }
            }
        }
    }

    /**
     * Launch all project-independent data fetches in parallel.
     *
     * Config and notifications are required — retried up to [MAX_RETRIES] times.
     * Profile is optional — 401 (not logged in) is fine.
     *
     * Progress is tracked via [LoadProgress] and emitted as [KiloAppState.Loading].
     * On success, transitions to [KiloAppState.Ready].
     * On failure of required data, transitions to [KiloAppState.Error].
     */
    private fun load() {
        loader?.cancel()
        loader = cs.launch {
            log.info("Loading global data")
            val progress = AtomicReference(LoadProgress())
            _appState.value = KiloAppState.Loading(progress.get())

            val errors = mutableListOf<LoadError>()

            try {
                coroutineScope {
                    launch {
                        try {
                            val result = fetchProfile()
                            progress.updateAndGet { it.copy(profile = result) }
                                .also { _appState.value = KiloAppState.Loading(it) }
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            val err = LoadError(
                                resource = "profile",
                                status = (e as? ClientException)?.statusCode
                                    ?: (e as? ServerException)?.statusCode,
                                detail = e.message,
                            )
                            synchronized(errors) { errors.add(err) }
                            throw LoadFailure(err)
                        }
                    }
                    launch {
                        val result = fetchWithRetry("config") { fetchConfig() }
                        if (result.value != null) {
                            config = result.value
                            progress.updateAndGet { it.copy(config = true) }
                                .also { _appState.value = KiloAppState.Loading(it) }
                        } else {
                            val err = result.error!!
                            synchronized(errors) { errors.add(err) }
                            throw LoadFailure(err)
                        }
                    }
                    launch {
                        val result = fetchWithRetry("notifications") { fetchNotifications() }
                        if (result.value != null) {
                            notifications = result.value
                            progress.updateAndGet { it.copy(notifications = true) }
                                .also { _appState.value = KiloAppState.Loading(it) }
                        } else {
                            val err = result.error!!
                            synchronized(errors) { errors.add(err) }
                            throw LoadFailure(err)
                        }
                    }
                }

                _appState.value = KiloAppState.Ready(
                    AppData(
                        profile = profile,
                        config = config!!,
                        notifications = notifications,
                    )
                )
                log.info("Global data loaded — app is Ready")
                ensureRouter()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.warn("Global data load failed: ${e.message}")
                _appState.value = KiloAppState.Error(
                    message = "Failed to load required data",
                    errors = synchronized(errors) { errors.toList() },
                )
            }
        }
    }

    private suspend fun fetchProfile(): ProfileResult {
        val client = connection.api ?: return ProfileResult.NOT_LOGGED_IN
        return try {
            val response = client.kiloProfile()
            profile = response
            log.info("Profile: ${response.profile.email}")
            ProfileResult.LOADED
        } catch (e: ClientException) {
            if (e.statusCode == 401) {
                log.info("Profile: not logged in (401)")
                return ProfileResult.NOT_LOGGED_IN
            }
            log.warn("Profile fetch failed: HTTP ${e.statusCode}", e)
            throw e
        } catch (e: Exception) {
            log.warn("Profile fetch failed: ${e.message}", e)
            throw e
        }
    }

    private suspend fun fetchConfig(): FetchResult<Config> {
        val client = connection.api
            ?: return FetchResult.fail("config", detail = "Not connected")
        return try {
            FetchResult.ok(client.globalConfigGet())
        } catch (e: Exception) {
            log.warn("Global config fetch failed: ${e.message}", e)
            logResponseBody("config", e)
            FetchResult.fail("config", e)
        }
    }

    private suspend fun fetchNotifications(): FetchResult<List<KiloNotifications200ResponseInner>> {
        val client = connection.api
            ?: return FetchResult.fail("notifications", detail = "Not connected")
        return try {
            FetchResult.ok(client.kiloNotifications())
        } catch (e: Exception) {
            log.warn("Notifications fetch failed: ${e.message}", e)
            logResponseBody("notifications", e)
            FetchResult.fail("notifications", e)
        }
    }

    /**
     * Dump the HTTP response body from a failed API call for debugging.
     * The generated client wraps the response in [ClientException.response]
     * or [ServerException.response] as a [ClientError] / [ServerError] with
     * a `body` field containing the raw response string.
     */
    private fun logResponseBody(resource: String, e: Exception) {
        val body = when (e) {
            is ClientException -> (e.response as? ClientError<*>)?.body
            is ServerException -> (e.response as? ServerError<*>)?.body
            else -> null
        }
        if (body != null) {
            log.warn("$resource response body: $body")
        }
    }

    private suspend fun <T> fetchWithRetry(
        name: String,
        block: suspend () -> FetchResult<T>,
    ): FetchResult<T> {
        var last: FetchResult<T> = FetchResult.fail(name, detail = "No attempts made")
        repeat(MAX_RETRIES) { attempt ->
            last = block()
            if (last.value != null) return last
            if (attempt < MAX_RETRIES - 1) {
                log.warn("$name: attempt ${attempt + 1}/$MAX_RETRIES failed — retrying in ${RETRY_DELAY_MS}ms")
                delay(RETRY_DELAY_MS)
            }
        }
        log.error("$name: all $MAX_RETRIES attempts failed")
        return last
    }

    private fun ensureRouter() {
        if (router?.isActive == true) return
        router = cs.launch {
            connection.events.collect { event ->
                when (event.type) {
                    "global.config.updated" -> launch {
                        val result = fetchConfig()
                        if (result.value != null) {
                            config = result.value
                            val current = _appState.value
                            if (current is KiloAppState.Ready) {
                                _appState.value = current.copy(
                                    data = current.data.copy(config = result.value)
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    private fun clear() {
        loader?.cancel()
        router?.cancel()
        profile = null
        config = null
        notifications = emptyList()
        _appState.value = KiloAppState.Disconnected
    }

    override fun dispose() {
        clear()
        connection.dispose()
        server.dispose()
    }
}

/**
 * Result of a data fetch — either a value or an error with details.
 */
private data class FetchResult<T>(val value: T?, val error: LoadError?) {
    companion object {
        fun <T> ok(value: T) = FetchResult<T>(value, null)

        fun <T> fail(resource: String, exception: Exception) = FetchResult<T>(
            value = null,
            error = LoadError(
                resource = resource,
                status = httpStatus(exception),
                detail = httpDetail(exception),
            ),
        )

        fun <T> fail(resource: String, detail: String) = FetchResult<T>(
            value = null,
            error = LoadError(resource = resource, detail = detail),
        )

        private fun httpStatus(e: Exception): Int? =
            when (e) {
                is ClientException -> e.statusCode
                is ServerException -> e.statusCode
                else -> null
            }

        private fun httpDetail(e: Exception): String? =
            when (e) {
                is ClientException -> "HTTP ${e.statusCode}: ${e.message}"
                is ServerException -> "HTTP ${e.statusCode}: ${e.message}"
                is ConnectException -> "Connection refused: ${e.message}"
                is SocketTimeoutException -> "Timeout: ${e.message}"
                else -> e.message
            }
    }
}

/** Thrown when a required data fetch exhausts all retries. */
private class LoadFailure(val error: LoadError) : Exception("Failed to load ${error.resource}")
