package ai.kilocode.client.session.controller

import ai.kilocode.client.util.edt
import ai.kilocode.client.util.edtLater
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ChatEventDto
import com.intellij.openapi.Disposable
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
internal const val EVENT_CATCHUP_SIZE = 8
internal const val EVENT_CATCHUP_SCAN_SIZE = 128

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

    private val condenser = SessionQueueCondenser()
    private val pending = ArrayDeque<ChatEventDto>()
    private val catchup = ArrayDeque<ChatEventDto>()
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
    private var scheduled = false

    init {
        Disposer.register(parent, this)
        if (comp != null && watch != null) run {
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
        run {
            LOG.debug { "${ChatLogSummary.sid(sid())} hold=$hold" }
            this.hold = hold
        }
    }

    fun requestFlush(forced: Boolean, source: String = "api") {
        if (disposed.get()) return
        if (!forced && !visible.get()) return
        run { flushNow(forced, source) }
    }

    override fun dispose() {
        if (!disposed.compareAndSet(false, true)) return
        val size = synchronized(lock) { pending.size }
        LOG.debug { "${ChatLogSummary.sid(sid())} dispose pending=$size" }
        tick?.cancel()
        val cleanup = {
            if (comp != null && watch != null) comp.removeHierarchyListener(watch)
            synchronized(lock) { pending.clear() }
            catchup.clear()
            scheduled = false
        }
        edt(cleanup)
    }

    private fun flushNow(forced: Boolean, source: String) {
        if (disposed.get()) return
        if (hold) return
        if (!forced && !visible.get()) return
        if (!forced && (scheduled || catchup.isNotEmpty())) {
            scheduleCatchup()
            return
        }
        val now = System.currentTimeMillis()
        if (!forced && now - last < flushMs) return
        val batch = take()
        if (batch.isEmpty()) {
            if (forced && catchup.isNotEmpty()) {
                val out = catchup.toList()
                catchup.clear()
                fire(out)
            }
            return
        }
        val out = prepare(batch, source, forced, now)
        if (forced && catchup.isNotEmpty()) {
            catchup.addAll(out)
            val all = catchup.toList()
            catchup.clear()
            fire(all)
            return
        }
        fire(out)
    }

    /**
     * A newly visible editor must finish its hierarchy change before transcript updates mutate its
     * Swing tree. Condense a bounded raw window and apply a bounded result per EDT turn so a
     * long-running background session cannot monopolize the event queue when its tab is selected.
     */
    private fun scheduleCatchup() {
        if (disposed.get() || scheduled) return
        scheduled = true
        edtLater {
            scheduled = false
            if (disposed.get() || !visible.get() || hold) return@edtLater
            if (catchup.isEmpty()) {
                val batch = take(EVENT_CATCHUP_SCAN_SIZE)
                if (batch.isEmpty()) return@edtLater
                catchup.addAll(prepare(batch, "visible", true, System.currentTimeMillis()))
            }
            drainCatchup()
        }
    }

    private fun drainCatchup() {
        if (disposed.get() || !visible.get() || hold || catchup.isEmpty()) return
        val batch = buildList {
            repeat(minOf(EVENT_CATCHUP_SIZE, catchup.size)) {
                add(catchup.removeFirst())
            }
        }
        LOG.debug { "${ChatLogSummary.sid(sid())} catchup batch=${batch.size} remaining=${catchup.size}" }
        fire(batch)
        if (catchup.isNotEmpty() || synchronized(lock) { pending.isNotEmpty() }) scheduleCatchup()
    }

    private fun take(limit: Int = Int.MAX_VALUE): List<ChatEventDto> = synchronized(lock) {
        val count = minOf(limit, pending.size)
        buildList(count) {
            repeat(count) { add(pending.removeFirst()) }
        }
    }

    private fun prepare(batch: List<ChatEventDto>, source: String, forced: Boolean, now: Long): List<ChatEventDto> {
        val out = if (condense) condenser.condense(batch) else batch
        last = now
        LOG.debug {
            val types = batch.groupBy { it::class.simpleName }
                .entries.joinToString(",") { (k, v) -> "$k:${v.size}" }
            "${ChatLogSummary.sid(sid())} flush source=$source forced=$forced pending=${batch.size} condensed=${out.size} saved=${batch.size - out.size} types=$types"
        }
        return out
    }

    private fun onVisible(show: Boolean) {
        if (disposed.get()) return
        val prev = visible.getAndSet(show)
        if (prev == show) return
        LOG.debug { "${ChatLogSummary.sid(sid())} visible=$show" }
        if (!show) return
        scheduleCatchup()
    }

    private fun run(block: () -> Unit) = edt({ !disposed.get() }, block)
}
