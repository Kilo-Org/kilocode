package ai.kilocode.backend.testing

import java.io.BufferedWriter
import java.io.OutputStreamWriter
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.ConcurrentHashMap
import kotlin.io.path.createTempDirectory

/**
 * Lightweight mock HTTP server simulating the Kilo CLI server.
 *
 * Handles REST endpoints with configurable JSON responses and provides
 * full control over the SSE `/global/event` stream. Uses raw sockets
 * so SSE connections can be held open and events pushed on demand.
 *
 * Supports restart: [start] can be called after [shutdown] to bind a new port.
 * Call [close] for final cleanup (shuts down the thread pool).
 */
class MockCliServer : AutoCloseable {

    val password = "test-password"

    // Configurable REST responses — can be changed between requests
    @Volatile var health = """{"healthy":true,"version":"1.0.0"}"""
    @Volatile var config = """{"model":"test/model"}"""
    @Volatile var workspaceConfig = """{}"""
    @Volatile var warnings = "[]"
    @Volatile var notifications = "[]"
    @Volatile var profile = """{"profile":{"email":"test@test.com","name":"Test"},"balance":null,"currentOrgId":null}"""
    @Volatile var path = """{"home":"/tmp","state":"${createTempDirectory("kilo-model-state").toAbsolutePath()}","config":"/tmp","worktree":"/tmp","directory":"/tmp"}"""
    @Volatile var profileStatus = 200
    @Volatile var configStatus = 200
    @Volatile var workspaceConfigStatus = 200
    @Volatile var warningsStatus = 200
    @Volatile var notificationsStatus = 200

    // Auth / OAuth responses
    @Volatile var authorizeResponse = """{"url":"https://auth.kilo.ai/device","method":"code","instructions":"Open URL and enter code: TEST-1234"}"""
    @Volatile var authorizeStatus = 200
    @Volatile var callbackStatus = 200
    @Volatile var authRemoveStatus = 200
    @Volatile var authPutStatus = 200
    @Volatile var disposeStatus = 200
    @Volatile var organizationSetStatus = 200
    @Volatile var lastAuthorizeBody: String? = null
    @Volatile var lastCallbackBody: String? = null
    @Volatile var lastAuthPutBody: String? = null
    @Volatile var lastAuthDeletePath: String? = null
    @Volatile var lastConfigPatchBody: String? = null
    @Volatile var lastWorkspaceConfigPatchPath: String? = null
    @Volatile var lastWorkspaceConfigPatchBody: String? = null
    @Volatile var lastOrganizationSetBody: String? = null
    @Volatile var mcp = "[]"
    @Volatile var mcpStatus = 200
    @Volatile var mcpActionStatus = 200
    @Volatile var agentRemoveStatus = 200
    @Volatile var agentBuilderStatus = 200
    @Volatile var lastMcpActionPath: String? = null
    @Volatile var lastAgentRemoveBody: String? = null
    @Volatile var lastAgentBuilderPath: String? = null
    @Volatile var lastAgentBuilderBody: String? = null
    @Volatile var lastAgentBuilderMethod: String? = null

    // Project-scoped REST responses
    @Volatile var providers = """{"all":[],"default":{},"connected":[],"failed":[]}"""
    @Volatile var providerAuth = "{}"
    @Volatile var providersAfterAuthPut: String? = null
    @Volatile var agents = "[]"
    @Volatile var commands = "[]"
    @Volatile var skills = "[]"
    @Volatile var providersStatus = 200
    @Volatile var providerAuthStatus = 200
    @Volatile var agentsStatus = 200
    @Volatile var commandsStatus = 200
    @Volatile var skillsStatus = 200

