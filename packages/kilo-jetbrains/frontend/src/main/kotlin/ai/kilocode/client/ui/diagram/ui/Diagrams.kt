@file:Suppress("UnstableApiUsage", "DEPRECATION")

package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.ui.diagram.AwtMeasure
import ai.kilocode.client.ui.diagram.Engine
import ai.kilocode.client.ui.diagram.Fault
import ai.kilocode.client.ui.diagram.FontSpec
import ai.kilocode.client.ui.diagram.Out
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.diagram.mermaid.Mermaid
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.Service
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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
            val out = try {
                impl().draw(source, spec)
            } catch (err: CancellationException) {
                throw err
            } catch (err: Exception) {
                Out.Err(Fault.Internal, err.message ?: err.javaClass.simpleName)
            }
            withContext(edt) {
                if (Disposer.isDisposed(owner)) return@withContext
                cache[key] = out
                done(out)
            }
        }
        Disposer.register(owner) { job.cancel() }
    }

    private fun impl() = engine ?: Mermaid(measure)

    private data class Key(val hash: Long, val font: FontSpec)

    private companion object {
        const val CACHE = 64
        val edt = Dispatchers.EDT + ModalityState.any().asContextElement()

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
