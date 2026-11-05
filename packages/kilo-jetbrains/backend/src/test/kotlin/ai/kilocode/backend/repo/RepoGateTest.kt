package ai.kilocode.backend.repo

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RepoGateTest {
    @Test
    fun `a busy repository does not block another`() = runBlocking {
        val gate = RepoGate(perRepo = 1, global = 2)
        val held = CompletableDeferred<Unit>()
        val acquired = CompletableDeferred<Unit>()

        val busy = launch {
            gate.withRepo("repo-a") {
                acquired.complete(Unit)
                held.await()
            }
        }
        acquired.await()

        // repo-b must still get through while repo-a holds its only permit: this is the starvation the
        // per-repo budget exists to prevent.
        val done = CompletableDeferred<Unit>()
        launch { gate.withRepo("repo-b") { done.complete(Unit) } }
        withTimeout(2_000) { done.await() }

        held.complete(Unit)
        busy.join()
    }

    @Test
    fun `a repository admits at most its own budget at once`() = runBlocking {
        val gate = RepoGate(perRepo = 1, global = 4)
        val release = CompletableDeferred<Unit>()
        val order = mutableListOf<Int>()

        val first = launch { gate.withRepo("repo-a") { order.add(1); release.await() } }
        while (order.isEmpty()) delay(1)

        val second = launch { gate.withRepo("repo-a") { order.add(2) } }
        delay(50)
        assertEquals(listOf(1), order, "the second task must wait for the per-repo permit")

        release.complete(Unit)
        first.join()
        second.join()
        assertEquals(listOf(1, 2), order)
    }

    @Test
    fun `the global ceiling bounds total concurrency across repositories`() = runBlocking {
        val gate = RepoGate(perRepo = 4, global = 2)
        val sync = Mutex()
        var active = 0
        var peak = 0

        withTimeout(5_000) {
            (0 until 8).map { index ->
                launch(Dispatchers.Default) {
                    gate.withRepo("repo-${index % 4}") {
                        sync.withLock { active++; peak = maxOf(peak, active) }
                        delay(20)
                        sync.withLock { active-- }
                    }
                }
            }.forEach { it.join() }
        }

        assertTrue(peak <= 2, "global ceiling exceeded: peak=$peak")
    }

    @Test
    fun `eviction drops gates for missing roots once the map is large`() {
        val gate = RepoGate(perRepo = 1, global = 2)
        listOf("a", "b", "c").forEach { repo -> runBlocking { gate.withRepo(repo) {} } }
        assertEquals(3, gate.size)

        // Under the limit nothing is evicted.
        gate.evict(limit = 3) { false }
        assertEquals(3, gate.size)

        // Over the limit, only roots that still exist survive.
        gate.evict(limit = 2) { it == "a" }
        assertEquals(1, gate.size)
    }
}
