package ai.kilocode.client.testing

import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch

class TestCoroutines {
    val dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val job = SupervisorJob()

    val scope = CoroutineScope(job + dispatcher)

    fun drain(pump: () -> Unit = ::pumpEdt) {
        repeat(5) {
            await(scope.launch {}, pump)
            pump()
        }
    }

    /**
     * Drain coroutines + EDT until [cond] holds or [deadlineMs] elapses.
     *
     * Re-checks the predicate after each [drain] so a slow cross-thread handoff
     * (coroutine -> `invokeLater` -> EDT) is observed, instead of relying on a fixed
     * iteration budget that can run out under CI load. Returns whether [cond] became true.
     * [cond] is evaluated on the calling thread; wrap it in `edt { }` when it reads UI state.
     */
    fun pumpUntil(deadlineMs: Long = TEST_WAIT_MS, pump: () -> Unit = ::pumpEdt, cond: () -> Boolean): Boolean {
        val end = System.nanoTime() + deadlineMs * 1_000_000
        while (true) {
            drain(pump)
            if (cond()) return true
            if (System.nanoTime() >= end) return false
            Thread.sleep(1)
        }
    }

    fun close(pump: () -> Unit = ::pumpEdt) {
        job.cancel()
        try {
            await(job, pump)
        } finally {
            dispatcher.close()
        }
    }

    private fun await(job: kotlinx.coroutines.Job, pump: () -> Unit) {
        val end = System.nanoTime() + 5_000_000_000L
        while (!job.isCompleted) {
            check(System.nanoTime() < end) { "Timed out draining test coroutines" }
            pump()
            Thread.yield()
        }
    }
}
