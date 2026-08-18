package ai.kilocode.backend.cli

import ai.kilocode.backend.testing.TestLog
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Locks the app-close teardown ordering so a future edit cannot reintroduce the Windows deadlock:
 * closing a CLI stream while its reader thread is blocked reading it hangs until the process dies,
 * so the process tree MUST be killed before any stream is closed.
 */
class KiloBackendCliShutdownTest {

    @Test
    fun `shutdownTree kills the tree before closing streams`() {
        val events = mutableListOf<String>()
        val proc = RecordingProcess(events)

        shutdownTree(
            proc = proc,
            jobKill = true,
            log = TestLog(),
            killJob = { events += "job" },
            descendants = { emptyList() },
        )

        // Both kill steps (job close + destroy) must precede every stream close.
        val lastKill = maxOf(events.indexOf("job"), events.indexOf("destroy"))
        val firstClose = events.indexOfFirst { it.startsWith("close-") }
        assertTrue(lastKill >= 0, "kill steps ran: $events")
        assertTrue(firstClose >= 0, "streams were closed: $events")
        assertTrue(lastKill < firstClose, "process must be killed before its streams are closed; got $events")
        assertEquals(listOf("job", "destroy", "close-stderr", "close-stdout", "close-stdin"), events)
    }

    @Test
    fun `shutdownTree destroys descendants before the parent and before streams`() {
        val events = mutableListOf<String>()
        val proc = RecordingProcess(events)
        val child = RecordingHandle("child", events)

        shutdownTree(
            proc = proc,
            jobKill = false,
            log = TestLog(),
            killJob = {},
            descendants = { listOf(child) },
        )

        assertEquals(listOf("destroy-child", "destroy", "close-stderr", "close-stdout", "close-stdin"), events)
    }

    @Test
    fun `closeStreams closes every stream even when one throws`() {
        val events = mutableListOf<String>()
        val proc = RecordingProcess(events, failStderrClose = true)

        closeStreams(proc, TestLog())

        // stderr close throws, but stdout and stdin must still be closed.
        assertEquals(listOf("close-stderr", "close-stdout", "close-stdin"), events)
    }
}

private class RecordingProcess(
    private val events: MutableList<String>,
    failStderrClose: Boolean = false,
) : Process() {
    private val err = RecordingInput("close-stderr", events, fail = failStderrClose)
    private val out = RecordingInput("close-stdout", events, fail = false)
    private val inp = RecordingOutput("close-stdin", events)

    override fun getErrorStream(): InputStream = err
    override fun getInputStream(): InputStream = out
    override fun getOutputStream(): OutputStream = inp
    override fun waitFor(): Int = 0
    override fun exitValue(): Int = 0
    override fun isAlive(): Boolean = false
    override fun pid(): Long = 4321L
    override fun destroy() {
        events += "destroy"
    }
}

private class RecordingHandle(
    private val label: String,
    private val events: MutableList<String>,
) : ProcessHandle {
    override fun pid(): Long = label.hashCode().toLong()
    override fun info(): ProcessHandle.Info = throw UnsupportedOperationException()
    override fun parent(): java.util.Optional<ProcessHandle> = java.util.Optional.empty()
    override fun children(): java.util.stream.Stream<ProcessHandle> = java.util.stream.Stream.empty()
    override fun descendants(): java.util.stream.Stream<ProcessHandle> = java.util.stream.Stream.empty()
    override fun onExit(): java.util.concurrent.CompletableFuture<ProcessHandle> = java.util.concurrent.CompletableFuture.completedFuture(this)
    override fun supportsNormalTermination(): Boolean = true
    override fun isAlive(): Boolean = false
    override fun compareTo(other: ProcessHandle): Int = pid().compareTo(other.pid())
    override fun destroyForcibly(): Boolean = true
    override fun destroy(): Boolean {
        events += "destroy-$label"
        return true
    }
}

private class RecordingInput(
    private val label: String,
    private val events: MutableList<String>,
    private val fail: Boolean,
) : InputStream() {
    override fun read(): Int = -1
    override fun close() {
        events += label
        if (fail) throw IOException("boom")
    }
}

private class RecordingOutput(
    private val label: String,
    private val events: MutableList<String>,
) : OutputStream() {
    override fun write(b: Int) = Unit
    override fun close() {
        events += label
    }
}
