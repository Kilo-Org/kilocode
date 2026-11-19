package ai.kilocode.client.util

import com.intellij.util.concurrency.annotations.RequiresEdt

/**
 * Applies queued items to [sink] in bounded slices, one slice per EDT turn, so a long queue cannot
 * monopolize the event queue.
 *
 * A slice holds at most [size] items. When the queue is empty, [refill] is consulted for more work.
 * Each slice is delivered through [schedule] (an `invokeLater` by default), so a pass always yields
 * the EDT before the next slice runs. [ready] gates whether a slice may run right now; when it
 * returns false the pass stops and the queue is left intact until the next [wake] or [submit].
 *
 * [idle] fires once when the drain runs out of work, after the last slice. [cancel] discards queued
 * items and supersedes any in-flight pass.
 *
 * EDT-only: every method must be called on the EDT.
 */
internal class EdtDrain<T>(
    private val size: Int,
    private val ready: () -> Boolean = { true },
    private val refill: () -> List<T> = { emptyList() },
    private val schedule: (() -> Unit) -> Unit = ::edtLater,
    private val idle: () -> Unit = {},
    private val sink: (List<T>) -> Unit,
) {
    private val queue = ArrayDeque<T>()
    private var generation = 0
    private var armed = false
    private var live = false

    /** Whether the drain holds queued work or has a pass pending. */
    val active: Boolean get() = live || queue.isNotEmpty()

    /** Queue items without arming a pass. For callers that take the batch themselves. */
    @RequiresEdt
    fun append(items: List<T>) {
        if (items.isNotEmpty()) queue.addAll(items)
    }

    /** Whether items are queued (as opposed to only a pass being armed). */
    @RequiresEdt
    fun hasQueued(): Boolean = queue.isNotEmpty()

    /** Start (or restart) processing. A pass already in flight is left alone. */
    @RequiresEdt
    fun wake() {
        if (armed) return
        live = true
        arm()
    }

    /** Queue [items] and start processing. */
    @RequiresEdt
    fun submit(items: List<T>) {
        if (items.isEmpty()) return
        queue.addAll(items)
        wake()
    }

    /** Empty and return the queued items, cancelling nothing. */
    @RequiresEdt
    fun take(): List<T> {
        if (queue.isEmpty()) return emptyList()
        val out = queue.toList()
        queue.clear()
        return out
    }

    /** Discard queued items and supersede any in-flight pass. [idle] is not called. */
    @RequiresEdt
    fun cancel() {
        generation++
        armed = false
        live = false
        queue.clear()
    }

    private fun arm() {
        if (armed) return
        armed = true
        val gen = generation
        schedule { pass(gen) }
    }

    @RequiresEdt
    private fun pass(gen: Int) {
        if (gen != generation) return
        armed = false
        if (!ready()) return
        if (queue.isEmpty()) queue.addAll(refill())
        if (queue.isEmpty()) return finish()
        val count = minOf(size, queue.size)
        val batch = ArrayList<T>(count)
        repeat(count) { batch.add(queue.removeFirst()) }
        sink(batch)
        if (gen != generation) return
        if (queue.isEmpty()) queue.addAll(refill())
        if (queue.isEmpty()) return finish()
        arm()
    }

    private fun finish() {
        live = false
        idle()
    }
}
