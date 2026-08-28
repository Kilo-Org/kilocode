package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.header.BranchChangesBadge
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.HoverIcon
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
import org.jetbrains.plugins.terminal.TerminalIcons
import java.awt.Container
import java.awt.Cursor
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.SwingUtilities

class WorktreePrHeaderViewTest : BasePlatformTestCase() {
    fun `test PR state title and colors render`() {
        val view = edt { WorktreePrHeaderView {} }
        val pull = pull(GhState.OPEN)

        edt { view.update(null, pull, "friendly-name") }

        val badge = edt { badge(view) }
        val title = edt { title(view) }
        val fragments = edt { fragments(title) }
        assertEquals(stateLabel(GhState.OPEN), (badge.icon as FilledBadgeIcon).text)
        assertSame(style(GhState.OPEN), (badge.icon as FilledBadgeIcon).style)
        assertTrue(badge.isVisible)
        assertEquals(listOf("Implement header", " #123"), fragments.map { it.text })
        assertEquals(SimpleTextAttributes.STYLE_BOLD, fragments[0].attrs.style)
        assertEquals(SimpleTextAttributes.GRAYED_ATTRIBUTES.fgColor, fragments[1].attrs.fgColor)
        assertEquals(Cursor.HAND_CURSOR, title.cursor.type)
        assertEquals(Cursor.HAND_CURSOR, badge.cursor.type)
        assertTrue(title.toolTipText.contains("Open #123 Implement header"))
    }

    fun `test PR states use shared badge styles`() {
        val view = edt { WorktreePrHeaderView {} }

        GhState.entries.forEach { state ->
            edt { view.update(null, pull(state), "worktree") }
            val icon = edt { badge(view).icon as FilledBadgeIcon }
            assertEquals(stateLabel(state), icon.text)
            assertSame(style(state), icon.style)
        }
    }

    fun `test no PR hides status and title`() {
        val view = edt { WorktreePrHeaderView {} }

        edt { view.update(null, null, "feature-x") }

        assertNull(edt { components(view).filterIsInstance<JBLabel>().firstOrNull { it.icon is FilledBadgeIcon } })
        val title = edt { title(view) }
        assertFalse(edt { title.isVisible })
        assertTrue(edt { fragments(title).isEmpty() })
        assertEquals(Cursor.DEFAULT_CURSOR, title.cursor.type)
    }

    fun `test no PR keeps changes badge on the right`() {
        val view = edt { WorktreePrHeaderView {} }
        val changes = edt { UIUtil.findComponentOfType(view, BranchChangesBadge::class.java)!! }
        val open = edt { components(view).filterIsInstance<JButton>().single { it.text == "Open" } }
        val terminal = edt { components(view).filterIsInstance<HoverIcon>().single { it.icon === TerminalIcons.OpenTerminal_13x13 } }

        edt {
            view.update(WorktreeStatsDto("/repo", additions = 2, files = 1), null, "feature-x")
            view.setSize(400, 32)
            view.doLayout()
            components(view).filterIsInstance<Container>().forEach { it.doLayout() }
        }

        val changesX = edt { SwingUtilities.convertPoint(changes, Point(0, 0), view).x }
        val openX = edt { SwingUtilities.convertPoint(open, Point(0, 0), view).x }
        val terminalX = edt { SwingUtilities.convertPoint(terminal, Point(0, 0), view).x }
        val terminalRight = edt { terminalX + terminal.width }
        assertTrue(edt { changes.isVisible })
        // Changes badge precedes Open, which precedes the icon-only Terminal button, and the whole
        // action cluster hugs the right edge.
        assertTrue(changesX < openX)
        assertTrue(openX < terminalX)
        assertTrue(400 - terminalRight <= 20)
    }

    fun `test changes view visibility follows stats`() {
        val view = edt { WorktreePrHeaderView {} }
        val changes = edt { UIUtil.findComponentOfType(view, BranchChangesBadge::class.java)!! }

        edt { view.update(WorktreeStatsDto("/repo"), null, "feature-x") }
        assertFalse(edt { changes.isVisible })

        edt { view.update(WorktreeStatsDto("/repo", additions = 2, deletions = 1, ahead = 1, behind = 1, files = 2), null, "feature-x") }
        assertTrue(edt { changes.isVisible })
    }

