package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Container

class WorktreeRowPopupBodyTest : BasePlatformTestCase() {
    private val path = "/repo/.kilo/worktrees/feature-x"

    fun `test the popup states both verdicts with their counts`() {
        val body = body()

        edt {
            body.update(
                stats = WorktreeStatsDto(path, additions = 9, deletions = 4, files = 3, base = "origin/main"),
                pull = pr(GhReview.CHANGES_REQUESTED, GhChecksDto(GhChecks.FAILED, total = 5, passed = 3, failed = 2)),
                name = "feature-x",
                dirty = WorktreeDirtyDto(path, additions = 2, files = 1),
            )
        }

        val lines = labels(body)
        // The row glyphs only carry a color, so the popup is where the counts become readable.
        assertTrue("expected the review verdict, got $lines", lines.contains("Changes requested"))
        assertTrue("expected the check counts, got $lines", lines.contains("2 of 5 checks failed"))
    }

    fun `test a passing build with an approved review reads as both`() {
        val body = body()

        edt {
            body.update(
                stats = null,
                pull = pr(GhReview.APPROVED, GhChecksDto(GhChecks.PASSED, total = 4, passed = 4)),
                name = "feature-x",
                dirty = null,
            )
        }

        val lines = labels(body)
        assertTrue("expected the review verdict, got $lines", lines.contains("Review approved"))
        assertTrue("expected the check counts, got $lines", lines.contains("4 checks passed"))
    }

    fun `test verdict lines are hidden when github reports neither`() {
        val body = body()

        edt { body.update(null, pr(GhReview.NONE, GhChecksDto()), "feature-x", null) }

        // A PR with no reviewers and no CI must not leave two empty rows in the popup.
        val lines = labels(body)
        assertTrue("expected no verdict lines, got $lines", lines.none { it.contains("Review") || it.contains("check") })
    }

    fun `test a required but ungiven review is not stated`() {
        val body = body()

        edt { body.update(null, pr(GhReview.PENDING, GhChecksDto()), "feature-x", null) }

        val lines = labels(body)
        assertTrue("expected no review line, got $lines", lines.none { it.contains("Review") })
    }

    fun `test switching from a failing to a passing build replaces the line`() {
        val body = body()
        edt { body.update(null, pr(GhReview.NONE, GhChecksDto(GhChecks.FAILED, total = 2, failed = 1)), "feature-x", null) }
        assertTrue(labels(body).contains("1 of 2 checks failed"))

        edt { body.update(null, pr(GhReview.NONE, GhChecksDto(GhChecks.PASSED, total = 2, passed = 2)), "feature-x", null) }

        val lines = labels(body)
        assertTrue("expected the passing line, got $lines", lines.contains("2 checks passed"))
        assertTrue("the stale failing line must be gone, got $lines", lines.none { it.contains("failed") })
    }

    private fun body(): WorktreeRowPopupBody = edt { WorktreeRowPopupBody(openDiff = {}, onLocal = {}) }

    private fun pr(review: GhReview, checks: GhChecksDto) =
        WorktreePrDto(path, 7, GhState.OPEN, "https://example.test/pr/7", "Feature title", review, checks)

    /** Text of every visible label in the body, which is what a reader actually sees. */
    private fun labels(body: WorktreeRowPopupBody): List<String> = edt {
        UIUtil.dispatchAllInvocationEvents()
        components(body).filterIsInstance<JBLabel>().filter { it.isVisible }.map { it.text.orEmpty() }
    }

    private fun components(root: Component): List<Component> {
        val out = mutableListOf(root)
        if (root is Container) root.components.forEach { out += components(it) }
        return out
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
