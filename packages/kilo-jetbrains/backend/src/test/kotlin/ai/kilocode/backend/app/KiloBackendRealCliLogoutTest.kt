package ai.kilocode.backend.app

import ai.kilocode.backend.cli.CliDownload
import ai.kilocode.backend.cli.CliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.jetbrains.api.infrastructure.ClientException
import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.jupiter.api.Assumptions.assumeTrue
import java.io.File
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.file.Files
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Collections
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Real-CLI end-to-end proof for sign-out.
 *
 * Everything here is real except the Kilo Cloud control plane: a `bun dev serve` server from this
 * checkout runs as its own process, and a loopback HTTP stand-in answers the Cloud routes the CLI
 * forwards to (`/api/cloud-agent-next/token`, `/kilo/session/...`, the two SSE feeds) plus the Kilo
 * API route its notification proxy calls. No account, no credential and no network egress outside
 * loopback.
 *
 * Upstream routes, read from source rather than guessed:
 * - `KILO_API_URL` is the only override for the Kilo API origin
 *   (`packages/opencode/src/kilocode/cloud/origin.ts`, `resolveKiloApiOrigin`), and it accepts an
 *   explicit `http://127.0.0.1` loopback.
 * - The CLI's `/kilo/notifications` proxy calls `${KILO_API_URL}/api/users/notifications` and expects
 *   `{notifications: [...]}` (`packages/kilo-gateway/src/api/notifications.ts`), so the stand-in
 *   answers `{"notifications":[]}`.
 * - The CLI's `/kilo/profile` proxy requires an `oauth` credential before it calls
 *   `${KILO_API_URL}/api/profile` (`handlers/kilo-gateway.ts`, `profile`). A seeded `api` key therefore
 *   answers 401 there, which the app service documents as "profile is optional" — startup still
 *   reaches Ready, so the stand-in's `/api/profile` route is never exercised by this test.
 * - The Cloud routes are the ones `native-routes.ts` forwards to, gated behind a control token minted
 *   by `POST /api/cloud-agent-next/token` (`cloud/control-token.ts`).
 *
 * Gated on `KILO_E2E_REAL_CLI` because it needs `bun` and a warm checkout: CI runs it as a skip, a
 * developer or the work VM runs it as the proof.
 */
class KiloBackendRealCliLogoutTest {

