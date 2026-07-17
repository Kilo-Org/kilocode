package ai.kilocode.backend.app

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.cli.CliServer
import ai.kilocode.backend.cli.CliDownload
import ai.kilocode.backend.rpc.appStateDto
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.AgentConfigPatchDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.assertContains

class KiloBackendAppServiceTest {

    private val mock = MockCliServer()
    private val log = TestLog()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @AfterTest
    fun tearDown() {
        scope.cancel()
        mock.close()
    }

    private fun create(loadTimeoutMs: Long = 30_000L): KiloBackendAppService =
        KiloBackendAppService.create(scope, FakeCliServer(mock), log, loadTimeoutMs)

    private suspend fun ready(svc: KiloBackendAppService): KiloAppState.Ready {
        val state = assertNotNull(
            withTimeoutOrNull(35_000) {
                svc.appState.first {
                    it is KiloAppState.Ready || it is KiloAppState.Error || it is KiloAppState.MigrationRequired
                }
            },
            "App startup timed out in ${svc.appState.value}; logs=${log.messages}",
        )
        return assertIs<KiloAppState.Ready>(state, "App startup failed in $state; logs=${log.messages}")
    }

    private class StallingServer(private val mock: MockCliServer) : CliServer {
        override var forceExtract = false
        private val starts = AtomicInteger()
        private var srv: ServerSocket? = null

        val count: Int get() = starts.get()

        override fun process(): Process? = null

        override suspend fun init(onProgress: (CliDownload) -> Unit, onResolved: () -> Unit): CliServer.State {
            onResolved()
            if (starts.getAndIncrement() == 0) {
                val socket = ServerSocket(0)
                srv = socket
                return CliServer.State.Ready(socket.localPort, mock.password)
            }
            return CliServer.State.Ready(mock.start(), mock.password)
        }

        override fun exited(proc: Process) {}

        override fun stop() {
            srv?.close()
            srv = null
            mock.shutdown()
        }

        override fun dispose() {
            stop()
            mock.close()
        }
    }

    @Test
    fun `full lifecycle reaches Ready`() = runBlocking {
        val svc = create()
        svc.connect()

        ready(svc)

        val ready = svc.appState.value as KiloAppState.Ready
        assertNotNull(ready.data.config)
        assertNotNull(ready.data.notifications)
    }

    @Test
    fun `download progress maps to app state before ready`() = runBlocking {
        val resolved = CompletableDeferred<Unit>()
        val signal = CompletableDeferred<Unit>()
        val server = object : CliServer {
            override var forceExtract = false
            override fun process(): Process? = null
            override suspend fun init(onProgress: (CliDownload) -> Unit, onResolved: () -> Unit): CliServer.State {
                onProgress(CliDownload(37, "1.2.3", "darwin-arm64"))
                resolved.await()
                onResolved()
                signal.await()
                return CliServer.State.Ready(mock.start(), mock.password)
            }
            override fun exited(proc: Process) {}
            override fun stop() {}
            override fun dispose() {}
        }
        val svc = KiloBackendAppService.create(scope, server, log)
        val job = scope.launch { svc.connect() }

        val downloading = withTimeout(5_000) {
            svc.appState.first { it is KiloAppState.Downloading }
        }
        assertEquals(KiloAppState.Downloading(37, "1.2.3", "darwin-arm64"), downloading)
        val dto = appStateDto(downloading)
        assertEquals(37, dto.downloadPercent)
        assertEquals("1.2.3", dto.downloadVersion)
        assertEquals("darwin-arm64", dto.downloadPlatform)

        resolved.complete(Unit)
        withTimeout(5_000) {
            svc.appState.first { it == KiloAppState.Connecting }
        }

        signal.complete(Unit)
        ready(svc)
        job.join()
    }

    @Test
    fun `shutdown for unload clears runtime and disposes server once`() = runBlocking {
        val server = FakeCliServer(mock)
        val svc = KiloBackendAppService.create(scope, server, log)
        svc.connect()

        ready(svc)

        svc.shutdownForUnload()
        svc.shutdownForUnload()
        svc.dispose()

        assertEquals(KiloAppState.Disconnected, svc.appState.value)
        assertNull(svc.profile)
        assertNull(svc.config)
        assertTrue(svc.notifications.isEmpty())
        assertTrue(svc.warnings.isEmpty())
        assertEquals(1, server.disposeCount)
    }

