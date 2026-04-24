package ai.kilocode.client.session

import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ChatEventDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import java.awt.Component
import java.awt.event.HierarchyEvent
import java.awt.event.HierarchyListener
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

internal const val EVENT_FLUSH_MS = 150L

internal class SessionUpdateQueue(
    parent: Disposable,
    private val comp: Component?,
    private val flushMs: Long = EVENT_FLUSH_MS,
    private val fire: (List<ChatEventDto>) -> Unit,
    private val condense: Boolean = true,
    hold: Boolean,
    private val sid: () -> String,
) : Disposable {
    companion object {
        private val LOG = KiloLog.create(SessionUpdateQueue::class.java)
    }

    private val app = ApplicationManager.getApplication()
    private val condenser = SessionQueueCondenser()
    private val pending = mutableListOf<ChatEventDto>()
    private val lock = Any()
    private val exec: ScheduledExecutorService? = if (flushMs == Long.MAX_VALUE) null else Executors.newSingleThreadScheduledExecutor()
    private val visible = AtomicBoolean(comp?.isShowing ?: true)
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
        if (comp != null && watch != null) comp.addHierarchyListener(watch)
        exec?.scheduleAtFixedRate(
            {
                if (!visible.get()) return@scheduleAtFixedRate
                requestFlush(false, "tick")
            },
            flushMs,
            flushMs,
            TimeUnit.MILLISECONDS,
        )
    }

    fun enqueue(event: ChatEventDto) {
        val size = synchronized(lock) {
            pending.add(event)
            pending.size
        }
        LOG.debug { "${ChatLogSummary.sid(sid())} enqueue pending=$size visible=${visible.get()}" }
        if (!visible.get()) return
        requestFlush(false, "enqueue")
    }

    fun holdFlush(hold: Boolean) {
        edt {
            LOG.debug { "${ChatLogSummary.sid(sid())} hold=$hold" }
            this.hold = hold
        }
    }

    fun requestFlush(forced: Boolean, source: String = "api") {
        if (!forced && !visible.get()) return
        edt { flushNow(forced, source) }
    }

    override fun dispose() {
        val size = synchronized(lock) { pending.size }
        LOG.debug { "${ChatLogSummary.sid(sid())} dispose pending=$size" }
        exec?.shutdownNow()
        if (comp != null && watch != null) comp.removeHierarchyListener(watch)
        if (app.isDispatchThread) {
            synchronized(lock) { pending.clear() }
            return
        }
        app.invokeLater { synchronized(lock) { pending.clear() } }
    }

    private fun flushNow(forced: Boolean, source: String) {
        if (hold) return
        if (!visible.get()) return
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
        val prev = visible.getAndSet(show)
        if (prev == show) return
        LOG.debug { "${ChatLogSummary.sid(sid())} visible=$show" }
        if (!show) return
        requestFlush(true, "visible")
    }

    private fun edt(block: () -> Unit) {
        if (app.isDispatchThread) {
            block()
            return
        }
        app.invokeLater(block)
    }
}
