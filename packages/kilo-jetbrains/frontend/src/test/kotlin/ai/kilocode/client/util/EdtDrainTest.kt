package ai.kilocode.client.util

import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Tests for [EdtDrain], the shared chunked EDT drain behind CLI event catch-up, transcript settings
 * re-apply, and the chunked history rebuild.
 */
@Suppress("UnstableApiUsage")
class EdtDrainTest : BasePlatformTestCase() {

    fun `test applies in bounded slices preserving order`() {
        val applied = mutableListOf<List<Int>>()
        val drain = EdtDrain<Int>(size = 2, schedule = { it() }, sink = { applied.add(it) })

        drain.submit((1..5).toList())

        assertEquals(listOf(listOf(1, 2), listOf(3, 4), listOf(5)), applied)
        assertFalse(drain.active)
    }

    fun `test yields between slices on a deferred scheduler`() {
        val pending = ArrayDeque<() -> Unit>()
        val applied = mutableListOf<Int>()
        val drain = EdtDrain<Int>(size = 2, schedule = { pending.add(it) }, sink = { applied.addAll(it) })

        drain.submit((1..4).toList())

        assertEquals(emptyList<Int>(), applied)
        pending.removeFirst().invoke()
        assertEquals(listOf(1, 2), applied)
        pending.removeFirst().invoke()
        assertEquals(listOf(1, 2, 3, 4), applied)
        assertFalse(drain.active)
    }

    fun `test not ready pauses and wake resumes`() {
        var ready = false
        val applied = mutableListOf<Int>()
        val drain = EdtDrain<Int>(size = 2, ready = { ready }, schedule = { it() }, sink = { applied.addAll(it) })

        drain.submit(listOf(1, 2, 3))

        assertEquals(emptyList<Int>(), applied)
        assertTrue("queued work keeps the drain active", drain.active)

        ready = true
        drain.wake()

        assertEquals(listOf(1, 2, 3), applied)
        assertFalse(drain.active)
    }

    fun `test cancel drops queued work and supersedes in-flight pass`() {
        val pending = ArrayDeque<() -> Unit>()
        val applied = mutableListOf<Int>()
        val drain = EdtDrain<Int>(size = 1, schedule = { pending.add(it) }, sink = { applied.addAll(it) })

        drain.submit(listOf(1, 2, 3))
        drain.cancel()
        while (pending.isNotEmpty()) pending.removeFirst().invoke()

        assertEquals(emptyList<Int>(), applied)
        assertFalse(drain.active)
    }

    fun `test refill supplies more work until exhausted`() {
        val source = ArrayDeque((1..5).toList())
        val applied = mutableListOf<Int>()
        val drain = EdtDrain<Int>(
            size = 2,
            refill = { buildList { repeat(2) { source.removeFirstOrNull()?.let { add(it) } } } },
            schedule = { it() },
            sink = { applied.addAll(it) },
        )

        drain.wake()

        assertEquals(listOf(1, 2, 3, 4, 5), applied)
        assertFalse(drain.active)
    }
}
