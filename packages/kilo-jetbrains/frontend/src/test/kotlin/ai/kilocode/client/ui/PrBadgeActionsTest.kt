package ai.kilocode.client.ui

import ai.kilocode.client.testing.installBrowser
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhCommentsDto
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class PrBadgeActionsTest : BasePlatformTestCase() {
    fun `test omitted actions keep browser navigation for every shared PR badge`() {
        val browser = installBrowser()
        edtWait {
            val pull = pull()
            (prGlyphBadges(pull) + listOfNotNull(prNumberBadge(pull))).forEach { requireNotNull(it.action).invoke() }
        }
        assertEquals(
            listOf("https://example.test/pr/7", "https://example.test/pr/7", "https://example.test/pr/7/checks", "https://example.test/pr/7"),
            browser.urls,
        )
    }

    fun `test injected handlers stay distinct and never fall back to the browser`() {
        val browser = installBrowser()
        val calls = mutableListOf<String>()
        edtWait {
            val actions = PrBadgeActions(
                open = { calls += "open" }, review = { calls += "review" },
                checks = { calls += "checks" }, comments = { calls += "comments" },
            )
            (prGlyphBadges(pull(), actions) + listOfNotNull(prNumberBadge(pull(), actions)))
                .forEach { requireNotNull(it.action).invoke() }
            assertEquals(listOf("comments", "review", "checks", "open"), calls)
        }
        assertTrue(browser.urls.isEmpty())
    }

    fun `test explicit null handlers retain glyph order and text without interactivity`() = edtWait {
        val actions = PrBadgeActions()
        val glyphs = prGlyphBadges(pull(), actions)
        assertEquals(listOf("pr-comments", "pr-review", "pr-checks"), glyphs.map { it.id })
        assertEquals("2", glyphs.first().text)
        assertTrue(glyphs.all { it.action == null })
        val number = requireNotNull(prNumberBadge(pull(), actions))
        assertNull(number.action)
        assertNull(number.tooltip)
        assertEquals("#7", number.text)
        assertTrue(glyphs.filter { it.id != "pr-review" }.all { !it.tooltip.orEmpty().contains("Click") })
        assertEquals(
            listOf("pr-comments", "pr-checks"),
            prGlyphBadges(pull().copy(review = GhReview.PENDING), actions).map { it.id },
        )
    }

    private fun pull() = WorktreePrDto(
        "/repo", 7, GhState.OPEN, "https://example.test/pr/7", review = GhReview.APPROVED,
        checks = GhChecksDto(GhChecks.PENDING, total = 3, pending = 2),
        comments = GhCommentsDto(total = 4, unresolved = 2),
    )
}
