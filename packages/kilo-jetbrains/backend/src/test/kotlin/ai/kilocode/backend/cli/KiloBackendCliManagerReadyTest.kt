package ai.kilocode.backend.cli

import ai.kilocode.backend.testing.TestLog
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue
import java.io.ByteArrayInputStream
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.util.concurrent.atomic.AtomicInteger

class KiloBackendCliManagerReadyTest {

    @Test
    fun `ready line returns port`() = runBlocking {
        val state = awaitReady(
            stdout = ByteArrayInputStream("kilo server listening on http://127.0.0.1:12345\n".toByteArray()),
            stderr = StringBuilder(),
            pwd = "pwd123",
            timeoutMs = TIMEOUT_MS,
            alive = { false },
            pid = { 123L },
            code = { 0 },
            onTimeout = {},
            diagnostics = { "diag" },
        )

        val ready = assertIs<CliServer.State.Ready>(state)
        assertEquals(12345, ready.port)
        assertEquals("pwd123", ready.password)
    }

    @Test
    fun `timeout invokes cleanup once and returns diagnostics`() = runBlocking {
        val input = PipedInputStream()
        val output = PipedOutputStream(input)
        output.write("not ready yet\n".toByteArray())
        output.flush()
        val calls = AtomicInteger(0)

        val state = awaitReady(
            stdout = input,
            stderr = StringBuilder("stderr line"),
            pwd = "pwd123",
            timeoutMs = WATCHDOG_TIMEOUT_MS,
            alive = { true },
            pid = { 456L },
            code = { 0 },
            onTimeout = {
                calls.incrementAndGet()
                output.close()
            },
            diagnostics = { "diag line" },
        )

        val err = assertIs<CliServer.State.Error>(state)
        assertEquals(1, calls.get())
        assertContains(err.message, "within ${WATCHDOG_TIMEOUT_MS}ms")
        assertContains(err.message, "process alive=true")
        assertContains(err.message, "pid=456")
        assertContains(err.details.orEmpty(), "stderr line")
        assertContains(err.details.orEmpty(), "diag line")
    }

    @Test
    fun `early eof without port returns exit code and stderr`() = runBlocking {
        val state = awaitReady(
            stdout = ByteArrayInputStream("booting\n".toByteArray()),
            stderr = StringBuilder("bad db"),
            pwd = "pwd123",
            timeoutMs = TIMEOUT_MS,
            alive = { false },
            pid = { 789L },
            code = { 9 },
            onTimeout = {},
            diagnostics = { "diag line" },
        )

        val err = assertIs<CliServer.State.Error>(state)
        assertEquals("CLI process exited with code 9 before announcing a port", err.message)
        assertContains(err.details.orEmpty(), "bad db")
        assertContains(err.details.orEmpty(), "diag line")
    }

    @Test
    fun `init after dispose is rejected without spawning`() = runBlocking {
        val manager = KiloBackendCliManager(log = TestLog())
        manager.dispose()
        var resolved = false
        val state = manager.init(onProgress = {}, onResolved = { resolved = true })
        val err = assertIs<CliServer.State.Error>(state)
        assertEquals("CLI manager is disposed", err.message)
        assertFalse(resolved)
    }

    @Test
    fun `ipv6 bind form remains a known non match`() = runBlocking {
        val calls = AtomicInteger(0)

        val state = awaitReady(
            stdout = ByteArrayInputStream("kilo server listening on http://[::1]:12345\n".toByteArray()),
            stderr = StringBuilder(),
            pwd = "pwd123",
            timeoutMs = TIMEOUT_MS,
            alive = { false },
            pid = { 321L },
            code = { 0 },
            onTimeout = { calls.incrementAndGet() },
            diagnostics = { "diag line" },
        )

        val err = assertIs<CliServer.State.Error>(state)
        assertEquals(0, calls.get())
        assertTrue(err.message.startsWith("CLI process exited with code 0"))
    }

    companion object {
        private const val TIMEOUT_MS = 1_000L
        private const val WATCHDOG_TIMEOUT_MS = 50L
    }
}