    @Test
    fun `shutdown for app close fast-closes server once without blocking dispose`() {
        val server = FakeCliServer(mock)
        val svc = KiloBackendAppService.create(scope, server, log)

        svc.shutdownForAppClose()
        svc.shutdownForAppClose()
        svc.dispose()

        assertEquals(KiloAppState.Disconnected, svc.appState.value)
        // App close uses the non-blocking fast path, not the confirming dispose path.
        assertEquals(1, server.closeCount)
        assertEquals(0, server.disposeCount)
    }

    @Test
    fun `config is loaded`() = runBlocking {
        mock.config = """{"model":"claude-4","username":"testuser"}"""
        val svc = create()
        svc.connect()

        ready(svc)

        assertNotNull(svc.config)
        assertEquals("claude-4", svc.config!!.model)
    }

    @Test
    fun `update config patches model selections and reloads`() = runBlocking {
        val svc = create()
        svc.connect()
        ready(svc)

        val state = svc.updateConfig(ConfigPatchDto(
            values = linkedMapOf(
                "model" to "openai/gpt-5",
                "small_model" to "openai/gpt-5-mini",
                "subagent_model" to "anthropic/claude",
                "subagent_variant" to "high",
            ),
            agents = linkedMapOf("code" to AgentConfigPatchDto(model = "google/gemini", variant = "fast")),
        ))

        assertEquals(
            "{\"model\":\"openai/gpt-5\",\"small_model\":\"openai/gpt-5-mini\",\"subagent_model\":\"anthropic/claude\",\"subagent_variant\":\"high\",\"agent\":{\"code\":{\"model\":\"google/gemini\",\"variant\":\"fast\"}}}",
            mock.lastConfigPatchBody,
        )
        val cfg = appStateDto(state).config
        assertEquals("openai/gpt-5", cfg?.model)
        assertEquals("openai/gpt-5-mini", cfg?.smallModel)
        assertEquals("anthropic/claude", cfg?.subagentModel)
        assertEquals("high", cfg?.subagentVariant)
        assertEquals("google/gemini", cfg?.agent?.get("code")?.model)
        assertEquals("fast", svc.config?.agent?.get("code")?.variant)
    }

    @Test
    fun `ready dto maps model config`() = runBlocking {
        mock.config = """{"model":"openai/gpt","agent":{"plan":{"model":"anthropic/claude","variant":"high"}}}"""
        val svc = create()
        svc.connect()

        ready(svc)

        val dto = appStateDto(svc.appState.value)
        assertEquals("openai/gpt", dto.config?.model)
        assertEquals("anthropic/claude", dto.config?.agent?.get("plan")?.model)
        assertEquals("high", dto.config?.agent?.get("plan")?.variant)
    }

    @Test
    fun `mcp config is populated end to end`() = runBlocking {
        mock.config = """{"mcp":{"sample":{"type":"local","command":["node","s.js"]},"remote":{"type":"remote","url":"https://mcp.example.test"}}}"""
        val svc = create()
        svc.connect()

        ready(svc)

        val dto = appStateDto(svc.appState.value)
        assertEquals(listOf("node", "s.js"), dto.config?.mcp?.get("sample")?.command)
        assertEquals("https://mcp.example.test", dto.config?.mcp?.get("remote")?.url)
        assertEquals(listOf("node", "s.js"), svc.config?.mcp?.get("sample")?.command)
    }

    @Test
    fun `agent config is populated end to end`() = runBlocking {
        mock.config = """{"agent":{"build":{"model":"openai/gpt","mode":"subagent","permission":{"edit":"ask"}}}}"""
        val svc = create()
        svc.connect()

        ready(svc)

        val dto = appStateDto(svc.appState.value)
        assertEquals("openai/gpt", dto.config?.agent?.get("build")?.model)
        assertEquals("subagent", dto.config?.agent?.get("build")?.mode)
        assertNotNull(dto.config?.agent?.get("build")?.permission?.get("edit"))
    }

    @Test
    fun `disabled mcp config is populated end to end`() = runBlocking {
        mock.config = """{"mcp":{"sample":{"enabled":false}}}"""
        val svc = create()
        svc.connect()

        ready(svc)

        val mcp = appStateDto(svc.appState.value).config?.mcp?.get("sample")
        assertNotNull(mcp)
        assertNull(mcp.type)
        assertEquals(false, mcp.enabled)
    }

