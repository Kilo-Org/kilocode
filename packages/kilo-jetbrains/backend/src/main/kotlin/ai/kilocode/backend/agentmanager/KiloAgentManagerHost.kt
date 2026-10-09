package ai.kilocode.backend.agentmanager

import ai.kilocode.backend.agentmanager.AgentManagerProtocol.ErrorCode
import ai.kilocode.backend.agentmanager.AgentManagerProtocol.Request
import ai.kilocode.backend.agentmanager.AgentManagerProtocol.RequestFailure
import ai.kilocode.backend.app.KiloBackendChatManager
import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.backend.app.SseEvent
import ai.kilocode.backend.rpc.KiloWorktreeRpcApiImpl
import ai.kilocode.log.KiloLog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request as OkRequest
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.nio.file.Files
import java.nio.file.InvalidPathException
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
 *
 * **Every call must carry `?directory=`.** `/kilocode/agent-manager` and its `reply`/`reject` routes
 * are workspace-routed, and the pending-request set lives in per-directory instance state. The
 * middleware resolves the instance from the `directory` query, then the `x-kilo-directory` header,
 * then the server's own `process.cwd()`; it cannot recover one from these paths, because
 * `getWorkspaceRouteSessionID` only matches `/session/...`-shaped URLs. The backend's OkHttp client
 * adds only Basic auth, so an un-parameterised call silently lands on the `process.cwd()` instance,
 * finds no pending entry, and 404s — leaving the CLI request to time out after 60s.
 */
