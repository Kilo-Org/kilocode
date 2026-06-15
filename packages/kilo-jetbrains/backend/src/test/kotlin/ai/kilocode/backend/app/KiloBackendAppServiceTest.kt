package ai.kilocode.backend.app

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.rpc.appStateDto
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.util.concurrent.CountDownLatch
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

    @Test
    fun `full lifecycle reaches Ready`() = runBlocking {
        val svc = create()
        svc.connect()

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

        val ready = svc.appState.value as KiloAppState.Ready
        assertNotNull(ready.data.config)
        assertNotNull(ready.data.notifications)
    }

    @Test
    fun `config is loaded`() = runBlocking {
        mock.config = """{"model":"claude-4","username":"testuser"}"""
        val svc = create()
        svc.connect()

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

        assertNotNull(svc.config)
        assertEquals("claude-4", svc.config!!.model)
    }

    @Test
    fun `ready dto maps model config`() = runBlocking {
        mock.config = """{"model":"openai/gpt","agent":{"plan":{"model":"anthropic/claude","variant":"high"}}}"""
        val svc = create()
        svc.connect()

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

        val dto = appStateDto(svc.appState.value)
        assertEquals("openai/gpt", dto.config?.model)
        assertEquals("anthropic/claude", dto.config?.agent?.get("plan")?.model)
        assertEquals("high", dto.config?.agent?.get("plan")?.variant)
    }

    @Test
    fun `config warnings are loaded without blocking Ready`() = runBlocking {
        mock.warnings = """[{"path":".kilo/kilo.json","message":"Invalid JSON","detail":"CloseBraceExpected"}]"""
        val svc = create()
        svc.connect()

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

        assertNotNull(svc.profile)
        assertEquals("alice@test.com", svc.profile!!.profile.email)
    }

    @Test
    fun `set organization sends explicit null body for personal account`() = runBlocking {
        val svc = create()
        svc.connect()

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(15_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

        assertEquals("retry/model", svc.config?.model)
        assertEquals(4, mock.requestCount("/global/config"))
    }

    @Test
    fun `connection error surfaces details as connection load error`() = runBlocking {
        val failing = object : ai.kilocode.backend.cli.CliServer {
            override var forceExtract = false
            override fun process(): Process? = null
            override suspend fun init() = ai.kilocode.backend.cli.CliServer.State.Error(
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

        withTimeout(10_000) {
            svc.appState.first { state ->
                state is KiloAppState.Ready && state.data.warnings.any { it.path == ".kilo/kilo.json" }
            }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

        // Second connect should not change state
        svc.connect()
        assertIs<KiloAppState.Ready>(svc.appState.value)
    }

    @Test
    fun `health returns HealthDto when connected`() = runBlocking {
        val svc = create()
        svc.connect()

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

        val dto = svc.health()
        assertTrue(dto.healthy)
        assertEquals("1.0.0", dto.version)
    }

    @Test
    fun `health forwards healthy false from server`() = runBlocking {
        mock.health = """{"healthy":false,"version":"1.0.0"}"""
        val svc = create()
        svc.connect()

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(15_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

        assertNull(svc.profile)
        assertIs<KiloAppState.Ready>(svc.appState.value)
    }

    @Test
    fun `dispose transitions to Disconnected`() = runBlocking {
        val svc = create()
        svc.connect()

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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
            val ready = withTimeout(10_000) {
                svc.appState.first { it is KiloAppState.Ready }
            }
            assertIs<KiloAppState.Ready>(ready)
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

            val ready = withTimeout(10_000) {
                svc.appState.first { it is KiloAppState.Ready }
            } as KiloAppState.Ready

            assertTrue(ready.data.warnings.isEmpty())
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

            withTimeout(10_000) {
                svc.appState.first { it is KiloAppState.Ready }
            }

            assertIs<KiloAppState.Ready>(svc.appState.value)
            assertFalse(log.messages.any { it.contains("Application start timed out") })
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

            withTimeout(10_000) {
                svc.appState.first { it is KiloAppState.Ready }
            }

            assertIs<KiloAppState.Ready>(svc.appState.value)
            assertFalse(log.messages.any { it.contains("Application start timed out") })
        } finally {
            gate.countDown()
        }
    }

    @Test
    fun `SSE config updated event refreshes config`() = runBlocking {
        mock.config = """{"model":"initial"}"""
        val svc = create()
        svc.connect()

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

        // Restart should tear down and reconnect
        svc.restart()

        // Should transition back to Ready after restart
        withTimeout(15_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

        assertIs<KiloAppState.Ready>(svc.appState.value)
        assertNotNull(svc.config)
    }

    @Test
    fun `reconnect after SSE close restores Ready state`() = runBlocking {
        val svc = create()
        svc.connect()

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

        val dto = appStateDto(svc.appState.value)
        assertEquals("alice@test.com", dto.profile?.email)
        assertEquals("Alice", dto.profile?.name)
        assertEquals("ADMIN", dto.profile?.organizations?.firstOrNull()?.role)
        assertEquals(42.5, dto.profile?.balance?.balance)
        assertEquals("org_1", dto.profile?.currentOrgId)
    }

    @Test
    fun `refresh profile updates ready dto profile`() = runBlocking {
        mock.profile = """{"profile":{"email":"alice@test.com","name":"Alice"},"balance":null,"currentOrgId":null}"""
        val svc = create()
        svc.connect()

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

        val auth = svc.startLogin(null)
        assertNull(auth.code, "code should be null when instructions have no code: prefix")
        assertEquals("https://auth.kilo.ai/device", auth.verificationUrl)
    }

    @Test
    fun `complete login callback failure propagates`() = runBlocking {
        val svc = create()
        svc.connect()

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

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