    // Session REST responses
    @Volatile var sessions = "[]"
    @Volatile var recentSessions = "[]"
    @Volatile var sessionCreate = """{"id":"ses_test","slug":"test","projectID":"prj_test","directory":"/test","title":"New Session","version":"1.0.0","time":{"created":1000,"updated":1000}}"""
    @Volatile var sessionStatuses = "{}"
    @Volatile var summarizeResponse = "true"
    @Volatile var sessionsStatus = 200
    @Volatile var recentSessionsStatus = 200
    @Volatile var sessionCreateStatus = 200
    @Volatile var sessionGetStatus = 200
    @Volatile var sessionDeleteStatus = 200
    @Volatile var sessionStatusesStatus = 200
    @Volatile var cloudSessions = """{"cliSessions":[],"nextCursor":null}"""
    @Volatile var cloudSessionImport = """{"id":"ses_imported","slug":"imported","projectID":"prj_test","directory":"/test","title":"Imported Session","version":"1.0.0","time":{"created":1000,"updated":1000}}"""
    @Volatile var cloudSessionsStatus = 200
    @Volatile var cloudSessionImportStatus = 200
    @Volatile var lastCloudSessionsPath: String? = null
    @Volatile var lastCloudSessionImportPath: String? = null
    @Volatile var lastCloudSessionImportBody: String? = null
    @Volatile var summarizeStatus = 200
    @Volatile var lastSummarizePath: String? = null
    @Volatile var lastSummarizeBody: String? = null
    @Volatile var promptStatus = 200
    @Volatile var promptResponse = "true"
    @Volatile var lastPromptPath: String? = null
    @Volatile var lastPromptBody: String? = null
    @Volatile var enhanced = """{"text":"Enhanced prompt"}"""
    @Volatile var enhanceStatus = 200
    @Volatile var lastEnhancePath: String? = null
    @Volatile var lastEnhanceBody: String? = null
    @Volatile var sessionRenameStatus = 200
    @Volatile var sessionRenameResponse = """{"id":"ses_test","slug":"test","projectID":"prj_test","directory":"/test","title":"Renamed","version":"1.0.0","time":{"created":1000,"updated":2000}}"""
    @Volatile var lastSessionRenamePath: String? = null
    @Volatile var lastSessionRenameBody: String? = null
    @Volatile var lastSessionRenameMethod: String? = null

    /** Configurable delay for all endpoint responses (ms). 0 = no delay. */
    @Volatile var responseDelay: Long = 0

    /** Optional gate for REST responses; SSE stays unblocked so the app can enter Loading. */
    @Volatile var responseGate: CountDownLatch? = null

    /** Optional gate for config warnings only. */
    @Volatile var warningsGate: CountDownLatch? = null

    /** Request counts by bare path (e.g. "/session" or "/global/config"). Thread-safe. */
    private val counts = ConcurrentHashMap<String, AtomicInteger>()
    private val requests = Object()
    private val streams = Object()
    private val sse = AtomicInteger(0)

    val sseConnectionCount: Int
        get() = sse.get()

    /** Return the number of requests received for [path] (bare, no query). */
    fun requestCount(path: String): Int = counts[path]?.get() ?: 0

    fun awaitRequestCount(path: String, target: Int, timeout: Long = 5_000): Boolean {
        val end = System.currentTimeMillis() + timeout
        synchronized(requests) {
            while (requestCount(path) < target) {
                val wait = end - System.currentTimeMillis()
                if (wait <= 0) return false
                requests.wait(wait)
            }
            return true
        }
    }

    fun awaitSseConnections(target: Int, timeout: Long = 5_000): Boolean {
        val end = System.currentTimeMillis() + timeout
        synchronized(streams) {
            while (sse.get() < target) {
                val wait = end - System.currentTimeMillis()
                if (wait <= 0) return false
                streams.wait(wait)
            }
            return true
        }
    }

    @Volatile var lastExperimentalSessionPath: String? = null

    /** Reset all request counters. */
    fun resetCounts() { counts.clear() }

    private val executor = Executors.newThreadPerTaskExecutor(
        Thread.ofVirtual().name("mock-cli-", 0).factory(),
    )
    private val closed = AtomicBoolean(false)

    private var server: ServerSocket? = null
    private val connections = ConcurrentLinkedQueue<Socket>()
    private var port = 0

