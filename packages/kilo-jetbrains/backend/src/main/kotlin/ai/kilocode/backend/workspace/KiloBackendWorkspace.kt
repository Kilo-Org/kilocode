package ai.kilocode.backend.workspace

import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.backend.app.SseEvent
import ai.kilocode.backend.util.KiloLog
import ai.kilocode.jetbrains.api.client.DefaultApi
import ai.kilocode.jetbrains.api.model.Agent
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionListDto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicReference

/**
 * Single entry point for all directory-scoped data: project catalog
 * (providers, agents, commands, skills) and session access.
 *
 * **Not an IntelliJ service** — a plain class created by
 * [KiloBackendWorkspaceManager] for each directory. Receives a
 * pre-connected [DefaultApi] — no null checks needed.
 *
 * Session operations delegate to [KiloBackendSessionManager] with
 * this workspace's [directory], so the frontend only needs one
 * object per directory.
 */
class KiloBackendWorkspace(
    val directory: String,
    private val cs: CoroutineScope,
    private val api: DefaultApi,
    private val events: SharedFlow<SseEvent>,
    private val sessions: KiloBackendSessionManager,
    private val log: KiloLog,
) {
    companion object {
        private const val MAX_RETRIES = 3
        private const val RETRY_DELAY_MS = 1000L
    }

    private val _state = MutableStateFlow<KiloWorkspaceState>(KiloWorkspaceState.Pending)
    val state: StateFlow<KiloWorkspaceState> = _state.asStateFlow()

    private var loader: Job? = null
    private var eventWatcher: Job? = null
    private val loadLock = Any()

    /** Load project data (providers, agents, commands, skills). */
    fun load() {
        synchronized(loadLock) {
            loader?.cancel()
            eventWatcher?.cancel()
            loader = cs.launch {
            log.info("Loading workspace data for $directory")
            val progress = AtomicReference(KiloWorkspaceLoadProgress())
            _state.value = KiloWorkspaceState.Loading(progress.get())

            var prov: ProviderData? = null
            var ag: AgentData? = null
            var cmd: List<CommandInfo>? = null
            var sk: List<SkillInfo>? = null
            val errors = mutableListOf<String>()

            try {
                coroutineScope {
                    launch {
                        val result = fetchWithRetry("providers") { fetchProviders() }
                        if (result != null) {
                            prov = result
                            progress.updateAndGet { it.copy(providers = true) }
                                .also { _state.value = KiloWorkspaceState.Loading(it) }
                        } else {
                            synchronized(errors) { errors.add("providers") }
                            throw LoadFailure("providers")
                        }
                    }
                    launch {
                        val result = fetchWithRetry("agents") { fetchAgents() }
                        if (result != null) {
                            ag = result
                            progress.updateAndGet { it.copy(agents = true) }
                                .also { _state.value = KiloWorkspaceState.Loading(it) }
                        } else {
                            synchronized(errors) { errors.add("agents") }
                            throw LoadFailure("agents")
                        }
                    }
                    launch {
                        val result = fetchWithRetry("commands") { fetchCommands() }
                        if (result != null) {
                            cmd = result
                            progress.updateAndGet { it.copy(commands = true) }
                                .also { _state.value = KiloWorkspaceState.Loading(it) }
                        } else {
                            synchronized(errors) { errors.add("commands") }
                            throw LoadFailure("commands")
                        }
                    }
                    launch {
                        val result = fetchWithRetry("skills") { fetchSkills() }
                        if (result != null) {
                            sk = result
                            progress.updateAndGet { it.copy(skills = true) }
                                .also { _state.value = KiloWorkspaceState.Loading(it) }
                        } else {
                            synchronized(errors) { errors.add("skills") }
                            throw LoadFailure("skills")
                        }
                    }
                }

                _state.value = KiloWorkspaceState.Ready(
                    providers = prov!!,
                    agents = ag!!,
                    commands = cmd!!,
                    skills = sk!!,
                )
                log.info("Workspace data loaded for $directory")
                ensureActive()
                startWatchingGlobalSseEvents()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.warn("Workspace data load failed for $directory: ${e.message}")
                _state.value = KiloWorkspaceState.Error(
                    "Failed to load: ${synchronized(errors) { errors.joinToString() }}"
                )
            }
            }
        }
    }

    /** Force a full reload of workspace data. */
    fun reload() {
        load()
    }

    /** Stop all background work. */
    fun stop() {
        synchronized(loadLock) {
            loader?.cancel()
            eventWatcher?.cancel()
        }
        _state.value = KiloWorkspaceState.Pending
    }

    // ------ session access (delegates to session manager) ------

    fun sessions(): SessionListDto = sessions.list(directory)
    fun createSession(): SessionDto = sessions.create(directory)
    fun deleteSession(id: String) = sessions.delete(id, directory)
    fun seedStatuses() = sessions.seed(directory)

    // ------ SSE watching ------

    /**
     * Watch global SSE events that invalidate workspace data.
     *
     * - `global.disposed` — CLI server context torn down, all data stale.
     * - `server.instance.disposed` — server instance disposed, reload.
     *
     * Idempotent — only one watcher runs at a time.
     */
    private fun startWatchingGlobalSseEvents() {
        synchronized(loadLock) {
            if (eventWatcher?.isActive == true) return
            log.info("Started watching global SSE events for workspace $directory")
            eventWatcher = cs.launch {
                events.collect { event ->
                    when (event.type) {
                        "global.disposed" -> {
                            log.info("SSE global.disposed — reloading workspace data for $directory")
                            load()
                        }
                        "server.instance.disposed" -> {
                            log.info("SSE server.instance.disposed — reloading workspace data for $directory")
                            load()
                        }
                    }
                }
            }
        }
    }

    // ------ fetch methods ------

    private fun fetchProviders(): ProviderData? =
        try {
            val response = api.providerList(directory = directory)
            ProviderData(
                providers = response.all.map { p ->
                    ProviderInfo(
                        id = p.id,
                        name = p.name,
                        source = p.api,
                        models = p.models.mapValues { (_, m) ->
                            ModelInfo(
                                id = m.id,
                                name = m.name,
                                attachment = m.attachment,
                                reasoning = m.reasoning,
                                temperature = m.temperature,
                                toolCall = m.toolCall,
                                free = m.isFree ?: false,
                                status = m.status?.value,
                            )
                        },
                    )
                },
                connected = response.connected,
                defaults = response.default,
            )
        } catch (e: Exception) {
            log.warn("Providers fetch failed: ${e.message}", e)
            null
        }

    private fun fetchAgents(): AgentData? =
        try {
            val response = api.appAgents(directory = directory)
            val mapped = response.map(::mapAgent)
            val visible = response.filter { it.mode != Agent.Mode.SUBAGENT && it.hidden != true }
            AgentData(
                agents = visible.map(::mapAgent),
                all = mapped,
                default = visible.firstOrNull()?.name ?: "code",
            )
        } catch (e: Exception) {
            log.warn("Agents fetch failed: ${e.message}", e)
            null
        }

    private fun fetchCommands(): List<CommandInfo>? =
        try {
            api.commandList(directory = directory).map { c ->
                CommandInfo(
                    name = c.name,
                    description = c.description,
                    source = c.source?.value,
                    hints = c.hints,
                )
            }
        } catch (e: Exception) {
            log.warn("Commands fetch failed: ${e.message}", e)
            null
        }

    private fun fetchSkills(): List<SkillInfo>? =
        try {
            api.appSkills(directory = directory).map { s ->
                SkillInfo(
                    name = s.name,
                    description = s.description,
                    location = s.location,
                )
            }
        } catch (e: Exception) {
            log.warn("Skills fetch failed: ${e.message}", e)
            null
        }

    // ------ helpers ------

    private fun mapAgent(a: Agent) = AgentInfo(
        name = a.name,
        displayName = a.displayName,
        description = a.description,
        mode = a.mode.value,
        native = a.native,
        hidden = a.hidden,
        color = a.color,
        deprecated = a.deprecated,
    )

    private suspend fun <T> fetchWithRetry(
        name: String,
        block: () -> T?,
    ): T? {
        repeat(MAX_RETRIES) { attempt ->
            val result = block()
            if (result != null) return result
            if (attempt < MAX_RETRIES - 1) {
                log.warn("$name: attempt ${attempt + 1}/$MAX_RETRIES failed — retrying in ${RETRY_DELAY_MS}ms")
                delay(RETRY_DELAY_MS)
            }
        }
        log.error("$name: all $MAX_RETRIES attempts failed")
        return null
    }

    private class LoadFailure(resource: String) : Exception("Failed to load $resource")
}
