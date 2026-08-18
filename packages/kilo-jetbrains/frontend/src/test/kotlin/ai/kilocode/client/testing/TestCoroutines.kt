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

    fun drain(pump: () -> Unit) {
        repeat(5) {
            await(scope.launch {}, pump)
            pump()
        }
    }

    fun close(pump: () -> Unit) {
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