    // SSE stream control — reset on each start()
    @Volatile private var sseWriter: BufferedWriter? = null
    private var sseLatch = CountDownLatch(1)
    private var sseConnected = CountDownLatch(1)

    /** Start (or restart) the mock server. Returns the port. */
    fun start(): Int {
        // Clean up any previous instance
        shutdownServer()

        val latch = CountDownLatch(1)
        sseLatch = latch
        sseConnected = CountDownLatch(1)
        sseWriter = null

        val srv = ServerSocket(0)
        server = srv
        port = srv.localPort
        val ready = CountDownLatch(1)
        executor.submit { acceptLoop(srv, ready) }
        // LLM note: tests connect immediately after start(), so publish accept-loop readiness instead of racing CI scheduling.
        check(ready.await(5, TimeUnit.SECONDS)) { "Mock CLI accept loop did not start" }
        return port
    }

    /** Stop the server socket and SSE without killing the thread pool. */
    fun shutdown() {
        shutdownServer()
    }

    /** Wait until an SSE client has connected (up to [timeout] ms). */
    fun awaitSseConnection(timeout: Long = 5_000): Boolean =
        sseConnected.await(timeout, TimeUnit.MILLISECONDS)

    /** Push an SSE event to the connected client. */
    fun pushEvent(type: String, data: String) {
        val w = sseWriter ?: return
        synchronized(w) {
            w.write("event: $type\n")
            w.write("data: $data\n")
            w.write("\n")
            w.flush()
        }
    }

    /** Close the SSE stream to simulate a server-side disconnect. */
    fun closeSse() {
        val w = sseWriter
        sseWriter = null
        runCatching { w?.close() }
        sseLatch.countDown()
    }

