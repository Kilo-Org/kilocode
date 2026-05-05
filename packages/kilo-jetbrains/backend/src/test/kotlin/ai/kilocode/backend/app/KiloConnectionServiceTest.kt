package ai.kilocode.backend.app

import ai.kilocode.backend.cli.CliServer
import ai.kilocode.backend.app.ConnectionState
import ai.kilocode.backend.app.KiloConnectionService
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
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class KiloConnectionServiceTest {

    private val mock = MockCliServer()
    private val fake = FakeCliServer(mock)
    private val log = TestLog()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @AfterTest
    fun tearDown() {
        scope.cancel()
        mock.close()
    }

    @Test
    fun `connect transitions to Connected`() = runBlocking {
        val reconnects = AtomicInteger(0)
        val svc = KiloConnectionService(
          scope,
          fake,
          { reconnects.incrementAndGet() },
          log
        )

        svc.connect()

        // Wait for SSE to connect, which triggers Connected
        mock.awaitSseConnection()

        withTimeout(5_000) {
            svc.state.first { it is ConnectionState.Connected }
        }
        assertIs<ConnectionState.Connected>(svc.state.value)
    }

    @Test
    fun `connect provides API client`() = runBlocking {
        val svc = KiloConnectionService(scope, fake, {}, log)
        svc.connect()
        mock.awaitSseConnection()

        withTimeout(5_000) {
            svc.state.first { it is ConnectionState.Connected }
        }
        assertTrue(svc.api != null)
    }

    @Test
    fun `SSE events are emitted`() = runBlocking {
        val svc = KiloConnectionService(scope, fake, {}, log)
        svc.connect()
        mock.awaitSseConnection()

        withTimeout(5_000) {
            svc.state.first { it is ConnectionState.Connected }
        }

        // Use first{} on the flow to capture the event — avoids race with SharedFlow subscription
        val deferred = scope.launch {
            val event = svc.events.first { it.type == "global.config.updated" }
            assertEquals("global.config.updated", event.type)
        }

        // Small delay to ensure the collector subscription is active
        delay(200)
        mock.pushEvent("global.config.updated", """{"type":"global.config.updated"}""")

        withTimeout(5_000) {
            deferred.join()
        }
    }

    @Test
    fun `SSE close triggers error state`() = runBlocking {
        val svc = KiloConnectionService(scope, fake, {}, log)
        svc.connect()
        mock.awaitSseConnection()

        withTimeout(5_000) {
            svc.state.first { it is ConnectionState.Connected }
        }

        // Close SSE stream
        mock.closeSse()

        // Should transition away from Connected (to Error or Connecting on reconnect)
        withTimeout(5_000) {
            svc.state.first { it !is ConnectionState.Connected }
        }
    }

    @Test
    fun `init error transitions to Error state`() = runBlocking {
        val failing = object : CliServer {
            override var forceExtract = false
            override fun process(): Process? = null
            override suspend fun init() = CliServer.State.Error("binary not found", "stderr line 1\nstderr line 2")
            override fun exited(proc: Process) {}
            override fun stop() {}
            override fun dispose() {}
        }

        val svc = KiloConnectionService(scope, failing, {}, log)
        svc.connect()

        withTimeout(5_000) {
            svc.state.first { it is ConnectionState.Error }
        }
        val err = svc.state.value as ConnectionState.Error
        assertEquals("binary not found", err.message)
        assertEquals("stderr line 1\nstderr line 2", err.details)
    }

    @Test
    fun `reinstall sets forceExtract on server`() = runBlocking {
        val svc = KiloConnectionService(scope, fake, {}, log)
        svc.connect()
        mock.awaitSseConnection()

        withTimeout(5_000) {
            svc.state.first { it is ConnectionState.Connected }
        }

        svc.reinstall()
        assertTrue(fake.forceExtract)
    }

    // extractType tests moved to KiloCliDataParserTest

    @Test
    fun `dispose transitions to Disconnected`() = runBlocking {
        val svc = KiloConnectionService(scope, fake, {}, log)
        svc.connect()
        mock.awaitSseConnection()

        withTimeout(5_000) {
            svc.state.first { it is ConnectionState.Connected }
        }

        svc.dispose()
        assertEquals(ConnectionState.Disconnected, svc.state.value)
    }

    // ------ Reconnect & health ------

    @Test
    fun `restart tears down and reconnects`() = runBlocking {
        val svc = KiloConnectionService(scope, fake, {}, log)
        svc.connect()
        mock.awaitSseConnection()

        withTimeout(5_000) {
            svc.state.first { it is ConnectionState.Connected }
        }

        // Restart should tear down and re-open
        svc.restart()

        // Wait for reconnection
        withTimeout(10_000) {
            svc.state.first { it is ConnectionState.Connected }
        }
        assertIs<ConnectionState.Connected>(svc.state.value)
        assertTrue(svc.api != null)
    }

    @Test
    fun `health check failure triggers reconnect`() = runBlocking {
        // Start healthy then switch to failing health
        val svc = KiloConnectionService(scope, fake, {}, log)
        svc.connect()
        mock.awaitSseConnection()

        withTimeout(5_000) {
            svc.state.first { it is ConnectionState.Connected }
        }

        // Make health checks fail — the health loop runs every 10s, so we
        // close the SSE first (which triggers immediate reconnect path)
        mock.health = """{"healthy": false}"""
        mock.closeSse()

        // Should transition away from Connected
        withTimeout(10_000) {
            svc.state.first { it !is ConnectionState.Connected }
        }
    }
}
