package ai.kilocode.backend.app

import ai.kilocode.backend.cli.CliDownload
import ai.kilocode.backend.cli.CliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
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
 * Real-CLI end-to-end proof for the organization scope of a hosted attachment.
 *
 * Everything here is real except the Kilo Cloud control plane: a `bun dev serve` server from this
 * checkout runs as its own process, and a loopback HTTP stand-in answers the Cloud routes the CLI
 * forwards to (`/api/cloud-agent-next/token`, the `/kilo/session/...` reads, both SSE feeds) plus the
 * Kilo API routes its profile and notification proxies call. No account, no credential, and no
 * network egress outside loopback.
 *
 * The routes come from source rather than a guess:
 * - `KILO_API_URL` overrides the Kilo API origin (`packages/opencode/src/kilocode/cloud/origin.ts`)
 *   and accepts an explicit loopback address.
 * - `/kilo/profile` requires an `oauth` credential and returns `currentOrgId` from its `accountId`
 *   (`handlers/kilo-gateway.ts`), so the stand-in's shell credential is an `oauth` record carrying
 *   the organization the test wants to observe.
 * - `/kilo/organization` replaces that `accountId` and disposes the instances
 *   (`handlers/kilo-gateway.ts`, `organization`).
 * - The attachment carries the organization its mint used
 *   (`session-hosting/kilo-cloud.ts`, `attach`), and every routed native request forwards the entry's
 *   organization (`server/routes/hosted-routing.ts`, `resolve` / `respond`), so the organization a
 *   routed request carries is observable at the stand-in.
 *
 * Gated on `KILO_E2E_REAL_CLI` because it needs `bun` and a warm checkout: CI runs it as a skip, a
 * developer or the work VM runs it as the proof.
 */
class KiloBackendRealCliOrganizationTest {