    @Test
    fun `malformed config body still reaches Ready`() = runBlocking {
        mock.config = "garbage"
        val svc = create()
        svc.connect()

        ready(svc)

        assertNull(svc.config?.model)
        assertTrue(svc.config?.mcp?.isEmpty() == true)
    }

    @Test
    fun `config warnings are loaded without blocking Ready`() = runBlocking {
        mock.warnings = """[{"path":".kilo/kilo.json","message":"Invalid JSON","detail":"CloseBraceExpected"}]"""
        val svc = create()
        svc.connect()

        ready(svc)

        val ready = svc.appState.value as KiloAppState.Ready
        assertEquals(1, ready.data.warnings.size)
        assertEquals(".kilo/kilo.json", ready.data.warnings.first().path)
        assertEquals("Invalid JSON", ready.data.warnings.first().message)
    }

    @Test
    fun `retry refreshes warnings while Ready`() = runBlocking {
        mock.warnings = """[{"path":".kilo/kilo.json","message":"Invalid JSON","detail":"CloseBraceExpected"}]"""
        val svc = create()
        svc.connect()

        ready(svc)

        val before = svc.appState.value as KiloAppState.Ready
        assertEquals(1, before.data.warnings.size)

        mock.warnings = "[]"
        svc.retry()

        withTimeout(5_000) {
            while ((svc.appState.value as? KiloAppState.Ready)?.data?.warnings?.isNotEmpty() == true) {
                delay(100)
            }
        }

        val ready = svc.appState.value as KiloAppState.Ready
        assertTrue(ready.data.warnings.isEmpty())
        assertTrue(svc.warnings.isEmpty())
    }

    @Test
    fun `retry restarts app when warnings remain after refresh`() = runBlocking {
        mock.warnings = """[{"path":".kilo/kilo.json","message":"Invalid JSON","detail":"CloseBraceExpected"}]"""
        val svc = create()
        svc.connect()

        ready(svc)

        val before = mock.requestCount("/global/config")
        svc.retry()

        withTimeout(15_000) {
            while (mock.requestCount("/global/config") <= before) {
                delay(100)
            }
        }

        assertTrue(mock.requestCount("/global/config") > before)
        assertTrue(log.messages.any { it.contains("retry: restarted connection") })
    }

    @Test
    fun `profile is loaded when available`() = runBlocking {
        mock.profile = """{"profile":{"email":"alice@test.com","name":"Alice"},"balance":null,"currentOrgId":null}"""
        val svc = create()
        svc.connect()

        ready(svc)

        assertNotNull(svc.profile)
        assertEquals("alice@test.com", svc.profile!!.profile.email)
    }

    @Test
    fun `set organization sends explicit null body for personal account`() = runBlocking {
        val svc = create()
        svc.connect()

        ready(svc)

        svc.setOrganization("org_1")
        assertEquals("""{"organizationId":"org_1"}""", mock.lastOrganizationSetBody)

        svc.setOrganization(null)
        assertEquals("""{"organizationId":null}""", mock.lastOrganizationSetBody)
    }

    @Test
    fun `profile 401 does not prevent Ready`() = runBlocking {
        mock.profileStatus = 401
        val svc = create()
        svc.connect()

        ready(svc)

        // Profile is null but we still reached Ready
        assertNull(svc.profile)
        assertIs<KiloAppState.Ready>(svc.appState.value)
    }

    @Test
    fun `config failure retries then transitions to Error`() = runBlocking {
        mock.configStatus = 500
        mock.config = """{"error":"internal"}"""
        val svc = create()
        svc.connect()

        withTimeout(15_000) {
            svc.appState.first { it is KiloAppState.Error }
        }

        val err = svc.appState.value as KiloAppState.Error
        assertEquals("Failed to load required data", err.message)
        assertTrue(err.errors.any { it.resource == "config" })
    }

    @Test
    fun `notifications failure transitions to Error`() = runBlocking {
        mock.notificationsStatus = 500
        mock.notifications = """{"error":"internal"}"""
        val svc = create()
        svc.connect()

        withTimeout(15_000) {
            svc.appState.first { it is KiloAppState.Error }
        }

        val err = svc.appState.value as KiloAppState.Error
        assertTrue(err.errors.any { it.resource == "notifications" })
    }

