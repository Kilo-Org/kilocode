package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.ui.header.PrHeaderView
import ai.kilocode.client.session.ui.popup.HeaderPopupBody
import ai.kilocode.client.testing.installBrowser
import ai.kilocode.client.ui.ChangesPanel
import ai.kilocode.client.ui.ConflictDotIcon
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.HoverArea
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.mergeLabel
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhCommentsDto
import ai.kilocode.rpc.dto.GhMerge
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
import java.awt.Cursor
import java.awt.event.MouseEvent
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

    fun `test the popup names what the conversation count is counting`() {
        val body = body()

        edt {
            body.update(
                stats = null,
                pull = pr(GhReview.APPROVED, GhChecksDto(), GhCommentsDto(total = 8, unresolved = 3)),
                name = "feature-x",
                dirty = null,
            )
        }

        // The row shows a bare number beside a glyph; this is where it becomes a sentence.
        val lines = labels(body)
        assertTrue("expected the conversation counts, got $lines", lines.contains("3 of 8 review conversations unresolved"))
    }

    /**
     * The merge verdict has no glyph in the row's strip — it is marked on the changes badge instead — so the
     * popup is the only surface that states it in words, and it has to open the page that shows the conflict.
     */
    fun `test a conflicting merge gets its own clickable line under the changes`() {
        val browser = installBrowser()
        val body = body()

        edt {
            body.update(
                stats = WorktreeStatsDto(path, additions = 9, deletions = 4, files = 3, base = "origin/main"),
                pull = pr(GhReview.APPROVED, GhChecksDto()).copy(merge = GhMerge.CONFLICTING),
                name = "feature-x",
                dirty = null,
            )
            layout(body)
        }

        val lines = labels(body)
        assertTrue("expected the merge verdict, got $lines", lines.contains(mergeLabel("origin/main")))
        val line = edt { hovers(body).first() }
        // Marked with the same red dot the changes badge is marked with, so the words and the mark match.
        val label = edt { components(line).filterIsInstance<JBLabel>().single() }
        assertSame(ConflictDotIcon, edt { label.icon })
        assertEquals(Cursor.HAND_CURSOR, edt { line.cursor.type })
        assertEquals(mergeLabel("origin/main"), edt { line.accessibleContext.accessibleName })

        edt { click(line) }

        // The conversation page, which is where GitHub prints the conflict and offers the web editor.
        assertEquals(listOf("https://example.test/pr/7"), browser.urls)
        // Above the verdicts, and under the summary whose badge carries the mark.
        edt {
            val changes = UIUtil.findComponentOfType(body, ChangesPanel::class.java)!!
            val review = components(body).filterIsInstance<JBLabel>().single { it.text == "Review approved" }
            assertTrue(bottom(body, changes) <= top(body, label))
            assertTrue(bottom(body, label) <= top(body, review))
        }
    }

    fun `test a merging branch has no merge line`() {
        val body = body()

        edt { body.update(null, pr(GhReview.APPROVED, GhChecksDto()).copy(merge = GhMerge.CLEAN), "feature-x", null) }

        // Merging cleanly is the normal state, and a line for it would push the verdicts down to report
        // that nothing is wrong.
        val lines = labels(body)
        assertTrue("expected no merge line, got $lines", lines.none { it.contains("Merge conflicts") })
    }

    fun `test a settled conversation drops its line`() {
        val body = body()
        edt { body.update(null, pr(GhReview.NONE, GhChecksDto(), GhCommentsDto(total = 8, unresolved = 3)), "feature-x", null) }
        assertTrue(labels(body).contains("3 of 8 review conversations unresolved"))

        edt { body.update(null, pr(GhReview.NONE, GhChecksDto(), GhCommentsDto(total = 8, unresolved = 0)), "feature-x", null) }

        // Every thread resolved is nothing outstanding, not "0 unresolved".
        val lines = labels(body)
        assertTrue("the stale conversation line must be gone, got $lines", lines.none { it.contains("conversations") })
    }

    fun `test each verdict line is a hoverable click target`() {
        val browser = installBrowser()
        val body = body()

        edt {
            body.update(
                stats = null,
                pull = pr(
                    GhReview.APPROVED,
                    GhChecksDto(GhChecks.FAILED, total = 5, failed = 2),
                    GhCommentsDto(total = 8, unresolved = 3),
                ),
                name = "feature-x",
                dirty = null,
            )
        }

        val lines = edt { hovers(body) }
        assertEquals(3, lines.size)
        assertTrue("every line must read as clickable, got $lines", edt { lines.all { it.cursor.type == Cursor.HAND_CURSOR } })

        // Each line already states its verdict, so the tooltip carries only the click hint. Repeating
        // "2 of 5 checks failed" over a line that reads exactly that tells the user nothing.
        assertEquals(
            listOf(
                "<html>Click to open the pull request conversation in your browser.</html>",
                "<html>Click to open the pull request in your browser.</html>",
                "<html>Click to open the checks in your browser.</html>",
            ),
            edt { lines.map { it.toolTipText } },
        )
        // Announced by its sentence rather than by the hint, which alone would not say what opens.
        assertEquals(
            listOf("3 of 8 review conversations unresolved", "Review approved", "2 of 5 checks failed"),
            edt { lines.map { it.accessibleContext.accessibleName } },
        )

        edt { lines.forEach { click(it) } }

        // The popup is the one surface that says "2 of 5 checks failed" in words, so that line goes to the
        // log rather than the conversation the other two open.
        assertEquals(
            listOf(
                "https://example.test/pr/7",
                "https://example.test/pr/7",
                "https://example.test/pr/7/checks",
            ),
            browser.urls,
        )
    }

    fun `test the tooltip covers the whole line, not just its text`() {
        val body = body()

        edt { body.update(null, pr(GhReview.NONE, GhChecksDto(), GhCommentsDto(total = 8, unresolved = 3)), "feature-x", null) }

        // The pill is the click target, so a tooltip only on the label would go quiet over the padding the
        // user is just as likely to be pointing at.
        val line = edt { hovers(body).single() }
        val label = edt { components(line).filterIsInstance<JBLabel>().single() }
        assertEquals(edt { line.toolTipText }, edt { label.toolTipText })
    }

    fun `test a hidden verdict line is not a click target`() {
        val body = body()

        edt { body.update(null, pr(GhReview.NONE, GhChecksDto()), "feature-x", null) }

        // The lines are retained and only hidden, so a stale action behind an invisible row would still be
        // reachable by the keyboard if the slot were left in the column.
        assertTrue(edt { hovers(body).isEmpty() })
    }

    fun `test verdict lines are hidden when github reports neither`() {
        val body = body()

        edt { body.update(null, pr(GhReview.NONE, GhChecksDto()), "feature-x", null) }

        // A PR with no reviewers, no CI, and nothing unresolved must not leave three empty rows.
        val lines = labels(body)
        assertTrue(
            "expected no verdict lines, got $lines",
            lines.none { it.contains("Review") || it.contains("check") || it.contains("conversations") },
        )
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
                pull = pr(
                    GhReview.APPROVED,
                    GhChecksDto(GhChecks.PASSED, total = 4, passed = 4),
                    GhCommentsDto(total = 8, unresolved = 3),
                ),
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
            val comments = components(body)
                .filterIsInstance<JBLabel>()
                .single { it.text == "3 of 8 review conversations unresolved" }

            // The state pill and the title share the first line; everything else gets its own, in the same
            // order as the glyph strip above them.
            assertTrue(kotlin.math.abs(middle(body, badge) - middle(body, title)) <= 2)
            assertTrue(bottom(body, title) <= top(body, rule))
            assertTrue(bottom(body, rule) <= top(body, changes))
            assertTrue(bottom(body, changes) <= top(body, comments))
            assertTrue(bottom(body, comments) <= top(body, review))
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

    fun `test the uncommitted changes are broken out beside the committed ones`() {
        val body = body()

        edt {
            body.update(
                stats = WorktreeStatsDto(path, additions = 9, deletions = 4, files = 3, ahead = 1, behind = 2),
                pull = pr(GhReview.NONE, GhChecksDto()),
                name = "feature-x",
                dirty = WorktreeDirtyDto(path, additions = 6, deletions = 2, files = 4),
            )
            layout(body)
        }

        edt {
            // The PR chrome leads, and every count the row cannot fit follows it.
            assertNotNull(components(body).filterIsInstance<JBLabel>().find { it.icon is FilledBadgeIcon })
            assertTrue(components(body).filterIsInstance<SimpleColoredComponent>().single().isVisible)
            val changes = UIUtil.findComponentOfType(body, ChangesPanel::class.java)!!
            assertTrue(changes.isVisible)
            assertEquals(
                listOf("4 files", "-2", "+6", "1", "2", "3 files", "-4", "+9"),
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

    /**
     * The verdict lines' hover areas, in popup order. Areas inside the embedded [PrHeaderView] are left out
     * — that widget has its own five and its own tests — and so is any line that is currently hidden, since
     * a reader cannot reach it.
     */
    @RequiresEdt
    private fun hovers(body: WorktreeRowPopupBody): List<HoverArea> {
        val header = components(body).filterIsInstance<PrHeaderView>().single()
        return components(body)
            .filterIsInstance<HoverArea>()
            .filter { !SwingUtilities.isDescendingFrom(it, header) }
            .filter { area -> generateSequence<Component>(area) { it.parent }.all { it.isVisible } }
    }

    @RequiresEdt
    private fun click(target: Component) {
        target.dispatchEvent(
            MouseEvent(target, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, 1, 1, 1, false, MouseEvent.BUTTON1),
        )
    }

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

    private fun pr(review: GhReview, checks: GhChecksDto, comments: GhCommentsDto = GhCommentsDto()) =
        WorktreePrDto(path, 7, GhState.OPEN, "https://example.test/pr/7", "Feature title", review, checks, comments)

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
