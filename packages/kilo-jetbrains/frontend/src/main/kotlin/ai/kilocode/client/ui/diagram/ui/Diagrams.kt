@file:Suppress("UnstableApiUsage", "DEPRECATION")

package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.ui.diagram.AwtMeasure
import ai.kilocode.client.ui.diagram.Engine
import ai.kilocode.client.ui.diagram.Fault
import ai.kilocode.client.ui.diagram.FontSpec
import ai.kilocode.client.ui.diagram.Out
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.diagram.mermaid.Mermaid
import ai.kilocode.log.KiloLog
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.Service
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

@Service(Service.Level.APP)
internal class Diagrams internal constructor(
    private val cs: CoroutineScope,
    private val engine: Engine?,
) {
    constructor(cs: CoroutineScope) : this(cs, null)

    private val measure = AwtMeasure()
    private val cache = object : LinkedHashMap<Key, Out>(CACHE, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Key, Out>?) = size > CACHE
    }

    @RequiresEdt
    fun render(source: String, spec: Spec, owner: Disposable, done: (Out) -> Unit) {
        val key = Key(hash(source), spec.font)
        cache[key]?.let {
            done(it)
            return
        }
        val job = cs.launch {
            val out = draw(source, spec)
            withContext(edt) {
                if (Disposer.isDisposed(owner)) return@withContext
                // Everything except an internal failure is a deterministic function of the input, so it
                // is worth remembering. A bug is not: caching it would keep a transient failure on
                // screen for the rest of the session.
                if (out !is Out.Err || out.fault != Fault.Internal) cache[key] = out
                deliver(done, out)
            }
        }
        // One child disposable per call would accumulate on a long lived owner (every fence re-render and
        // every theme change registers one), so the guard is released as soon as the job settles. The
        // latch keeps the two directions from re-entering each other: whichever of owner disposal and job
        // completion happens first, the other side becomes a no-op.
        val once = AtomicBoolean(false)
        val guard = Disposable { if (once.compareAndSet(false, true)) job.cancel() }
        Disposer.register(owner, guard)
        job.invokeOnCompletion { if (once.compareAndSet(false, true)) Disposer.dispose(guard) }
    }

    private suspend fun draw(source: String, spec: Spec): Out {
        try {
            if (spec.limits.millis <= 0) return impl().draw(source, spec)
            return withTimeout(spec.limits.millis) { impl().draw(source, spec) }
        } catch (err: TimeoutCancellationException) {
            LOG.warn("kind=diagram render=timeout millis=${spec.limits.millis} chars=${source.length}", err)
            return Out.Err(Fault.Limit, "rendering took longer than ${spec.limits.millis} ms")
        } catch (err: CancellationException) {
            throw err
        } catch (err: Exception) {
            // The message reaches the user, but only the log carries the stack trace, so a diagram that
            // trips a parser or layout bug is reportable instead of just looking broken.
            LOG.error("kind=diagram render=failed chars=${source.length}", err)
            return Out.Err(Fault.Internal, err.message ?: err.javaClass.simpleName)
        }
    }

    /**
     * Runs the completion callback so a failure inside it cannot escape into the service scope.
     *
     * An exception here would be reported as a plugin error and, worse, leave the caller stuck on its
     * pending state forever because nothing else is going to answer that render.
     */
    private fun deliver(done: (Out) -> Unit, out: Out) {
        try {
            done(out)
        } catch (err: ProcessCanceledException) {
            throw err
        } catch (err: Exception) {
            LOG.error("kind=diagram deliver=failed out=$out", err)
        }
    }

    private fun impl() = engine ?: Mermaid(measure)

    private data class Key(val hash: Long, val font: FontSpec)

    private companion object {
        const val CACHE = 64
        val edt = Dispatchers.EDT + ModalityState.any().asContextElement()
        val LOG = KiloLog.create(Diagrams::class.java)

        fun hash(text: String): Long {
            var value = -3750763034362895579L
            for (char in text) {
                value = value xor char.code.toLong()
                value *= 1099511628211L
            }
            return value
        }
    }
}
