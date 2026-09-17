package ai.kilocode.client.session.board

import com.intellij.testFramework.fixtures.BasePlatformTestCase

class BoardAvatarsTest : BasePlatformTestCase() {

    fun `test same participant returns the same cached icon`() {
        val order = listOf("main", "ses_child")

        assertSame(BoardAvatars.icon("ses_child", order), BoardAvatars.icon("ses_child", order))
    }

    fun `test main and a subagent get different icons`() {
        val order = listOf("main", "ses_child")

        assertNotSame(BoardAvatars.icon("main", order), BoardAvatars.icon("ses_child", order))
    }

    fun `test participants in different slots get different icons`() {
        val order = listOf("main", "ses_aaa", "ses_bbb")

        // Same initial ('S'), different colour slot, so the icons must not be shared.
        assertNotSame(BoardAvatars.icon("ses_aaa", order), BoardAvatars.icon("ses_bbb", order))
    }

    /**
     * Regression: the cache used to be keyed on participant id. Session ids never repeat, so every
     * board opened leaked another entry for the life of the IDE. Keying on the drawn glyph instead
     * keeps it bounded, which this asserts by churning many unique ids through it.
     */
    fun `test unique session ids do not grow the icon cache without bound`() {
        val order = listOf("main")
        val icons = (1..500).map { BoardAvatars.icon("ses_x$it", order) }.toSet()

        // All 500 ids are outside `order`, so they share the neutral slot and the same 'S' initial.
        assertEquals(1, icons.size)
    }

    fun `test icons are stable across repeated calls for ids sharing a glyph`() {
        val order = listOf("main", "ses_one")

        val first = BoardAvatars.icon("ses_one", order)
        repeat(50) { BoardAvatars.icon("ses_one", order) }

        assertSame(first, BoardAvatars.icon("ses_one", order))
    }
}
