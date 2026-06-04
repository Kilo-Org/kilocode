package ai.kilocode.client.session.controller

import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ChatEventDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import java.awt.Component
import java.awt.event.HierarchyEvent
import java.awt.event.HierarchyListener
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

internal const val EVENT_FLUSH_MS = 150L

internal class SessionUpdateQueue(
    parent: Disposable,
    cs: CoroutineScope,
    private val comp: Component?,
    private val flushMs: Long = EVENT_FLUSH_MS,
    private val fire: (List<ChatEventDto>) -> Unit,
    private val condense: Boolean = true,
    hold: Boolean,
    private val hidden: (ChatEventDto) -> Boolean = { false },
    private val sid: () -> String,
) : Disposable {
    companion object {
        private val LOG = KiloLog.create(SessionUpdateQueue::class.java)
    }

    private val app = ApplicationManager.getApplication()
    private val condenser = SessionQueueCondenser()
    private val pending = mutableListOf<ChatEventDto>()
    private val lock = Any()
    private val disposed = AtomicBoolean(false)
    private val visible = AtomicBoolean(comp == null)
    private val tick: Job? = if (flushMs == Long.MAX_VALUE) null else cs.launch {
        while (isActive) {
            delay(flushMs)
            if (disposed.get()) continue
            if (!visible.get()) continue
            requestFlush(false, "tick")
        }
    }
    private val watch = comp?.let {
        HierarchyListener { event ->
            if (event.changeFlags and HierarchyEvent.SHOWING_CHANGED.toLong() == 0L) return@HierarchyListener
            onVisible(it.isShowing)
        }
    }
    private var last = 0L
    private var hold = hold

    init {
        Disposer.register(parent, this)
        if (comp != null && watch != null) edt {
            visible.set(comp.isShowing)
            comp.addHierarchyListener(watch)
        }
    }

    fun enqueue(event: ChatEventDto) {
        if (disposed.get()) return
        if (!visible.get() && hidden(event)) {
            LOG.debug { "${ChatLogSummary.sid(sid())} enqueue hidden=true visible=false" }
            return
        }
        val size = synchronized(lock) {
            pending.add(event)
            pending.size
        }
        LOG.debug { "${ChatLogSummary.sid(sid())} enqueue pending=$size visible=${visible.get()}" }
        if (!visible.get()) return
        requestFlush(false, "enqueue")
    }

    fun holdFlush(hold: Boolean) {
        if (disposed.get()) return
        edt {
            LOG.debug { "${ChatLogSummary.sid(sid())} hold=$hold" }
            this.hold = hold
        }
    }

    fun requestFlush(forced: Boolean, source: String = "api") {
        if (disposed.get()) return
        if (!forced && !visible.get()) return
        edt { flushNow(forced, source) }
    }

    override fun dispose() {
        if (!disposed.compareAndSet(false, true)) return
        val size = synchronized(lock) { pending.size }
        LOG.debug { "${ChatLogSummary.sid(sid())} dispose pending=$size" }
        tick?.cancel()
        val cleanup = {
            if (comp != null && watch != null) comp.removeHierarchyListener(watch)
            synchronized(lock) { pending.clear() }
        }
        if (app.isDispatchThread) cleanup() else app.invokeLater(cleanup)
    }

    private fun flushNow(forced: Boolean, source: String) {
        if (disposed.get()) return
        if (hold) return
        if (!forced && !visible.get()) return
        val now = System.currentTimeMillis()
        if (!forced && now - last < flushMs) return
        val batch = synchronized(lock) {
            if (pending.isEmpty()) return
            pending.toList().also { pending.clear() }
        }
        val before = batch.size
        val types = batch.groupBy { it::class.simpleName }
            .entries.joinToString(",") { (k, v) -> "$k:${v.size}" }
        val out = if (condense) condenser.condense(batch) else batch
        last = now
        LOG.debug { "${ChatLogSummary.sid(sid())} flush source=$source forced=$forced pending=$before condensed=${out.size} saved=${before - out.size} types=$types" }
        fire(out)
    }

    private fun onVisible(show: Boolean) {
        if (disposed.get()) return
        val prev = visible.getAndSet(show)
        if (prev == show) return
        LOG.debug { "${ChatLogSummary.sid(sid())} visible=$show" }
        if (!show) return
        requestFlush(true, "visible")
    }

    private fun edt(block: () -> Unit) {
        if (disposed.get()) return
        if (app.isDispatchThread) {
            block()
            return
        }
        app.invokeLater {
            if (disposed.get()) return@invokeLater
            block()
        }
    }
}