    @Test
    fun `signing out empties hosted state and the next sign in reattaches`() {
        assumeTrue(
            System.getenv("KILO_E2E_REAL_CLI") != null,
            "set KILO_E2E_REAL_CLI=1 to run the real-CLI end-to-end sign-out proof",
        )

        val repo = repoRoot()
        val bun = findBun()
        val data = Files.createTempDirectory("kilo-e2e-data").toFile()
        val log = TestLog()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val password = "e2e-${UUID.randomUUID()}"
        val standIn = StandIn()
        val cli = CliProcess(repo, bun, data, password)
        var service: KiloBackendAppService? = null
        var leftover = emptyList<Long>()

        fun note(text: String) {
            println("[e2e] $text")
        }

        try {
            // ------------------------------------------------------------ fixture ----
            seedAuth(data, KEY_ONE)
            note("XDG_DATA_HOME=${data.absolutePath}")
            note("seeded kilo/auth.json with account one key")
            standIn.start()
            note("cloud stand-in origin=${standIn.origin}")

            // ---------------------------------------------------------------- CLI ----
            cli.start(standIn.origin)
            note("cli port=${cli.port} pid=${cli.process.pid()} password=${password.take(4)}<redacted>")

            // ------------------------------------------------------------- plugin ----
            val svc = KiloBackendAppService.create(scope, FixedCliServer(cli.port, password), log)
            service = svc
            runBlocking {
                svc.connect()
                val ready = awaitReady(svc, APP_READY_TIMEOUT_MS, log)
                note("app ready: profile=${ready.data.profile?.profile?.email ?: "none"} " +
                    "notifications=${ready.data.notifications.size}")

                // ------------------------------------------------ (1) live hosted state ----
                val session = HostedIDs.session(PROVIDER, WORKSPACE, SESSION)
                val ref = HostedWorkspaceRefDto(PROVIDER, WORKSPACE)
                svc.hosted.retain(session, null)
                val systemEvent = withTimeoutOrNull(HOSTED_TIMEOUT_MS) {
                    svc.hosted.systemEvents(ref, SESSION, null).first { it.kind == "cloud.status" }
                }
                assertNotNull(
                    systemEvent,
                    "the /cloud-agent/event feed never delivered a system event; logs=${log.messages.takeLast(40)}",
                )
                note("system event: kind=${systemEvent.kind} cloudStatus=${systemEvent.cloudStatus} " +
                    "message=${systemEvent.message}")

                val statuses = withTimeoutOrNull(HOSTED_TIMEOUT_MS) {
                    svc.hosted.statuses.first { it[session] != null }
                }
                assertNotNull(
                    statuses,
                    "the /event feed never delivered its snapshot fence; logs=${log.messages.takeLast(40)}",
                )
                note("hosted status after fence: ${statuses[session]}")

                val firstMessages = svc.hosted.messages(session, null)
                assertEquals(1, firstMessages.size, "stand-in transcript should hold one message")
                assertEquals(session, firstMessages.single().info.sessionID)
                assertEquals(TRANSCRIPT_TEXT, firstMessages.single().parts.single().text)
                note("transcript through the attachment: ${firstMessages.single().parts.single().text}")
                assertTrue(
                    standIn.hasRequest("GET", "/kilo/event") && standIn.hasRequest("GET", "/kilo/cloud-agent/event"),
                    "both hosted SSE feeds must be open through the CLI; log=${standIn.snapshot()}",
                )
                assertTrue(
                    standIn.hasRequest("GET", "/api/users/notifications"),
                    "the app load must reach the stand-in Kilo API stub, not the real one; log=${standIn.snapshot()}",
                )

                // ---------------------------------------------------- (2) sign out ----
                assertTrue(svc.logout(), "logout() reported a refused credential removal")
                note("logout() -> true")
                assertTrue(
                    svc.hosted.statuses.value.isEmpty(),
                    "hosted statuses survived sign-out: ${svc.hosted.statuses.value}",
                )
                note("hosted statuses after sign-out: ${svc.hosted.statuses.value}")
                val failure = runCatching { svc.hosted.messages(session, null) }.exceptionOrNull()
                assertNotNull(failure, "the retained hosted transcript still loaded after sign-out")
                val rejected = (failure is ClientException && failure.statusCode == 401) ||
                    failure.message?.contains("401") == true ||
                    failure.message?.contains("UnauthorizedError") == true
                assertTrue(rejected, "sign-out must be rejected as unauthorized, got ${failure::class.java.name}: ${failure.message}")
                note("transcript after sign-out: ${failure::class.java.name}: ${failure.message}")
                assertEquals(
                    1, standIn.tokenExchanges().size,
                    "a signed-out session must not exchange a control token; log=${standIn.snapshot()}",
                )
                val firstAttachments = attachmentsFrom(log)
                assertEquals(1, firstAttachments.size, "expected exactly one plugin attach before sign-out: $firstAttachments")
                note("attachment before sign-out: ${firstAttachments.single()}")

                // ------------------------------------------------ (3) next sign in ----
                seedAuth(data, KEY_TWO)
                note("seeded kilo/auth.json with account two key")
                awaitReady(svc, APP_READY_TIMEOUT_MS, log)
                svc.hosted.retain(session, null)
                val secondMessages = svc.hosted.messages(session, null)
                assertEquals(1, secondMessages.size, "the re-attached stand-in transcript should hold one message")
                assertEquals(TRANSCRIPT_TEXT, secondMessages.single().parts.single().text)
                note("transcript after re-sign-in: ${secondMessages.single().parts.single().text}")

                val secondAttachments = attachmentsFrom(log)
                assertEquals(2, secondAttachments.size, "expected a second plugin attach after re-sign-in: $secondAttachments")
                assertNotEquals(
                    secondAttachments[0], secondAttachments[1],
                    "the second sign-in must mint a fresh attachment, not reuse the signed-out one",
                )
                note("attachment after re-sign-in: ${secondAttachments[1]}")

                val exchanges = standIn.tokenExchanges()
                assertEquals(2, exchanges.size, "expected one control-token exchange per sign-in; log=${standIn.snapshot()}")
                assertEquals("Bearer $KEY_ONE", exchanges[0], "first exchange must use the first account key")
                assertEquals("Bearer $KEY_TWO", exchanges[1], "second exchange must use the second account key")

                // A session read carrying the token minted from the second account key can only come
                // from a genuinely fresh attach: the first attach used the first key's token.
                val minted = standIn.mintedTokens()
                assertEquals(2, minted.size, "expected one control token per attach; log=${standIn.snapshot()}")
                assertNotEquals(minted[0], minted[1], "the second attach must not reuse the first control token")
                assertTrue(
                    standIn.hasRequestWithAuth("GET", "/kilo/session/$SESSION", minted[0]),
                    "the first attach never read the session with its own token; log=${standIn.snapshot()}",
                )
                assertTrue(
                    standIn.hasRequestWithAuth("GET", "/kilo/session/$SESSION", minted[1]),
                    "the second attach never read the session with the token minted from the new key: " +
                        "minted=$minted log=${standIn.snapshot()}",
                )
            }
        } finally {
            runCatching { service?.shutdownForUnload() }
            scope.cancel()
            leftover = cli.stop()
            standIn.stop()
            val alive = leftover.filter { handle -> ProcessHandle.of(handle).map { it.isAlive }.orElse(false) }
            println("[e2e] === evidence ===")
            println("[e2e] cli port: ${cli.port}")
            println("[e2e] cli processes started: ${leftover.size}; still alive after teardown: $alive")
            standIn.snapshot().filter { it.startsWith("REQ ") || it.startsWith("SSE ") || it.startsWith("RES #") }
                .forEach { println("[e2e] stand-in: $it") }
            println("[e2e] === end evidence ===")
            assertTrue(alive.isEmpty(), "the spawned CLI tree outlived the test: $alive")
            assertFalsePort(cli.port)
            data.deleteRecursively()
        }
    }

