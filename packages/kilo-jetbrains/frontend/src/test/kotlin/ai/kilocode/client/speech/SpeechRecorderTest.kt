package ai.kilocode.client.speech

import ai.kilocode.client.plugin.KiloBundle
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.jupiter.api.Test
import java.io.ByteArrayInputStream
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioSystem
import javax.sound.sampled.Control
import javax.sound.sampled.DataLine
import javax.sound.sampled.Line
import javax.sound.sampled.LineListener
import javax.sound.sampled.TargetDataLine
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class SpeechRecorderTest {
    companion object {
        private const val WAIT_SECONDS = 5L
        private const val STOP_TIMEOUT_MS = 100L
        private const val MAX_DURATION_MS = 120_000L
        private val FORMAT = AudioFormat(AudioFormat.Encoding.PCM_SIGNED, 16000f, 16, 1, 2, 16000f, false)
    }

    @Test
    fun `encodes captured PCM as a readable WAV file`() {
        val pcm = ByteArray(3200) { index -> (index % 127).toByte() }

        val data = wav(pcm, FORMAT)
        val stream = AudioSystem.getAudioInputStream(ByteArrayInputStream(data))

        stream.use {
            assertEquals(FORMAT.sampleRate, it.format.sampleRate)
            assertEquals(FORMAT.sampleSizeInBits, it.format.sampleSizeInBits)
            assertEquals(FORMAT.channels, it.format.channels)
            assertEquals(FORMAT.isBigEndian, it.format.isBigEndian)
            assertContentEquals(pcm, it.readAllBytes())
        }
    }

    @Test
    fun `wall clock deadline closes a blocked device and preserves captured audio`() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val deadline = CompletableDeferred<Unit>()
        val blocked = CountDownLatch(1)
        val pcm = ByteArray(320) { index -> (index % 127).toByte() }
        val reads = AtomicInteger()
        val line = TestLine(input = { data, offset, _ ->
            if (reads.getAndIncrement() == 0) {
                pcm.copyInto(data, offset)
                pcm.size
            } else {
                blocked.countDown()
                closed.await()
                -1
            }
        })
        val recorder = recorder(scope, line, pause = { deadline.await() })
        val failures = mutableListOf<Throwable>()
        val caps = mutableListOf<Pair<String, Long>>()

        try {
            val id = recorder.start(cap = { token, duration -> caps.add(token to duration) }) { _, err -> failures.add(err) }
            blocked.await("audio read did not block")

            deadline.complete(Unit)
            line.closed.await("deadline did not close the audio line")

            assertContentEquals(pcm, decode(recorder.stop(id)))
            assertTrue(failures.isEmpty())
            assertEquals(listOf(id to MAX_DURATION_MS), caps)
        } finally {
            recorder.dispose()
            scope.cancel()
        }
    }

    @Test
    fun `byte safety cap returns the truncated recording without a limit error`() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val pcm = ByteArray(64) { index -> (index % 127).toByte() }
        val line = TestLine(input = { data, offset, _ ->
            pcm.copyInto(data, offset)
            pcm.size
        })
        val recorder = recorder(scope, line, limit = 1, pause = { awaitCancellation() })
        val failures = mutableListOf<Throwable>()
        val caps = mutableListOf<Pair<String, Long>>()

        try {
            val id = recorder.start(cap = { token, duration -> caps.add(token to duration) }) { _, err -> failures.add(err) }
            line.closed.await("byte cap did not close the audio line")

            assertContentEquals(pcm.copyOf(32), decode(recorder.stop(id)))
            assertTrue(failures.isEmpty())
            assertEquals(listOf(id to 1L), caps)
        } finally {
            recorder.dispose()
            scope.cancel()
        }
    }

    @Test
    fun `stop timeout retains the capture for disposal`() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val reading = CountDownLatch(1)
        val closing = CountDownLatch(1)
        val release = CountDownLatch(1)
        val line = TestLine(
            input = { _, _, _ ->
                reading.countDown()
                closed.await()
                -1
            },
            shutdown = {
                if (closes.get() == 1) {
                    closing.countDown()
                    release.await()
                }
                finish()
            },
        )
        val recorder = recorder(scope, line, timeout = STOP_TIMEOUT_MS)

        try {
            val id = recorder.start { _, _ -> }
            reading.await("audio read did not start")

            val err = runCatching { recorder.stop(id) }.exceptionOrNull()
            assertIs<TimeoutCancellationException>(err)
            closing.await("stop did not attempt to close the audio line")

            val restart = scope.async { runCatching { recorder.start { _, _ -> } }.exceptionOrNull() }
            val restartErr = withTimeout(TimeUnit.SECONDS.toMillis(WAIT_SECONDS)) { restart.await() }
            assertIs<IllegalStateException>(restartErr)
            assertEquals(KiloBundle.message("prompt.speech.microphone"), restartErr.message)

            recorder.dispose()
            line.closed.await("dispose did not retry the timed-out close")
            assertTrue(line.closes.get() >= 2)
        } finally {
            release.countDown()
            recorder.dispose()
            scope.cancel()
        }
    }

    @Test
    fun `throwing stop close remains tracked for disposal retry`() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val reading = CountDownLatch(1)
        val failure = IllegalStateException("close failed")
        val line = TestLine(
            input = { _, _, _ ->
                reading.countDown()
                closed.await()
                -1
            },
            shutdown = {
                if (closes.get() == 1) throw failure
                finish()
            },
        )
        val recorder = recorder(scope, line, timeout = STOP_TIMEOUT_MS)

        try {
            val id = recorder.start { _, _ -> }
            reading.await("audio read did not start")

            val err = assertIs<IllegalStateException>(runCatching { recorder.stop(id) }.exceptionOrNull())
            assertEquals(failure.message, err.message)

            val restart = scope.async { runCatching { recorder.start { _, _ -> } }.exceptionOrNull() }
            val restartErr = withTimeout(TimeUnit.SECONDS.toMillis(WAIT_SECONDS)) { restart.await() }
            assertIs<IllegalStateException>(restartErr)
            assertEquals(KiloBundle.message("prompt.speech.microphone"), restartErr.message)

            recorder.dispose()
            line.closed.await("dispose did not retry the throwing close")
            assertTrue(line.closes.get() >= 2)
        } finally {
            recorder.dispose()
            scope.cancel()
        }
    }

    @Test
    fun `failure callback exception cannot strand recorder completion`() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val failed = CountDownLatch(1)
        val second = TestLine(input = { _, _, _ ->
            closed.await()
            -1
        })
        val lines = ConcurrentLinkedQueue(
            listOf(
                TestLine(input = { _, _, _ -> throw IllegalStateException("read failed") }),
                second,
            ),
        )
        val recorder = recorder(scope, source = { lines.remove() })

        try {
            recorder.start { _, _ ->
                failed.countDown()
                throw IllegalStateException("callback failed")
            }
            failed.await("failure callback was not invoked")

            val next = scope.async { recorder.start { _, _ -> } }
            val id = withTimeout(TimeUnit.SECONDS.toMillis(WAIT_SECONDS)) { next.await() }
            recorder.cancel(id)
            second.closed.await("a new capture could not complete after callback failure")
        } finally {
            recorder.dispose()
            scope.cancel()
        }
    }

    @Test
    fun `capture failure close exception remains reachable by dispose`() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val failed = CountDownLatch(1)
        val started = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val line = TestLine(
            input = { _, _, _ ->
                started.await()
                throw IllegalStateException("read failed")
            },
            shutdown = {
                if (closes.get() == 1) throw IllegalStateException("close failed")
                finish()
            },
        )
        val recorder = recorder(
            scope,
            line,
            pause = {
                started.countDown()
                try {
                    awaitCancellation()
                } finally {
                    finished.countDown()
                }
            },
        )

        try {
            recorder.start { _, _ ->
                failed.countDown()
                throw IllegalStateException("callback failed")
            }
            failed.await("failure callback was not invoked")
            finished.await("capture cleanup did not finish after callback failure")

            recorder.dispose()
            line.closed.await("dispose did not retry capture failure cleanup")
            assertTrue(line.closes.get() >= 2)
        } finally {
            recorder.dispose()
            scope.cancel()
        }
    }

    private fun recorder(
        scope: CoroutineScope,
        line: TestLine? = null,
        source: () -> TestLine = { requireNotNull(line) },
        pause: suspend (Long) -> Unit = { awaitCancellation() },
        limit: Long = MAX_DURATION_MS,
        timeout: Long = 1000,
    ) = SpeechRecorder(scope, { source() }, pause, limit, timeout)

    private fun decode(data: ByteArray): ByteArray =
        AudioSystem.getAudioInputStream(ByteArrayInputStream(data)).use { it.readAllBytes() }

    private fun CountDownLatch.await(message: String) {
        assertTrue(await(WAIT_SECONDS, TimeUnit.SECONDS), message)
    }

    private class TestLine(
        private val input: TestLine.(ByteArray, Int, Int) -> Int,
        private val shutdown: TestLine.() -> Unit = { finish() },
    ) : TargetDataLine {
        private val opened = AtomicBoolean(false)
        private val running = AtomicBoolean(false)

        @Volatile
        private var audio = FORMAT

        val closes = AtomicInteger()
        val closed = CountDownLatch(1)

        fun finish() {
            running.set(false)
            opened.set(false)
            closed.countDown()
        }

        override fun open(format: AudioFormat) {
            audio = format
            opened.set(true)
        }

        override fun open(format: AudioFormat, bufferSize: Int) = open(format)

        override fun open() {
            opened.set(true)
        }

        override fun close() {
            closes.incrementAndGet()
            shutdown()
        }

        override fun start() {
            running.set(true)
        }

        override fun stop() {
            running.set(false)
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int = input(buffer, offset, length)

        override fun isOpen(): Boolean = opened.get()

        override fun isRunning(): Boolean = running.get()

        override fun isActive(): Boolean = running.get()

        override fun getFormat(): AudioFormat = audio

        override fun getBufferSize(): Int = 4096

        override fun available(): Int = 0

        override fun drain() = Unit

        override fun flush() = Unit

        override fun getFramePosition(): Int = 0

        override fun getLongFramePosition(): Long = 0

        override fun getMicrosecondPosition(): Long = 0

        override fun getLevel(): Float = 0f

        override fun getLineInfo(): Line.Info = DataLine.Info(TargetDataLine::class.java, audio)

        override fun getControls(): Array<Control> = emptyArray()

        override fun isControlSupported(control: Control.Type): Boolean = false

        override fun getControl(control: Control.Type): Control = throw IllegalArgumentException("Unsupported control: $control")

        override fun addLineListener(listener: LineListener) = Unit

        override fun removeLineListener(listener: LineListener) = Unit
    }
}
