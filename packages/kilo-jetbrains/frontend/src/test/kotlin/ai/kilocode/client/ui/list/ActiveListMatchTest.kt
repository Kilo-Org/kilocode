package ai.kilocode.client.ui.list

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.measureTime

class ActiveListMatchTest {
    @Test
    fun `matches words and camel case acronyms`() {
        assertTrue(activeListMatches("wc", item("WorktreeController")))
        assertTrue(activeListMatches("ws ses", item("Worktree Session Editor")))
        assertTrue(activeListMatches("feature", item("feature-branch")))
        assertFalse(activeListMatches("zz", item("WorktreeController")))
    }

    @Test
    fun `matcher handles repeated ambiguous prefixes quickly`() {
        val text = List(28) { "aaaaaaaaaa" }.joinToString("-")
        val query = "aaaaaaaaaab"

        val duration = measureTime {
            assertFalse(activeListMatches(query, item(text)))
        }

        assertTrue(duration < 200.milliseconds, "ambiguous match took $duration")
    }

    private fun item(title: String) = object : ActiveListItem {
        override val key = title
        override val title = title
    }
}