    // ------------------------------------------------------------------ helpers ----

    private suspend fun awaitReady(service: KiloBackendAppService, timeoutMs: Long, log: TestLog): KiloAppState.Ready {
        val state = withTimeoutOrNull(timeoutMs) {
            service.appState.first {
                it is KiloAppState.Ready || it is KiloAppState.Error || it is KiloAppState.MigrationRequired
            }
        }
        assertNotNull(state, "app state never settled; current=${service.appState.value}; logs=${log.messages.takeLast(40)}")
        return assertIs<KiloAppState.Ready>(state, "app startup did not reach Ready: $state; logs=${log.messages.takeLast(40)}")
    }

    /** Attachment ids the plugin minted, in order, from its own log lines. */
    private fun attachmentsFrom(log: TestLog): List<String> =
        log.messages.filter { it.contains("hosted attach session=") }
            .mapNotNull { ATTACHMENT.find(it)?.groupValues?.get(1) }

    private fun assertFalsePort(port: Int) {
        if (port == 0) return
        val open = runCatching { Socket().use { it.connect(InetSocketAddress("127.0.0.1", port), 500) } }.isSuccess
        assertTrue(!open, "the CLI still accepts connections on $port after teardown")
    }

    private fun seedAuth(data: File, key: String) {
        val dir = File(data, "kilo").apply { mkdirs() }
        File(dir, "auth.json").writeText("""{"kilo":{"type":"api","key":"$key"}}""")
    }

