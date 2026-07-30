package ai.kilocode.client.agentManager.worktree

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorktreeNamesTest {

    // Always picks the first adjective and the first noun, so every attempt yields the same pair.
    // Lets the collision/suffix paths be exercised without exposing the private word lists.
    private val fixed = object : Random() {
        override fun nextBits(bitCount: Int) = 0
        override fun nextInt(until: Int) = 0
    }

    @Test
    fun `generates an adjective-noun pair`() {
        val name = WorktreeNames.generate(emptySet(), Random(1))
        val parts = name.split('-')
        assertEquals(2, parts.size, "expected a two-word name, got '$name'")
        assertTrue(parts.all { it.isNotBlank() })
    }

    @Test
    fun `is deterministic for a fixed seed`() {
        assertEquals(WorktreeNames.generate(emptySet(), Random(42)), WorktreeNames.generate(emptySet(), Random(42)))
    }

    @Test
    fun `avoids names already taken`() {
        val first = WorktreeNames.generate(emptySet(), fixed)
        val next = WorktreeNames.generate(setOf(first), fixed)
        assertFalse(next == first, "generation returned a taken name")
    }

    @Test
    fun `matches taken names case-insensitively`() {
        val first = WorktreeNames.generate(emptySet(), fixed)
        val next = WorktreeNames.generate(setOf(first.uppercase()), fixed)
        assertFalse(next.equals(first, ignoreCase = true), "generation ignored an upper-cased taken name")
    }

    @Test
    fun `falls back to a numeric suffix when the only pair is taken`() {
        // With every attempt producing the same pair, reserving it forces the numeric-suffix path.
        val first = WorktreeNames.generate(emptySet(), fixed)
        val fallback = WorktreeNames.generate(setOf(first), fixed)
        assertEquals("$first-0", fallback)
    }
}
