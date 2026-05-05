package ai.kilocode.backend.workspace

import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.backend.app.LoadError
import ai.kilocode.backend.app.SseEvent
import ai.kilocode.log.KiloLog
import ai.kilocode.jetbrains.api.client.DefaultApi
import ai.kilocode.jetbrains.api.model.Agent
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionListDto
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
import okhttp3.OkHttpClient
import okhttp3.Request
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
    private val http: OkHttpClient,
    private val port: Int,
    private val events: SharedFlow<SseEvent>,
    private val sessions: KiloBackendSessionManager,
    private val log: KiloLog,
) {
    companion object {
        private const val MAX_RETRIES = 3
        private const val RETRY_DELAY_MS = 1000L
        private val json = Json { ignoreUnknownKeys = true }
        private val EFFORT_ORDER = listOf("none", "minimal", "low", "medium", "high", "xhigh", "max")
            .withIndex()
            .associate { it.value to it.index }
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
            val errors = mutableListOf<LoadError>()

            try {
                coroutineScope {
                    launch {
                        val result = fetchWithRetry("providers") { fetchProviders() }
                        if (result.value != null) {
                            prov = result.value
                            progress.updateAndGet { it.copy(providers = true) }
                                .also { _state.value = KiloWorkspaceState.Loading(it) }
                        } else {
                            val err = result.error ?: LoadError(resource = "providers")
                            synchronized(errors) { errors.add(err) }
                            throw LoadFailure(err)
                        }
                    }
                    launch {
                        val result = fetchWithRetry("agents") { fetchAgents() }
                        if (result.value != null) {
                            ag = result.value
                            progress.updateAndGet { it.copy(agents = true) }
                                .also { _state.value = KiloWorkspaceState.Loading(it) }
                        } else {
                            val err = result.error ?: LoadError(resource = "agents")
                            synchronized(errors) { errors.add(err) }
                            throw LoadFailure(err)
                        }
                    }
                    launch {
                        val result = fetchWithRetry("commands") { fetchCommands() }
                        if (result.value != null) {
                            cmd = result.value
                            progress.updateAndGet { it.copy(commands = true) }
                                .also { _state.value = KiloWorkspaceState.Loading(it) }
                        } else {
                            val err = result.error ?: LoadError(resource = "commands")
                            synchronized(errors) { errors.add(err) }
                            throw LoadFailure(err)
                        }
                    }
                    launch {
                        val result = fetchWithRetry("skills") { fetchSkills() }
                        if (result.value != null) {
                            sk = result.value
                            progress.updateAndGet { it.copy(skills = true) }
                                .also { _state.value = KiloWorkspaceState.Loading(it) }
                        } else {
                            val err = result.error ?: LoadError(resource = "skills")
                            synchronized(errors) { errors.add(err) }
                            throw LoadFailure(err)
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
                val items = synchronized(errors) { errors.toList() }
                val names = items.joinToString { it.resource }
                setWorkspaceError("Failed to load: $names", items)
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

    private fun fetchProviders(): FetchResult<ProviderData> =
        try {
            FetchResult.ok(parseProviders(fetch("/provider?directory=${encode(directory)}")))
        } catch (e: Exception) {
            log.warn("Providers fetch failed: ${e.message}", e)
            FetchResult.fail("providers", e)
        }

    private fun fetchAgents(): FetchResult<AgentData> =
        try {
            val response = api.appAgents(directory = directory)
            val mapped = response.map(::mapAgent)
            val visible = response.filter { it.mode != Agent.Mode.SUBAGENT && it.hidden != true }
            FetchResult.ok(AgentData(
                agents = visible.map(::mapAgent),
                all = mapped,
                default = visible.firstOrNull()?.name ?: "code",
            ))
        } catch (e: Exception) {
            log.warn("Agents fetch failed: ${e.message}", e)
            FetchResult.fail("agents", e)
        }

    private fun fetchCommands(): FetchResult<List<CommandInfo>> =
        try {
            FetchResult.ok(api.commandList(directory = directory).map { c ->
                CommandInfo(
                    name = c.name,
                    description = c.description,
                    source = c.source?.value,
                    hints = c.hints,
                )
            })
        } catch (e: Exception) {
            log.warn("Commands fetch failed: ${e.message}", e)
            FetchResult.fail("commands", e)
        }

    private fun fetchSkills(): FetchResult<List<SkillInfo>> =
        try {
            FetchResult.ok(api.appSkills(directory = directory).map { s ->
                SkillInfo(
                    name = s.name,
                    description = s.description,
                    location = s.location,
                )
            })
        } catch (e: Exception) {
            log.warn("Skills fetch failed: ${e.message}", e)
            FetchResult.fail("skills", e)
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

    private fun parseProviders(raw: String): ProviderData {
        val obj = json.parseToJsonElement(raw).jsonObject
        return ProviderData(
            providers = obj["all"]?.jsonArray?.map { provider(it.jsonObject) } ?: emptyList(),
            connected = obj["connected"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList(),
            defaults = obj["default"]?.jsonObject?.mapValues { (_, value) -> value.jsonPrimitive.content } ?: emptyMap(),
        )
    }

    private fun provider(obj: JsonObject) = ProviderInfo(
        id = obj.str("id") ?: "",
        name = obj.str("name") ?: "",
        source = obj.str("source"),
        models = obj["models"]?.jsonObject?.mapValues { (id, value) -> model(id, value.jsonObject) } ?: emptyMap(),
    )

    private fun model(id: String, obj: JsonObject): ModelInfo {
        val cap = obj["capabilities"]?.jsonObject
        return ModelInfo(
            id = obj.str("id") ?: id,
            name = obj.str("name") ?: id,
            attachment = cap.bool("attachment"),
            reasoning = cap.bool("reasoning"),
            temperature = cap.bool("temperature"),
            toolCall = cap.bool("toolcall"),
            free = obj.bool("isFree"),
            status = obj.str("status"),
            recommendedIndex = obj.num("recommendedIndex"),
            variants = variants(obj),
        )
    }

    private fun variants(obj: JsonObject): List<String> {
        val raw = obj["variants"]?.jsonObject?.keys?.toList() ?: return emptyList()
        return raw.sortedWith(compareBy<String> { EFFORT_ORDER[it] ?: Int.MAX_VALUE }.thenBy { it })
    }

    private fun fetch(path: String): String {
        val request = Request.Builder().url("http://localhost:$port$path").get().build()
        http.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw RuntimeException("HTTP ${response.code}: $raw")
            return raw
        }
    }

    private suspend fun <T> fetchWithRetry(
        name: String,
        block: () -> FetchResult<T>,
    ): FetchResult<T> {
        var last = FetchResult.fail<T>(name)
        repeat(MAX_RETRIES) { attempt ->
            val result = block()
            if (result.value != null) return result
            last = result
            if (attempt < MAX_RETRIES - 1) {
                log.warn("$name: attempt ${attempt + 1}/$MAX_RETRIES failed — retrying in ${RETRY_DELAY_MS}ms")
                delay(RETRY_DELAY_MS)
            }
        }
        log.error("$name: all $MAX_RETRIES attempts failed")
        return last
    }

    private fun setWorkspaceError(message: String, errors: List<LoadError>) {
        _state.value = KiloWorkspaceState.Error(message, errors)
        log.warn("Workspace error [$directory]: $message")
    }

    private data class FetchResult<T>(val value: T?, val error: LoadError?) {
        companion object {
            fun <T> ok(value: T) = FetchResult<T>(value, null)
            fun <T> fail(resource: String, e: Exception? = null) = FetchResult<T>(null, LoadError(resource, detail = e?.message))
        }
    }

    private class LoadFailure(val error: LoadError) : Exception("Failed to load ${error.resource}")

}

private fun encode(value: String) = java.net.URLEncoder.encode(value, Charsets.UTF_8)
private fun JsonObject.str(key: String) = this[key]?.jsonPrimitive?.contentOrNull
private fun JsonObject?.bool(key: String) = this?.get(key)?.jsonPrimitive?.booleanOrNull ?: false
private fun JsonObject.num(key: String) = this[key]?.jsonPrimitive?.doubleOrNull
