package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.util.edtWait
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Container
import java.awt.Point
import java.awt.event.ActionEvent
import java.awt.event.InputEvent
import java.awt.event.KeyEvent
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.KeyStroke

class WorktreeSessionListToggleTest : BasePlatformTestCase() {
    private var clicks = 0
    private lateinit var toggle: WorktreeSessionListToggle

    override fun setUp() {
        super.setUp()
        clicks = 0
        toggle = edt { WorktreeSessionListToggle { clicks++ } }
    }

    fun `test the badge follows count expansion and activity without rebuilding labels`() {
        val glyph = labels()[0]
        val badge = labels()[1]

        assertFalse(edt { badge.isVisible })
        assertEquals("Show sessions", edt { toggle.toolTipText })

        edt { toggle.update(expanded = false, count = 1, kind = null) }
        assertFalse(edt { badge.isVisible })

        edt { toggle.update(expanded = false, count = 3, kind = null) }
        assertEquals("3", edt { (badge.icon as FilledBadgeIcon).text })

        edt { toggle.update(expanded = false, count = 3, kind = SessionActivityKind.PERMISSION) }
        assertSame(SessionActivityKind.PERMISSION.icon(), edt { badge.icon })

        edt { toggle.update(expanded = true, count = 3, kind = SessionActivityKind.PERMISSION) }
        assertFalse(edt { badge.isVisible })
        assertEquals("Hide sessions", edt { toggle.toolTipText })

        // The retained tree is mutated in place, never rebuilt.
        assertSame(glyph, labels()[0])
        assertSame(badge, labels()[1])
        assertEquals(2, labels().size)
    }

    fun `test the glyph swaps between the collapsed and expanded icons`() {
        val glyph = labels()[0]
        val collapsed = edt { glyph.icon }

        edt { toggle.update(expanded = true, count = 0, kind = null) }
        val expanded = edt { glyph.icon }

        assertNotSame(collapsed, expanded)

        edt { toggle.update(expanded = false, count = 0, kind = null) }
        assertSame(collapsed, edt { glyph.icon })
    }

    fun `test mouse and keyboard both activate the toggle`() {
        edt {
            toggle.size = toggle.preferredSize
            val point = Point(toggle.width / 2, toggle.height / 2)
            toggle.dispatchEvent(
                MouseEvent(toggle, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), InputEvent.BUTTON1_DOWN_MASK, point.x, point.y, 1, false, MouseEvent.BUTTON1),
            )
        }
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(1, clicks)

        edt {
            val key = toggle.getInputMap(JComponent.WHEN_FOCUSED).get(KeyStroke.getKeyStroke(KeyEvent.VK_SPACE, 0))
            toggle.actionMap.get(key).actionPerformed(ActionEvent(toggle, ActionEvent.ACTION_PERFORMED, ""))
        }

        assertEquals(2, clicks)
    }

    private fun labels(): List<JBLabel> = edt { components(toggle).filterIsInstance<JBLabel>() }

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
