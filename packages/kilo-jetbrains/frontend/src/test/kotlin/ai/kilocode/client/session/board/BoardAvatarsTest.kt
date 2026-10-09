package ai.kilocode.client.session.board

import ai.kilocode.client.session.views.SessionViewIcons
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class BoardAvatarsTest : BasePlatformTestCase() {

    fun `test same participant returns the same cached icon`() {
        val avatars = BoardAvatars(listOf("main", "ses_child"))

        assertSame(avatars.icon("ses_child"), avatars.icon("ses_child"))
    }

    fun `test main and ALL get the ordinary task glyph, not a generated avatar`() {
        val avatars = BoardAvatars(listOf("main", "ses_child"))

        assertSame(SessionViewIcons.task, avatars.icon("main"))
        assertSame(SessionViewIcons.task, avatars.icon("ALL"))
        assertNotSame(SessionViewIcons.task, avatars.icon("ses_child"))
    }

    fun `test siblings in the order get distinct avatars`() {
        val avatars = BoardAvatars(listOf("main", "ses_aaa", "ses_bbb"))

        assertNotSame(avatars.icon("ses_aaa"), avatars.icon("ses_bbb"))
    }

    fun `test icons are stable across repeated calls`() {
        val avatars = BoardAvatars(listOf("main", "ses_one"))

        val first = avatars.icon("ses_one")
        repeat(50) { avatars.icon("ses_one") }

        assertSame(first, avatars.icon("ses_one"))
    }

    fun `test each dialog instance owns its own cache`() {
        val first = BoardAvatars(listOf("main", "ses_child"))
        val second = BoardAvatars(listOf("main", "ses_child"))

        // Distinct icon instances (no shared/static cache), but still generated identities rather
        // than the task glyph.
        assertNotSame(first.icon("ses_child"), second.icon("ses_child"))
        assertNotSame(SessionViewIcons.task, first.icon("ses_child"))
    }

    fun `test a participant outside the order still gets a deterministic avatar`() {
        val avatars = BoardAvatars(listOf("main"))

        val first = avatars.icon("ses_unlisted")
        assertSame(first, avatars.icon("ses_unlisted"))
        assertNotSame(SessionViewIcons.task, first)
    }
}