    @Test
    fun `retry reruns load for app load error`() = runBlocking {
        mock.configStatus = 500
        mock.config = """{"error":"internal"}"""
        val svc = create()
        svc.connect()

        withTimeout(15_000) {
            svc.appState.first { it is KiloAppState.Error }
        }

        assertEquals(3, mock.requestCount("/global/config"))

        mock.configStatus = 200
        mock.config = """{"model":"retry/model"}"""
        svc.retry()

        ready(svc)

        assertEquals("retry/model", svc.config?.model)
        assertEquals(4, mock.requestCount("/global/config"))
    }

    @Test
    fun `connection error surfaces details as connection load error`() = runBlocking {
        val failing = object : ai.kilocode.backend.cli.CliServer {
            override var forceExtract = false
            override fun process(): Process? = null
            override suspend fun init(onProgress: (CliDownload) -> Unit, onResolved: () -> Unit) = ai.kilocode.backend.cli.CliServer.State.Error(
                message = "CLI startup failed",
                details = "stderr: missing dependency",
            )
            override fun exited(proc: Process) {}
            override fun stop() {}
            override fun dispose() {}
        }
        val svc = KiloBackendAppService.create(scope, failing, log)
        svc.connect()

        withTimeout(5_000) {
            svc.appState.first { it is KiloAppState.Error }
        }

        val err = svc.appState.value as KiloAppState.Error
        assertEquals("CLI startup failed", err.message)
        assertContains(err.errors.map { it.resource }, "connection")
        assertEquals("stderr: missing dependency", err.errors.first { it.resource == "connection" }.detail)
        assertTrue(log.messages.any { it.contains("App error: CLI startup failed") })
    }

    @Test
    fun `warning state emits final warn log`() = runBlocking {
        mock.warnings = """[{"path":".kilo/kilo.json","message":"Invalid JSON","detail":"CloseBraceExpected"}]"""
        val svc = create()
        svc.connect()

        val state = ready(svc)
        assertTrue(state.data.warnings.any { it.path == ".kilo/kilo.json" })

        assertTrue(log.awaitMessage {
            it.contains("App warnings:") && it.contains(".kilo/kilo.json: Invalid JSON")
        })
    }

    @Test
    fun `app load error emits final warn log`() = runBlocking {
        mock.configStatus = 500
        mock.config = """{"error":"internal"}"""
        val svc = create()
        svc.connect()

        withTimeout(15_000) {
            svc.appState.first { it is KiloAppState.Error }
        }

        assertTrue(log.messages.any {
            it.contains("App error: Failed to load required data") && it.contains("config")
        })
    }

    @Test
    fun `connect when already Ready is no-op`() = runBlocking {
        val svc = create()
        svc.connect()

        ready(svc)

        // Second connect should not change state
        svc.connect()
        assertIs<KiloAppState.Ready>(svc.appState.value)
    }

    @Test
    fun `health returns HealthDto when connected`() = runBlocking {
        val svc = create()
        svc.connect()

        ready(svc)

        val dto = svc.health()
        assertTrue(dto.healthy)
        assertEquals("1.0.0", dto.version)
    }

    @Test
    fun `health forwards healthy false from server`() = runBlocking {
        mock.health = """{"healthy":false,"version":"1.0.0"}"""
        val svc = create()
        svc.connect()

        ready(svc)

        val dto = svc.health()
        assertFalse(dto.healthy)
        assertEquals("1.0.0", dto.version)
    }

    @Test
    fun `profile 500 does not prevent Ready`() = runBlocking {
        mock.profileStatus = 500
        mock.profile = """{"error":"internal"}"""
        val svc = create()
        svc.connect()

        ready(svc)

        assertNull(svc.profile)
        assertIs<KiloAppState.Ready>(svc.appState.value)
    }

    @Test
    fun `dispose transitions to Disconnected`() = runBlocking {
        val svc = create()
        svc.connect()

        ready(svc)

        svc.dispose()
        assertEquals(KiloAppState.Disconnected, svc.appState.value)
    }

    @Test
    fun `loading tracks progress through Loading state`() = runBlocking {
        val gate = CountDownLatch(1)
        mock.responseGate = gate
        val svc = create()

        try {
            svc.connect()

            val loading = withTimeout(10_000) {
                svc.appState.first { it is KiloAppState.Loading }
            }
            assertIs<KiloAppState.Loading>(loading)

            gate.countDown()
            ready(svc)
        } finally {
            gate.countDown()
        }
    }

