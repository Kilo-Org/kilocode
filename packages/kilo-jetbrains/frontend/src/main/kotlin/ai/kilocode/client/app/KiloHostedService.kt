package ai.kilocode.client.app

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloHostedRpcApi
import ai.kilocode.rpc.dto.HostedProviderDto
import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.client.session.history.resolveGitRemoteUrl
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.registry.Registry
import fleet.rpc.client.durable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
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
    constructor(project: Project, cs: CoroutineScope) : this(cs, null, service<KiloAppService>())

    companion object {
        private val LOG = KiloLog.create(KiloHostedService::class.java)
        private const val PAGE_LIMIT = 10
    }

    data class HostedState(
        val enabled: Boolean = false,
        val loading: Boolean = false,
        val items: List<HostedWorkspaceDto> = emptyList(),
        val providers: List<HostedProviderDto> = emptyList(),
        val signedOut: Boolean = false,
        val statuses: Map<String, HostedWorkspaceStatusDto> = emptyMap(),
        val cursor: String? = null,
        val error: String? = null,
        val repositoryUrl: String? = null,
    )

    private val _state = MutableStateFlow(HostedState())
    val state: StateFlow<HostedState> = _state.asStateFlow()

    private val _refreshes = MutableStateFlow(0L)
    val refreshes: StateFlow<Long> = _refreshes.asStateFlow()

    private var generation = 0L
    private var requestedDir: String? = null

    init {
        if (app != null) {
            cs.launch {
                var ready = false
                app.state.collect { state ->
                    val now = state.status == KiloAppStatusDto.READY
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
            _state.value = HostedState(enabled = false)
            return
        }
        if (requestedDir == directory && _state.value.loading) return
        requestedDir = directory
        val run = ++generation
        _refreshes.value = run
        _state.value = _state.value.copy(enabled = true, loading = true, error = null)
        cs.launch {
            try {
                val remote = withContext(Dispatchers.IO) { repo(directory) }
                if (run != generation) return@launch
                if (remote == null) {
                    _state.value = HostedState(enabled = true, error = "No repository remote")
                    return@launch
                }
                _state.value = _state.value.copy(repositoryUrl = remote)
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
                    runCatching { call { workspaceStatus(ws.ref, null) } }
                        .getOrNull()
                        ?.let { ws.ref.key to it }
                }.toMap()
                if (run != generation) return@launch
                _state.value = HostedState(
                    enabled = true,
                    items = unique,
                    providers = providers,
                    signedOut = signedOut,
                    statuses = statuses,
                    cursor = cursor,
                    repositoryUrl = remote,
                )
                log.info("hosted workspace discovery completed workspaces=${unique.size} signedOut=$signedOut")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (run != generation) return@launch
                log.warn("hosted workspace discovery failed message=${e.message}", e)
                _state.value = _state.value.copy(loading = false, error = e.message ?: "Cloud workspaces unavailable")
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
        _state.value = current.copy(loading = true, error = null)
        cs.launch {
            try {
                val page = call { workspaces(repo, cursor, null) }
                if (run != generation) return@launch
                _state.value = _state.value.copy(
                    loading = false,
                    items = dedupe(_state.value.items + page.items),
                    providers = page.providers,
                    signedOut = page.signedOut,
                    cursor = page.cursor,
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (run != generation) return@launch
                _state.value = _state.value.copy(loading = false, error = e.message ?: "Cloud workspaces unavailable")
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

    suspend fun status(ref: HostedWorkspaceRefDto): HostedWorkspaceStatusDto =
        call { workspaceStatus(ref, null) }

    suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String): Flow<HostedSystemEventDto> =
        call { systemEvents(ref, sessionID, null) }

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