    fun `test nested changes badge click opens diff`() {
        var opened = 0
        val view = edt { WorktreePrHeaderView { opened++ } }

        edt { view.update(WorktreeStatsDto("/repo", additions = 2, files = 1), null, "feature-x") }
        edt { click(UIUtil.findComponentOfType(view, BranchChangesBadge::class.java)!!) }

        assertEquals(1, opened)
    }

    fun `test repeated update keeps child instances`() {
        val view = edt { WorktreePrHeaderView {} }
        val stats = WorktreeStatsDto("/repo", additions = 2, files = 1)
        val pull = pull(GhState.DRAFT)

        edt { view.update(stats, pull, "feature-x") }
        val labels = edt { components(view).filterIsInstance<JBLabel>() }
        val title = edt { title(view) }
        val changes = edt { UIUtil.findComponentOfType(view, BranchChangesBadge::class.java)!! }

        edt { view.update(stats, pull, "feature-x") }

        assertEquals(labels, edt { components(view).filterIsInstance<JBLabel>() })
        assertSame(title, edt { title(view) })
        assertSame(changes, edt { UIUtil.findComponentOfType(view, BranchChangesBadge::class.java) })
    }

    fun `test changes badge reuses session branch badge with file count`() {
        val view = edt { WorktreePrHeaderView {} }
        val changes = edt { UIUtil.findComponentOfType(view, BranchChangesBadge::class.java)!! }

        edt { view.update(WorktreeStatsDto("/repo", additions = 10, deletions = 4, ahead = 3, files = 2), null, "feature-x") }

        assertEquals("2 files", edt { changes.countText() })
        assertEquals(10 to 4, edt { changes.stats() })
        assertTrue(edt { changes.isVisible })
        assertEquals("Compare with base branch", edt { changes.toolTipText })
    }

    fun `test terminal button is icon-only and triggers callback`() {
        var opened = 0
        val view = edt { WorktreePrHeaderView(openDiff = {}, openTerminal = { opened++ }) }
        val terminal = edt { components(view).filterIsInstance<HoverIcon>().single { it.icon === TerminalIcons.OpenTerminal_13x13 } }

        assertTrue(edt { terminal.text.isNullOrEmpty() })
        assertEquals(KiloBundle.message("worktree.session.terminal.tooltip"), edt { terminal.toolTipText })

        edt { click(terminal) }

        assertEquals(1, opened)
    }

    private fun pull(state: GhState) = WorktreePrDto(
        path = "/repo",
        number = 123,
        state = state,
        url = "https://github.com/kilo/test/pull/123",
        title = "Implement header",
    )

    private fun badge(view: WorktreePrHeaderView): JBLabel {
        return components(view).filterIsInstance<JBLabel>().single { it.icon is FilledBadgeIcon }
    }

    private fun title(view: WorktreePrHeaderView): SimpleColoredComponent {
        return components(view).filterIsInstance<SimpleColoredComponent>().single()
    }

    private fun fragments(title: SimpleColoredComponent): List<Fragment> {
        val out = mutableListOf<Fragment>()
        val iter = title.iterator()
        while (iter.hasNext()) {
            iter.next()
            out += Fragment(iter.fragment, iter.textAttributes)
        }
        return out
    }

    private data class Fragment(val text: String, val attrs: SimpleTextAttributes)

    private fun components(root: java.awt.Component): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        fun visit(item: java.awt.Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private fun click(target: JComponent) {
        target.setSize(target.preferredSize)
        val point = Point(target.width.coerceAtLeast(2) / 2, target.height.coerceAtLeast(2) / 2)
        listOf(
            MouseEvent(target, MouseEvent.MOUSE_PRESSED, System.currentTimeMillis(), InputEvent.BUTTON1_DOWN_MASK, point.x, point.y, 1, false, MouseEvent.BUTTON1),
            MouseEvent(target, MouseEvent.MOUSE_RELEASED, System.currentTimeMillis(), 0, point.x, point.y, 1, false, MouseEvent.BUTTON1),
            MouseEvent(target, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, point.x, point.y, 1, false, MouseEvent.BUTTON1),
        ).forEach(target::dispatchEvent)
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