    @Test
    fun `hung app load transitions from Loading to Error`() = runBlocking {
        val gate = CountDownLatch(1)
        mock.responseGate = gate
        val svc = create(loadTimeoutMs = 300L)

        try {
            svc.connect()

            withTimeout(10_000) {
                svc.appState.first { it is KiloAppState.Loading }
            }

            val err = withTimeout(10_000) {
                svc.appState.first { it is KiloAppState.Error }
            } as KiloAppState.Error

            assertEquals("Failed to load required data", err.message)
            assertTrue(err.errors.any { it.detail?.contains("timeout", ignoreCase = true) == true })
        } finally {
            gate.countDown()
        }
    }

    @Test
    fun `hung warnings do not prevent Ready`() = runBlocking {
        val gate = CountDownLatch(1)
        mock.warningsGate = gate
        val svc = create(loadTimeoutMs = 300L)

        try {
            svc.connect()

            val state = ready(svc)

            assertTrue(state.data.warnings.isEmpty())
            assertTrue(svc.warnings.isEmpty())
        } finally {
            gate.countDown()
        }
    }

    @Test
    fun `restart during Loading cancels stale load and reaches Ready`() = runBlocking {
        val gate = CountDownLatch(1)
        mock.responseGate = gate
        val svc = create(loadTimeoutMs = 500L)

        try {
            svc.connect()

            withTimeout(10_000) {
                svc.appState.first { it is KiloAppState.Loading }
            }

            gate.countDown()
            svc.restart()

            ready(svc)

            assertIs<KiloAppState.Ready>(svc.appState.value)
            assertFalse(log.messages.any { it.contains("Application start timed out") })
            assertTrue(log.messages.any { it.contains("restart: requested") && it.contains("waiting for lifecycle mutex") })
            assertTrue(log.messages.any { it.contains("restart: acquired lifecycle mutex") })
            assertTrue(log.messages.any { it.contains("restart: complete") })
        } finally {
            gate.countDown()
        }
    }

    @Test
    fun `reinstall during Loading cancels stale load and reaches Ready`() = runBlocking {
        val gate = CountDownLatch(1)
        mock.responseGate = gate
        val svc = create(loadTimeoutMs = 500L)

        try {
            svc.connect()

            withTimeout(10_000) {
                svc.appState.first { it is KiloAppState.Loading }
            }

            gate.countDown()
            svc.reinstall()

            ready(svc)

            assertIs<KiloAppState.Ready>(svc.appState.value)
            assertFalse(log.messages.any { it.contains("Application start timed out") })
            assertTrue(log.messages.any { it.contains("reinstall: requested") && it.contains("waiting for lifecycle mutex") })
            assertTrue(log.messages.any { it.contains("reinstall: acquired lifecycle mutex") })
            assertTrue(log.messages.any { it.contains("reinstall: complete") })
        } finally {
            gate.countDown()
        }
    }

    @Test
    fun `SSE config updated event refreshes config`() = runBlocking {
        mock.config = """{"model":"initial"}"""
        val svc = create()
        svc.connect()

        ready(svc)

        assertEquals("initial", svc.config?.model)

        // Change the config response and push an SSE event
        mock.config = """{"model":"updated"}"""
        val before = mock.requestCount("/global/config")
        mock.awaitSseConnection()
        mock.pushEvent("global.config.updated", """{"type":"global.config.updated"}""")

        assertTrue(mock.awaitRequestCount("/global/config", before + 1))
        withTimeout(5_000) {
            svc.appState.first { state ->
                state is KiloAppState.Ready && state.data.config.model == "updated"
            }
        }

        assertEquals("updated", svc.config?.model)
    }

    @Test
    fun `SSE config updated refreshes warnings`() = runBlocking {
        mock.warnings = """[{"path":".kilo/kilo.json","message":"Invalid JSON","detail":"CloseBraceExpected"}]"""
        val svc = create()
        svc.connect()

        ready(svc)

        assertEquals(1, (svc.appState.value as KiloAppState.Ready).data.warnings.size)

        mock.warnings = "[]"
        val before = mock.requestCount("/config/warnings")
        mock.awaitSseConnection()
        mock.pushEvent("global.config.updated", """{"type":"global.config.updated"}""")

        assertTrue(mock.awaitRequestCount("/config/warnings", before + 1))
        withTimeout(5_000) {
            svc.appState.first { state ->
                state is KiloAppState.Ready && state.data.warnings.isEmpty()
            }
        }

        assertTrue((svc.appState.value as KiloAppState.Ready).data.warnings.isEmpty())
    }

