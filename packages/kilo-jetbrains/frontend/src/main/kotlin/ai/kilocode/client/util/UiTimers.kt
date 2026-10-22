package ai.kilocode.client.util

import javax.swing.Timer

interface UiTimer {
    fun start()
    fun stop()
    fun restart()
    fun isRunning(): Boolean
}

interface UiTimerSource {
    fun now(): Long
    fun timer(ms: Int, repeats: Boolean = true, action: () -> Unit): UiTimer
}

object UiTimers : UiTimerSource {
    override fun now(): Long = System.currentTimeMillis()

    override fun timer(ms: Int, repeats: Boolean, action: () -> Unit): UiTimer {
        val timer = Timer(ms.coerceAtLeast(0)) { action() }
        timer.isRepeats = repeats
        return SwingUiTimer(timer)
    }

    private class SwingUiTimer(private val timer: Timer) : UiTimer {
        override fun start() {
            timer.start()
        }

        override fun stop() {
            timer.stop()
        }

        override fun restart() {
            timer.restart()
        }

        override fun isRunning(): Boolean = timer.isRunning
    }
}
