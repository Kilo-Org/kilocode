package ai.kilocode.backend.app

import ai.kilocode.backend.cli.KiloBackendHttpClients
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.jetbrains.api.client.DefaultApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class KiloBackendSandboxManagerTest {
    private val mock = MockCliServer()
    private val log = TestLog()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val http = KiloBackendHttpClients.api(mock.password)
    private val events = MutableSharedFlow<SseEvent>(extraBufferCapacity = 4)
    private lateinit var manager: KiloBackendSandboxManager

    @AfterTest
    fun tearDown() {
        if (::manager.isInitialized) manager.stop()
        scope.cancel()
        KiloBackendHttpClients.shutdown(http)
        mock.close()
    }

    @Test
    fun `support and status route the exact directory`() = runBlocking {
        start()

        assertTrue(manager.support("/test").available)
        val status = manager.status("ses_test", "/test")

        assertFalse(status.enabled)
        assertEquals("/sandbox/support?directory=%2Ftest", mock.lastSandboxSupportPath)
        assertEquals("/session/ses_test/sandbox?directory=%2Ftest", mock.lastSandboxStatusPath)
    }

    @Test
    fun `set enabled toggles once and confirms final state`() = runBlocking {
        start()

        val status = manager.setEnabled("ses_test", "/test", true)

        assertTrue(status.enabled)
        assertEquals(1, mock.requestCount("/session/ses_test/sandbox/toggle"))
        assertEquals(2, mock.requestCount("/session/ses_test/sandbox"))
    }

    @Test
    fun `set enabled never toggles an unavailable effective false state`() = runBlocking {
        mock.sandboxStatus = """{"directory":"/test","enabled":false,"available":false,"reason":"missing helper","version":7}"""
        start()

        val status = manager.setEnabled("ses_test", "/test", true)

        assertFalse(status.available)
        assertEquals(0, mock.requestCount("/session/ses_test/sandbox/toggle"))
    }

    @Test
    fun `status rejects a response from another directory`() = runBlocking {
        mock.sandboxStatus = """{"directory":"/other","enabled":false,"available":true,"version":0}"""
        start()

        assertFailsWith<IllegalArgumentException> { manager.status("ses_test", "/test") }
    }

    @Test
    fun `changed event is decoded with long revision`() = runBlocking {
        start()
        val result = scope.launch {
            withTimeout(5_000) {
                val status = manager.statusChanges.first()
                assertEquals("ses_test", status.sessionID)
                assertEquals(5_000_000_000L, status.version)
                assertTrue(status.enabled)
            }
        }

        events.emit(
            SseEvent(
                "sandbox.status.changed",
                """{"payload":{"properties":{"sessionID":"ses_test","directory":"/test","enabled":true,"available":true,"version":5000000000}}}""",
            ),
        )
        result.join()
    }

    private fun start() {
        val port = mock.start()
        manager = KiloBackendSandboxManager(scope, log)
        manager.start(DefaultApi(basePath = "http://127.0.0.1:$port", client = http), events)
    }
}
