package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.ChangesPanel
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.PrIcons
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.stateLabel
import ai.kilocode.client.ui.style
import ai.kilocode.client.testing.installBrowser
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Container
import java.awt.Cursor
import java.awt.event.MouseEvent
import javax.swing.Icon
import javax.swing.JButton
import javax.swing.JSeparator
import javax.swing.SwingUtilities

class PrHeaderViewTest : BasePlatformTestCase() {
    fun `test PR renders state badge title and link`() {
        val view = edt { PrHeaderView {} }

        edt { view.update(files = 0, additions = 0, deletions = 0, pull = pull(GhState.OPEN), name = "feature-x") }

        val badge = edt { badge(view) }
        val title = edt { title(view) }
        assertEquals(stateLabel(GhState.OPEN), (badge.icon as FilledBadgeIcon).text)
        assertSame(style(GhState.OPEN), (badge.icon as FilledBadgeIcon).style)
        assertEquals(listOf("Implement header", " #123"), edt { fragments(title) })
        assertEquals(Cursor.HAND_CURSOR, edt { title.cursor.type })
    }

    fun `test title style can be configured`() {
        val view = edt { PrHeaderView(openDiff = {}, titleStyle = SimpleTextAttributes.STYLE_PLAIN) }

        edt { view.update(files = 0, additions = 0, deletions = 0, pull = pull(GhState.OPEN), name = "feature-x") }

        val title = edt { title(view) }
        assertEquals(SimpleTextAttributes.STYLE_PLAIN, edt { firstAttrs(title).style })
    }

    fun `test no PR hides badge and title`() {
        val view = edt { PrHeaderView {} }

        edt { view.update(files = 0, additions = 0, deletions = 0, pull = null, name = "feature-x") }

        assertNull(edt { components(view).filterIsInstance<JBLabel>().firstOrNull { it.icon is FilledBadgeIcon } })
        assertFalse(edt { title(view).isVisible })
    }

    fun `test verdict glyphs sit between the state badge and the title`() {
        val view = edt { PrHeaderView {} }

        edt {
            view.update(files = 0, additions = 0, deletions = 0, pull = verdicts(), name = "feature-x")
            layout(view)
        }

        edt {
            val badge = badge(view)
            val review = glyph(view, PrIcons.reviewApproved)
            val checks = glyph(view, PrIcons.checksFailed)
            // State, review, run, then the title: the same reading order the worktree rows use.
            assertTrue(right(view, badge) <= left(view, review))
            assertTrue(right(view, review) <= left(view, checks))
            assertTrue(right(view, checks) <= left(view, title(view)))
            assertEquals("<html>Review approved</html>", review.toolTipText)
            // The glyph cannot say how many failed, so the tooltip has to.
            assertEquals(
                "<html>2 of 5 checks failed<br>Click to open the checks in your browser.</html>",
                checks.toolTipText,
            )
            assertEquals(Cursor.HAND_CURSOR, review.cursor.type)
            assertEquals(Cursor.HAND_CURSOR, checks.cursor.type)
        }
    }

    fun `test the review glyph opens the pull request and the run glyph opens its checks`() {
        val browser = installBrowser()
        val view = edt { PrHeaderView {} }
        edt { view.update(files = 0, additions = 0, deletions = 0, pull = verdicts(), name = "feature-x") }

        edt { click(glyph(view, PrIcons.reviewApproved)) }
        edt { click(glyph(view, PrIcons.checksFailed)) }

        // Someone clicking a red build wants the log, not the conversation.
        assertEquals(
            listOf("https://github.com/kilo/test/pull/123", "https://github.com/kilo/test/pull/123/checks"),
            browser.urls,
        )
    }

    fun `test a pull request with no verdicts shows no glyphs`() {
        val view = edt { PrHeaderView {} }

        edt { view.update(files = 0, additions = 0, deletions = 0, pull = pull(GhState.OPEN), name = "feature-x") }

        // No CI on the head and a review nobody has given yet: both would leave a gap after the pill.
        assertTrue(edt { glyphs(view).isEmpty() })

        edt { view.update(files = 0, additions = 0, deletions = 0, pull = verdicts(), name = "feature-x") }
        assertEquals(2, edt { glyphs(view).size })

        // A PR that goes away takes its verdicts with it.
        edt { view.update(files = 0, additions = 0, deletions = 0, pull = null, name = "feature-x") }
        assertTrue(edt { glyphs(view).isEmpty() })
    }

    fun `test changes default to compact aggregate presentation`() {
        val view = edt { PrHeaderView {} }
        val changes = edt { UIUtil.findComponentOfType(view, ChangesPanel::class.java)!! }

        edt { view.update(3, 7, 4, null, "feature-x", ahead = 2, localFiles = 1, localAdditions = 8) }

        assertEquals(listOf("3 files", "-4", "+7"), edt { components(changes).filterIsInstance<JBLabel>().filter { it.isVisible }.map { it.text } })
        assertTrue(edt { changes.isVisible })
    }

    fun `test action slot adds trailing control`() {
        val view = edt { PrHeaderView {} }
        val button = edt { JButton("Move").also { view.addAction(it) } }

        assertTrue(edt { components(view).contains(button) })
    }