    @Test
    fun `organization switch serves each organization from its own attachment`() {
        assumeTrue(
            System.getenv("KILO_E2E_REAL_CLI") != null,
            "set KILO_E2E_REAL_CLI=1 to run the real-CLI end-to-end organization proof",
        )

        val repo = repoRoot()
        val bun = findBun()
        val data = Files.createTempDirectory("kilo-e2e-org").toFile()
        val log = TestLog()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val password = "e2e-${UUID.randomUUID()}"
        val standIn = StandIn()
        val cli = CliProcess(repo, bun, data, password)
        var service: KiloBackendAppService? = null
        var leftover = emptyList<Long>()

        fun note(text: String) {
            println("[e2e-org] $text")
        }

        try {
            seedAuth(data, ORG_ONE)
            note("XDG_DATA_HOME=${data.absolutePath}")
            note("seeded kilo/auth.json for the first organization")
            standIn.start()
            note("cloud stand-in origin=${standIn.origin}")

            cli.start(standIn.origin)
            note("cli port=${cli.port} pid=${cli.process.pid()}")

            val svc = KiloBackendAppService.create(scope, FixedCliServer(cli.port, password), log)
            service = svc
            runBlocking {
                svc.connect()
                val ready = awaitReady(svc, APP_READY_TIMEOUT_MS, log)
                note("app ready: currentOrgId=${ready.data.profile?.currentOrgId ?: "none"}")

                // ------------------------------------ (1) the first organization's lease ----
                val session = HostedIDs.session(PROVIDER, WORKSPACE, SESSION)
                svc.hosted.retain(session, ORG_ONE)
                val firstMessages = svc.hosted.messages(session, ORG_ONE)
                assertEquals(1, firstMessages.size, "stand-in transcript should hold one message")
                note("first transcript through the lease: ${firstMessages.single().parts.single().text}")

                val first = attachmentsFrom(log)
                assertEquals(1, first.size, "expected exactly one attach before the switch: $first")
                assertEquals(
                    listOf(ORG_ONE),
                    standIn.tokenExchanges().map(::organizationOf),
                    "the first lease must be minted for the selected organization; log=${standIn.snapshot()}",
                )
                note("first lease=${first.single()} organization=${ORG_ONE}")

                // A hosted status has to exist before the switch, so the assertion after it cannot
                // hold merely because no status ever arrived.
                assertNotNull(
                    withTimeoutOrNull(10_000) { svc.hosted.statuses.first { it[session]?.type != null } },
                    "no hosted status arrived before the selection change",
                )
                note("hosted status observed before the switch: ${svc.hosted.statuses.value[session]}")

                // -------------------------------------------------- (2) switch the context ----
                standIn.select(ORG_TWO)
                svc.setOrganization(ORG_TWO)
                note("setOrganization switched the stand-in to the second organization")

                // The CLI's organization handler disposes its instances, which reloads the app and
                // stops the hosted manager. Wait for the reload before the next hosted call.
                val reloaded = awaitReady(svc, APP_READY_TIMEOUT_MS, log)
                note("app ready after the switch: currentOrgId=${reloaded.data.profile?.currentOrgId ?: "none"}")

                // The plugin detaches locally, through the CLI it drives, so the stand-in never sees
                // the DELETE. Ask the CLI's own lease registry instead: a disposed lease answers 410
                // (`server/routes/hosted-routing.ts`, `disposed`), which is the real boundary. Detach
                // is asynchronous, so poll until the registry settles.
                val firstFeed = first.single()
                val disposed = withTimeoutOrNull(10_000) {
                    while (cli.probeAttachment(firstFeed) != 410) delay(50)
                    true
                }
                assertEquals(
                    true,
                    disposed,
                    "the lease from the earlier context is still live in the CLI: " +
                        "lease=$firstFeed port=${cli.port}",
                )
                note("first lease is disposed at the CLI: $firstFeed")
                assertTrue(
                    svc.hosted.statuses.value.isEmpty(),
                    "hosted statuses survived the switch: ${svc.hosted.statuses.value}",
                )

                // --------------------------------- (3) a call now mints for the new organization ----
                val secondMessages = svc.hosted.messages(session, ORG_TWO)
                assertEquals(1, secondMessages.size, "the second organization's transcript should hold one message")
                note("second transcript through the new lease: ${secondMessages.single().parts.single().text}")

                val all = attachmentsFrom(log)
                assertEquals(2, all.size, "the switch must mint a new lease: $all")
                assertNotEquals(all[0], all[1], "both organizations must not share one lease")
                assertEquals(
                    listOf(ORG_ONE, ORG_TWO),
                    standIn.tokenExchanges().map(::organizationOf),
                    "each lease must be minted for the organization its caller asked for; log=${standIn.snapshot()}",
                )
                note("second lease=${all[1]} organization=${ORG_TWO}")

                // A routed native call carries the organization of its own lease.
                assertTrue(
                    standIn.routedOrganizations().contains(ORG_TWO),
                    "no routed request carried the second organization; log=${standIn.snapshot()}",
                )
                assertTrue(
                    standIn.routedOrganizations().last() == ORG_TWO,
                    "the newest routed request did not carry the switched organization: " +
                        "${standIn.routedOrganizations()}",
                )
            }
        } finally {
            runCatching { service?.shutdownForUnload() }
            scope.cancel()
            leftover = cli.stop()
            standIn.stop()
            println("[e2e-org] === evidence ===")
            println("[e2e-org] cli port: ${cli.port}")
            println("[e2e-org] cli processes started: ${leftover.size}")
            standIn.snapshot().filter { it.startsWith("REQ ") || it.startsWith("SSE ") || it.startsWith("RES #") }
                .forEach { println("[e2e-org] stand-in: $it") }
            println("[e2e-org] === end evidence ===")
            data.deleteRecursively()
        }

        assertTrue(leftover.isNotEmpty(), "the CLI process tree was not recorded for teardown")
        val alive = leftover.filter { handle -> ProcessHandle.of(handle).map { it.isAlive }.orElse(false) }
        assertTrue(alive.isEmpty(), "the spawned CLI tree outlived the test: $alive")
        assertFalsePort(cli.port)
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

    /** The organization a control-token exchange carried, from the request line the stand-in wrote. */
    private fun organizationOf(exchange: String): String = exchange.substringAfter("org=").substringBefore(" body=")

    private fun assertFalsePort(port: Int) {
        if (port == 0) return
        val open = runCatching { Socket().use { it.connect(InetSocketAddress("127.0.0.1", port), 500) } }.isSuccess
        assertTrue(!open, "the CLI still accepts connections on $port after teardown")
    }

    /** An `oauth` credential: `/kilo/organization` refuses anything else and `/kilo/profile` needs it. */
    private fun seedAuth(data: File, organization: String) {
        val dir = File(data, "kilo").apply { mkdirs() }
        val expires = Instant.now().plusSeconds(86_400).toEpochMilli()
        File(dir, "auth.json").writeText(
            """{"kilo":{"type":"oauth","refresh":"e2e-refresh","access":"e2e-access",""" +
                """"expires":$expires,"accountId":"$organization"}}""",
        )
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
     * `KILO_PARENT_PID` is deliberately left unset: production points it at the IDE, but `bun dev`
     * re-execs through `bun run`, so the watchdog's re-parenting heuristic would shut the server down
     * mid-test. This harness kills and verifies the whole process tree itself instead.
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
            }, "kilo-e2e-org-cli-output").apply { isDaemon = true }.start()

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

