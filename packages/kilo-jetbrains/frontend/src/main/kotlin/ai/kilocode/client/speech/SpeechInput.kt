package ai.kilocode.client.speech

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

internal enum class SpeechInputState {
    IDLE,
    STARTING,
    RECORDING,
    TRANSCRIBING,
    ERROR,
}

internal class SpeechInput(
    private val cs: CoroutineScope,
    private val capture: SpeechCapture,
    private val transcribe: suspend (ByteArray) -> String,
    private val insert: (String) -> Unit,
    private val change: (SpeechInputState, String?) -> Unit,
    private val notice: (String) -> Unit = {},
) {
    var state = SpeechInputState.IDLE
        private set
    var error: String? = null
        private set

    private var id: String? = null
    private var job: Job? = null
    private var pending: Finish? = null
    private var generation = 0L
    private var opening = false
    private var restart = false
    private var cap: Cap? = null
    private var notified: String? = null

    private data class Finish(
        val done: (() -> Unit)?,
        val ready: (() -> Boolean)?,
    )

    private data class Cap(
        val id: String,
        val duration: Long,
    )

    @RequiresEdt
    fun toggle() {
        when (state) {
            SpeechInputState.IDLE -> start()
            SpeechInputState.STARTING -> stop()
            SpeechInputState.RECORDING -> stop()
            SpeechInputState.TRANSCRIBING -> Unit
            SpeechInputState.ERROR -> update(SpeechInputState.IDLE)
        }
    }

    @RequiresEdt
    fun start() {
        if (state != SpeechInputState.IDLE) return
        cap = null
        notified = null
        update(SpeechInputState.STARTING)
        if (opening) {
            restart = true
            return
        }
        launch()
    }

    @RequiresEdt
    private fun launch() {
        val attempt = ++generation
        val modality = ModalityState.current().asContextElement()
        opening = true
        job = cs.launch(modality) {
            val result = runCatching {
                capture.start(
                    cap = { token, duration ->
                        cs.launch(modality) {
                            withContext(Dispatchers.EDT) {
                                capped(attempt, token, duration)
                            }
                        }
                    },
                ) { token, err ->
                    cs.launch(modality) {
                        withContext(Dispatchers.EDT) {
                            if (attempt == generation) {
                                val current = state == SpeechInputState.STARTING || state == SpeechInputState.RECORDING
                                if (current && (id == null || id == token)) failed(err)
                            }
                        }
                    }
                }
            }
            withContext(NonCancellable + Dispatchers.EDT) {
                opening = false
                result.onSuccess { token -> started(attempt, token) }.onFailure { err ->
                    if (attempt == generation && state == SpeechInputState.STARTING) failed(err)
                }
                if (restart && state == SpeechInputState.STARTING) {
                    restart = false
                    launch()
                }
            }
        }
    }

    @RequiresEdt
    fun stop(done: (() -> Unit)? = null, ready: (() -> Boolean)? = null) {
        when (state) {
            SpeechInputState.STARTING -> pending = Finish(done, ready)
            SpeechInputState.RECORDING -> stopRecording(done, ready)
            else -> Unit
        }
    }

    @RequiresEdt
    private fun stopRecording(done: (() -> Unit)?, ready: (() -> Boolean)?) {
        val token = id
        if (token == null) {
            failed(IllegalStateException("No active speech recording"))
            return
        }
        update(SpeechInputState.TRANSCRIBING)
        job = cs.launch(ModalityState.current().asContextElement()) {
            val result = runCatching { transcribe(capture.stop(token)) }
            withContext(Dispatchers.EDT) {
                result.onSuccess { text -> completed(text, Finish(done, ready)) }.onFailure(::failed)
            }
        }
    }

    @RequiresEdt
    fun cancel() {
        generation++
        restart = false
        job?.cancel()
        id?.let(capture::cancel)
        id = null
        pending = null
        cap = null
        notified = null
        update(SpeechInputState.IDLE)
    }

    @RequiresEdt
    private fun started(attempt: Long, token: String) {
        if (attempt != generation || state != SpeechInputState.STARTING) {
            capture.cancel(token)
            return
        }
        id = token
        update(SpeechInputState.RECORDING)
        val reached = cap?.takeIf { it.id == token }
        cap = null
        if (reached != null) {
            capped(attempt, reached.id, reached.duration)
            return
        }
        val finish = pending ?: return
        pending = null
        stop(finish.done, finish.ready)
    }

    @RequiresEdt
    private fun capped(attempt: Long, token: String, duration: Long) {
        if (attempt != generation) return
        if (id == null && state == SpeechInputState.STARTING) {
            cap = Cap(token, duration)
            return
        }
        if (id != token || notified == token) return
        if (state != SpeechInputState.RECORDING && state != SpeechInputState.TRANSCRIBING) return
        notified = token
        if (state == SpeechInputState.RECORDING) {
            val finish = pending
            pending = null
            stopRecording(finish?.done, finish?.ready)
        }
        notice(KiloBundle.message("prompt.speech.limit", TimeUnit.MILLISECONDS.toMinutes(duration)))
    }

    @RequiresEdt
    private fun completed(value: String, finish: Finish) {
        val text = value.trim()
        if (text.isEmpty()) return failed(IllegalStateException(KiloBundle.message("prompt.speech.empty")))
        runCatching {
            val done = finish.done.takeUnless { finish.ready?.invoke() == false }
            insert(text)
            done
        }.onSuccess { done ->
            id = null
            job = null
            cap = null
            update(SpeechInputState.IDLE)
            done?.invoke()
        }.onFailure(::failed)
    }

    @RequiresEdt
    private fun failed(err: Throwable) {
        generation++
        restart = false
        id = null
        job = null
        pending = null
        cap = null
        notified = null
        update(SpeechInputState.ERROR, err.message ?: KiloBundle.message("prompt.speech.error.title"))
    }

    @RequiresEdt
    private fun update(value: SpeechInputState, message: String? = null) {
        state = value
        error = message
        change(value, message)
    }
}
