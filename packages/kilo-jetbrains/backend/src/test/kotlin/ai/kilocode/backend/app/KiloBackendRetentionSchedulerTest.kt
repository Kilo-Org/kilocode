package ai.kilocode.backend.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Test
import kotlin.test.assertEquals

class KiloBackendRetentionSchedulerTest {
    @Test
    fun `schedule waits two minutes then retries daily after failures`() = runBlocking {
        val waits = mutableListOf<Long>()
        val failures = mutableListOf<Throwable>()
        var attempts = 0

        try {
            retentionSchedule(
                attempt = {
                    attempts += 1
                    if (attempts == 1) error("offline")
                },
                wait = { value ->
                    waits.add(value)
                    if (waits.size == 3) throw Stop()
                },
                failed = failures::add,
            )
        } catch (_: Stop) {
            // Deterministically stop after the second scheduled attempt.
        }

        assertEquals(listOf(RETENTION_INITIAL_DELAY_MS, RETENTION_INTERVAL_MS, RETENTION_INTERVAL_MS), waits)
        assertEquals(2, attempts)
        assertEquals("offline", failures.single().message)
    }

    private class Stop : CancellationException()
}
