package ai.kilocode.backend.app

import ai.kilocode.backend.cli.CliServer
import ai.kilocode.backend.cli.KiloBackendCliManager
import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.backend.migration.KiloBackendLegacyMigrationStoreService
import ai.kilocode.backend.migration.LegacyMigrationDetection
import ai.kilocode.backend.migration.LegacyMigrationStatus
import ai.kilocode.backend.telemetry.KiloBackendTelemetry
import ai.kilocode.log.KiloLog
import ai.kilocode.backend.workspace.KiloBackendWorkspaceManager
import ai.kilocode.jetbrains.api.client.DefaultApi
import ai.kilocode.jetbrains.api.infrastructure.ClientError
import ai.kilocode.jetbrains.api.infrastructure.ClientException
import ai.kilocode.jetbrains.api.infrastructure.ServerError
import ai.kilocode.jetbrains.api.infrastructure.ServerException
import ai.kilocode.jetbrains.api.model.ConfigWarnings200ResponseInner
import ai.kilocode.jetbrains.api.model.KiloNotifications200ResponseInner
import ai.kilocode.jetbrains.api.model.KiloProfile200Response
import ai.kilocode.jetbrains.api.model.ProviderOauthAuthorizeRequest
import ai.kilocode.jetbrains.api.model.ProviderOauthCallbackRequest
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.DeviceAuthDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.HealthDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

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
  private val loadTimeoutMs: Long,
) : Disposable {

    /** IntelliJ service injection entry point. */
    constructor(cs: CoroutineScope) : this(
        cs,
        KiloBackendCliManager(),
      KiloLog.create(KiloBackendAppService::class.java),
        APP_LOAD_TIMEOUT_MS,
    )

    companion object {
        private const val MAX_RETRIES = 3
        private const val RETRY_DELAY_MS = 1000L
        private const val APP_LOAD_TIMEOUT_MS = 30_000L
        private const val READY_TIMEOUT_MS = 120_000L

        /** Test factory — no IntelliJ deps needed. */
        internal fun create(
          cs: CoroutineScope,
          server: CliServer,
          log: KiloLog,
          loadTimeoutMs: Long = APP_LOAD_TIMEOUT_MS,
        ) = KiloBackendAppService(cs, server, log, loadTimeoutMs)
    }

    private val mutex = Mutex()
    private val connection = KiloConnectionService(cs, server, onReconnect = {
        cs.launch { reconnect() }
    }, appLoadTimeoutMs = loadTimeoutMs, log = log)

    private var watcher: Job? = null
    private var eventWatcher: Job? = null
    private var loader: Job? = null
    private var closed = false
    private var migrationOffered = false
    private var migrationSuppressed = false
    private var migrationForceRequested = false
    private val loadLock = Any()
    private val rev = AtomicLong()

    private val _appState = MutableStateFlow<KiloAppState>(KiloAppState.Disconnected)
    val appState: StateFlow<KiloAppState> = _appState.asStateFlow()

    val events: SharedFlow<SseEvent> get() = connection.events
    val api: DefaultApi? get() = connection.api
    val http: OkHttpClient? get() = connection.apiClient
    val port: Int get() = connection.port

    val sessions = KiloBackendSessionManager(cs, log)
    val chat = KiloBackendChatManager(cs, log)
    val models = KiloBackendModelStateManager(log)
    val workspaces = KiloBackendWorkspaceManager(cs, sessions, log)
    @Volatile var profile: KiloProfile200Response? = null
        private set

    @Volatile var config: ConfigDto? = null
        private set

    @Volatile var notifications: List<KiloNotifications200ResponseInner> = emptyList()
        private set

    @Volatile var warnings: List<ConfigWarning> = emptyList()
        private set

    suspend fun connect() {
        mutex.withLock {
            val current = _appState.value
            if (current is KiloAppState.Ready || current is KiloAppState.Downloading || current is KiloAppState.Connecting || current is KiloAppState.Loading || current is KiloAppState.MigrationRequired) return
            ensureWatcher()
            connection.connect()
        }
    }

    suspend fun restart() {
        log.info("restart: requested — waiting for lifecycle mutex")
        mutex.withLock {
            log.info("restart: acquired lifecycle mutex")
            try {
                clear()
                connection.restart()
                log.info("restart: complete")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.warn("restart: failed", e)
                throw e
            }
        }
    }

    suspend fun reinstall() {
        log.info("reinstall: requested — waiting for lifecycle mutex")
        mutex.withLock {
            log.info("reinstall: acquired lifecycle mutex")
            try {
                clear()
                connection.reinstall()
                log.info("reinstall: complete")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.warn("reinstall: failed", e)
                throw e
            }
        }
    }

    /**
     * Synchronous CLI teardown for plugin unload. Confirms process exit but does not wait on the
     * lifecycle mutex, so an in-flight download/spawn cannot delay unload. Safe to call repeatedly.
     */
    fun shutdownForUnload() = shutdown(fast = false)

    /** Best-effort CLI teardown for IDE app close. Non-blocking; safe to call repeatedly. */
    fun shutdownForAppClose() = shutdown(fast = true)

    suspend fun retry() {
        mutex.withLock {
            when (val current = _appState.value) {
                KiloAppState.Disconnected -> {
                    ensureWatcher()
                    connection.connect()
                }
                is KiloAppState.Downloading,
                KiloAppState.Connecting,
                is KiloAppState.Loading -> Unit
                is KiloAppState.MigrationRequired -> {
                    log.info("retry: rerunning migration detection")
                    load()
                }
                is KiloAppState.Ready -> {
                    if (current.data.warnings.isEmpty()) return
                    log.info("retry: refreshing config warnings")
                    refreshConfigState()
                    val next = _appState.value
                    val warns = (next as? KiloAppState.Ready)?.data?.warnings
                    if (next is KiloAppState.Ready && warns.isNullOrEmpty()) return
                    restartConnection("warnings remained after refresh")
                }
                is KiloAppState.Error -> {
                    val load = current.errors.none { it.resource == "connection" }
                    if (load && connection.api != null) {
                        log.info("retry: rerunning app load from ${current.message}")
                        val prev = _appState.value
                        load()
                        val next = awaitLoadResult(prev)
                        val warns = (next as? KiloAppState.Ready)?.data?.warnings
                        if (next is KiloAppState.Ready && warns.isNullOrEmpty()) return
                        restartConnection("state remained problematic after load retry")
                        return
                    }
                    restartConnection("connection error: ${current.message}")
                }
            }
        }
    }

    /** One-shot health check via the generated API client. */
    suspend fun health(): HealthDto {
        val client = api ?: throw IllegalStateException("Not connected")
        val response = client.globalHealth()
        return HealthDto(healthy = response.healthy, version = response.version)
    }

    fun requireReady() {
        when (_appState.value) {
            is KiloAppState.Ready -> return
            is KiloAppState.MigrationRequired -> throw IllegalStateException("Migration required")
            else -> throw IllegalStateException("Kilo backend is not ready")
        }
    }

    suspend fun awaitReady(timeoutMs: Long = READY_TIMEOUT_MS) {
        when (_appState.value) {
            is KiloAppState.Ready -> return
            is KiloAppState.MigrationRequired -> throw IllegalStateException("Migration required")
            is KiloAppState.Downloading,
            is KiloAppState.Loading,
            KiloAppState.Connecting -> {
                val state = withTimeoutOrNull(timeoutMs) {
                    appState.first { it !is KiloAppState.Downloading && it !is KiloAppState.Loading && it !is KiloAppState.Connecting }
                }
                when (state) {
                    is KiloAppState.Ready -> return
                    is KiloAppState.MigrationRequired -> throw IllegalStateException("Migration required")
                    else -> throw IllegalStateException("Kilo backend is not ready")
                }
            }
            else -> throw IllegalStateException("Kilo backend is not ready")
        }
    }

    suspend fun updateConfig(patch: ConfigPatchDto): KiloAppState {
        val http = connection.apiClient ?: throw IllegalStateException("Not connected")
        val current = _appState.value as? KiloAppState.Ready ?: throw IllegalStateException("Kilo backend is not ready")
        val connected = connection.state.value as? ConnectionState.Connected
        val body = KiloCliDataParser.buildConfigPatch(patch)
        val summary = summary(patch)
        log.info("Global config patch: started $summary")
        val request = Request.Builder()
            .url("http://127.0.0.1:$port/global/config")
            .header("Accept", "application/json")
            .patch(body.toRequestBody("application/json".toMediaType()))
            .build()
        withContext(Dispatchers.IO) {
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    log.warn("Global config patch failed: HTTP ${response.code} ${response.message} $summary")
                    throw IllegalStateException("Global config patch failed: HTTP ${response.code} ${response.message}")
                }
            }
        }
        log.info("Global config patch: saved $summary")
        val cfg = fetchConfig().value
        if (cfg == null) {
            log.warn("Global config patch: config reload failed after save $summary")
            return (_appState.value as? KiloAppState.Ready) ?: current
        }
        val warns = fetchWarnings()
        val state = _appState.value
        if (state is KiloAppState.Ready && state.data === current.data && connection.state.value == connected) {
            config = cfg
            setAppReady(current.data.copy(config = cfg, warnings = warns))
        }
        log.info("Global config patch: state refreshed $summary")
        return (_appState.value as? KiloAppState.Ready) ?: current
    }

    internal suspend fun resumeAfterMigration() {
        mutex.withLock {
            if (_appState.value !is KiloAppState.MigrationRequired) return
            migrationSuppressed = true
            load()
            migrationForceRequested = false
        }
    }

    internal fun resetMigrationOfferForRerun() {
        migrationOffered = false
        migrationSuppressed = false
        migrationForceRequested = true
        log.info("Migration check: reset in-memory offer suppression for forced rerun")
    }

    internal fun forceMigrationRequested(): Boolean = migrationForceRequested

    private suspend fun reconnect() {
        mutex.withLock {
            val current = _appState.value
            if (current is KiloAppState.Ready || current is KiloAppState.Downloading || current is KiloAppState.Loading || current is KiloAppState.MigrationRequired) {
                log.info("reconnect: already ${current::class.simpleName} — skipping")
                return
            }
            log.info("reconnect: full restart under mutex")
            connection.restart()
        }
    }

    private fun ensureWatcher() {
        if (watcher?.isActive == true) return
        watcher = cs.launch {
            connection.state.collect { next ->
                when (next) {
                    ConnectionState.Disconnected -> _appState.value = KiloAppState.Disconnected
                    is ConnectionState.Downloading -> _appState.value = KiloAppState.Downloading(next.percent, next.version, next.platform)
                    ConnectionState.Connecting -> _appState.value = KiloAppState.Connecting
                    is ConnectionState.Connected -> {
                        load()
                    }
                    is ConnectionState.Error -> setAppError(
                        message = next.message,
                        errors = next.details?.let {
                            listOf(LoadError(resource = "connection", detail = it))
                        } ?: emptyList(),
                    )
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
        synchronized(loadLock) {
            loader?.cancel()
            loader = cs.launch {
                val start = System.currentTimeMillis()
                log.info("Application starting — loading config, profile, notifications")
                val progress = AtomicReference(LoadProgress())
                _appState.value = KiloAppState.Loading(progress.get())

                val migration = detectMigration()
                if (migration != null) {
                    captureLoad("Backend Migration Required", start, mapOf("migrationRequired" to "true"))
                    stopRuntime()
                    profile = null
                    config = null
                    notifications = emptyList()
                    warnings = emptyList()
                    _appState.value = KiloAppState.MigrationRequired(migration)
                    log.info("Application paused — legacy migration required")
                    return@launch
                }

                val errors = CopyOnWriteArrayList<LoadError>()
                var cfg: ConfigDto? = null
                var prof: KiloProfile200Response? = null
                var notifs: List<KiloNotifications200ResponseInner> = emptyList()
                var warns: List<ConfigWarning> = emptyList()

                try {
                    withTimeout(loadTimeoutMs) {
                        coroutineScope {
                        launch {
                            val result = fetchProfile()
                            val status = when {
                                result.error != null -> {
                                    errors.add(result.error)
                                    throw LoadFailure(result.error)
                                }
                                result.value != null -> {
                                    prof = result.value
                                    ProfileResult.LOADED
                                }
                                else -> ProfileResult.NOT_LOGGED_IN
                            }
                            progress.updateAndGet { it.copy(profile = status) }
                                .also { _appState.value = KiloAppState.Loading(it) }
                        }
                        launch {
                            val result = fetchWithRetry("config") { fetchConfig() }
                            if (result.value != null) {
                                cfg = result.value
                                progress.updateAndGet { it.copy(config = true) }
                                    .also { _appState.value = KiloAppState.Loading(it) }
                            } else {
                                val err = result.error!!
                                errors.add(err)
                                throw LoadFailure(err)
                            }
                        }
                        launch {
                            val result = fetchWithRetry("notifications") { fetchNotifications() }
                            if (result.value != null) {
                                notifs = result.value
                                progress.updateAndGet { it.copy(notifications = true) }
                                    .also { _appState.value = KiloAppState.Loading(it) }
                            } else {
                                val err = result.error!!
                                errors.add(err)
                                throw LoadFailure(err)
                            }
                        }
                        }
                    }

                    warns = fetchWarnings()

                    ensureActive()
                    profile = prof
                    config = cfg
                    notifications = notifs
                    models.start(connection.apiClient!!, connection.port)
                    sessions.start(connection.api!!, connection.apiClient!!, connection.port, connection.events)
                    chat.start(connection.apiClient!!, connection.port, connection.events)
                    workspaces.start(connection.api!!, connection.apiClient!!, connection.port, connection.events)
                    startWatchingGlobalSseEvents()
                    setTelemetry(true)
                    captureBackend("Backend Connected", mapOf("portKnown" to "true"))
                    captureLoad("Backend Load Completed", start, mapOf(
                        "profileStatus" to if (prof != null) "loaded" else "not_logged_in",
                        "warningCount" to warns.size.toString(),
                        "migrationRequired" to "false",
                    ))
                    setAppReady(
                        AppData(
                            profile = prof,
                            config = cfg!!,
                            notifications = notifs,
                            warnings = warns,
                        )
                    )
                    log.info(
                        "Application snapshot: profile=${if (prof != null) "loaded" else "not_logged_in"} " +
                            "warnings=${warns.size} notifications=${notifs.size} ${configSummary(cfg)}",
                    )
                    log.info("Application started — config, profile, notifications loaded")
                } catch (e: TimeoutCancellationException) {
                    val err = LoadError(
                        resource = "app",
                        detail = "Timed out loading app data after ${loadTimeoutMs}ms",
                    )
                    log.warn("Application start timed out after ${loadTimeoutMs}ms")
                    captureLoad("Backend Load Failed", start, mapOf(
                        "errorCount" to (errors.size + 1).toString(),
                        "resources" to (errors.map { it.resource } + err.resource).distinct().joinToString(","),
                        "reason" to "timeout",
                    ))
                    setAppError(
                        message = "Failed to load required data",
                        errors = errors.toList() + err,
                    )
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    ensureActive()
                    log.warn("Application start failed: ${e.message}")
                    captureLoad("Backend Load Failed", start, mapOf(
                        "errorCount" to errors.size.toString(),
                        "resources" to errors.map { it.resource }.distinct().joinToString(","),
                        "reason" to e::class.java.name,
                    ))
                    setAppError(
                        message = "Failed to load required data",
                        errors = errors.toList(),
                    )
                }
            }
        }
    }

    private fun captureLoad(event: String, start: Long, props: Map<String, String>) {
        val http = connection.apiClient
        val port = connection.port
        cs.launch {
            runCatching {
                service<KiloBackendTelemetry>().capture(
                    http,
                    port,
                    event,
                    props + mapOf("durationMs" to (System.currentTimeMillis() - start).toString()),
                )
            }.onFailure { log.info("Skipping backend load telemetry: ${it.message}") }
        }
    }

    private fun setTelemetry(enabled: Boolean) {
        val http = connection.apiClient
        val port = connection.port
        cs.launch {
            runCatching {
                service<KiloBackendTelemetry>().setEnabled(http, port, enabled)
            }.onFailure { log.info("Skipping telemetry setEnabled: ${it.message}") }
        }
    }

    private fun captureBackend(event: String, props: Map<String, String>) {
        val http = connection.apiClient
        val port = connection.port
        cs.launch {
            runCatching {
                service<KiloBackendTelemetry>().capture(http, port, event, props)
            }.onFailure { log.info("Skipping backend telemetry: ${it.message}") }
        }
    }

    private suspend fun detectMigration(): LegacyMigrationDetection? = withContext(Dispatchers.IO) {
        try {
            val http = connection.apiClient ?: run {
                log.info("Migration check: skipped because CLI HTTP client is not connected")
                return@withContext null
            }
            log.info("Migration check: started")
            // Status is only consulted when the in-memory flags do not already block the offer,
            // preserving the original short-circuit order.
            val status = if (migrationSuppressed || migrationOffered) null
            else KiloBackendLegacyMigrationStoreService.status(log)
            val gate = migrationGate(migrationSuppressed, migrationOffered, status)
            if (gate != MigrationGate.Proceed) {
                log.info("Migration check: skipped gate=$gate status=$status")
                return@withContext null
            }
            val source = KiloBackendLegacyMigrationStoreService.resolveSource(log, includeFile = migrationForceRequested)
            val store = source.store
            val detection = KiloBackendMigrationManager(http, connection.port).detect(store)
            log.info("Migration check: completed hasData=${detection.hasData} ${migrationSummary(detection)}")
            if (!detection.hasData) return@withContext null
            migrationOffered = true
            detection
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.warn("Migration check failed: ${e.message}", e)
            null
        }
    }

    private fun migrationSummary(detection: LegacyMigrationDetection): String {
        val providers = detection.providers.count { it.supported }
        val unsupported = detection.providers.size - providers
        return "providers=$providers unsupportedProviders=$unsupported mcp=${detection.mcpServers.size} modes=${detection.customModes.size} sessions=${detection.sessions.size} model=${detection.defaultModel != null} settings=${detection.settings != null}"
    }

    /**
     * Fetch the user profile. Returns [FetchResult.ok] with the response
     * on success, [FetchResult.ok] with `null` when not logged in or when
     * the server cannot reach the profile endpoint. Never throws.
     *
     * Profile is optional — 401 (not logged in) and 5xx (gateway/network
     * errors) are both non-fatal. Only unexpected client errors are treated
     * as failures.
     */
    private suspend fun fetchProfile(): FetchResult<KiloProfile200Response?> {
        val client = connection.appLoadApi
            ?: return FetchResult.ok(null)
        return try {
            val response = client.kiloProfile()
            log.info("Profile: ${response.profile.email}")
            FetchResult.ok(response)
        } catch (e: ClientException) {
            if (e.statusCode == 401) {
                log.info("Profile: not logged in (401)")
                return FetchResult.ok(null)
            }
            log.warn("Profile fetch failed: HTTP ${e.statusCode}", e)
            logResponseBody("profile", e)
            FetchResult.fail("profile", e)
        } catch (e: ServerException) {
            // 5xx from the CLI — profile endpoint is unreachable (no auth,
            // gateway down, etc.). Treat the same as not-logged-in.
            log.warn("Profile fetch: server error (${e.statusCode}) — treating as unavailable", e)
            logResponseBody("profile", e)
            FetchResult.ok(null)
        } catch (e: Exception) {
            log.warn("Profile fetch failed: ${e.message}", e)
            logResponseBody("profile", e)
            FetchResult.fail("profile", e)
        }
    }

    private suspend fun fetchConfig(): FetchResult<ConfigDto> {
        val http = connection.apiClient
            ?: return FetchResult.fail("config", detail = "Not connected")
        return try {
            val request = Request.Builder()
                .url("http://127.0.0.1:$port/global/config")
                .header("Accept", "application/json")
                .get()
                .build()
            val body = withContext(Dispatchers.IO) {
                suspendCancellableCoroutine { cont ->
                    val call = http.newCall(request)
                    cont.invokeOnCancellation { call.cancel() }
                    try {
                        val text = call.execute().use { response ->
                            val text = response.body?.string().orEmpty()
                            if (!response.isSuccessful) {
                                log.warn("Global config fetch failed: HTTP ${response.code} ${response.message} $text")
                                throw IllegalStateException("Global config fetch failed: HTTP ${response.code} ${response.message}")
                            }
                            text
                        }
                        if (cont.isActive) cont.resume(text)
                    } catch (e: Exception) {
                        if (cont.isActive) cont.resumeWithException(e)
                    }
                }
            }
            FetchResult.ok(KiloCliDataParser.parseConfig(body))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.warn("Global config fetch failed: ${e.message}", e)
            FetchResult.fail("config", e)
        }
    }

    private suspend fun fetchNotifications(): FetchResult<List<KiloNotifications200ResponseInner>> {
        val client = connection.appLoadApi
            ?: return FetchResult.fail("notifications", detail = "Not connected")
        return try {
            FetchResult.ok(client.kiloNotifications())
        } catch (e: Exception) {
            log.warn("Notifications fetch failed: ${e.message}", e)
            logResponseBody("notifications", e)
            FetchResult.fail("notifications", e)
        }
    }

    private suspend fun fetchWarnings(): List<ConfigWarning> {
        val client = connection.appLoadApi ?: return emptyList()
        return try {
            client.configWarnings().map(::warning)
        } catch (e: Exception) {
            log.warn("Config warnings fetch failed: ${e.message}", e)
            emptyList()
        }
    }

    private fun warning(w: ConfigWarnings200ResponseInner) = ConfigWarning(
        path = w.path,
        message = w.message,
        detail = w.detail,
    )

    private suspend fun refreshConfigState() {
        val current = _appState.value as? KiloAppState.Ready ?: return
        val connection = connection.state.value as? ConnectionState.Connected ?: return
        val cfg = fetchConfig().value ?: return
        val warns = fetchWarnings()
        val state = _appState.value
        if (state !is KiloAppState.Ready || state.data !== current.data) return
        if (this.connection.state.value != connection) return
        config = cfg
        setAppReady(
            current.data.copy(
                config = cfg,
                warnings = warns,
            )
        )
    }

    private fun setAppReady(data: AppData) {
        warnings = data.warnings
        if (data.warnings.isNotEmpty()) warnAppWarnings(data.warnings)
        _appState.value = KiloAppState.Ready(data, rev.incrementAndGet())
    }

    private fun setAppError(message: String, errors: List<LoadError>) {
        val state = KiloAppState.Error(message, errors)
        warnAppError(state)
        _appState.value = state
    }

    private fun warnAppError(state: KiloAppState.Error) {
        val text = if (state.errors.isEmpty()) state.message
        else "${state.message} [${state.errors.joinToString("; ") { error(it) }}]"
        log.warn("App error: $text")
    }

    private fun warnAppWarnings(warnings: List<ConfigWarning>) {
        val text = warnings.joinToString("; ") { warning(it) }
        log.warn("App warnings: $text")
    }

    private fun error(err: LoadError): String {
        val status = err.status?.let { " status=$it" } ?: ""
        val detail = err.detail?.let { " detail=$it" } ?: ""
        return "${err.resource}$status$detail"
    }

    private fun warning(warn: ConfigWarning): String {
        val detail = warn.detail?.let { " detail=$it" } ?: ""
        return "${warn.path}: ${warn.message}$detail"
    }

    private fun configSummary(cfg: ConfigDto): String {
        val text = cfg.toString()
        return "configChars=${text.length} configHash=${text.hashCode().toUInt().toString(16)}"
    }

    private suspend fun restartConnection(reason: String) {
        clear()
        connection.restart()
        log.info("retry: restarted connection ($reason)")
    }

    private suspend fun awaitLoadResult(prev: KiloAppState): KiloAppState {
        val next = appState.first { it !== prev }
        if (next !is KiloAppState.Loading) return next
        return appState.first { it !is KiloAppState.Loading }
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

    /**
     * Watch global SSE events to keep app state in sync with the CLI server.
     *
     * - `global.config.updated` — the project config changed on disk or via CLI.
     *   Re-fetches config and updates [KiloAppState.Ready] data in-place.
     *
     * - `global.disposed` — the CLI server's global context was torn down
     *   (e.g. during a restart). Triggers a full reload to re-populate all data.
     *
     * - `server.instance.disposed` — a specific server instance was disposed.
     *   Same effect as `global.disposed` — triggers a full reload so downstream
     *   project services pick up the new state.
     *
     * Idempotent — only one watcher runs at a time.
     */
    private fun startWatchingGlobalSseEvents() {
        synchronized(loadLock) {
            if (eventWatcher?.isActive == true) return
            log.info("Started watching global SSE events (config.updated, disposed)")
            eventWatcher = cs.launch(start = CoroutineStart.UNDISPATCHED) {
                connection.events.collect { event ->
                    when (event.type) {
                        "global.config.updated" -> {
                            log.info("SSE global.config.updated — reloading config")
                            launch {
                                refreshConfigState()
                                log.info("Config reloaded successfully")
                            }
                        }
                        "global.disposed" -> {
                            logSessionDisposalRisk("global.disposed")
                            log.info("SSE global.disposed — triggering full application reload")
                            val current = _appState.value
                            if (current is KiloAppState.Ready) load()
                        }
                        "server.instance.disposed" -> {
                            logSessionDisposalRisk("server.instance.disposed")
                            log.info("SSE server.instance.disposed — triggering full application reload")
                            val current = _appState.value
                            if (current is KiloAppState.Ready) load()
                        }
                    }
                }
            }
        }
    }

    private fun logSessionDisposalRisk(event: String) {
        val active = sessions.statuses.value.filterValues { it.type != "idle" }
        if (active.isEmpty()) return
        log.warn("SSE $event while sessions are active; sessions may be cancelled count=${active.size} statuses=${active.values.map { it.type }.distinct()}")
    }

    private suspend fun clear() {
        synchronized(loadLock) {
            val jobs = listOfNotNull(loader, eventWatcher)
            loader = null
            eventWatcher = null
            jobs
        }.forEach { job ->
            // LLM note: restart/reinstall must not open a new CLI while old app-load requests are still unwinding.
            job.cancelAndJoin()
        }
        reset()
    }

    private fun clearNow() {
        synchronized(loadLock) {
            loader?.cancel()
            eventWatcher?.cancel()
            loader = null
            eventWatcher = null
        }
        reset()
    }

    private fun reset() {
        stopRuntime()
        profile = null
        config = null
        notifications = emptyList()
        warnings = emptyList()
        _appState.value = KiloAppState.Disconnected
    }

    private fun stopRuntime() {
        workspaces.stop()
        models.stop()
        chat.stop()
        sessions.stop()
    }

    /**
     * Refresh the user profile from the CLI backend.
     * Returns the latest profile data, or null when not logged in.
     * Updates the current [KiloAppState.Ready] profile in-place if the app is ready.
     */
    suspend fun refreshProfile(): KiloProfile200Response? {
        val result = fetchProfile()
        val fresh = result.value
        val current = _appState.value
        if (current is KiloAppState.Ready) {
            setAppReady(current.data.copy(profile = fresh))
        }
        profile = fresh
        return fresh
    }

    /**
     * Start the Kilo device auth login flow.
     * Returns [DeviceAuthDto] containing the verification URL and code for display in the UI.
     */
    suspend fun startLogin(directory: String?): DeviceAuthDto {
        val client = connection.api ?: throw IllegalStateException("Not connected")
        val body = ProviderOauthAuthorizeRequest(method = 0.0)
        val response = client.providerOauthAuthorize(providerID = "kilo", directory = directory, providerOauthAuthorizeRequest = body)
        val match = response.instructions.let { Regex("""code:\s*(\S+)""", RegexOption.IGNORE_CASE).find(it) }
        return DeviceAuthDto(
            code = match?.groupValues?.get(1),
            verificationUrl = response.url,
            expiresIn = 900,
        )
    }

    /**
     * Complete the Kilo device auth login flow.
     * Blocks until the user completes authentication on the browser side.
     * Returns the user profile on success, or null if the login could not be completed.
     */
    suspend fun completeLogin(directory: String?): KiloProfile200Response? {
        val client = connection.api ?: throw IllegalStateException("Not connected")
        client.providerOauthCallback(providerID = "kilo", directory = directory, providerOauthCallbackRequest = ProviderOauthCallbackRequest(method = 0.0))
        return refreshProfile()
    }

    /**
     * Log out from Kilo Gateway.
     * Removes credentials and clears the profile from app state.
     */
    suspend fun logout(): Boolean {
        val client = connection.api ?: throw IllegalStateException("Not connected")
        val result = client.authRemove(providerID = "kilo")
        val current = _appState.value
        if (current is KiloAppState.Ready) {
            profile = null
            setAppReady(current.data.copy(profile = null))
        }
        return result
    }

    /**
     * Switch the active account context.
     * Pass null for personal account, an organization ID for org context.
     * Returns the updated profile after the switch.
     */
    suspend fun setOrganization(organizationId: String?): KiloProfile200Response? {
        val http = connection.apiClient ?: throw IllegalStateException("Not connected")
        val body = JsonObject(
            mapOf("organizationId" to (organizationId?.let { JsonPrimitive(it) } ?: JsonNull)),
        ).toString()
        val request = Request.Builder()
            .url("http://127.0.0.1:$port/kilo/organization")
            .header("Accept", "application/json")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        withContext(Dispatchers.IO) {
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IllegalStateException("Organization switch failed: HTTP ${response.code} ${response.message}")
                }
            }
        }
        return refreshProfile()
    }

    override fun dispose() {
        shutdown(fast = false)
    }

    private fun shutdown(fast: Boolean) {
        if (closed) return
        closed = true
        watcher?.cancel()
        watcher = null
        clearNow()
        connection.dispose()
        if (fast) server.closeForShutdown() else server.dispose()
    }
}

private fun summary(patch: ConfigPatchDto): String {
    val values = patch.values.keys.sorted().joinToString(",").ifEmpty { "none" }
    return "values=$values agents=${patch.agents.size}"
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

/** Why a startup migration offer is or is not made. */
internal enum class MigrationGate { Proceed, Suppressed, AlreadyOffered, StatusSet }

/**
 * Pure startup-gating decision for the migration offer. Suppression (dismissed this startup)
 * takes priority, then a prior offer this startup, then a persisted status.
 */
internal fun migrationGate(
    suppressed: Boolean,
    offered: Boolean,
    status: LegacyMigrationStatus?,
): MigrationGate = when {
    suppressed -> MigrationGate.Suppressed
    offered -> MigrationGate.AlreadyOffered
    status != null -> MigrationGate.StatusSet
    else -> MigrationGate.Proceed
}
