package ai.kilocode.client.speech

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.log.KiloLog
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import javax.sound.sampled.AudioFileFormat
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioInputStream
import javax.sound.sampled.AudioSystem
import javax.sound.sampled.DataLine
import javax.sound.sampled.TargetDataLine

@Service(Service.Level.APP)
internal class SpeechRecorder internal constructor(
    private val cs: CoroutineScope,
    private val source: (DataLine.Info) -> TargetDataLine,
    private val pause: suspend (Long) -> Unit,
    private val limit: Long,
    private val timeout: Long,
) : SpeechCapture, Disposable {
    constructor(cs: CoroutineScope) : this(
        cs,
        { info -> AudioSystem.getLine(info) as TargetDataLine },
        { delay(it) },
        MAX_DURATION_MS,
        STOP_TIMEOUT_MS,
    )

    companion object {
        private val LOG = KiloLog.create(SpeechRecorder::class.java)
        private const val STOP_TIMEOUT_MS = 5000L
        private const val MAX_DURATION_MS = 120_000L
        private const val PCM_BITS = 16
        private const val PCM_BYTES = 2
        private const val BUFFER_FRAMES = 1024
        private const val BUFFER_DIVISOR = 5
        private val FORMATS = listOf(16000f, 44100f, 48000f).flatMap { rate ->
            listOf(1, 2).map { channels ->
                AudioFormat(
                    AudioFormat.Encoding.PCM_SIGNED,
                    rate,
                    PCM_BITS,
                    channels,
                    channels * PCM_BYTES,
                    rate,
                    false,
                )
            }
        }
    }

    private class Capture(
        val id: String,
        val line: TargetDataLine,
        val format: AudioFormat,
        val cap: (String, Long) -> Unit,
        val fail: (String, Throwable) -> Unit,
    ) {
        val data = ByteArrayOutputStream()
        val done = CompletableDeferred<Unit>()
        val closed = CompletableDeferred<Unit>()
        val error = AtomicReference<Throwable?>()
        val stopped = AtomicBoolean(false)
        val deadline = AtomicReference<Job?>()
    }

    private val lock = Any()
    private var starting = false
    private var active: Capture? = null
    private val closing = mutableSetOf<Capture>()
    private var unavailable: Throwable? = null
    private var disposed = false

    override suspend fun start(
        cap: (String, Long) -> Unit,
        fail: (String, Throwable) -> Unit,
    ): String = withContext(NonCancellable) {
        synchronized(lock) { unavailable }?.let { throw SpeechRecorderUnavailableException(it) }
        runCatching {
            withTimeout(timeout) {
                while (true) {
                    val wait = synchronized(lock) { closing.firstOrNull()?.closed } ?: break
                    wait.await()
                }
            }
        }.getOrElse { err ->
            markUnavailable(err)
            throw SpeechRecorderUnavailableException(err)
        }
        synchronized(lock) {
            check(!disposed) { "Speech recorder is disposed" }
            check(!starting && active == null) { "Speech recording is already in progress" }
            starting = true
        }

        val result = runCatching { withContext(Dispatchers.IO) { open(cap, fail) } }
        synchronized(lock) { starting = false }
        val item = result.getOrThrow()
        val accepted = synchronized(lock) {
            if (!disposed && active == null) {
                active = item
                true
            } else {
                false
            }
        }
        if (!accepted) {
            withContext(Dispatchers.IO) { close(item) }
            error(if (disposed) "Speech recorder is disposed" else "Speech recording is already in progress")
        }

        val deadline = cs.launch(start = CoroutineStart.LAZY) { expire(item) }
        item.deadline.set(deadline)
        cs.launch(Dispatchers.IO) { capture(item) }
        deadline.start()
        item.id
    }

    override suspend fun stop(id: String): ByteArray {
        val item = synchronized(lock) {
            val value = active?.takeIf { it.id == id } ?: error("No active speech recording")
            active = null
            value.stopped.set(true)
            closing.add(value)
            value
        }
        val attempt = finish(item)
        return withContext(NonCancellable + Dispatchers.IO) {
            runCatching {
                withTimeout(timeout) {
                    attempt.await().getOrThrow()
                    item.done.await()
                }
            }.getOrElse { err ->
                markUnavailable(err)
                throw SpeechRecorderUnavailableException(err)
            }
            settle(item)
            item.error.get()?.let { throw it }
            check(item.data.size() > 0) { KiloBundle.message("prompt.speech.empty") }
            wav(item.data.toByteArray(), item.format)
        }
    }

    override fun cancel(id: String) {
        val item = synchronized(lock) {
            val value = active?.takeIf { it.id == id } ?: return
            active = null
            value.stopped.set(true)
            closing.add(value)
            value
        }
        val attempt = finish(item)
        cs.launch {
            attempt.await().exceptionOrNull()?.let(::markUnavailable)
        }
    }

    override fun dispose() {
        val items = synchronized(lock) {
            disposed = true
            val values = buildList {
                active?.let(::add)
                addAll(closing)
            }.distinct()
            active = null
            values.onEach { it.stopped.set(true) }
        }
        items.forEach { item ->
            val result = runCatching { close(item) }
                .onFailure { LOG.warn("failed to close disposed speech recording", it) }
            if (result.isSuccess) item.done.invokeOnCompletion { settle(item) }
        }
    }

    private fun open(cap: (String, Long) -> Unit, fail: (String, Throwable) -> Unit): Capture {
        val errors = mutableListOf<Throwable>()
        val item = FORMATS.firstNotNullOfOrNull { format ->
            open(format, cap, fail).onFailure { errors.add(it) }.getOrNull()
        }
        if (item != null) return item
        val err = errors.lastOrNull()
        val detail = err?.message?.takeIf { it.isNotBlank() }
        throw IllegalStateException(
            KiloBundle.message("prompt.speech.microphone") + if (detail == null) "" else ": $detail",
            err,
        )
    }

    private fun open(
        format: AudioFormat,
        cap: (String, Long) -> Unit,
        fail: (String, Throwable) -> Unit,
    ): Result<Capture> = runCatching {
        val info = DataLine.Info(TargetDataLine::class.java, format)
        val line = source(info)
        runCatching {
            line.open(format)
            line.start()
        }.onFailure {
            if (line.isOpen) line.close()
        }.getOrThrow()
        Capture(UUID.randomUUID().toString(), line, format, cap, fail)
    }

    private fun capture(item: Capture) {
        val result = runCatching {
            val size = (item.line.bufferSize / BUFFER_DIVISOR)
                .coerceAtLeast(item.format.frameSize * BUFFER_FRAMES)
            val buffer = ByteArray(size - size % item.format.frameSize)
            val max = (item.format.frameRate.toDouble() * item.format.frameSize * limit / 1000)
                .toInt()
                .coerceAtLeast(item.format.frameSize)
            while (!item.stopped.get()) {
                val count = item.line.read(buffer, 0, buffer.size)
                if (count > 0) {
                    val remaining = (max - item.data.size()).coerceAtLeast(0)
                    item.data.write(buffer, 0, count.coerceAtMost(remaining))
                    if (item.data.size() >= max && item.stopped.compareAndSet(false, true)) {
                        cap(item)
                    }
                }
            }
        }
        val failure = result.exceptionOrNull()?.takeIf { item.stopped.compareAndSet(false, true) }
        var closed = false
        try {
            if (failure == null) return
            item.error.compareAndSet(null, failure)
            synchronized(lock) {
                closing.add(item)
            }
            val close = runCatching { close(item) }
                .onFailure { LOG.warn("failed to close failed speech recording", it) }
            closed = close.isSuccess
            LOG.warn("speech recording failed", failure)
            runCatching { item.fail(item.id, failure) }
                .onFailure { LOG.warn("speech recording failure callback failed", it) }
        } finally {
            item.deadline.get()?.cancel()
            if (failure != null) {
                synchronized(lock) {
                    if (active === item) active = null
                }
            }
            item.done.complete(Unit)
            if (closed) settle(item)
        }
    }

    private fun close(item: Capture) {
        val stopped = runCatching {
            if (item.line.isRunning) item.line.stop()
        }.exceptionOrNull()
        runCatching { item.line.close() }
            .onFailure { err -> stopped?.let(err::addSuppressed) }
            .getOrThrow()
        stopped?.let { LOG.warn("failed to stop speech recording before close", it) }
    }

    private suspend fun expire(item: Capture) {
        pause(limit)
        if (!item.stopped.compareAndSet(false, true)) return
        withContext(Dispatchers.IO) { cap(item) }
    }

    private fun cap(item: Capture) {
        runCatching { item.cap(item.id, limit) }
            .onFailure { LOG.warn("speech recording limit callback failed", it) }
        runCatching { close(item) }
            .onFailure { LOG.warn("failed to close limited speech recording", it) }
    }

    private fun finish(item: Capture): CompletableDeferred<Result<Unit>> {
        val attempt = CompletableDeferred<Result<Unit>>()
        cs.launch(Dispatchers.IO) {
            val result = runCatching { close(item) }
                .onFailure { LOG.warn("failed to close speech recording", it) }
            if (result.isSuccess) item.done.invokeOnCompletion { settle(item) }
            attempt.complete(result)
        }
        return attempt
    }

    private fun settle(item: Capture) {
        synchronized(lock) {
            closing.remove(item)
            if (closing.isEmpty()) unavailable = null
        }
        item.closed.complete(Unit)
    }

    private fun markUnavailable(err: Throwable) {
        synchronized(lock) { unavailable = err }
    }
}

private class SpeechRecorderUnavailableException(cause: Throwable) : IllegalStateException(
    "Speech recorder is unavailable because the previous microphone could not close",
    cause,
)

interface SpeechCapture {
    suspend fun start(
        cap: (String, Long) -> Unit = { _, _ -> },
        fail: (String, Throwable) -> Unit,
    ): String

    suspend fun stop(id: String): ByteArray

    fun cancel(id: String)
}

internal fun wav(data: ByteArray, format: AudioFormat): ByteArray {
    val out = ByteArrayOutputStream()
    val frames = data.size.toLong() / format.frameSize
    AudioInputStream(ByteArrayInputStream(data), format, frames).use { input ->
        AudioSystem.write(input, AudioFileFormat.Type.WAVE, out)
    }
    return out.toByteArray()
}
