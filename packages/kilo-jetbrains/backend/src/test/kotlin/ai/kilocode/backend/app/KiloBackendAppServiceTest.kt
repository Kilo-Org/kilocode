package ai.kilocode.backend.app

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
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

    private fun create(): KiloBackendAppService =
        KiloBackendAppService.create(scope, FakeCliServer(mock), log)

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
            svc.appState.first { it is KiloAppState.Ready }
        }

        assertTrue(log.messages.any {
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
        val svc = create()
        val states = mutableListOf<KiloAppState>()

        val collector = scope.launch {
            svc.appState.collect { states.add(it) }
        }

        svc.connect()

        withTimeout(10_000) {
            svc.appState.first { it is KiloAppState.Ready }
        }

        collector.cancel()

        // Should have passed through Loading at least once
        assertTrue(states.any { it is KiloAppState.Loading })
        // Should have reached Ready
        assertTrue(states.any { it is KiloAppState.Ready })
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
        mock.awaitSseConnection()
        mock.pushEvent("global.config.updated", """{"type":"global.config.updated"}""")

        // Wait for config to be refreshed
        withTimeout(5_000) {
            while (svc.config?.model != "updated") {
                delay(100)
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
        mock.awaitSseConnection()
        mock.pushEvent("global.config.updated", """{"type":"global.config.updated"}""")

        withTimeout(5_000) {
            while ((svc.appState.value as? KiloAppState.Ready)?.data?.warnings?.isNotEmpty() == true) {
                delay(100)
            }
        }

        assertTrue((svc.appState.value as KiloAppState.Ready).data.warnings.isEmpty())
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
}