    fun `test action separator tracks actions and visible changes`() {
        val view = edt { PrHeaderView {} }
        val separator = edt { components(view).filterIsInstance<JSeparator>().single() }

        // Changes alone are not a toolbar: with no actions there is nothing to separate them from.
        edt { view.update(2, 1, 0, null, "feature-x") }
        assertFalse(edt { separator.isVisible })

        edt { view.addAction(JButton("Open")) }
        assertTrue(edt { separator.isVisible })

        // A clean worktree leaves the separator with nothing on its left, so it goes away too.
        edt { view.update(0, 0, 0, null, "feature-x") }
        assertFalse(edt { separator.isVisible })
    }

    fun `test toolbar keeps standard left padding before the changes summary`() {
        val view = edt { PrHeaderView {} }
        val button = JButton("Open")
        edt {
            view.addAction(button)
            view.update(2, 1, 0, null, "feature-x")
            layout(view)
        }
        val separator = edt { components(view).filterIsInstance<JSeparator>().single() }
        val changes = edt { UIUtil.findComponentOfType(view, ChangesPanel::class.java)!! }
        val row = edt { separator.parent }
        val wrapper = edt { row.components.single { SwingUtilities.isDescendingFrom(changes, it) } }

        // The row's left inset pads the summary off the PR title without a leading separator.
        assertEquals(UiStyle.Gap.md(), edt { wrapper.x })
        assertTrue(edt { components(view).filterIsInstance<JSeparator>().none { it.x < wrapper.x } })
        // Order is padding, changes, separator, then the actions.
        assertTrue(edt { wrapper.x + wrapper.width <= separator.x })
        assertTrue(edt { separator.x < SwingUtilities.convertPoint(button, 0, 0, view).x })
    }

    fun `test repeated update keeps child instances and bounded count`() {
        val view = edt { PrHeaderView {} }
        val pull = pull(GhState.DRAFT)

        edt { view.update(1, 2, 0, pull, "feature-x") }
        val labels = edt { components(view).filterIsInstance<JBLabel>() }
        val title = edt { title(view) }
        val changes = edt { UIUtil.findComponentOfType(view, ChangesPanel::class.java)!! }
        val count = edt { components(view).size }

        repeat(20) { edt { view.update(1, 2, 0, pull, "feature-x") } }

        assertEquals(labels, edt { components(view).filterIsInstance<JBLabel>() })
        assertSame(title, edt { title(view) })
        assertSame(changes, edt { UIUtil.findComponentOfType(view, ChangesPanel::class.java) })
        assertEquals(count, edt { components(view).size })
    }

    fun `test applyStyle refreshes title without rebuilding`() {
        val view = edt { PrHeaderView {} }
        edt { view.update(files = 1, additions = 1, deletions = 0, pull = pull(GhState.OPEN), name = "feature-x") }
        val title = edt { title(view) }

        edt { view.applyStyle(SessionEditorStyle.current()) }

        assertSame(title, edt { title(view) })
        assertEquals(listOf("Implement header", " #123"), edt { fragments(title) })
    }

    private fun pull(state: GhState) = WorktreePrDto(
        path = "/repo",
        number = 123,
        state = state,
        url = "https://github.com/kilo/test/pull/123",
        title = "Implement header",
    )

    private fun verdicts() = pull(GhState.OPEN).copy(
        review = GhReview.APPROVED,
        checks = GhChecksDto(GhChecks.FAILED, total = 5, passed = 3, failed = 2),
    )

    @RequiresEdt
    private fun badge(view: PrHeaderView): JBLabel =
        components(view).filterIsInstance<JBLabel>().single { it.icon is FilledBadgeIcon }

    /** The visible verdict labels, which are the only glyph-icon labels the header owns. */
    @RequiresEdt
    private fun glyphs(view: PrHeaderView): List<JBLabel> =
        components(view).filterIsInstance<JBLabel>().filter { it.isVisible && it.icon != null && it.icon !is FilledBadgeIcon }

    @RequiresEdt
    private fun glyph(view: PrHeaderView, icon: Icon): JBLabel = glyphs(view).single { it.icon === icon }

    @RequiresEdt
    private fun left(view: PrHeaderView, child: Component): Int = SwingUtilities.convertPoint(child, 0, 0, view).x

    @RequiresEdt
    private fun right(view: PrHeaderView, child: Component): Int = left(view, child) + child.width

    @RequiresEdt
    private fun click(child: Component) {
        child.dispatchEvent(
            MouseEvent(child, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, 1, 1, 1, false, MouseEvent.BUTTON1),
        )
    }

    @RequiresEdt
    private fun title(view: PrHeaderView): SimpleColoredComponent =
        components(view).filterIsInstance<SimpleColoredComponent>().single()

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
    private fun firstAttrs(title: SimpleColoredComponent): SimpleTextAttributes {
        val iter = title.iterator()
        check(iter.hasNext()) { "missing title fragment" }
        iter.next()
        return iter.textAttributes
    }

    @RequiresEdt
    private fun components(root: Component): List<Component> {
        val out = mutableListOf<Component>()
        fun visit(item: Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    @RequiresEdt
    private fun layout(view: PrHeaderView) {
        view.setSize(view.preferredSize)
        components(view).forEach { if (it is Container) it.doLayout() }
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
