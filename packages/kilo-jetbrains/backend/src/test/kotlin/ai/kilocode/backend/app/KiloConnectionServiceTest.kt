package ai.kilocode.backend.app

import ai.kilocode.backend.cli.CliServer
import ai.kilocode.backend.cli.CliDownload
import ai.kilocode.backend.app.ConnectionState
import ai.kilocode.backend.app.KiloConnectionService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.log.KiloLog
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.Request
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
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
    fun `connect reports downloading then connecting before ready`() = runBlocking {
        val resolved = CompletableDeferred<Unit>()
        val ready = CompletableDeferred<Unit>()
        val server = object : CliServer {
            override var forceExtract = false
            override fun process(): Process? = null
            override suspend fun init(onProgress: (CliDownload) -> Unit, onResolved: () -> Unit): CliServer.State {
                onProgress(CliDownload(42, "1.2.3", "darwin-arm64"))
                resolved.await()
                onResolved()
                ready.await()
                return CliServer.State.Ready(mock.start(), mock.password)
            }
            override fun exited(proc: Process) {}
            override fun stop() {}
            override fun dispose() {}
        }
        val svc = KiloConnectionService(scope, server, {}, log)
        val job = scope.launch { svc.connect() }

        val downloading = withTimeout(5_000) {
            svc.state.first { it is ConnectionState.Downloading }
        }
        assertEquals(ConnectionState.Downloading(42, "1.2.3", "darwin-arm64"), downloading)

        resolved.complete(Unit)
        withTimeout(5_000) {
            svc.state.first { it == ConnectionState.Connecting }
        }

        ready.complete(Unit)
        mock.awaitSseConnection()
        withTimeout(5_000) {
            svc.state.first { it is ConnectionState.Connected }
        }
        job.join()
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
        val deferred = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            val event = svc.events.first { it.type == "global.config.updated" }
            assertEquals("global.config.updated", event.type)
        }

        mock.pushEvent("global.config.updated", """{"type":"global.config.updated"}""")

        withTimeout(5_000) {
            deferred.join()
        }
    }

    @Test
    fun `SSE events preserve callback order`() = runBlocking {
        val svc = KiloConnectionService(scope, fake, {}, log)
        svc.connect()
        mock.awaitSseConnection()

        withTimeout(5_000) {
            svc.state.first { it is ConnectionState.Connected }
        }

        val count = 100
        val received = async(start = CoroutineStart.UNDISPATCHED) {
            withTimeout(5_000) {
                svc.events.take(count).toList()
            }
        }

        repeat(count) { idx ->
            mock.pushEvent("test.event", idx.toString())
        }

        assertEquals((0 until count).map { it.toString() }, received.await().map { it.data })
    }

    @Test
    fun `SSE concurrent callbacks preserve callback order`() = runBlocking {
        val blocked = BlockingLog()
        val svc = KiloConnectionService(scope, fake, {}, blocked)
        val field = KiloConnectionService::class.java.getDeclaredField("listener")
        field.isAccessible = true
        val listener = field.get(svc) as EventSourceListener
        val source = object : EventSource {
            override fun request(): Request = Request.Builder().url("http://127.0.0.1/global/event").build()
            override fun cancel() {}
        }
        val sourceField = KiloConnectionService::class.java.getDeclaredField("source")
        sourceField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val ref = sourceField.get(svc) as AtomicReference<EventSource?>
        ref.set(source)
        val received = scope.async(start = CoroutineStart.UNDISPATCHED) {
            withTimeout(5_000) {
                svc.events.take(2).toList()
            }
        }

        val entered = CountDownLatch(1)
        val first = Thread { listener.onEvent(source, null, "first.event", "first") }
        val second = Thread {
            entered.countDown()
            listener.onEvent(source, null, "second.event", "second")
        }
        first.start()
        assertTrue(blocked.started.await(1, TimeUnit.SECONDS))
        second.start()
        assertTrue(entered.await(1, TimeUnit.SECONDS))
        blocked.release.countDown()
        first.join()
        second.join()

        assertEquals(listOf("first", "second"), received.await().map { it.data })
        svc.dispose()
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
            override suspend fun init(onProgress: (CliDownload) -> Unit, onResolved: () -> Unit) = CliServer.State.Error("binary not found", "stderr line 1\nstderr line 2")
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

    @Test
    fun `dispose prevents reconnect on late SSE callbacks`() = runBlocking {
        val reconnects = AtomicInteger(0)
        val svc = KiloConnectionService(scope, fake, { reconnects.incrementAndGet() }, log)
        svc.connect()
        mock.awaitSseConnection()

        withTimeout(5_000) {
            svc.state.first { it is ConnectionState.Connected }
        }

        svc.dispose()

        // Simulate a late SSE close/failure arriving after teardown. The stale source must be
        // ignored so shutdown neither resurrects the connection nor schedules a reconnect.
        val field = KiloConnectionService::class.java.getDeclaredField("listener")
        field.isAccessible = true
        val listener = field.get(svc) as EventSourceListener
        val stale = object : EventSource {
            override fun request(): Request = Request.Builder().url("http://127.0.0.1/global/event").build()
            override fun cancel() {}
        }
        listener.onFailure(stale, RuntimeException("late failure"), null)
        listener.onClosed(stale)

        assertEquals(ConnectionState.Disconnected, svc.state.value)
        assertEquals(0, reconnects.get())
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
        val seen = mock.sseConnectionCount
        svc.restart()

        // Wait for reconnection
        assertTrue(mock.awaitSseConnections(seen + 1))
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

    private class BlockingLog : KiloLog {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        override var isDebugEnabled: Boolean = true

        override fun debug(block: () -> String) {
            val msg = block()
            if (!msg.contains("evt=first.event")) return
            started.countDown()
            release.await(1, TimeUnit.SECONDS)
        }

        override fun info(msg: String) {}
        override fun warn(msg: String, t: Throwable?) {}
        override fun error(msg: String, t: Throwable?) {}
    }
}
