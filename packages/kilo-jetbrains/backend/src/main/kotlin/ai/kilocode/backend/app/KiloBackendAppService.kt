package ai.kilocode.backend.app

import ai.kilocode.backend.cli.CliState
import ai.kilocode.backend.cli.KiloBackendCliManager
import ai.kilocode.backend.v2.V2Client
import ai.kilocode.backend.workspace.KiloWorkspaceData
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.atomic.AtomicBoolean

@Service(Service.Level.APP)
class KiloBackendAppService(private val scope: CoroutineScope) : Disposable {
    private val log = KiloLog.create(KiloBackendAppService::class.java)
    private val cli get() = service<KiloBackendCliManager>()
    private val connection = KiloBackendConnectionService()
    private val state = KiloAppState(MutableStateFlow(KiloAppStateDto(KiloAppStatusDto.DISCONNECTED)))
    val appState = state.flow.asStateFlow()
    val events = connection.events
    val activity = KiloBackendActivityManager(scope, log)
    val models = KiloBackendModelStateManager()
    val retention = KiloBackendRetentionManager(this)
    private val closed = AtomicBoolean()
    private val lifecycle = Mutex()
    private val data = Mutex()
    @Volatile private var current: V2Client? = null
    private var loginSession: Pair<V2Client, KiloAccountSettings>? = null
    @Volatile private var stream: Job? = null
    @Volatile private var migrationOffered = false
    @Volatile private var migrationForce = false

    suspend fun connect() = lifecycle.withLock {
        if (stream?.isActive != true) open(null)
    }

    suspend fun restart() = lifecycle.withLock { open(false) }
    suspend fun reinstall() = lifecycle.withLock { open(true) }

    suspend fun retry() = lifecycle.withLock {
        when (appState.value.status) {
            KiloAppStatusDto.ERROR -> {
                val client = current
                if (client != null) {
                    data.withLock { state.load(client) }
                    if (appState.value.status == KiloAppStatusDto.READY) return@withLock
                }
                open(false)
            }
            KiloAppStatusDto.DISCONNECTED -> open(null)
            else -> Unit
        }
    }

    private suspend fun open(restart: Boolean?) {
        check(!closed.get()) { "Kilo backend is closed" }
        stream?.cancelAndJoin()
        current = null
        activity.stop()
        state.flow.value = KiloAppStateDto(KiloAppStatusDto.CONNECTING)
        val started = CompletableDeferred<Unit>()
        stream = scope.launch { supervise(restart, started) }.also { job ->
            job.invokeOnCompletion { cause ->
                if (cause == null) started.complete(Unit) else started.completeExceptionally(cause)
            }
        }
        // The RPC confirms the process is authenticated. Data loading continues in service scope.
        started.await()
    }

