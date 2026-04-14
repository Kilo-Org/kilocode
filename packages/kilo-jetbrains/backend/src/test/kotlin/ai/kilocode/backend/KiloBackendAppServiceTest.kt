package ai.kilocode.backend

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
    fun `profile 500 transitions to Error`() = runBlocking {
        mock.profileStatus = 500
        mock.profile = """{"error":"internal"}"""
        val svc = create()
        svc.connect()

        withTimeout(15_000) {
            svc.appState.first { it is KiloAppState.Error }
        }

        val err = svc.appState.value as KiloAppState.Error
        assertTrue(err.errors.any { it.resource == "profile" })
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
}
