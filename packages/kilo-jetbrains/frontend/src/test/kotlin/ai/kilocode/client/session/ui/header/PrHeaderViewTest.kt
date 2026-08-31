package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.ChangesPanel
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.stateLabel
import ai.kilocode.client.ui.style
import ai.kilocode.client.util.edtWait
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

    @RequiresEdt
    private fun badge(view: PrHeaderView): JBLabel =
        components(view).filterIsInstance<JBLabel>().single { it.icon is FilledBadgeIcon }

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