    private suspend fun supervise(restart: Boolean?, started: CompletableDeferred<Unit>) = coroutineScope {
        var attempts = 0
        var action = restart
        val progress = launch { watchDownload() }
        try {
            while (isActive && !closed.get()) {
                try {
                    val client = action?.let { cli.restart(it) } ?: cli.client()
                    action = null
                    current = client
                    started.complete(Unit)
                    connection.listen(client) {
                        attempts = 0
                        observe(client)
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    current = null
                    // Downloads that failed must be retried deliberately, not in a download loop.
                    if (++attempts >= 3 || cli.state.value is CliState.Failed && action != null) {
                        unlessMigrating(failure("connection", e))
                        return@coroutineScope
                    }
                    unlessMigrating(KiloAppStateDto(KiloAppStatusDto.CONNECTING))
                    delay(500L * attempts)
                }
            }
        } finally {
            current = null
            progress.cancel()
        }
    }

    private suspend fun watchDownload() {
        cli.state.collect { status ->
            if (status !is CliState.Starting) return@collect
            val pct = status.percent
            unlessMigrating(if (pct == null) KiloAppStateDto(KiloAppStatusDto.CONNECTING) else KiloAppStateDto(
                KiloAppStatusDto.DOWNLOADING, downloadPercent = pct, downloadPlatform = cli.platform, downloadVersion = cli.version,
            ))
        }
    }

    private fun unlessMigrating(next: KiloAppStateDto) = state.flow.update {
        if (it.status == KiloAppStatusDto.MIGRATION_REQUIRED) it else next
    }

    private enum class Change { ALL, CONFIG, PROFILE, PLUGINS }

    private suspend fun observe(client: V2Client): Unit = coroutineScope {
        val sessions = service<KiloBackendSessionManager>()
        val chat = service<KiloBackendChatManager>()
        activity.start(sessions.statuses, sessions::sessionDirectory, chat.events)
        val changes = MutableStateFlow(setOf(Change.ALL))
        launch(start = CoroutineStart.UNDISPATCHED) {
            events.collect { event ->
                val change = when (event["type"]?.jsonPrimitive?.content) {
                    "config.updated" -> Change.CONFIG
                    "rpc.kilocode.gateway.organization" -> Change.PROFILE
                    "plugin.updated" -> Change.PLUGINS
                    // A location reload replaces services at a step boundary; the session keeps running.
                    "global.disposed", "location.shutdown" -> Change.ALL
                    "session.execution.interrupted" -> {
                        val payload = event["data"] as? JsonObject ?: return@collect
                        val reason = payload["reason"]?.jsonPrimitive?.content
                        if (reason == "shutdown" || reason == "inactivity") {
                            val id = payload["sessionID"]?.jsonPrimitive?.content ?: return@collect
                            activity.interrupt(listOf(id))
                            chat.interrupt(listOf(id), reason)
                        }
                        return@collect
                    }
                    else -> return@collect
                }
                changes.update { it + change }
            }
        }
        while (isActive) {
            changes.first { it.isNotEmpty() }
            val dirty = changes.getAndUpdate { emptySet() }
            if (appState.value.status == KiloAppStatusDto.MIGRATION_REQUIRED) continue
            try {
                data.withLock {
                    if (Change.ALL in dirty) load(client)
                    else if (appState.value.status == KiloAppStatusDto.READY) refresh(client, dirty)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // A failed incremental refresh leaves the last good settings visible.
                log.warn("App refresh failed: ${e.javaClass.simpleName}")
            }
        }
    }

    private suspend fun load(client: V2Client) {
        val migration = if (migrationOffered) null else try {
            KiloBackendMigrationManager.offer(migrationForce)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.warn("Unable to detect migration: ${e.javaClass.simpleName}")
            null
        }
        if (migration != null) {
            migrationOffered = true
            state.flow.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = migration)
            return
        }
        state.load(client)
    }

    private suspend fun refresh(client: V2Client, changes: Set<Change>) {
        if (Change.CONFIG in changes) {
            val config = KiloWorkspaceData(client).config()
            update(client) { copy(config = config) }
        }
        if (Change.PROFILE in changes) profile(client, account(client).profile())
        if (Change.PLUGINS in changes) {
            val enabled = "kilocode.background-jobs" in installed(client)
            update(client) { copy(backgroundSubagents = enabled) }
        }
    }

    fun resetMigrationOfferForRerun() {
        migrationOffered = false
        migrationForce = true
    }

    fun forceMigrationRequested() = migrationForce

    suspend fun resumeAfterMigration() = lifecycle.withLock {
        migrationForce = false
        migrationOffered = true
        if (appState.value.status == KiloAppStatusDto.MIGRATION_REQUIRED) open(null)
    }

    suspend fun health() = connection.health(client())

    fun requireReady() {
        check(appState.value.status == KiloAppStatusDto.READY) { "Kilo backend is not ready" }
    }

    suspend fun awaitReady() {
        connect()
        withTimeout(120_000) {
            appState.first { it.status in setOf(KiloAppStatusDto.READY, KiloAppStatusDto.ERROR, KiloAppStatusDto.MIGRATION_REQUIRED) }
        }
        requireReady()
    }

    internal fun client() = checkNotNull(current) { "Kilo backend is not connected" }
    // The device authorization attempt belongs to this server, not to an individual split RPC.
    @Synchronized
    private fun account(client: V2Client): KiloAccountSettings {
        loginSession?.let { if (it.first === client) return it.second }
        return KiloAccountSettings { client }.also { loginSession = client to it }
    }

    suspend fun updateConfig(patch: ConfigPatchDto) = data.withLock {
        requireReady()
        val client = client()
        require(patch.retention == null || retention.endpoint(client).status().supported) { "Session retention is unavailable" }
        val config = KiloWorkspaceData(client).updateConfig(patch, "global")
        update(client) { copy(config = config) }
        appState.value
    }

    private fun update(client: V2Client, block: KiloAppStateDto.() -> KiloAppStateDto) = state.flow.update {
        if (current === client && it.status == KiloAppStatusDto.READY) it.block() else it
    }

    private fun profile(client: V2Client, user: ProfileDto?): ProfileDto? {
        update(client) {
            copy(profile = user, progress = progress?.copy(profile = if (user == null) ProfileStatusDto.NOT_LOGGED_IN else ProfileStatusDto.LOADED))
        }
        return user
    }

    suspend fun refreshProfile() = data.withLock { client().let { profile(it, account(it).profile()) } }
    suspend fun startLogin(directory: String?) = account(client()).startLogin(directory)
    suspend fun completeLogin(directory: String?) = client().let { profile(it, account(it).completeLogin(directory)) }
    suspend fun logout() = client().let { account(it).logout().also { ok -> if (ok) profile(it, null) } }
    suspend fun setOrganization(id: String?) = client().let { profile(it, account(it).setOrganization(id)) }

    fun shutdown() {
        if (!closed.compareAndSet(false, true)) return
        stream?.cancel()
        current = null
        activity.stop()
        state.flow.value = KiloAppStateDto(KiloAppStatusDto.DISCONNECTED)
    }

    override fun dispose() = shutdown()
}
