package ai.kilocode.backend.agentmanager

import ai.kilocode.backend.agentmanager.AgentManagerProtocol.ErrorCode
import ai.kilocode.backend.agentmanager.AgentManagerProtocol.Request
import ai.kilocode.backend.agentmanager.AgentManagerProtocol.RequestFailure
import ai.kilocode.backend.app.KiloBackendChatManager
import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.backend.app.SseEvent
import ai.kilocode.backend.rpc.KiloWorktreeRpcApiImpl
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.AgentManagerStartProgressDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request as OkRequest
import okhttp3.RequestBody.Companion.toRequestBody
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap

/**
 * Host for the CLI's `agent_manager` orchestration protocol — the backend-side counterpart of
 * `packages/kilo-vscode/src/agent-manager/orchestration-bridge.ts`.
 *
 * Not an IntelliJ service: owned and lifecycle-managed by [ai.kilocode.backend.app.
 * KiloBackendAppService] alongside [KiloBackendSessionManager]/[KiloBackendChatManager], exactly the
 * same shape — a plain class with [start]/[stop] driven by the connection lifecycle, holding no
 * IntelliJ Application/Project references so it can run and be unit-tested without one.
 *
 * Lifecycle: every `kilocode.agent_manager.requested`/`.cancelled`/`.start` SSE event is routed here
 * from the shared `events` flow. A `requested` request is admitted (its envelope `directory` must
 * resolve to a reachable repository) and dispatched to [AgentManagerOverview]/[AgentManagerDispatch]
 * on its own [Job]. The built reply/reject body is memoized in [outcomes] *before* the first POST
 * attempt, mirroring the VS Code bridge's own `outcomes` map — a POST that fails to land (a CLI
 * restart mid-flight, a transient connection drop) is retried with that same body on the next SSE
 * redelivery or [sync] reconciliation, instead of re-running `prompt`/`stop`/`answer` and risking a
 * second prompt delivery or a second abort. [sync] reconciles anything the CLI still lists as pending
 * after a reconnect this host was not alive for.
 */