        /**
         * Status the CLI returns for a request routed through [attachment], using the server password
         * the plugin itself uses. 410 means the lease is disposed, 200 that it still serves.
         */
        fun probeAttachment(attachment: String): Int {
            val credentials = "$BASIC_USER:$password".toByteArray().let { java.util.Base64.getEncoder().encodeToString(it) }
            val connection = java.net.URI("http://127.0.0.1:$port/cloud-agent/event?workspace=$attachment")
                .toURL().openConnection() as java.net.HttpURLConnection
            connection.setRequestProperty("Authorization", "Basic $credentials")
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            return try {
                connection.responseCode
            } finally {
                connection.disconnect()
            }
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
     * Loopback stand-in for the Kilo Cloud control plane plus the Kilo API routes the CLI's profile
     * and notification proxies call. It mints control tokens only for the organization the test
     * selected, records every request, and reports the organization each routed request presented.
     */
    private class StandIn {
        private val pool = Executors.newCachedThreadPool { runnable ->
            Thread(runnable, "kilo-e2e-org-standin").apply { isDaemon = true }
        }
        private val server: HttpServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).also {
            it.executor = pool
        }
        private val requests: MutableList<String> = Collections.synchronizedList(mutableListOf())
        private val tokens: MutableMap<String, String> = Collections.synchronizedMap(mutableMapOf())
        private val streams: MutableList<HttpExchange> = Collections.synchronizedList(mutableListOf())
        private val sequence = AtomicLong()

        @Volatile
        private var organization: String = ORG_ONE

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

        /** The organization the account is switched to, so `/kilo/profile` reports it. */
        fun select(next: String) {
            organization = next
        }

        fun snapshot(): List<String> = synchronized(requests) { requests.toList() }

        /** Organization carried by each control-token exchange, in issue order. */
        fun tokenExchanges(): List<String> = snapshot()
            .filter { it.startsWith("REQ ") && it.contains("POST $TOKEN_PATH ") }
            .map { it.substringAfter("org=").substringBefore(" body=") }

        /** Organizations the routed native requests presented, in request order. */
        fun routedOrganizations(): List<String> = snapshot()
            .filter { it.startsWith("ROUTE ") }
            .map { it.substringAfter("org=").substringBefore(" path=") }

        private fun handle(exchange: HttpExchange) {
            val id = sequence.incrementAndGet()
            val method = exchange.requestMethod
            val path = exchange.requestURI.path
            val query = exchange.requestURI.query.orEmpty()
            val auth = exchange.requestHeaders.getFirst("authorization") ?: "(none)"
            val org = exchange.requestHeaders.getFirst("x-kilocode-organizationid")
                ?: Organization.find(query)
                ?: "(none)"
            val body = exchange.requestBody.readBytes().decodeToString()
            record("REQ #$id $method $path${if (query.isEmpty()) "" else "?$query"} auth=$auth org=$org body=${body.ifEmpty { "-" }}")
            try {
                route(exchange, id, method, path, query, auth, org, body)
            } catch (err: Throwable) {
                record("ERR #$id $method $path ${err::class.java.simpleName}: ${err.message}")
            } finally {
                runCatching { exchange.close() }
            }
        }

        private fun route(
            exchange: HttpExchange,
            id: Long,
            method: String,
            path: String,
            query: String,
            auth: String,
            org: String,
            body: String,
        ) {
            if (method == "POST" && path == TOKEN_PATH) {
                if (!auth.startsWith("Bearer ")) return json(exchange, id, method, path, 401, """{"error":"unauthorized"}""")
                // The organization the attach asked for is the organization this token grants.
                val minted = Organization.find(body) ?: org
                val token = "ctl_e2e_$id"
                tokens[token] = minted
                record("MINT #$id org=$minted")
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
                    """{"user":{"email":"e2e@example.com","name":"E2E"},"organizations":[],""" +
                        """"selectedOrganizationId":null,"hasPersonalAccount":true}""",
                )
            }
            if (method == "GET" && path == "/api/profile/balance") {
                return json(exchange, id, method, path, 200, """{"balance":0}""")
            }

            val control = auth.removePrefix("Bearer ")
            val granted = tokens[control]
            if (!auth.startsWith("Bearer ") || granted == null) {
                record("REJECT #$id $method $path caller did not present a control token minted by the issuer")
                return json(exchange, id, method, path, 401, """{"error":"KILO_UNAUTHORIZED"}""")
            }
            record("ROUTE #$id org=$granted path=$path")

            when {
                method == "GET" && path == "/kilo/session/$SESSION" ->
                    json(exchange, id, method, path, 200, SESSION_INFO)
                method == "GET" && path == "/kilo/session/$SESSION/message" ->
                    json(exchange, id, method, path, 200, TRANSCRIPT)
                // `attach` resolves workspace membership from this catalog before it mints a lease
                // (`session-hosting/kilo-cloud.ts`, `membership`); an empty page is also valid, but the
                // real catalog answer keeps the run on the same path production takes.
                method == "GET" && path == "/trpc/listHostedWorkspaces" ->
                    json(exchange, id, method, path, 200, workspacePage())
                method == "GET" && path == "/trpc/getHostedWorkspace" ->
                    json(exchange, id, method, path, 200, workspaceSummary())
                method == "GET" && path == "/kilo/session/status" ->
                    json(exchange, id, method, path, 200, """{"$SESSION":{"type":"idle"}}""")
                method == "GET" && path == "/kilo/event" ->
                    stream(exchange, id, path, listOf(FENCE))
                method == "GET" && path == "/kilo/cloud-agent/event" ->
                    stream(exchange, id, path, listOf(CLOUD_STATUS))
                else -> json(exchange, id, method, path, 404, """{"error":"KILO_NOT_FOUND","path":"$path"}""")
            }
        }