    /** Final cleanup — shuts down the thread pool. Not restartable after this. */
    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        shutdownServer()
        executor.shutdownNow()
        check(executor.awaitTermination(5, TimeUnit.SECONDS)) { "Mock CLI executor did not terminate" }
    }

    private fun shutdownServer() {
        sseLatch.countDown()
        val w = sseWriter
        sseWriter = null
        runCatching { w?.close() }
        connections.forEach { runCatching { it.close() } }
        connections.clear()
        runCatching { server?.close() }
        server = null
    }

    private fun acceptLoop(srv: ServerSocket, ready: CountDownLatch) {
        ready.countDown()
        while (!closed.get() && !srv.isClosed) {
            try {
                val socket = srv.accept()
                connections.add(socket)
                executor.submit { handle(socket) }
            } catch (_: SocketException) {
                break
            }
        }
    }

    private fun handle(socket: Socket) {
        try {
            val input = socket.getInputStream().bufferedReader()
            val line = input.readLine() ?: return
            val parts = line.split(" ")
            if (parts.size < 2) return
            val method = parts[0]
            val path = parts[1]

            var len = 0
            while (true) {
                val header = input.readLine()
                if (header.isNullOrBlank()) break
                val parts = header.split(":", limit = 2)
                if (parts.size == 2 && parts[0].equals("Content-Length", ignoreCase = true)) {
                    len = parts[1].trim().toIntOrNull() ?: 0
                }
            }
            val body = if (len > 0) CharArray(len).also { input.read(it, 0, len) }.concatToString() else ""

            val output = BufferedWriter(OutputStreamWriter(socket.getOutputStream()))
            val bare = path.substringBefore("?")
            val latch = sseLatch

            // Track request counts
            counts.computeIfAbsent(bare) { AtomicInteger(0) }.incrementAndGet()
            synchronized(requests) { requests.notifyAll() }

            // Optional delay for race condition testing
            val delay = responseDelay
            if (delay > 0) Thread.sleep(delay)
            if (bare != "/global/event") responseGate?.await()
            if (bare.startsWith("/config/warnings")) warningsGate?.await()

            when {
                path == "/global/health" -> respond(output, 200, health)
                bare == "/global/config" && method == "GET" -> respond(output, configStatus, config)
                bare == "/global/config" && method == "PATCH" -> {
                    lastConfigPatchBody = body
                    config = mergeConfig(config, body)
                    respond(output, configStatus, config)
                }
                bare == "/global/dispose" && method == "POST" -> respond(output, disposeStatus, "true")
                path.startsWith("/config/warnings") -> respond(output, warningsStatus, warnings)
                bare == "/config" && method == "PATCH" -> {
                    lastWorkspaceConfigPatchPath = path
                    lastWorkspaceConfigPatchBody = body
                    workspaceConfig = mergeConfig(workspaceConfig, body)
                    respond(output, workspaceConfigStatus, workspaceConfig)
                }
                bare == "/config" -> respond(output, workspaceConfigStatus, workspaceConfig)
                path.startsWith("/kilo/notifications") -> respond(output, notificationsStatus, notifications)
                path.startsWith("/kilo/profile") && method == "GET" -> {
                    if (profileStatus == 401) {
                        respond(output, 401, """{"message":"Unauthorized"}""")
                    } else {
                        respond(output, profileStatus, profile)
                    }
                }
                path.matches(Regex("/provider/[^/]+/oauth/authorize.*")) && method == "POST" -> {
                    lastAuthorizeBody = body
                    respond(output, authorizeStatus, authorizeResponse)
                }
                path.matches(Regex("/provider/[^/]+/oauth/callback.*")) && method == "POST" -> {
                    lastCallbackBody = body
                    respond(output, callbackStatus, "true")
                }
                bare.matches(Regex("/auth/[^/]+")) && method == "DELETE" -> {
                    lastAuthDeletePath = bare
                    respond(output, authRemoveStatus, "true")
                }
                bare.matches(Regex("/auth/[^/]+")) && method == "PUT" -> {
                    lastAuthPutBody = body
                    providersAfterAuthPut?.let { providers = it }
                    respond(output, authPutStatus, "true")
                }
                bare == "/kilo/organization" && method == "POST" -> {
                    lastOrganizationSetBody = body
                    respond(output, organizationSetStatus, "true")
                }
                path == "/global/event" -> handleSse(output, latch)
                path == "/path" -> respond(output, 200, this.path)
                bare == "/provider" -> respond(output, providersStatus, providers)
                bare == "/provider/auth" -> respond(output, providerAuthStatus, providerAuth)
                bare == "/agent" -> respond(output, agentsStatus, agents)
                bare == "/agent-builder" || bare.startsWith("/agent-builder/") -> {
                    lastAgentBuilderPath = path
                    lastAgentBuilderBody = body
                    lastAgentBuilderMethod = method
                    respond(output, agentBuilderStatus, """{"id":"test","scope":"project","path":"/tmp/test.md","markdown":"---\n---\n"}""")
                }
                bare == "/kilocode/agent/remove" && method == "POST" -> {
                    lastAgentRemoveBody = body
                    respond(output, agentRemoveStatus, if (agentRemoveStatus == 200) "true" else """{"error":"Agent not found"}""")
                }
                bare == "/command" -> respond(output, commandsStatus, commands)
                bare == "/skill" -> respond(output, skillsStatus, skills)
                bare == "/mcp" -> respond(output, mcpStatus, mcp)
                bare.matches(Regex("/mcp/[^/]+/(connect|disconnect)")) && method == "POST" -> {
                    lastMcpActionPath = path
                    respond(output, mcpActionStatus, "true")
                }
                bare.matches(Regex("/mcp/[^/]+/auth/authenticate")) && method == "POST" -> {
                    lastMcpActionPath = path
                    respond(output, mcpActionStatus, "true")
                }
                bare == "/experimental/session" -> {
                    lastExperimentalSessionPath = path
                    respond(output, recentSessionsStatus, recentSessions)
                }
                bare == "/kilo/cloud-sessions" -> {
                    lastCloudSessionsPath = path
                    respond(output, cloudSessionsStatus, cloudSessions)
                }
                bare == "/kilo/cloud/session/import" && method == "POST" -> {
                    lastCloudSessionImportPath = path
                    lastCloudSessionImportBody = body
                    respond(output, cloudSessionImportStatus, cloudSessionImport)
                }
                bare == "/session/status" -> respond(output, sessionStatusesStatus, sessionStatuses)
                bare == "/session" && method == "GET" -> respond(output, sessionsStatus, sessions)
                bare == "/session" && method == "POST" -> respond(output, sessionCreateStatus, sessionCreate)
                bare.matches(Regex("/session/ses_[^/]+")) && method == "GET" ->
                    respond(output, sessionGetStatus, sessionCreate)
                bare.matches(Regex("/session/ses_[^/]+")) && method == "DELETE" ->
                    respond(output, sessionDeleteStatus, "true")
                bare.matches(Regex("/session/ses_[^/]+")) && method == "PATCH" -> {
                    lastSessionRenamePath = path
                    lastSessionRenameBody = body
                    lastSessionRenameMethod = method
                    respond(output, sessionRenameStatus, sessionRenameResponse)
                }
                bare.matches(Regex("/session/ses_[^/]+/summarize")) && method == "POST" -> {
                    lastSummarizePath = path
                    lastSummarizeBody = body
                    respond(output, summarizeStatus, summarizeResponse)
                }
                bare.matches(Regex("/session/ses_[^/]+/prompt_async")) && method == "POST" -> {
                    lastPromptPath = path
                    lastPromptBody = body
                    respond(output, promptStatus, promptResponse)
                }
                bare == "/enhance-prompt" && method == "POST" -> {
                    lastEnhancePath = path
                    lastEnhanceBody = body
                    respond(output, enhanceStatus, enhanced)
                }
                else -> respond(output, 404, """{"error":"Not found"}""")
            }
        } catch (_: SocketException) {
            // Client disconnected
        } catch (_: Exception) {
            // Ignore errors in test mock
        }
    }

    private fun respond(writer: BufferedWriter, status: Int, body: String) {
        val phrase = when (status) {
            200 -> "OK"
            401 -> "Unauthorized"
            404 -> "Not Found"
            500 -> "Internal Server Error"
            else -> "Error"
        }
        val bytes = body.toByteArray(Charsets.UTF_8)
        writer.write("HTTP/1.1 $status $phrase\r\n")
        writer.write("Content-Type: application/json\r\n")
        writer.write("Content-Length: ${bytes.size}\r\n")
        writer.write("Connection: close\r\n")
        writer.write("\r\n")
        writer.write(body)
        writer.flush()
    }

    private fun mergeConfig(raw: String, patch: String): String {
        val base = runCatching { JSON.parseToJsonElement(raw).jsonObject.toMutableMap() }.getOrNull()
            ?: mutableMapOf()
        val next = runCatching { JSON.parseToJsonElement(patch).jsonObject }.getOrNull() ?: return raw
        for ((key, value) in next) {
            if (value is JsonNull) {
                base.remove(key)
                continue
            }
            base[key] = merge(base[key], value)
        }
        return JsonObject(base).toString()
    }

    private fun merge(base: JsonElement?, patch: JsonElement): JsonElement {
        if (base !is JsonObject || patch !is JsonObject) return patch
        val out = base.toMutableMap()
        for ((key, value) in patch) {
            if (value is JsonNull) {
                out.remove(key)
                continue
            }
            out[key] = merge(out[key], value)
        }
        return JsonObject(out)
    }

    private fun handleSse(writer: BufferedWriter, latch: CountDownLatch) {
        writer.write("HTTP/1.1 200 OK\r\n")
        writer.write("Content-Type: text/event-stream\r\n")
        writer.write("Cache-Control: no-cache\r\n")
        writer.write("Connection: keep-alive\r\n")
        writer.write("\r\n")
        writer.flush()
        sseWriter = writer
        sse.incrementAndGet()
        synchronized(streams) { streams.notifyAll() }
        sseConnected.countDown()
        // Block until SSE is closed or server shuts down
        latch.await()
    }

    private companion object {
        val JSON = Json { ignoreUnknownKeys = true }
    }
}
