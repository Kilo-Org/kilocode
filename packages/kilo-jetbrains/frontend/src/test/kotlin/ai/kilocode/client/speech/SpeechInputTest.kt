package ai.kilocode.client.speech

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.util.edtWait
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

class SpeechInputTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
    }

    override fun tearDown() {
        try {
            coroutines.close()
        } finally {
            super.tearDown()
        }
    }

    fun `test records transcribes and inserts returned text`() {
        val capture = Capture()
        val states = mutableListOf<SpeechInputState>()
        val inserted = mutableListOf<String>()
        val input = SpeechInput(
            coroutines.scope,
            capture,
            transcribe = { data ->
                assertTrue(data.contentEquals(byteArrayOf(1, 2, 3)))
                " dictated prompt "
            },
            insert = inserted::add,
            change = { state, _ -> states.add(state) },
        )

        edtWait { input.start() }
        capture.started.complete("recording")
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.RECORDING } })

        edtWait { input.stop() }
        capture.stopped.complete(byteArrayOf(1, 2, 3))
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.IDLE } })

        assertEquals(listOf("dictated prompt"), inserted)
        assertEquals(
            listOf(
                SpeechInputState.STARTING,
                SpeechInputState.RECORDING,
                SpeechInputState.TRANSCRIBING,
                SpeechInputState.IDLE,
            ),
            states,
        )
    }

    fun `test second toggle during startup waits for microphone then stops`() {
        val capture = Capture()
        val inserted = mutableListOf<String>()
        val input = SpeechInput(
            coroutines.scope,
            capture,
            transcribe = { "hello" },
            insert = inserted::add,
            change = { _, _ -> },
        )

        edtWait {
            input.start()
            input.toggle()
        }
        capture.started.complete("recording")
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.TRANSCRIBING } })
        capture.stopped.complete(byteArrayOf(1))
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.IDLE } })

        assertEquals(listOf("hello"), inserted)
    }

    fun `test recording limit automatically transcribes and notifies once`() {
        val capture = Capture()
        val states = mutableListOf<SpeechInputState>()
        val inserted = mutableListOf<String>()
        val notices = mutableListOf<String>()
        val input = SpeechInput(
            coroutines.scope,
            capture,
            transcribe = { "truncated prompt" },
            insert = inserted::add,
            change = { state, _ -> states.add(state) },
            notice = notices::add,
        )

        edtWait { input.start() }
        assertTrue(coroutines.pumpUntil { capture.entered.isCompleted })
        capture.limit()
        capture.limit()
        capture.started.complete("recording")
        assertTrue(coroutines.pumpUntil {
            edtWait { input.state == SpeechInputState.TRANSCRIBING } && notices.size == 1
        })
        capture.stopped.complete(byteArrayOf(1))
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.IDLE } })

        assertEquals(1, capture.stops)
        assertEquals(listOf("truncated prompt"), inserted)
        assertEquals(listOf(KiloBundle.message("prompt.speech.limit", 2)), notices)
        assertEquals(
            listOf(
                SpeechInputState.STARTING,
                SpeechInputState.RECORDING,
                SpeechInputState.TRANSCRIBING,
                SpeechInputState.IDLE,
            ),
            states,
        )
    }

    fun `test manual stop racing recording limit transcribes and notifies once`() {
        val capture = Capture()
        val inserted = mutableListOf<String>()
        val notices = mutableListOf<String>()
        val input = SpeechInput(
            coroutines.scope,
            capture,
            transcribe = { "truncated prompt" },
            insert = inserted::add,
            change = { _, _ -> },
            notice = notices::add,
        )

        edtWait { input.start() }
        capture.started.complete("recording")
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.RECORDING } })

        capture.limit()
        edtWait { input.stop() }
        assertTrue(coroutines.pumpUntil { notices.size == 1 && capture.stops == 1 })
        capture.stopped.complete(byteArrayOf(1))
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.IDLE } })

        assertEquals(listOf("truncated prompt"), inserted)
        assertEquals(listOf(KiloBundle.message("prompt.speech.limit", 2)), notices)
    }

    fun `test cancel racing recording limit suppresses stale notification and transcription`() {
        val capture = Capture()
        val notices = mutableListOf<String>()
        val input = SpeechInput(
            coroutines.scope,
            capture,
            transcribe = { "unused" },
            insert = {},
            change = { _, _ -> },
            notice = notices::add,
        )

        edtWait { input.start() }
        capture.started.complete("recording")
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.RECORDING } })

        capture.limit()
        edtWait { input.cancel() }
        coroutines.drain()

        assertEquals(SpeechInputState.IDLE, edtWait { input.state })
        assertEquals("recording", capture.cancelled)
        assertEquals(0, capture.stops)
        assertTrue(notices.isEmpty())
    }

    fun `test cancel during startup releases microphone after it opens`() {
        val capture = Capture()
        val input = SpeechInput(
            coroutines.scope,
            capture,
            transcribe = { "unused" },
            insert = {},
            change = { _, _ -> },
        )

        edtWait { input.start() }
        assertTrue(coroutines.pumpUntil { capture.entered.isCompleted })
        edtWait { input.cancel() }
        capture.started.complete("recording")
        assertTrue(coroutines.pumpUntil { capture.cancelled == "recording" })

        assertEquals(SpeechInputState.IDLE, edtWait { input.state })
    }

    fun `test transcription failure enters error state and toggle resets it`() {
        val capture = Capture()
        val input = SpeechInput(
            coroutines.scope,
            capture,
            transcribe = { error("gateway unavailable") },
            insert = {},
            change = { _, _ -> },
        )

        edtWait { input.start() }
        capture.started.complete("recording")
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.RECORDING } })
        edtWait { input.stop() }
        capture.stopped.complete(byteArrayOf(1))
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.ERROR } })

        assertEquals("gateway unavailable", edtWait { input.error })
        edtWait { input.toggle() }
        assertEquals(SpeechInputState.IDLE, edtWait { input.state })
    }

    fun `test insertion failure clears recording and reports error without completion`() {
        val capture = Capture()
        var done = false
        val input = SpeechInput(
            coroutines.scope,
            capture,
            transcribe = { "hello" },
            insert = { error("document is read-only") },
            change = { _, _ -> },
        )

        edtWait { input.start() }
        capture.started.complete("recording")
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.RECORDING } })
        edtWait { input.stop(done = { done = true }) }
        capture.stopped.complete(byteArrayOf(1))
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.ERROR } })

        assertEquals("document is read-only", edtWait { input.error })
        assertFalse(done)
        edtWait { input.cancel() }
        assertNull(capture.cancelled)
    }

    fun `test callee cancellation enters error state`() {
        val capture = Capture()
        val input = SpeechInput(
            coroutines.scope,
            capture,
            transcribe = { throw CancellationException("transcription timed out") },
            insert = {},
            change = { _, _ -> },
        )

        edtWait { input.start() }
        capture.started.complete("recording")
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.RECORDING } })
        edtWait { input.stop() }
        capture.stopped.complete(byteArrayOf(1))
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.ERROR } })

        assertEquals("transcription timed out", edtWait { input.error })
    }

    fun `test capture failure enters error state without a manual stop`() {
        val capture = Capture()
        val input = SpeechInput(
            coroutines.scope,
            capture,
            transcribe = { "unused" },
            insert = {},
            change = { _, _ -> },
        )

        edtWait { input.start() }
        capture.started.complete("recording")
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.RECORDING } })
        capture.fail(IllegalStateException("microphone disconnected"))
        assertTrue(coroutines.pumpUntil { edtWait { input.state == SpeechInputState.ERROR } })

        assertEquals("microphone disconnected", edtWait { input.error })
    }

    fun `test restart ignores a late completion from the cancelled start`() {
        val capture = RestartCapture()
        val input = SpeechInput(
            coroutines.scope,
            capture,
            transcribe = { "unused" },
            insert = {},
            change = { _, _ -> },
        )

        edtWait { input.start() }
        assertTrue(coroutines.pumpUntil { capture.entered.isCompleted })
        edtWait {
            input.cancel()
            input.start()
        }
        capture.first.complete("old")
        assertTrue(coroutines.pumpUntil {
            edtWait { capture.starts == 2 && input.state == SpeechInputState.RECORDING }
        })

        assertEquals(listOf("old"), capture.cancelled)
    }

    private class Capture : SpeechCapture {
        val started = CompletableDeferred<String>()
        val stopped = CompletableDeferred<ByteArray>()
        val entered = CompletableDeferred<Unit>()

        @Volatile
        var cancelled: String? = null
        @Volatile
        var stops = 0
        @Volatile
        private var cap: ((String, Long) -> Unit)? = null
        private var failure: ((String, Throwable) -> Unit)? = null

        override suspend fun start(
            cap: (String, Long) -> Unit,
            fail: (String, Throwable) -> Unit,
        ): String = withContext(NonCancellable) {
            this@Capture.cap = cap
            failure = fail
            entered.complete(Unit)
            started.await()
        }

        override suspend fun stop(id: String): ByteArray {
            assertEquals("recording", id)
            stops++
            return stopped.await()
        }

        override fun cancel(id: String) {
            cancelled = id
        }

        fun fail(err: Throwable) {
            failure?.invoke("recording", err)
        }

        fun limit() {
            requireNotNull(cap).invoke("recording", 120_000)
        }
    }

    private class RestartCapture : SpeechCapture {
        val first = CompletableDeferred<String>()
        val entered = CompletableDeferred<Unit>()
        val cancelled = mutableListOf<String>()
        var starts = 0

        override suspend fun start(
            cap: (String, Long) -> Unit,
            fail: (String, Throwable) -> Unit,
        ): String {
            starts++
            if (starts > 1) return "new"
            return withContext(NonCancellable) {
                entered.complete(Unit)
                first.await()
            }
        }

        override suspend fun stop(id: String): ByteArray = byteArrayOf()

        override fun cancel(id: String) {
            cancelled.add(id)
        }
    }
}