    private fun repoRoot(): File {
        System.getenv("KILO_E2E_REPO_ROOT")?.takeIf { it.isNotBlank() }?.let { return File(it) }
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            if (File(dir, "package.json").isFile && File(dir, "packages/opencode/src/index.ts").isFile) return dir
            dir = dir.parentFile
        }
        throw AssertionError(
            "could not locate the repository root from ${System.getProperty("user.dir")}; set KILO_E2E_REPO_ROOT",
        )
    }

    private fun findBun(): File {
        System.getenv("KILO_E2E_BUN")?.takeIf { it.isNotBlank() }?.let { return File(it) }
        val name = if (System.getProperty("os.name").orEmpty().startsWith("Windows")) "bun.exe" else "bun"
        return System.getenv("PATH").orEmpty().split(File.pathSeparator)
            .filter { it.isNotBlank() }
            .map { File(it, name) }
            .firstOrNull { it.isFile && it.canExecute() }
            ?: throw AssertionError("bun was not found on PATH; set KILO_E2E_BUN to the bun executable")
    }

    /** Returns the port the test supplied, so the app service never spawns a CLI of its own. */
    private class FixedCliServer(private val port: Int, private val password: String) : CliServer {
        override var forceExtract = false

        override fun process(): Process? = null

        override suspend fun init(onProgress: (CliDownload) -> Unit, onResolved: () -> Unit): CliServer.State {
            onResolved()
            return CliServer.State.Ready(port, password)
        }

        override fun exited(proc: Process) {}

        override fun stop() {}

        override fun dispose() {}
    }

    /**
     * The real `bun dev serve --port 0` from this checkout.
     *
     * `KILO_PARENT_PID` is deliberately left unset: production points it at the IDE so a hard-killed
     * client cannot orphan the CLI, but `bun dev` re-execs through `bun run`, and the watchdog's
     * re-parenting heuristic would then shut the server down mid-test. This harness kills and
     * verifies the whole process tree itself instead.
     */
    private class CliProcess(
        private val repo: File,
        private val bun: File,
        private val data: File,
        private val password: String,
    ) {
        private val output: MutableList<String> = Collections.synchronizedList(mutableListOf())
        lateinit var process: Process
            private set
        var port: Int = 0
            private set
        private var pids: List<Long> = emptyList()

        fun start(standIn: String) {
            val env = HashMap(System.getenv())
            listOf("KILO_AUTH_CONTENT", "KILO_API_KEY", "KILO_ORG_ID").forEach(env::remove)
            env["XDG_DATA_HOME"] = data.absolutePath
            env["CLOUD_AGENT_NEXT_BASE_URL"] = standIn
            env["KILO_WEB_APP_URL"] = standIn
            env["KILO_API_URL"] = standIn
            env["KILO_SERVER_PASSWORD"] = password
            env["KILO_DISABLE_AUTOUPDATE"] = "1"
            env["KILO_DISABLE_MODELS_FETCH"] = "1"
            env["KILO_DISABLE_SESSION_INGEST"] = "1"
            env["KILO_TELEMETRY_LEVEL"] = "off"

            val builder = ProcessBuilder(bun.absolutePath, "dev", "serve", "--port", "0")
                .directory(repo)
                .redirectErrorStream(true)
            builder.environment().clear()
            builder.environment().putAll(env)
            val started = builder.start()
            process = started
            pids = buildList {
                add(started.pid())
                started.descendants().forEach { add(it.pid()) }
            }
            Thread({
                runCatching {
                    started.inputStream.bufferedReader().forEachLine { line ->
                        output.add(line)
                        println("[cli] $line")
                    }
                }
            }, "kilo-e2e-cli-output").apply { isDaemon = true }.start()

            val announcement = awaitOutput(CLI_READY_TIMEOUT_MS) { it.contains("kilo server listening on http://") }
                ?: throw AssertionError(
                    "the CLI never announced its port within ${CLI_READY_TIMEOUT_MS}ms; " +
                        "alive=${started.isAlive} output=${output.takeLast(60)}",
                )
            port = LISTENING.find(announcement)?.groupValues?.get(1)?.toInt()
                ?: throw AssertionError("could not parse the CLI port from '$announcement'")
            assertTrue(started.isAlive, "the CLI exited right after announcing port $port; output=${output.takeLast(40)}")
        }

        /** Kills the tree and returns every PID it started, so the caller can prove none survived. */
        fun stop(): List<Long> {
            if (pids.isEmpty() && !this::process.isInitialized) return emptyList()
            // Snapshot the tree before signalling: `bun dev` re-execs, so the server is a descendant
            // that appeared after start().
            val tree = LinkedHashSet<Long>()
            ProcessHandle.of(process.pid()).ifPresent { root ->
                tree.add(root.pid())
                root.descendants().forEach { tree.add(it.pid()) }
            }
            if (tree.isEmpty()) tree.addAll(pids)
            tree.forEach { pid -> ProcessHandle.of(pid).ifPresent { runCatching { it.destroy() } } }
            if (!process.waitFor(8, TimeUnit.SECONDS)) {
                tree.forEach { pid -> ProcessHandle.of(pid).ifPresent { runCatching { it.destroyForcibly() } } }
                process.waitFor(8, TimeUnit.SECONDS)
            }
            return tree.toList()
        }

        private fun awaitOutput(timeoutMs: Long, predicate: (String) -> Boolean): String? {
            val deadline = System.currentTimeMillis() + timeoutMs
            while (System.currentTimeMillis() < deadline) {
                synchronized(output) { output.firstOrNull(predicate) }?.let { return it }
                if (!process.isAlive) return null
                Thread.sleep(100)
            }
            return null
        }
    }

    /**
     * Loopback stand-in for the Kilo Cloud control plane plus the one Kilo API route the CLI's
     * notification proxy calls. It serves exactly what the `kilo-cloud` provider needs, gates every
     * worker read behind a control token it minted itself, and records each request so the test can
     * prove which account credential drove which attach.
     */
    private class StandIn {
        private val pool = Executors.newCachedThreadPool { runnable ->
            Thread(runnable, "kilo-e2e-standin").apply { isDaemon = true }
        }
        private val server: HttpServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).also {
            it.executor = pool
        }
        private val requests: MutableList<String> = Collections.synchronizedList(mutableListOf())
        private val tokens: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())
        private val streams: MutableList<HttpExchange> = Collections.synchronizedList(mutableListOf())
        private val issued: MutableList<String> = Collections.synchronizedList(mutableListOf())
        private val sequence = AtomicLong()
        @Volatile
        private var stopped = false

        val origin: String = "http://127.0.0.1:${server.address.port}"

        fun start() {
            server.createContext("/", ::handle)
            server.start()
        }

        fun stop() {
            stopped = true
            streams.toList().forEach { runCatching { it.close() } }
            streams.clear()
            server.stop(0)
            pool.shutdownNow()
        }

        fun snapshot(): List<String> = synchronized(requests) { requests.toList() }

        /** Authorization headers of every control-token exchange, in order. */
        fun tokenExchanges(): List<String> = snapshot()
            .filter { it.startsWith("REQ ") && it.contains("POST $TOKEN_PATH ") }
            .map { it.substringAfter("auth=").substringBefore(" body=") }

        fun hasRequest(method: String, path: String): Boolean = indexOf(request(method, path)) >= 0

        /** Control tokens the stand-in issued, in issue order. */
        fun mintedTokens(): List<String> = synchronized(issued) { issued.toList() }

        fun hasRequestWithAuth(method: String, path: String, token: String): Boolean =
            snapshot().any { line ->
                request(method, path).containsMatchIn(line.substringBefore(" auth=")) &&
                    line.substringAfter(" auth=").startsWith("Bearer $token ")
            }

        fun indexOf(pattern: Regex): Int = snapshot().indexOfFirst { pattern.containsMatchIn(it) }

        private fun request(method: String, path: String) =
            """REQ #\d+ ${Regex.escape(method)} ${Regex.escape(path)}(?:[? ]|$)""".toRegex()

        private fun handle(exchange: HttpExchange) {
            val id = sequence.incrementAndGet()
            val method = exchange.requestMethod
            val path = exchange.requestURI.path
            val query = exchange.requestURI.query.orEmpty()
            val auth = exchange.requestHeaders.getFirst("authorization") ?: "(none)"
            val body = exchange.requestBody.readBytes().decodeToString()
            record("REQ #$id $method $path${if (query.isEmpty()) "" else "?$query"} auth=$auth body=${body.ifEmpty { "-" }}")
            try {
                route(exchange, id, method, path, auth)
            } catch (err: Throwable) {
                record("ERR #$id $method $path ${err::class.java.simpleName}: ${err.message}")
            } finally {
                runCatching { exchange.close() }
            }
        }

        private fun route(exchange: HttpExchange, id: Long, method: String, path: String, auth: String) {
            if (method == "POST" && path == TOKEN_PATH) {
                if (!auth.startsWith("Bearer ")) return json(exchange, id, method, path, 401, """{"error":"unauthorized"}""")
                val token = "ctl_e2e_$id"
                tokens.add(token)
                issued.add(token)
                return json(
                    exchange, id, method, path, 200,
                    """{"token":"$token","expiresAt":"${expiry()}"}""",
                )
            }
            // Kilo API surfaces the CLI proxies with the account credential, not a control token.
            if (method == "GET" && path == "/api/users/notifications") {
                return json(exchange, id, method, path, 200, """{"notifications":[]}""")
            }
            if (method == "GET" && path == "/api/profile") {
                return json(
                    exchange, id, method, path, 200,
                    """{"user":{"email":"e2e@example.com","name":"E2E"},"organizations":[],"selectedOrganizationId":null}""",
                )
            }

            val control = auth.removePrefix("Bearer ")
            if (!auth.startsWith("Bearer ") || control !in tokens) {
                record("REJECT #$id $method $path caller did not present a control token minted by the issuer")
                return json(exchange, id, method, path, 401, """{"error":"KILO_UNAUTHORIZED"}""")
            }

            when {
                method == "GET" && path == "/kilo/session/$SESSION" ->
                    json(exchange, id, method, path, 200, SESSION_INFO)
                method == "GET" && path == "/kilo/session/$SESSION/message" ->
                    json(exchange, id, method, path, 200, TRANSCRIPT)
                method == "GET" && path == "/trpc/listHostedWorkspaces" ->
                    json(exchange, id, method, path, 200, """{"result":{"data":{"items":[],"nextCursor":null}}}""")
                method == "GET" && path == "/kilo/session/status" ->
                    json(exchange, id, method, path, 200, """{"$SESSION":{"type":"idle"}}""")
                method == "GET" && path == "/kilo/event" ->
                    stream(exchange, id, path, listOf(FENCE))
                method == "GET" && path == "/kilo/cloud-agent/event" ->
                    stream(exchange, id, path, listOf(CLOUD_STATUS))
                else -> json(exchange, id, method, path, 404, """{"error":"KILO_NOT_FOUND","path":"$path"}""")
            }
        }

        private fun json(exchange: HttpExchange, id: Long, method: String, path: String, status: Int, body: String) {
            val bytes = body.toByteArray()
            exchange.responseHeaders.add("content-type", "application/json")
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
            record("RES #$id $method $path -> $status")
        }

        /**
         * Holds one SSE exchange open on its own pool thread. The body is never closed early: the
         * client sees a live feed until [stop] closes it.
         */
        private fun stream(exchange: HttpExchange, id: Long, path: String, frames: List<String>) {
            exchange.responseHeaders.add("content-type", "text/event-stream")
            exchange.responseHeaders.add("cache-control", "no-cache, no-transform")
            exchange.sendResponseHeaders(200, 0)
            streams.add(exchange)
            record("SSE #$id GET $path open")
            try {
                val out = exchange.responseBody
                out.write(": $path open\n\n".toByteArray())
                frames.forEach { out.write("data: $it\n\n".toByteArray()) }
                out.flush()
                while (!stopped) {
                    Thread.sleep(200)
                    out.write(": $path keep-alive\n\n".toByteArray())
                    out.flush()
                }
            } catch (err: IOException) {
                record("SSE #$id GET $path closed: ${err::class.java.simpleName}")
            } finally {
                streams.remove(exchange)
                runCatching { exchange.close() }
            }
        }

        private fun record(line: String) {
            requests.add(line)
            println("[stand-in] $line")
        }

        private fun expiry(): String =
            EXPIRY.format(Instant.now().plusSeconds(3600))
    }

    private companion object {
        const val PROVIDER = "kilo-cloud"
        const val WORKSPACE = "ws_e2e"
        const val SESSION = "ses_e2e"
        const val KEY_ONE = "e2e-account-one"
        const val KEY_TWO = "e2e-account-two"
        const val TRANSCRIPT_TEXT = "hello from the loopback Kilo Cloud stand-in"
        const val TOKEN_PATH = "/api/cloud-agent-next/token"
        const val CLI_READY_TIMEOUT_MS = 240_000L
        const val APP_READY_TIMEOUT_MS = 120_000L
        const val HOSTED_TIMEOUT_MS = 60_000L
        val LISTENING = """kilo server listening on http://[\d.]+:(\d+)""".toRegex()
        val ATTACHMENT = """attachment=(\S+)""".toRegex()
        val EXPIRY: DateTimeFormatter =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSX").withZone(ZoneOffset.UTC)

        const val SESSION_INFO =
            """{"id":"ses_e2e","slug":"ses_e2e","projectID":"cloud-agent",""" +
                """"directory":"/cloud-agent/sessions/ses_e2e","title":"Hosted E2E","version":"cloud-agent",""" +
                """"time":{"created":100,"updated":200}}"""

        const val TRANSCRIPT =
            """[{"info":{"id":"msg_e2e_1","sessionID":"ses_e2e","role":"user","time":{"created":1000},""" +
                """"agent":"code","model":{"providerID":"kilo","modelID":"kilo/e2e-standin"}},"parts":[""" +
                """{"id":"prt_e2e_1","sessionID":"ses_e2e","messageID":"msg_e2e_1","type":"text",""" +
                """"text":"$TRANSCRIPT_TEXT"}]}]"""

        const val FENCE =
            """{"payload":{"type":"kilo.native.fence","properties":{"fence":3,"generation":2,"snapshotComplete":true}}}"""

        const val CLOUD_STATUS =
            """{"payload":{"type":"cloud.status","properties":{"sessionID":"ses_e2e","observedAt":1700000000000,""" +
                """"cloudStatus":{"type":"running","message":"preparing sandbox"}}}}"""
    }
}