class KiloAgentManagerHost(
    private val cs: CoroutineScope,
    private val sessions: KiloBackendSessionManager,
    private val chat: KiloBackendChatManager,
    private val log: KiloLog,
) {
    private val dispatch = AgentManagerDispatch(sessions, chat)
    private val worktrees = KiloWorktreeRpcApiImpl()
    private val starter = AgentManagerStarter(sessions, chat, worktrees, log)
    private val originals = PromptLedger()

    private var http: OkHttpClient? = null
    private var base: String? = null
    private var watcher: Job? = null
    private val jobs = ConcurrentHashMap<String, Job>()
    private val settled = ConcurrentHashMap.newKeySet<String>()

    /**
     * `requestID` → the answer built once and reused by every retried POST. [directory] is part of
     * the outcome because the retry has to address the same workspace instance as the original.
     */
    private data class Outcome(val reply: Boolean, val body: String, val directory: String)

    private val outcomes = ConcurrentHashMap<String, Outcome>()

    /** Directories already reconciled on this connection, so each is listed at most once. */
    private val synced = ConcurrentHashMap.newKeySet<String>()

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
            // Reconciliation can only ask about directories it knows, and the session manager's
            // directory map is cleared on every disconnect, so at connect time it is usually empty.
            // Reconcile a directory the first time a session is observed in it instead: that is when
            // the host first learns the directory exists, and it covers a CLI that outlived this host.
            launch {
                sessions.changes.collect { change ->
                    if (synced.add(change.directory)) syncDirectory(change.directory)
                }
            }
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
        synced.clear()
        http = null
        base = null
    }

    /**
     * Routes one SSE event. Exception-safe on purpose: this runs inside `events.collect`, so letting
     * anything escape would terminate the collector and silently disable `agent_manager` for the rest
     * of the connection. A malformed payload — a bad `Path.of`, an unexpected JSON shape — must cost
     * one dropped event, not the whole stream.
     */
    private fun route(event: SseEvent) {
        try {
            dispatchEvent(event)
        } catch (err: CancellationException) {
            throw err
        } catch (err: Exception) {
            log.warn("agent_manager dropped a malformed ${event.type} event", err)
        }
    }

    private fun dispatchEvent(event: SseEvent) {
        AgentManagerProtocol.parseRequest(event.type, event.data)?.let { request ->
            admit(request, AgentManagerProtocol.envelopeDirectory(event.data))
            return
        }
        AgentManagerProtocol.parseCancelled(event.type, event.data)?.let { cancelled ->
            settled.add(cancelled.requestID)
            jobs.remove(cancelled.requestID)?.cancel()
            outcomes.remove(cancelled.requestID)
            return
        }
        AgentManagerProtocol.parseStart(event.type, event.data)?.let { start ->
            val directory = AgentManagerProtocol.envelopeDirectory(event.data)?.takeIf { reachable(it) } ?: return
            cs.launch {
                try {
                    starter.start(start, directory)
                } catch (err: CancellationException) {
                    throw err
                } catch (err: Exception) {
                    log.warn("agent_manager start req=${start.requestID} failed", err)
                }
            }
        }
    }

    private fun reachable(directory: String): Boolean =
        try {
            Files.isDirectory(Path.of(directory))
        } catch (_: InvalidPathException) {
            false
        }

    /**
     * Reconciles requests the CLI still has pending after a (re)connect this host was not alive for.
     *
     * Listed per directory, not once: the endpoint is workspace-routed and each directory is a
     * separate instance with its own pending set, so a single un-parameterised call would only ever
     * see the server's `process.cwd()` instance. The VS Code bridge enumerates its known directories
     * the same way. A recovered request also carries the directory it was listed from, which is the
     * only directory information available here — the protocol's `Request` payload has none.
     */
    private suspend fun sync() {
        for (directory in sessions.knownDirectories()) {
            if (synced.add(directory)) syncDirectory(directory)
        }
    }

    private fun syncDirectory(directory: String) {
        if (!reachable(directory)) return
        val raw = get("/kilocode/agent-manager", directory) ?: return
        for (request in AgentManagerProtocol.parsePendingRequests(raw)) {
            admit(request, directory)
        }
    }

    /**
     * Admits a request exactly once. The check and the launch must be atomic: [sync] runs concurrently
     * with the live SSE collector, so a request that appears in both the reconciliation list and as a
     * `requested` event would otherwise pass a `containsKey` check in both callers and execute twice —
     * delivering a `prompt` or issuing a `stop` twice, which is precisely what [outcomes] cannot
     * prevent, since memoization only happens after execution.
     */
    private fun admit(request: Request, directory: String?) {
        if (request.id in settled) return
        jobs.computeIfAbsent(request.id) {
            val memoized = outcomes[request.id]
            cs.launch {
                try {
                    if (memoized != null) send(request.id, memoized.directory, memoized.reply, memoized.body)
                    else execute(request, directory)
                } finally {
                    jobs.remove(request.id)
                }
            }
        }
    }

    private suspend fun execute(request: Request, directory: String?) {
        // The reply/reject must address the instance that holds this request's pending entry. The
        // live SSE envelope names it; a request recovered by `sync()` is admitted with the directory
        // it was listed from. Falling back to the requesting session's own directory covers a flat
        // event with no envelope directory.
        // The answer has to address the instance holding this request's pending entry, which is the
        // directory it was published from — reachable or not. A directory that no longer exists on
        // disk still has a live instance (the CLI published from it), so the reject below can land;
        // only a request with no directory at all has nowhere to answer.
        val workspace = directory ?: sessions.sessionDirectory(request.sessionID)
        if (workspace == null) {
            log.warn("agent_manager request ${request.id} dropped: no workspace directory to answer through")
            settled.add(request.id)
            return
        }
        try {
            when (request) {
                is Request.Overview -> {
                    if (!reachable(workspace)) {
                        throw RequestFailure(ErrorCode.WORKSPACE_UNAVAILABLE, "Workspace directory is not reachable: $workspace")
                    }
                    val overview = AgentManagerOverview.build(workspace, sessions, chat, worktrees, request.sectionIDs, request.states)
                    reply(request.id, workspace, AgentManagerProtocol.replyBody(request, overview))
                }
                is Request.Prompt -> {
                    dispatch.prompt(request, originals)
                    reply(request.id, workspace, AgentManagerProtocol.replyBody(request))
                }
                is Request.Stop -> {
                    dispatch.stop(request)
                    reply(request.id, workspace, AgentManagerProtocol.replyBody(request))
                }
                is Request.Answer -> {
                    val questionID = dispatch.answer(request)
                    reply(request.id, workspace, AgentManagerProtocol.replyBody(request, questionID))
                }
                is Request.Move -> reject(
                    request.id,
                    workspace,
                    ErrorCode.UNKNOWN_SECTION,
                    "Agent Manager sections are a VS Code-only grouping; this client has no sections to move into.",
                )
            }
        } catch (failure: RequestFailure) {
            reject(request.id, workspace, failure.code, failure.message ?: "Agent Manager request failed")
        } catch (err: CancellationException) {
            throw err
        } catch (err: Exception) {
            log.warn("agent_manager request ${request.id} failed", err)
            reject(request.id, workspace, ErrorCode.HOST_ERROR, err.message ?: "Agent Manager request failed")
        }
    }

    private fun reply(requestID: String, directory: String, body: String) {
        outcomes[requestID] = Outcome(reply = true, body = body, directory = directory)
        send(requestID, directory, isReply = true, body = body)
    }

    private fun reject(requestID: String, directory: String, code: ErrorCode, message: String) {
        val body = AgentManagerProtocol.rejectBody(code, message)
        outcomes[requestID] = Outcome(reply = false, body = body, directory = directory)
        send(requestID, directory, isReply = false, body = body)
    }

    private fun send(requestID: String, directory: String, isReply: Boolean, body: String) {
        val action = if (isReply) "reply" else "reject"
        if (!post("/kilocode/agent-manager/$requestID/$action", directory, body)) return
        settled.add(requestID)
        outcomes.remove(requestID)
    }

    private fun post(path: String, directory: String, body: String): Boolean {
        val client = http ?: return false
        val url = base ?: return false
        val request = OkRequest.Builder()
            .url("$url$path?directory=${encode(directory)}")
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

    private fun get(path: String, directory: String): String? {
        val client = http ?: return null
        val url = base ?: return null
        val request = OkRequest.Builder().url("$url$path?directory=${encode(directory)}").get().build()
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

    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
}
