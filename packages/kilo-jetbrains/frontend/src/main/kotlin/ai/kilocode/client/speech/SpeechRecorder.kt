package ai.kilocode.client.speech

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.log.KiloLog
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
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
internal class SpeechRecorder(
    private val cs: CoroutineScope,
) : SpeechCapture, Disposable {
    companion object {
        private val LOG = KiloLog.create(SpeechRecorder::class.java)
        private const val STOP_TIMEOUT_MS = 5000L
        private const val MAX_SECONDS = 120
        private const val PCM_BITS = 16
        private const val PCM_BYTES = 2
        private const val BUFFER_FRAMES = 1024
        private const val BUFFER_DIVISOR = 5
        private const val MINUTE_SECONDS = 60
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
        val fail: (String, Throwable) -> Unit,
    ) {
        val data = ByteArrayOutputStream()
        val done = CompletableDeferred<Unit>()
        val closed = CompletableDeferred<Unit>()
        val error = AtomicReference<Throwable?>()
        val stopped = AtomicBoolean(false)
    }

    private val lock = Any()
    private var starting = false
    private var active: Capture? = null
    private val closing = mutableSetOf<Capture>()
    private var disposed = false

    override suspend fun start(fail: (String, Throwable) -> Unit): String = withContext(NonCancellable) {
        while (true) {
            val wait = synchronized(lock) { closing.firstOrNull()?.closed } ?: break
            wait.await()
        }
        synchronized(lock) {
            check(!disposed) { "Speech recorder is disposed" }
            check(!starting && active == null) { "Speech recording is already in progress" }
            starting = true
        }

        val result = runCatching { withContext(Dispatchers.IO) { open(fail) } }
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

        cs.launch(Dispatchers.IO) { capture(item) }
        item.id
    }

    override suspend fun stop(id: String): ByteArray {
        val item = synchronized(lock) {
            val value = active?.takeIf { it.id == id } ?: error("No active speech recording")
            active = null
            value.stopped.set(true)
            value
        }
        return withContext(NonCancellable + Dispatchers.IO) {
            close(item)
            withTimeout(STOP_TIMEOUT_MS) { item.done.await() }
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
        cs.launch(Dispatchers.IO) {
            val result = runCatching { close(item) }
            synchronized(lock) { closing.remove(item) }
            item.closed.complete(Unit)
            result.exceptionOrNull()?.let { LOG.warn("failed to close cancelled speech recording", it) }
        }
    }

    override fun dispose() {
        val items = synchronized(lock) {
            disposed = true
            val values = buildList {
                active?.let(::add)
                addAll(closing)
            }
            active = null
            closing.clear()
            values.onEach { it.stopped.set(true) }
        }
        items.forEach { item ->
            runCatching { close(item) }
                .onFailure { LOG.warn("failed to close disposed speech recording", it) }
            item.closed.complete(Unit)
        }
    }

    private fun open(fail: (String, Throwable) -> Unit): Capture {
        val errors = mutableListOf<Throwable>()
        val item = FORMATS.firstNotNullOfOrNull { format ->
            open(format, fail).onFailure { errors.add(it) }.getOrNull()
        }
        if (item != null) return item
        val err = errors.lastOrNull()
        val detail = err?.message?.takeIf { it.isNotBlank() }
        throw IllegalStateException(
            KiloBundle.message("prompt.speech.microphone") + if (detail == null) "" else ": $detail",
            err,
        )
    }

    private fun open(format: AudioFormat, fail: (String, Throwable) -> Unit): Result<Capture> = runCatching {
        val info = DataLine.Info(TargetDataLine::class.java, format)
        val line = AudioSystem.getLine(info) as TargetDataLine
        runCatching {
            line.open(format)
            line.start()
        }.onFailure {
            if (line.isOpen) line.close()
        }.getOrThrow()
        Capture(UUID.randomUUID().toString(), line, format, fail)
    }

    private fun capture(item: Capture) {
        val size = (item.line.bufferSize / BUFFER_DIVISOR)
            .coerceAtLeast(item.format.frameSize * BUFFER_FRAMES)
        val buffer = ByteArray(size - size % item.format.frameSize)
        val limit = (item.format.frameRate * item.format.frameSize * MAX_SECONDS).toInt()
        val result = runCatching {
            while (!item.stopped.get()) {
                val count = item.line.read(buffer, 0, buffer.size)
                if (count > 0) {
                    val remaining = (limit - item.data.size()).coerceAtLeast(0)
                    item.data.write(buffer, 0, count.coerceAtMost(remaining))
                    if (count > remaining) {
                        item.error.set(
                            IllegalStateException(
                                KiloBundle.message("prompt.speech.limit", MAX_SECONDS / MINUTE_SECONDS),
                            ),
                        )
                        item.stopped.set(true)
                        close(item)
                    }
                }
            }
        }
        val err = result.exceptionOrNull()
        val failure = item.error.get() ?: err?.takeUnless { item.stopped.get() }
        if (failure != null) {
            item.error.set(failure)
            if (!item.stopped.getAndSet(true)) close(item)
            synchronized(lock) {
                if (active === item) active = null
            }
            LOG.warn("speech recording failed", failure)
            item.fail(item.id, failure)
        }
        item.done.complete(Unit)
    }

    private fun close(item: Capture) {
        if (item.line.isRunning) item.line.stop()
        if (item.line.isOpen) item.line.close()
    }
}

interface SpeechCapture {
    suspend fun start(fail: (String, Throwable) -> Unit): String

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
