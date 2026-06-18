package ai.kilocode.client.session.controller

import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager

internal class DelayedState(
    private val ms: Long,
    private val timers: UiTimerSource = UiTimers,
) : Disposable {
    private val tick = when {
        ms <= 0 -> 1
        ms > Int.MAX_VALUE -> Int.MAX_VALUE
        else -> ms.coerceAtMost(TICK_MS).toInt()
    }
    private val timer = timers.timer(tick) { flush() }
    private val pending = mutableListOf<Pending<*>>()
    @Volatile private var alive = true

    fun <T : Any> run(state: T, current: () -> T, action: (T) -> Unit) {
        edt {
            if (!alive) return@edt
            val next = Pending(state, due(), current, action)
            pending.add(next)
            if (ms <= 0) {
                apply(next)
                return@edt
            }
            timer.start()
        }
    }

    fun cancel() {
        edt {
            pending.clear()
            timer.stop()
        }
    }

    internal fun active() = timer.isRunning()

    private fun <T : Any> apply(item: Pending<T>) {
        if (!alive) return
        if (!pending.remove(item)) return
        if (item.current() != item.state) return
        item.action(item.state)
    }

    private fun flush() {
        if (!alive) return
        val now = timers.now()
        for (item in pending.toList()) {
            if (item.due > now) continue
            apply(item)
        }
        if (pending.isEmpty()) timer.stop()
    }

    private fun due(): Long {
        val now = timers.now()
        return now + ms.coerceAtMost(Long.MAX_VALUE - now)
    }

    private fun edt(block: () -> Unit) {
        val app = ApplicationManager.getApplication()
        if (app.isDispatchThread) {
            block()
            return
        }
        app.invokeLater(block)
    }

    override fun dispose() {
        alive = false
        cancel()
    }

    private data class Pending<T : Any>(
        val state: T,
        val due: Long,
        val current: () -> T,
        val action: (T) -> Unit,
    )

    private companion object {
        const val TICK_MS = 25L
    }
}
