package ai.kilocode.client.app

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloHostedRpcApi
import ai.kilocode.rpc.dto.HostedProviderDto
import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import ai.kilocode.client.session.history.resolveGitRemoteUrl
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.registry.Registry
import com.intellij.openapi.util.registry.RegistryValue
import com.intellij.openapi.util.registry.RegistryValueListener
import fleet.rpc.client.durable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Project-level hosted Cloud workspace discovery.
 *
 * Repository-scoped reads run through the local CLI Session Host only. Discovery is passive: it
 * never starts compute and never wakes a sleeping workspace. Rows appear automatically when the
 * experimental gate is enabled and the CLI reports an authenticated hosted provider.
 */
@Service(Service.Level.PROJECT)
class KiloHostedService internal constructor(
    private val cs: CoroutineScope,
    private val rpc: KiloHostedRpcApi?,
    private val app: KiloAppService? = null,
    private val gate: () -> Boolean = { Registry.`is`("kilo.cloudWorkspaces.enabled", true) },
    private val log: KiloLog = LOG,
    private val repo: (String) -> String? = ::resolveGitRemoteUrl,
    private val pause: suspend (Long) -> Unit = { delay(it) },
) {
    constructor(project: Project, cs: CoroutineScope) : this(cs, null, service<KiloAppService>()) {
        Registry.get("kilo.cloudWorkspaces.enabled").addListener(object : RegistryValueListener {
            override fun afterValueChanged(value: RegistryValue) {
                refresh(requestedDir ?: project.basePath.orEmpty())
            }
        }, project)
    }

    companion object {
        private val LOG = KiloLog.create(KiloHostedService::class.java)
        private const val WATCH_LIMIT = 50
        private const val STATUS_CONCURRENCY = 8
        private const val INITIAL_BACKOFF_MS = 1_000L
        private const val MAX_BACKOFF_MS = 10_000L
    }

    data class HostedState(
        val enabled: Boolean = false,
        val loading: Boolean = false,
        val items: List<HostedWorkspaceDto> = emptyList(),
        val providers: List<HostedProviderDto> = emptyList(),
        val signedOut: Boolean = false,
        val statuses: Map<String, HostedWorkspaceStatusDto> = emptyMap(),
        val preparations: Map<String, HostedSystemEventDto> = emptyMap(),
        val cursor: String? = null,
        val error: String? = null,
        val repositoryUrl: String? = null,
    ) {
        /** Only the current preparation is visible; completed details remain in the cache. */
        fun preparation(session: String): HostedSystemEventDto? = preparations[session]?.takeIf {
            it.cloudStatus == "preparing" && failure(session) == null && it.action != "attempt_completed"
        }

        fun failure(session: String): HostedSystemEventDto? = preparations[session]?.takeIf {
            it.cloudStatus == "error" || it.action == "attempt_failed" || it.failure != null
        }

        /** Preparation is presentation only; native idle never changes canonical compute state. */
        fun presentation(ref: HostedWorkspaceRefDto): HostedWorkspaceStatusDto? {
            val status = statuses[ref.key]
            val starting = preparations.values.any {
                HostedIDs.parseSession(it.sessionID)?.let { id ->
                    id.first == ref.providerID && id.second == ref.workspaceID
                } == true && preparation(it.sessionID) != null
            }
            if (!starting) return status
            if (status == null) return HostedWorkspaceStatusDto(ref, "active", "starting", "", 0.0)
            return when (status.computeStatus) {
                "sleeping", "unknown", "stopped" -> status.copy(computeStatus = "starting")
                // Compute is up but the workspace is still running its setup command, so the chat is
                // not usable yet. Presentation-only: canonical compute status stays active.
                "active", "running" -> status.copy(computeStatus = "setting_up")
                else -> status
            }
        }
    }

    private val _state = MutableStateFlow(HostedState())
    val state: StateFlow<HostedState> = _state.asStateFlow()

    private val _refreshes = MutableStateFlow(0L)
    val refreshes: StateFlow<Long> = _refreshes.asStateFlow()

    @Volatile private var generation = 0L
    private val statusLimit = Semaphore(STATUS_CONCURRENCY)
    private var requestedDir: String? = null
    private val lock = Any()
    private class Watch(val ref: HostedWorkspaceRefDto, val session: String) {
        var owners = 0
        var discovered = false
        var job: Job? = null
        var lifecycle: HostedSystemEventDto? = null
        var progress: HostedSystemEventDto? = null
        var detail: HostedSystemEventDto? = null
        var closed = false
        val retired = mutableSetOf<String>()
    }
    private val watches = mutableMapOf<String, Watch>()
    private val retired = mutableMapOf<String, Set<String>>()

    init {
        if (app != null) {
            cs.launch {
                var ready = false
                app.state.collect { state ->
                    if (!gate() || state.progress?.profile == ProfileStatusDto.NOT_LOGGED_IN) {
                        ++generation
                        clear()
                        _state.value = HostedState(enabled = gate(), signedOut = gate())
                    }
                    val now = state.status == KiloAppStatusDto.READY &&
                        state.progress?.profile != ProfileStatusDto.NOT_LOGGED_IN
                    if (now && !ready) requestedDir?.let { refresh(it) }
                    ready = now
                }
            }
        }
    }

    /** Whether the experimental Cloud workspace surface is enabled in this IDE. */
    fun enabled(): Boolean = gate()

    /**
     * Reloads all workspaces for [directory]'s repository. A no-op while the gate is off, so the
     * feature can still be explicitly disabled in the Registry.
     */
    fun refresh(directory: String) {
        if (!gate()) {
            ++generation
            clear()
            _state.value = HostedState(enabled = false)
            return
        }
        if (requestedDir == directory && _state.value.loading) return
        requestedDir = directory
        val run = ++generation
        _refreshes.value = run
        _state.update { it.copy(enabled = true, loading = true, error = null) }
        cs.launch {
            try {
                val remote = withContext(Dispatchers.IO) { repo(directory) }
                if (run != generation) return@launch
                if (remote == null) {
                    clear()
                    _state.value = HostedState(enabled = true, error = "No repository remote")
                    return@launch
                }
                _state.update { it.copy(repositoryUrl = remote) }
                log.info("hosted workspace discovery started")
                val items = mutableListOf<HostedWorkspaceDto>()
                val seen = mutableSetOf<String?>()
                var cursor: String? = null
                var providers: List<HostedProviderDto> = emptyList()
                var signedOut = false
                do {
                    if (run != generation) return@launch
                    if (!seen.add(cursor)) {
                        log.warn("hosted workspace discovery stopped after repeated cursor")
                        cursor = null
                        break
                    }
                    val result = call { workspaces(remote, cursor, null) }
                    providers = result.providers
                    signedOut = result.signedOut
                    items += result.items
                    cursor = result.cursor
                } while (cursor != null)
                if (run != generation) return@launch
                val unique = dedupe(items)
                _state.update { current ->
                    if (run != generation) return@update current
                    HostedState(
                        enabled = true,
                        loading = !signedOut,
                        items = unique,
                        providers = providers,
                        signedOut = signedOut,
                        statuses = if (signedOut) emptyMap() else current.statuses.filterKeys { key ->
                            unique.any { it.ref.key == key }
                        },
                        preparations = if (signedOut) emptyMap() else current.preparations.filterKeys { key ->
                            unique.any { key.startsWith(it.ref.key + ":") }
                        },
                        cursor = cursor,
                        repositoryUrl = remote,
                    )
                }
                reconcile(unique, signedOut)
                if (!signedOut) refreshStatuses(unique, run)
                if (run != generation) return@launch
                _state.update { if (run == generation) it.copy(loading = false) else it }
                log.info("hosted workspace discovery completed workspaces=${unique.size} signedOut=$signedOut")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (run != generation) return@launch
                log.warn("hosted workspace discovery failed message=${e.message}", e)
                _state.update { it.copy(loading = false, error = e.message ?: "Cloud workspaces unavailable") }
            }
        }
    }

    /** Loads the next workspace page, if the provider returned one. */
    fun loadMore() {
        val current = _state.value
        val cursor = current.cursor ?: return
        val repo = current.repositoryUrl ?: return
        if (!current.enabled || current.loading) return
        val run = generation
        _state.update { it.copy(loading = true, error = null) }
        cs.launch {
            try {
                val page = call { workspaces(repo, cursor, null) }
                if (run != generation) return@launch
                _state.update { it.copy(
                    loading = false,
                    items = dedupe(it.items + page.items),
                    providers = page.providers,
                    signedOut = page.signedOut,
                    statuses = if (page.signedOut) emptyMap() else it.statuses,
                    preparations = if (page.signedOut) emptyMap() else it.preparations,
                    cursor = page.cursor,
                ) }
                reconcile(_state.value.items, page.signedOut)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (run != generation) return@launch
                _state.update { it.copy(loading = false, error = e.message ?: "Cloud workspaces unavailable") }
            }
        }
    }

    /** Registers a state listener on [parent]; the collector uses the service scope. */
    fun observe(parent: Disposable, listener: (HostedState) -> Unit) {
        val job = cs.launch { state.collect { listener(it) } }
        Disposer.register(parent) { job.cancel() }
    }

    suspend fun workspace(ref: HostedWorkspaceRefDto): HostedWorkspaceDto =
        call { workspace(ref, null, null) }

    /** All root sessions in one workspace, optionally reusing an already fetched first page. */
    suspend fun sessions(
        ref: HostedWorkspaceRefDto,
        first: HostedWorkspaceDto? = null,
    ): List<HostedWorkspaceSessionDto> {
        require(first == null || first.ref == ref)
        val out = first?.sessions?.toMutableList() ?: mutableListOf()
        val seen = mutableSetOf<String?>()
        var cursor = first?.sessionCursor
        if (first != null && cursor == null) return dedupeSessions(out)
        do {
            if (!seen.add(cursor)) {
                log.warn("hosted session discovery stopped after repeated cursor workspace=${ref.key}")
                break
            }
            val result = call { workspace(ref, cursor, null) }
            out += result.sessions
            cursor = result.sessionCursor
        } while (cursor != null)
        return dedupeSessions(out)
    }

    suspend fun status(ref: HostedWorkspaceRefDto): HostedWorkspaceStatusDto {
        val run = generation
        val fresh = call { workspaceStatus(ref, null) }
        if (fresh.ref != ref || !fresh.observedAt.isFinite() || fresh.observedAt < 0) {
            log.warn("hosted workspace status rejected workspace=${ref.key}")
            return _state.value.statuses[ref.key] ?: HostedWorkspaceStatusDto(ref, "active", "unknown", "", 0.0)
        }
        if (run != generation || !gate() || _state.value.signedOut) return fresh
        _state.update { current ->
            val old = current.statuses[ref.key]
            val next = when {
                old == null || fresh.observedAt > old.observedAt -> fresh
                fresh.observedAt == old.observedAt -> fresh.copy(
                    computeStatus = old.computeStatus,
                    computeDetail = old.computeDetail,
                )
                else -> old
            }
            current.copy(statuses = current.statuses + (ref.key to next))
        }
        return _state.value.statuses[ref.key] ?: fresh
    }

    /** Shares a session feed with passive discovery and releases it with the consumer. */
    fun observe(ref: HostedWorkspaceRefDto, session: String, parent: Disposable): Disposable {
        val key = HostedIDs.session(ref.providerID, ref.workspaceID, session)
        val item = synchronized(lock) {
            if (gate() && !_state.value.signedOut) watch(ref, session).also { it.owners++ } else null
        }
        val owner = Disposable {
            synchronized(lock) {
                if (item != null && watches[key] === item) {
                    item.owners--
                    prune(key, item)
                }
            }
        }
        Disposer.register(parent, owner)
        return owner
    }

    private fun reconcile(items: List<HostedWorkspaceDto>, signedOut: Boolean) = synchronized(lock) {
        if (signedOut || !gate()) {
            clear()
            return@synchronized
        }
        val keys = items.mapTo(mutableSetOf()) { it.ref.key }
        retired.keys.removeAll { key -> items.none { key.startsWith(it.ref.key + ":") } }
        watches.toMap().forEach { (key, item) ->
            item.discovered = false
            if (item.ref.key !in keys) {
                watches.remove(key)
                item.job?.cancel()
            }
        }
        items.take(WATCH_LIMIT).forEach { ws ->
            ws.sessions.maxByOrNull { it.updated }?.let { watch(ws.ref, it.nativeSessionID).discovered = true }
        }
        watches.toMap().forEach { (key, item) -> prune(key, item) }
    }

    private fun watch(ref: HostedWorkspaceRefDto, session: String): Watch {
        val key = HostedIDs.session(ref.providerID, ref.workspaceID, session)
        return watches.getOrPut(key) {
            Watch(ref, session).also { item ->
                item.retired += retired[key].orEmpty()
                _state.value.preparations[key]?.let { cached ->
                    item.progress = cached.takeIf { it.kind == "preparing" || it.action == "attempt_failed" }
                    item.lifecycle = cached.takeIf { it.kind == "cloud.status" }
                    item.closed = cached.cloudStatus != "preparing"
                }
                item.job = cs.launch {
                    var failures = 0
                    while (true) {
                        try {
                            // The durable boundary must include collection, not just Flow acquisition.
                            call { systemEvents(ref, session, null).collect { event ->
                                failures = 0
                                synchronized(lock) {
                                    if (watches[key] === item && event.sessionID == key && gate()) fold(item, event)
                                }
                            } }
                            failures = 0
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            failures++
                            val msg = "hosted system observation failed session=$key attempt=$failures"
                            if (failures == 1) log.warn(msg, e) else log.debug { "$msg message=${e.message}" }
                        }
                        val backoff = (INITIAL_BACKOFF_MS * (1L shl (failures - 1).coerceIn(0, 4)))
                            .coerceAtMost(MAX_BACKOFF_MS)
                        pause(backoff)
                    }
                }
            }
        }
    }

    private suspend fun refreshStatuses(items: List<HostedWorkspaceDto>, run: Long) = coroutineScope {
        items.map { ws ->
            async {
                if (run != generation) return@async
                val status = runCatching { statusLimit.withPermit { status(ws.ref) } }.getOrElse {
                    if (it is CancellationException) throw it
                    log.warn("hosted workspace status unavailable workspace=${ws.ref.key}", it)
                    HostedWorkspaceStatusDto(ws.ref, ws.deletionState, "unavailable", "", 0.0)
                }
                if (run != generation) return@async
                _state.update { current ->
                    if (run != generation) return@update current
                    if (current.signedOut || current.items.none { it.ref == ws.ref }) return@update current
                    val live = current.statuses[ws.ref.key]
                    val next = if (live != null && live.observedAt >= status.observedAt) live else status
                    current.copy(statuses = current.statuses + (ws.ref.key to next))
                }
            }
        }.awaitAll()
    }

    private fun prune(key: String, item: Watch) {
        if (item.discovered || item.owners > 0) return
        watches.remove(key)
        item.job?.cancel()
    }

    private fun clear() = synchronized(lock) {
        watches.values.forEach { it.job?.cancel() }
        watches.clear()
        retired.clear()
    }

    private fun fold(item: Watch, event: HostedSystemEventDto) {
        if (!event.observedAt.isFinite() || event.observedAt < 0) return
        val ref = item.ref
        val old = _state.value.preparations[event.sessionID]
        val preparation = when (event.kind) {
            "cloud.status" -> {
                val lifecycle = item.lifecycle
                if (event.cloudStatus == null || (lifecycle != null && event.observedAt > 0 &&
                    lifecycle.observedAt > event.observedAt)) return
                if (event.observedAt > 0 && (item.progress?.observedAt ?: 0.0) > event.observedAt) return
                item.lifecycle = event.copy(observedAt = event.observedAt.takeIf { it > 0 }
                    ?: lifecycle?.observedAt ?: 0.0)
                if (event.cloudStatus == "preparing" &&
                    (old?.cloudStatus == "error" || item.progress?.action in setOf("attempt_completed", "attempt_failed"))) {
                    item.progress?.attemptID?.let { item.retired += it }
                    item.progress = null
                    item.detail = null
                    item.closed = false
                    event
                } else if (event.cloudStatus == "error") {
                    item.closed = true
                    val failed = (old ?: event).copy(
                        action = "attempt_failed", cloudStatus = "error",
                        failure = event.failure ?: old?.failure,
                        observedAt = maxOf(event.observedAt, old?.observedAt ?: 0.0),
                    )
                    item.progress = failed
                    failed
                } else {
                    item.closed = event.cloudStatus != "preparing" && item.progress != null
                    old?.copy(cloudStatus = if (old.cloudStatus == "error") "error" else event.cloudStatus) ?: event
                }
            }
            "preparing" -> {
                val progress = item.progress
                val distinct = event.attemptID != null && event.attemptID != progress?.attemptID
                val failed = event.action in setOf("attempt_failed", "step_failed", "failed") || event.failure != null || event.step == "failed"
                val terminal = failed || event.action == "attempt_completed" ||
                    (event.attemptID == null && event.step == "ready")
                if (event.attemptID?.let { it in item.retired } == true) return
                if (distinct && progress != null && event.observedAt > 0 && progress.observedAt > event.observedAt) return
                val revision = event.revision
                val previous = progress?.revision
                val finished = !distinct && progress?.action in setOf("attempt_completed", "attempt_failed")
                if (!distinct && progress != null) {
                    if (finished && terminal && !(progress?.action == "attempt_failed" && failed &&
                        progress.failure == null && event.failure != null && revision == previous)) return
                    if (revision != null && previous != null) {
                        if (revision < previous) return
                        // An attempt snapshot precedes its latest step at the same revision.
                        if (revision == previous && !terminal &&
                            (event.step == null || item.detail?.revision == revision)) return
                    } else if (event.observedAt > 0 && progress.observedAt > event.observedAt) return
                }
                if (distinct) {
                    progress?.attemptID?.let { item.retired += it }
                    item.detail = null
                    item.closed = false
                }
                if (!finished && (progress == null || distinct ||
                    (revision != null && previous != null && revision > previous) ||
                    event.observedAt > progress.observedAt ||
                    (revision == null && previous == null && event.observedAt == 0.0))) item.closed = false
                if (!finished || terminal) {
                    item.progress = event.copy(
                        action = if (failed) "attempt_failed" else event.action,
                        observedAt = event.observedAt.takeIf { it > 0 }
                            ?: progress?.observedAt?.takeIf { !distinct } ?: 0.0,
                        attemptID = event.attemptID ?: progress?.attemptID,
                        triggerMessageID = event.triggerMessageID ?: progress?.triggerMessageID?.takeIf { !distinct },
                        revision = revision ?: previous?.takeIf { !distinct },
                    )
                }
                if (event.step != null) item.detail = event.copy(
                    message = event.message ?: item.detail?.message?.takeIf { item.detail?.step == event.step },
                )
                val latest = item.progress ?: event
                val display = item.detail ?: latest
                val closed = terminal || finished || (item.closed && !distinct)
                display.copy(
                    action = if (terminal || finished) latest.action else display.action,
                    message = latest.message?.takeIf { latest.action == "attempt_failed" } ?: display.message,
                    cloudStatus = when {
                        terminal || finished -> if (latest.action == "attempt_failed" || latest.step == "failed" || latest.failure != null) "error" else "ready"
                        closed -> item.lifecycle?.cloudStatus ?: "idle"
                        else -> "preparing"
                    },
                    observedAt = latest.observedAt,
                    attemptID = latest.attemptID,
                    revision = latest.revision,
                    failure = latest.failure ?: display.failure,
                    triggerMessageID = latest.triggerMessageID ?: display.triggerMessageID,
                )
            }
            else -> null
        }
        _state.update { current ->
            val status = current.statuses[ref.key] ?: HostedWorkspaceStatusDto(ref, "active", "unknown", "", 0.0)
            val sandbox = event.sandboxStatus?.takeIf { event.kind == "cloud.sandbox.status" }
            val next = if (sandbox != null && event.observedAt >= status.observedAt) {
                status.copy(
                    computeStatus = sandbox,
                    computeDetail = event.sandboxDetail ?: status.computeDetail,
                    observedAt = event.observedAt,
                )
            } else status
            current.copy(statuses = current.statuses + (ref.key to next), preparations =
                if (preparation != null) current.preparations + (event.sessionID to preparation) else current.preparations)
        }
        if (preparation?.cloudStatus == "error" && preparation != old) {
            val code = preparation.failure?.takeIf { it.matches(Regex("[a-z][a-z0-9_]{0,63}")) } ?: "unknown"
            log.warn("hosted preparation failed code=$code")
        }
        retired[event.sessionID] = item.retired.toSet()
    }

    private suspend fun <T> call(block: suspend KiloHostedRpcApi.() -> T): T {
        val api = rpc
        return if (api != null) block(api) else durable { block(KiloHostedRpcApi.getInstance()) }
    }

    private fun dedupe(items: List<HostedWorkspaceDto>): List<HostedWorkspaceDto> {
        val seen = LinkedHashMap<String, HostedWorkspaceDto>()
        items.forEach { seen[it.ref.key] = it }
        return seen.values.toList()
    }

    private fun dedupeSessions(items: List<HostedWorkspaceSessionDto>): List<HostedWorkspaceSessionDto> {
        val seen = LinkedHashMap<String, HostedWorkspaceSessionDto>()
        items.forEach { seen[it.id] = it }
        return seen.values.toList()
    }
}