        /** The catalog page `membership` scans, holding exactly the session under test. */
        private fun workspacePage(): String =
            """{"result":{"data":{"items":[${workspaceSummaryBody()}],"nextCursor":null}}}"""

        private fun workspaceSummary(): String = """{"result":{"data":${workspaceSummaryBody()}}}"""

        private fun workspaceSummaryBody(): String =
            """{"workspaceId":"$WORKSPACE","userId":"user_e2e","organizationId":"$organization",""" +
                """"name":"Hosted E2E","repositoryProvider":"github","gitUrl":"https://example.invalid/e2e",""" +
                """"gitBranch":"main","profileId":null,"deletionState":"active","created":100,""" +
                """"updated":200,"lastActivity":200,"nextSessionCursor":null,"sessions":[""" +
                """{"kiloSessionId":"$SESSION","cloudAgentSessionId":"ca_$SESSION","workspaceId":"$WORKSPACE",""" +
                """"userId":"user_e2e","organizationId":"$organization","title":"Hosted E2E","gitUrl":null,""" +
                """"gitBranch":null,"profileId":null,"createdOnPlatform":"kilo-cli","created":100,"updated":200}]}"""

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

        private fun expiry(): String = EXPIRY.format(Instant.now().plusSeconds(3600))
    }

    private companion object {
        const val PROVIDER = "kilo-cloud"
        const val WORKSPACE = "ws_e2e"
        const val SESSION = "ses_e2e"
        /** The CLI validates an organization as a UUID before it will scope a request to it. */
        const val ORG_ONE = "11111111-1111-4111-8111-111111111111"
        const val ORG_TWO = "22222222-2222-4222-8222-222222222222"
        const val TRANSCRIPT_TEXT = "hello from the loopback Kilo Cloud stand-in"
        const val TOKEN_PATH = "/api/cloud-agent-next/token"
        /** The CLI's basic-auth user; the password is the one the harness sets for the server. */
        const val BASIC_USER = "kilo"
        const val CLI_READY_TIMEOUT_MS = 240_000L
        const val APP_READY_TIMEOUT_MS = 120_000L
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

    /** Extracts an organization id the attach query or the control-token body carried. */
    private object Organization {
        private val QUERY = """organizationID=([^&]+)""".toRegex()
        private val BODY = """"organizationId"\s*:\s*"([^"]+)"""".toRegex()

        fun find(text: String): String? =
            BODY.find(text)?.groupValues?.get(1) ?: QUERY.find(text)?.groupValues?.get(1)
    }
}
