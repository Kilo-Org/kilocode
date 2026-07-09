package ai.kilocode.client.testing

import ai.kilocode.client.util.UiTimer
import ai.kilocode.client.util.UiTimerSource
import com.intellij.openapi.application.ApplicationManager

class TestUiTimers : UiTimerSource {
    private val timers = linkedSetOf<TestTimer>()
    private var time = 0L

    override fun now(): Long = time

    override fun timer(ms: Int, repeats: Boolean, action: () -> Unit): UiTimer {
        return TestTimer(ms.coerceAtLeast(0), repeats, action)
    }

    fun advanceBy(ms: Long) {
        edt { }
        time += ms.coerceAtLeast(0)
        runDue()
    }

    fun runDue() {
        while (true) {
            val due = timers.filter { it.running && it.due <= time }
            if (due.isEmpty()) return
            due.forEach { it.fire() }
        }
    }

    private fun edt(action: () -> Unit) {
        val app = ApplicationManager.getApplication()
        if (app.isDispatchThread) {
            action()
            return
        }
        app.invokeAndWait(action)
    }

    private inner class TestTimer(
        private val ms: Int,
        private val repeats: Boolean,
        private val action: () -> Unit,
    ) : UiTimer {
        var running = false
            private set
        var due = Long.MAX_VALUE
            private set

        override fun start() {
            if (running) return
            running = true
            due = time + ms
            timers.add(this)
        }

        override fun stop() {
            running = false
            due = Long.MAX_VALUE
            timers.remove(this)
        }

        override fun restart() {
            running = true
            due = time + ms
            timers.add(this)
        }

        override fun isRunning(): Boolean = running

        fun fire() {
            if (!running || due > time) return
            if (repeats) {
                due = time + ms.coerceAtLeast(1)
            } else {
                stop()
            }
            edt(action)
        }
    }
}