class KiloAgentManagerHost(
    private val cs: CoroutineScope,
    private val sessions: KiloBackendSessionManager,
    private val chat: KiloBackendChatManager,
    private val log: KiloLog,
) {
    private val dispatch = AgentManagerDispatch(sessions, chat)
    private val worktrees = KiloWorktreeRpcApiImpl()
    private val starter = AgentManagerStarter(sessions, chat, worktrees)
    private val originals = PromptLedger()

    /** Frontend-facing progress feed for host-initiated session creation; see [AgentManagerStarter]. */
    val startProgress: SharedFlow<AgentManagerStartProgressDto> get() = starter.progress

    private var http: OkHttpClient? = null
    private var base: String? = null
    private var watcher: Job? = null
    private val jobs = ConcurrentHashMap<String, Job>()
    private val settled = ConcurrentHashMap.newKeySet<String>()

    /** `requestID` → (isReply, body), built once per request and reused by every retried POST. */
    private val outcomes = ConcurrentHashMap<String, Pair<Boolean, String>>()

    fun start(client: OkHttpClient, port: Int, events: SharedFlow<SseEvent>) {
        stop()
        http = client
        base = "http://127.0.0.1:$port"
        // `events` has no replay buffer (see KiloBackendConnectionService), so the collector must
        // attach before anything else runs on this coroutine — including `sync()`, a blocking HTTP
        // round trip that would otherwise delay the subscription and drop any event published while
        // it was in flight. `sync()` therefore runs as its own child job once the collector is live.
        watcher = cs.launch {
            launch { sync() }
            events.collect { event -> route(event) }
        }
    }

    fun stop() {
        watcher?.cancel()
        watcher = null
        jobs.values.forEach { it.cancel() }
        jobs.clear()
        settled.clear()
        outcomes.clear()
        http = null
        base = null
    }

    private fun route(event: SseEvent) {
        AgentManagerProtocol.parseRequest(event.type, event.data)?.let { request ->
            val directory = AgentManagerProtocol.envelopeDirectory(event.data)
            admit(request, directory)
            return
        }
        AgentManagerProtocol.parseCancelled(event.type, event.data)?.let { cancelled ->
            settled.add(cancelled.requestID)
            jobs.remove(cancelled.requestID)?.cancel()
            outcomes.remove(cancelled.requestID)
            return
        }
        AgentManagerProtocol.parseStart(event.type, event.data)?.let { start ->
            val directory = AgentManagerProtocol.envelopeDirectory(event.data)?.takeIf { Files.isDirectory(Path.of(it)) } ?: return
            cs.launch { runCatching { starter.start(start, directory) }.onFailure { log.warn("agent_manager start failed", it) } }
        }
    }

    /** Reconciles requests the CLI still has pending after a (re)connect we were not alive for. */
    private suspend fun sync() {
        val raw = get("/kilocode/agent-manager") ?: return
        AgentManagerProtocol.parsePendingRequests(raw).forEach { request ->
            if (request.id in settled || jobs.containsKey(request.id)) return@forEach
            admit(request, null)
        }
    }

    private fun admit(request: Request, directory: String?) {
        if (request.id in settled || jobs.containsKey(request.id)) return
        val memoized = outcomes[request.id]
        jobs[request.id] = cs.launch {
            try {
                if (memoized != null) send(request.id, memoized.first, memoized.second) else execute(request, directory)
            } finally {
                jobs.remove(request.id)
            }
        }
    }

    private suspend fun execute(request: Request, directory: String?) {
        try {
            when (request) {
                is Request.Overview -> {
                    // The CLI's `GET /kilocode/agent-manager` reconciliation list carries no directory
                    // at all (only the live `requested` SSE envelope does) — see `sync()`'s doc — so a
                    // request recovered after a reconnect falls back to the requesting session's own
                    // known directory, the same lookup `AgentManagerDispatch` uses for prompt/stop/
                    // answer targets.
                    val root = (directory ?: sessions.sessionDirectory(request.sessionID))
                        ?.takeIf { Files.isDirectory(Path.of(it)) }
                        ?: throw RequestFailure(ErrorCode.WORKSPACE_UNAVAILABLE, "Agent Manager requires a reachable workspace directory")
                    val overview = AgentManagerOverview.build(root, sessions, chat, worktrees, request.sectionIDs, request.states)
                    reply(request.id, AgentManagerProtocol.replyBody(request, overview))
                }
                is Request.Prompt -> {
                    dispatch.prompt(request, originals)
                    reply(request.id, AgentManagerProtocol.replyBody(request))
                }
                is Request.Stop -> {
                    dispatch.stop(request)
                    reply(request.id, AgentManagerProtocol.replyBody(request))
                }
                is Request.Answer -> {
                    val questionID = dispatch.answer(request)
                    reply(request.id, AgentManagerProtocol.replyBody(request, questionID))
                }
                is Request.Move -> reject(
                    request.id,
                    ErrorCode.UNKNOWN_SECTION,
                    "Agent Manager sections are a VS Code-only grouping; this client has no sections to move into.",
                )
            }
        } catch (failure: RequestFailure) {
            reject(request.id, failure.code, failure.message ?: "Agent Manager request failed")
        } catch (err: Exception) {
            log.warn("agent_manager request ${request.id} failed", err)
            reject(request.id, ErrorCode.HOST_ERROR, err.message ?: "Agent Manager request failed")
        }
    }

    private fun reply(requestID: String, body: String) {
        outcomes[requestID] = true to body
        send(requestID, isReply = true, body = body)
    }

    private fun reject(requestID: String, code: ErrorCode, message: String) {
        val body = AgentManagerProtocol.rejectBody(code, message)
        outcomes[requestID] = false to body
        send(requestID, isReply = false, body = body)
    }

    private fun send(requestID: String, isReply: Boolean, body: String) {
        val path = if (isReply) "/kilocode/agent-manager/$requestID/reply" else "/kilocode/agent-manager/$requestID/reject"
        if (!post(path, body)) return
        settled.add(requestID)
        outcomes.remove(requestID)
    }

    private fun post(path: String, body: String): Boolean {
        val client = http ?: return false
        val url = base ?: return false
        val request = OkRequest.Builder()
            .url("$url$path")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        return try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) log.warn("agent_manager $path failed: HTTP ${response.code}")
                response.isSuccessful
            }
        } catch (err: Exception) {
            log.warn("agent_manager $path failed", err)
            false
        }
    }

    private fun get(path: String): String? {
        val client = http ?: return null
        val url = base ?: return null
        val request = OkRequest.Builder().url("$url$path").get().build()
        return try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    log.warn("agent_manager $path failed: HTTP ${response.code}")
                    null
                } else {
                    response.body.string()
                }
            }
        } catch (err: Exception) {
            log.warn("agent_manager $path failed", err)
            null
        }
    }
}
