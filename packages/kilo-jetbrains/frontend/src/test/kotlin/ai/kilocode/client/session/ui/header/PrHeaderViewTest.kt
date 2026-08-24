package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.stateLabel
import ai.kilocode.client.ui.style
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Container
import java.awt.Cursor
import javax.swing.JButton

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

    fun `test changes aggregate from stats overload`() {
        val view = edt { PrHeaderView {} }
        val changes = edt { UIUtil.findComponentOfType(view, BranchChangesBadge::class.java)!! }

        edt { view.update(WorktreeStatsDto("/repo", additions = 7, deletions = 4, files = 3), null, "feature-x") }

        assertEquals("3 files", edt { changes.countText() })
        assertEquals(7 to 4, edt { changes.stats() })
        assertTrue(edt { changes.isVisible })
    }

    fun `test action slot adds trailing control`() {
        val view = edt { PrHeaderView {} }
        val button = edt { JButton("Move").also { view.addAction(it) } }

        assertTrue(edt { components(view).contains(button) })
    }

    fun `test repeated update keeps child instances and bounded count`() {
        val view = edt { PrHeaderView {} }
        val stats = WorktreeStatsDto("/repo", additions = 2, files = 1)
        val pull = pull(GhState.DRAFT)

        edt { view.update(stats, pull, "feature-x") }
        val labels = edt { components(view).filterIsInstance<JBLabel>() }
        val title = edt { title(view) }
        val changes = edt { UIUtil.findComponentOfType(view, BranchChangesBadge::class.java)!! }
        val count = edt { components(view).size }

        repeat(20) { edt { view.update(stats, pull, "feature-x") } }

        assertEquals(labels, edt { components(view).filterIsInstance<JBLabel>() })
        assertSame(title, edt { title(view) })
        assertSame(changes, edt { UIUtil.findComponentOfType(view, BranchChangesBadge::class.java) })
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

    private fun badge(view: PrHeaderView): JBLabel =
        components(view).filterIsInstance<JBLabel>().single { it.icon is FilledBadgeIcon }

    private fun title(view: PrHeaderView): SimpleColoredComponent =
        components(view).filterIsInstance<SimpleColoredComponent>().single()

    private fun fragments(title: SimpleColoredComponent): List<String> {
        val out = mutableListOf<String>()
        val iter = title.iterator()
        while (iter.hasNext()) {
            iter.next()
            out += iter.fragment
        }
        return out
    }

    private fun firstAttrs(title: SimpleColoredComponent): SimpleTextAttributes {
        val iter = title.iterator()
        check(iter.hasNext()) { "missing title fragment" }
        iter.next()
        return iter.textAttributes
    }

    private fun components(root: Component): List<Component> {
        val out = mutableListOf<Component>()
        fun visit(item: Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
