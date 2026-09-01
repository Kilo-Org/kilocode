package ai.kilocode.client.agentManager.worktree

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AwayTest {
    private var now = 0L
    private val away = Away { now }

    @Test
    fun `a return with no recorded departure reports nothing`() {
        assertNull(away.back(), "the first focus of a session is not a return")
    }

    @Test
    fun `an absence shorter than the debounce reports nothing`() {
        away.left()
        now += Away.REAL - 1

        assertNull(away.back(), "a transient window is indistinguishable from never leaving")
    }

    @Test
    fun `an absence at the debounce reports its length`() {
        away.left()
        now += Away.REAL

        assertEquals(Away.REAL, away.back())
    }

    @Test
    fun `an absence is consumed so one departure answers one return`() {
        away.left()
        now += Away.FRESH
        assertEquals(Away.FRESH, away.back())

        now += Away.FRESH
        assertNull(away.back(), "a second activation without leaving again is not a new absence")
    }

    @Test
    fun `a later departure replaces an unconsumed one`() {
        away.left()
        now += Away.FRESH
        away.left()
        now += Away.REAL

        assertEquals(Away.REAL, away.back(), "the absence runs from the most recent departure")
    }

    @Test
    fun `only an absence past the freshness bar earns a ceiling`() {
        assertNull(Away.ceiling(Away.FRESH - 1), "window churn has no claim on the caches")
        assertEquals(Away.FRESH, Away.ceiling(Away.FRESH))
        // The ceiling is the absence itself, not zero: a lookup that ran while we were gone is still
        // current, and only answers predating the departure have to be rejected.
        assertEquals(90_000L, Away.ceiling(90_000L))
    }
}