    // ------ Auth mapping tests ------

    @Test
    fun `start login maps device auth response`() = runBlocking<Unit> {
        // Default authorizeResponse: url=https://auth.kilo.ai/device, code=TEST-1234
        val svc = create()
        svc.connect()

        ready(svc)

        val auth = svc.startLogin(null)
        assertEquals("https://auth.kilo.ai/device", auth.verificationUrl)
        assertEquals("TEST-1234", auth.code)
        assertEquals(900, auth.expiresIn)
        assertNotNull(mock.lastAuthorizeBody)
    }

    @Test
    fun `complete login calls callback and refreshes profile`() = runBlocking<Unit> {
        mock.profile = """{"profile":{"email":"alice@test.com","name":"Alice"},"balance":null,"currentOrgId":null}"""
        val svc = create()
        svc.connect()

        ready(svc)

        val profile = svc.completeLogin(null)
        assertNotNull(profile)
        assertEquals("alice@test.com", profile.profile.email)
        assertNotNull(mock.lastCallbackBody)
    }

    // ------ Concurrency & lifecycle tests ------

    @Test
    fun `rapid disposed events produce single valid Ready`() = runBlocking {
        val svc = create()
        svc.connect()

        ready(svc)

        mock.awaitSseConnection()

        // Fire rapid global.disposed events to trigger concurrent load() calls
        repeat(5) {
            mock.pushEvent("global.disposed", """{"type":"global.disposed"}""")
        }

        // Wait for the app to settle back to Ready
        withTimeout(15_000) {
            // Allow transient Loading states, wait for final Ready
            while (true) {
                val state = svc.appState.value
                if (state is KiloAppState.Ready) {
                    // Verify it's stable
                    delay(500)
                    if (svc.appState.value is KiloAppState.Ready) break
                }
                delay(100)
            }
        }

        assertIs<KiloAppState.Ready>(svc.appState.value)
        assertNotNull(svc.config)
    }

    @Test
    fun `restart lifecycle transitions correctly`() = runBlocking {
        val svc = create()
        svc.connect()

        ready(svc)

        // Restart should tear down and reconnect
        svc.restart()

        // Should transition back to Ready after restart
        ready(svc)

        assertIs<KiloAppState.Ready>(svc.appState.value)
        assertNotNull(svc.config)
        assertTrue(log.messages.any { it.contains("restart: requested") && it.contains("waiting for lifecycle mutex") })
        assertTrue(log.messages.any { it.contains("restart: acquired lifecycle mutex") })
        assertTrue(log.messages.any { it.contains("restart: complete") })
    }

