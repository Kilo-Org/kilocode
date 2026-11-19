package ai.kilocode.backend.app

import ai.kilocode.rpc.dto.HostedSystemEventDto
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class HostedCollectorTest {
    private val capacity = KiloBackendHostedManager.COLLECTOR_CAPACITY
    @Test
    fun `output is coalesced per step`() = runBlocking {
        val collector = KiloBackendHostedManager.Collector()
        repeat(100) { index -> collector.offer(event(index, action = "step_output", output = "chunk")) }
        collector.offer(event(100, action = "attempt_completed"))
        collector.close()

        val events = drain(collector)
        assertEquals(2, events.size)
        assertEquals("step_output", events[0].action)
        assertEquals("attempt_completed", events[1].action)
    }

    @Test
    fun `slow collectors stay bounded and keep terminal events`() = runBlocking {
        val collector = KiloBackendHostedManager.Collector()
        repeat(200) { index ->
            collector.offer(event(index, action = "step_output", output = "chunk", step = "s$index"))
        }
        collector.offer(event(200, action = "attempt_completed"))
        collector.close()

        val events = drain(collector)
        assertTrue(events.size <= capacity + 1)
        assertTrue(events.any { it.action == "attempt_completed" })
    }

    @Test
    fun `protected events are still hard capped`() = runBlocking {
        val collector = KiloBackendHostedManager.Collector()
        repeat(200) { index ->
            collector.offer(event(index, action = "attempt_failed", failure = "workspace_setup_failed", step = "s$index"))
        }
        collector.close()

        val events = drain(collector)
        assertEquals(capacity, events.size)
        assertEquals("attempt_failed", events.last().action)
        assertEquals(199.0, events.last().observedAt)
    }

    private suspend fun drain(collector: KiloBackendHostedManager.Collector): List<HostedSystemEventDto> {
        val events = mutableListOf<HostedSystemEventDto>()
        while (true) {
            val event = collector.receive() ?: break
            events.add(event)
        }
        return events
    }

    private fun event(
        index: Int,
        action: String,
        output: String? = null,
        step: String = "step",
        failure: String? = null,
    ) = HostedSystemEventDto(
        sessionID = "hosted:cloud:wrk:ses",
        kind = "preparing",
        action = action,
        attemptID = "attempt",
        stepID = step,
        step = "setup",
        failure = failure,
        output = output,
        observedAt = index.toDouble(),
        revision = index.toLong(),
    )
}
