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
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.retryWhen
import kotlinx.coroutines.flow.update
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
        private const val PAGE_LIMIT = 10
        private const val WATCH_LIMIT = 50
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
            it.cloudStatus == "preparing" && it.action !in setOf("attempt_completed", "attempt_failed")
        }

        /** Preparation is presentation only; native idle never changes canonical compute state. */
        fun presentation(ref: HostedWorkspaceRefDto): HostedWorkspaceStatusDto? {
            val status = statuses[ref.key] ?: return null
            val starting = preparations.values.any {
                HostedIDs.parseSession(it.sessionID)?.let { id ->
                    id.first == ref.providerID && id.second == ref.workspaceID
                } == true && preparation(it.sessionID) != null
            }
            return if (status.computeStatus == "sleeping" && starting
            ) status.copy(computeStatus = "starting") else status
        }
    }

    private val _state = MutableStateFlow(HostedState())
    val state: StateFlow<HostedState> = _state.asStateFlow()

    private val _refreshes = MutableStateFlow(0L)
    val refreshes: StateFlow<Long> = _refreshes.asStateFlow()

    @Volatile private var generation = 0L
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
     * Reloads the first page for [directory]'s repository. A no-op while the gate is off, so the
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
                var cursor: String? = null
                var providers: List<HostedProviderDto> = emptyList()
                var signedOut = false
                for (page in 0 until PAGE_LIMIT) {
                    val result = call { workspaces(remote, cursor, null) }
                    providers = result.providers
                    signedOut = result.signedOut
                    items += result.items
                    cursor = result.cursor
                    if (cursor == null) break
                }
                if (run != generation) return@launch
                val unique = dedupe(items)
                val statuses = unique.mapNotNull { ws ->
                    runCatching { status(ws.ref) }.onFailure {
                        if (it is CancellationException) throw it
                        log.warn("hosted workspace status unavailable workspace=${ws.ref.key}", it)
                    }.getOrNull()
                        ?.let { ws.ref.key to it }
                }.toMap()
                if (run != generation) return@launch
                _state.update { current -> HostedState(
                    enabled = true,
                    items = unique,
                    providers = providers,
                    signedOut = signedOut,
                    statuses = if (signedOut) emptyMap() else unique.mapNotNull { ws ->
                        val fresh = statuses[ws.ref.key]
                        val live = current.statuses[ws.ref.key]
                        (if (live != null && (fresh == null || live.observedAt >= fresh.observedAt)) live else fresh)
                            ?.let { ws.ref.key to it }
                    }.toMap(),
                    preparations = if (signedOut) emptyMap() else current.preparations.filterKeys { key ->
                        unique.any { key.startsWith(it.ref.key + ":") }
                    },
                    cursor = cursor,
                    repositoryUrl = remote,
                ) }
                reconcile(unique, signedOut)
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

    /** All root sessions in one workspace, following the provider session cursor. */
    suspend fun sessions(ref: HostedWorkspaceRefDto): List<HostedWorkspaceSessionDto> {
        val out = mutableListOf<HostedWorkspaceSessionDto>()
        var cursor: String? = null
        for (page in 0 until PAGE_LIMIT) {
            val result = call { workspace(ref, cursor, null) }
            out += result.sessions
            cursor = result.sessionCursor
            if (cursor == null) break
        }
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
                item.job = cs.launch {
                    flow {
                        // The durable boundary must include collection, not just Flow acquisition.
                        while (true) {
                            call { systemEvents(ref, session, null).collect { emit(it) } }
                            delay(1_000)
                        }
                    }.retryWhen { err, _ ->
                        if (err is CancellationException) return@retryWhen false
                        log.warn("hosted system observation failed session=$key", err)
                        delay(1_000)
                        true
                    }.collect { event ->
                        synchronized(lock) {
                            if (watches[key] === item && event.sessionID == key && gate()) fold(item, event)
                        }
                    }
                }
            }
        }
    }

    private fun prune(key: String, item: Watch) {
        if (item.discovered || item.owners > 0) return
        watches.remove(key)
        item.job?.cancel()
    }

    private fun clear() = synchronized(lock) {
        watches.values.forEach { it.job?.cancel() }
        watches.clear()
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
                if (event.cloudStatus != "preparing" && event.observedAt > 0 &&
                    (item.progress?.observedAt ?: 0.0) > event.observedAt) return
                item.lifecycle = event.copy(observedAt = event.observedAt.takeIf { it > 0 }
                    ?: lifecycle?.observedAt ?: 0.0)
                if (event.cloudStatus == "preparing" &&
                    item.progress?.action in setOf("attempt_completed", "attempt_failed")) {
                    item.progress?.attemptID?.let { item.retired += it }
                    item.progress = null
                    item.detail = null
                    item.closed = false
                    event
                } else {
                    item.closed = event.cloudStatus != "preparing" && item.progress != null
                    old?.copy(cloudStatus = event.cloudStatus) ?: event
                }
            }
            "preparing" -> {
                val progress = item.progress
                val distinct = event.attemptID != null && event.attemptID != progress?.attemptID
                val terminal = event.action in setOf("attempt_completed", "attempt_failed") ||
                    (event.attemptID == null && event.step in setOf("ready", "failed"))
                if (event.attemptID?.let { it in item.retired } == true) return
                if (distinct && progress != null && event.observedAt > 0 && progress.observedAt > event.observedAt) return
                val revision = event.revision
                val previous = progress?.revision
                val finished = !distinct && progress?.action in setOf("attempt_completed", "attempt_failed")
                if (!distinct && progress != null) {
                    if (finished && terminal) return
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
                        observedAt = event.observedAt.takeIf { it > 0 }
                            ?: progress?.observedAt?.takeIf { !distinct } ?: 0.0,
                        attemptID = event.attemptID ?: progress?.attemptID,
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
                        terminal || finished -> if (latest.action == "attempt_failed" || latest.step == "failed") "error" else "ready"
                        closed -> item.lifecycle?.cloudStatus ?: "idle"
                        else -> "preparing"
                    },
                    observedAt = latest.observedAt,
                    attemptID = latest.attemptID,
                    revision = latest.revision,
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