    @Test
    fun `reconnect after SSE close restores Ready state`() = runBlocking {
        val svc = create()
        svc.connect()

        ready(svc)

        // Close SSE to trigger reconnect path
        mock.closeSse()

        // Should eventually recover to Connected/Ready through reconnect
        // (connection service reconnects SSE if process is alive — but
        // FakeCliServer returns no process, so it delegates to onReconnect
        // which calls reconnect() under mutex)
        withTimeout(15_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

        assertIs<KiloAppState.Ready>(svc.appState.value)
    }

    @Test
    fun `startup SSE timeout reconnects from Connecting`() = runBlocking {
        val server = StallingServer(mock)
        val svc = KiloBackendAppService.create(scope, server, log)
        svc.connect()

        ready(svc)

        assertTrue(server.count >= 2)
        assertTrue(log.messages.any { it.contains("SSE: connection timed out") })
        assertIs<KiloAppState.Ready>(svc.appState.value)
    }

    // ------ Profile DTO mapping tests ------

    @Test
    fun `ready dto maps profile fields`() = runBlocking {
        mock.profile = """{
            "profile":{
                "email":"alice@test.com",
                "name":"Alice",
                "organizations":[{"id":"org_1","name":"Acme","role":"ADMIN"}]
            },
            "balance":{"balance":42.5},
            "currentOrgId":"org_1"
        }""".trimIndent()
        val svc = create()
        svc.connect()

        ready(svc)

        val dto = appStateDto(svc.appState.value)
        assertEquals("alice@test.com", dto.profile?.email)
        assertEquals("Alice", dto.profile?.name)
        assertEquals("ADMIN", dto.profile?.organizations?.firstOrNull()?.role)
        // The pinned CLI does not expose hasPersonalAccount yet; the mapper defaults it to true.
        assertTrue(dto.profile?.hasPersonalAccount ?: false)
        assertEquals(42.5, dto.profile?.balance?.balance)
        assertEquals("org_1", dto.profile?.currentOrgId)
    }

    @Test
    fun `ready dto hides unknown profile amounts`() = runBlocking {
        mock.profile = """{
            "profile":{"email":"alice@test.com","name":"Alice"},
            "balance":{"balance":null},
            "kiloPass":{
                "currentPeriodBaseCreditsUsd":null,
                "currentPeriodUsageUsd":null,
                "currentPeriodBonusCreditsUsd":null,
                "nextBillingAt":null
            },
            "currentOrgId":null
        }""".trimIndent()
        val svc = create()
        svc.connect()

        ready(svc)

        val dto = appStateDto(svc.appState.value)
        assertEquals("alice@test.com", dto.profile?.email)
        assertNull(dto.profile?.balance)
        assertNull(dto.profile?.kiloPass)
    }

    @Test
    fun `refresh profile updates ready dto profile`() = runBlocking {
        mock.profile = """{"profile":{"email":"alice@test.com","name":"Alice"},"balance":null,"currentOrgId":null}"""
        val svc = create()
        svc.connect()

        ready(svc)

        // Update mock to return different profile
        mock.profile = """{"profile":{"email":"alice@test.com","name":"Updated Alice"},"balance":{"balance":99.0},"currentOrgId":null}"""

        val fresh = svc.refreshProfile()
        assertNotNull(fresh)
        assertEquals("Updated Alice", fresh.profile.name)
        assertEquals("Updated Alice", appStateDto(svc.appState.value).profile?.name)
        assertEquals(99.0, appStateDto(svc.appState.value).profile?.balance?.balance)
    }

    @Test
    fun `logout clears ready profile on success`() = runBlocking {
        mock.profile = """{"profile":{"email":"alice@test.com","name":"Alice"},"balance":null,"currentOrgId":null}"""
        val svc = create()
        svc.connect()

        ready(svc)

        assertNotNull(svc.profile)
        mock.authRemoveStatus = 200
        val ok = svc.logout()

        assertTrue(ok)
        assertNull(svc.profile)
        assertNull(appStateDto(svc.appState.value).profile)
    }

    @Test
    fun `set organization failure leaves profile unchanged`() = runBlocking {
        mock.profile = """{"profile":{"email":"alice@test.com","name":"Alice"},"balance":null,"currentOrgId":null}"""
        val svc = create()
        svc.connect()

        ready(svc)

        val before = svc.profile
        assertNotNull(before)

        mock.organizationSetStatus = 500
        var thrown = false
        try {
            svc.setOrganization("org_1")
        } catch (_: Exception) {
            thrown = true
        }
        assertTrue(thrown, "setOrganization with 500 should throw")
        // Profile should remain unchanged because organization switch failed before refreshProfile
        assertEquals(before.profile.email, svc.profile?.profile?.email)
    }

    @Test
    fun `start login failure propagates`() = runBlocking {
        val svc = create()
        svc.connect()

        ready(svc)

        mock.authorizeStatus = 500
        var thrown = false
        try {
            svc.startLogin(null)
        } catch (_: Exception) {
            thrown = true
        }
        assertTrue(thrown, "startLogin with 500 status should throw")
    }

    @Test
    fun `start login without code returns null code but url present`() = runBlocking {
        // Instructions without 'code:' — the regex match should return null
        mock.authorizeResponse = """{"url":"https://auth.kilo.ai/device","method":"code","instructions":"Open the URL in your browser to sign in"}"""
        val svc = create()
        svc.connect()

        ready(svc)

        val auth = svc.startLogin(null)
        assertNull(auth.code, "code should be null when instructions have no code: prefix")
        assertEquals("https://auth.kilo.ai/device", auth.verificationUrl)
    }

    @Test
    fun `complete login callback failure propagates`() = runBlocking {
        val svc = create()
        svc.connect()

        ready(svc)

        mock.callbackStatus = 500
        var thrown = false
        try {
            svc.completeLogin(null)
        } catch (_: Exception) {
            thrown = true
        }
        assertTrue(thrown, "completeLogin with 500 callback status should throw")
    }
}
