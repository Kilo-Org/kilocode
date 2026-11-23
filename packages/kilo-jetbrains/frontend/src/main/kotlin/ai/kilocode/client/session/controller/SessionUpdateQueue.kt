package ai.kilocode.client.session.controller

import ai.kilocode.client.util.EdtDrain
import ai.kilocode.client.util.edt
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
    held: Boolean,
    private val hidden: (ChatEventDto) -> Boolean = { false },
    private val sid: () -> String,
) : Disposable {
    companion object {
        private val LOG = KiloLog.create(SessionUpdateQueue::class.java)
    }

    private val condenser = SessionQueueCondenser()
    private val pending = ArrayDeque<ChatEventDto>()
    private val lock = Any()
    private val disposed = AtomicBoolean(false)
    private val visible = AtomicBoolean(comp == null)
    private var last = 0L
    // Named `held` on the constructor so the mutable `hold` property is what the drain lambda reads
    // below; a same-named constructor parameter would be captured by value and freeze at its start.
    private var hold = held
    // Applies a catch-up backlog in bounded slices, one per EDT turn, so a newly visible editor
    // cannot monopolize the event queue when its tab is selected.
    private val drain = EdtDrain(
        size = EVENT_CATCHUP_SIZE,
        ready = { !disposed.get() && visible.get() && !hold },
        refill = { prepare(take(EVENT_CATCHUP_SCAN_SIZE), "visible", true, System.currentTimeMillis()) },
        sink = {
            LOG.debug { "${ChatLogSummary.sid(sid())} catchup batch=${it.size}" }
            fire(it)
        },
    )
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
        if (event is ChatEventDto.Resnapshot) {
            requestFlush(true, "snapshot")
            return
        }
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
            drain.cancel()
        }
        edt(cleanup)
    }

    private fun flushNow(forced: Boolean, source: String) {
        if (disposed.get()) return
        if (hold) return
        if (!forced && !visible.get()) return
        if (!forced && drain.active) {
            drain.wake()
            return
        }
        val now = System.currentTimeMillis()
        if (!forced && now - last < flushMs) return
        val batch = take()
        if (batch.isEmpty()) {
            if (forced && drain.hasQueued()) fire(drain.take())
            return
        }
        val out = prepare(batch, source, forced, now)
        if (forced && drain.hasQueued()) {
            drain.append(out)
            fire(drain.take())
            return
        }
        fire(out)
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
        drain.wake()
    }

    private fun run(block: () -> Unit) = edt({ !disposed.get() }, block)
}
