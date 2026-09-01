package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.ui.popup.HeaderPopupBody
import ai.kilocode.client.ui.ChangesPanel
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Container
import javax.swing.JScrollPane
import javax.swing.JSeparator
import javax.swing.ScrollPaneConstants
import javax.swing.SwingConstants
import javax.swing.SwingUtilities

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

    fun `test the popup stacks state and title, then the changes, then a verdict per line`() {
        val body = body()

        edt {
            body.update(
                stats = WorktreeStatsDto(path, additions = 9, deletions = 4, files = 3, ahead = 2, base = "origin/main"),
                pull = pr(GhReview.APPROVED, GhChecksDto(GhChecks.PASSED, total = 4, passed = 4)),
                name = "feature-x",
                dirty = WorktreeDirtyDto(path, additions = 2, files = 1),
            )
            layout(body)
        }

        edt {
            val badge = components(body).filterIsInstance<JBLabel>().single { it.icon is FilledBadgeIcon }
            val title = components(body).filterIsInstance<SimpleColoredComponent>().single()
            val changes = UIUtil.findComponentOfType(body, ChangesPanel::class.java)!!
            val rule = components(body).filterIsInstance<JSeparator>().single { it.orientation == SwingConstants.HORIZONTAL }
            val review = components(body).filterIsInstance<JBLabel>().single { it.text == "Review approved" }
            val checks = components(body).filterIsInstance<JBLabel>().single { it.text == "4 checks passed" }

            // The state pill and the title share the first line; everything else gets its own.
            assertTrue(kotlin.math.abs(middle(body, badge) - middle(body, title)) <= 2)
            assertTrue(bottom(body, title) <= top(body, rule))
            assertTrue(bottom(body, rule) <= top(body, changes))
            assertTrue(bottom(body, changes) <= top(body, review))
            assertTrue(bottom(body, review) <= top(body, checks))
            // One row for every counter, committed and uncommitted alike.
            val counters = components(changes).filterIsInstance<JBLabel>().filter { it.isVisible }
            assertEquals(listOf("1 file", "+2", "2", "3 files", "-4", "+9"), counters.map { it.text })
            val rows = counters.map { middle(body, it) }
            assertTrue("the counters must share one row, got $rows", rows.max() - rows.min() <= 2)
        }
    }

    fun `test a long title stays reachable by scrolling sideways`() {
        val title = "fix(jetbrains): make gh/PR focus sync responsive without overwhelming the backend"
        val body = body()
        val disposable = Disposer.newDisposable("popup")
        Disposer.register(testRootDisposable, disposable)

        edt {
            body.update(
                stats = WorktreeStatsDto(path, additions = 3191, deletions = 418, files = 63, ahead = 11, base = "origin/main"),
                pull = pr(GhReview.APPROVED, GhChecksDto(GhChecks.PENDING, total = 1, pending = 1)).copy(title = title),
                name = "brave-dune",
                dirty = null,
            )
            // Measured the way the row popup measures it: the cap the panel allows, trimmed to the room
            // the geometry found beside the row.
            val content = HeaderPopupBody(body, disposable, UiStyle.Balloon.bg(), maxWidth = 920, horizontal = true)
            content.fitWithin(JBUI.scale(360), JBUI.scale(320))
            content.component.size = content.component.preferredSize
            layout(content.component)

            val scroll = components(content.component).filterIsInstance<JScrollPane>().first()
            val view = scroll.viewport.view

            assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED, scroll.horizontalScrollBarPolicy)
            // The header wants more width than the popup can be, so the end of the title is behind the
            // scrollbar rather than cut off.
            assertTrue(
                "the title fits, so this proves nothing: ${view.preferredSize.width} vs ${scroll.viewport.width}",
                view.preferredSize.width > scroll.viewport.width,
            )
            val fragments = components(body).filterIsInstance<SimpleColoredComponent>().single()
            assertEquals(listOf(title, " #7"), fragments(fragments))
        }
    }

    fun `test a worktree with no pull request still breaks its changes out`() {
        val body = body()

        edt {
            body.update(
                stats = WorktreeStatsDto(path, ahead = 1, behind = 2),
                pull = null,
                name = "feature-x",
                dirty = WorktreeDirtyDto(path, additions = 6, deletions = 2, files = 4),
            )
            layout(body)
        }

        edt {
            // No pull request chrome to show, but the counters are the reason the popup opened.
            assertTrue(components(body).filterIsInstance<JBLabel>().none { it.icon is FilledBadgeIcon })
            assertFalse(components(body).filterIsInstance<SimpleColoredComponent>().single().isVisible)
            val changes = UIUtil.findComponentOfType(body, ChangesPanel::class.java)!!
            assertTrue(changes.isVisible)
            assertEquals(
                listOf("4 files", "-2", "+6", "1", "2"),
                components(changes).filterIsInstance<JBLabel>().filter { it.isVisible }.map { it.text },
            )
        }
    }

    fun `test a clean worktree drops the rule with the changes row`() {
        val body = body()

        edt { body.update(null, pr(GhReview.APPROVED, GhChecksDto()), "feature-x", null) }

        // Nothing to summarise, so a rule would fence the title off from the verdict lines for no reason.
        assertTrue(edt { components(body).filterIsInstance<JSeparator>().none { it.isVisible } })
    }

    private fun body(): WorktreeRowPopupBody = edt { WorktreeRowPopupBody(openDiff = {}, onLocal = {}) }

    /** The title's styled fragments, which is where the full text lives once the line is too long. */
    @RequiresEdt
    private fun fragments(title: SimpleColoredComponent): List<String> {
        val out = mutableListOf<String>()
        val iter = title.iterator()
        while (iter.hasNext()) {
            iter.next()
            out += iter.fragment
        }
        return out
    }

    @RequiresEdt
    private fun layout(body: WorktreeRowPopupBody) {
        body.setSize(body.preferredSize)
        layout(body as Component)
    }

    @RequiresEdt
    private fun layout(root: Component) {
        components(root).forEach { if (it is Container) it.doLayout() }
    }

    @RequiresEdt
    private fun right(body: WorktreeRowPopupBody, child: Component): Int =
        SwingUtilities.convertPoint(child, 0, 0, body).x + child.width

    @RequiresEdt
    private fun top(body: WorktreeRowPopupBody, child: Component): Int = SwingUtilities.convertPoint(child, 0, 0, body).y

    @RequiresEdt
    private fun bottom(body: WorktreeRowPopupBody, child: Component): Int = top(body, child) + child.height

    @RequiresEdt
    private fun middle(body: WorktreeRowPopupBody, child: Component): Int = top(body, child) + child.height / 2

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
