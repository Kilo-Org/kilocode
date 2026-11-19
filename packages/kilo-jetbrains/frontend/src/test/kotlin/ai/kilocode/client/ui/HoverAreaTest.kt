package ai.kilocode.client.ui

import ai.kilocode.client.util.edtWait
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Cursor
import java.awt.Dimension
import java.awt.event.ActionEvent
import java.awt.event.KeyEvent
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
import javax.accessibility.AccessibleAction
import javax.accessibility.AccessibleRole
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.KeyStroke

/**
 * The reusable hover treatment behind the PR header and the row popup. What matters is that an area only
 * looks and behaves clickable while it actually is: a pill on inert text is a promise the UI cannot keep.
 */
class HoverAreaTest : BasePlatformTestCase() {
    fun `test an area with no action stays inert`() {
        val area = edt { HoverArea(JBLabel("3")) }

        assertEquals(Cursor.DEFAULT_CURSOR, edt { area.cursor.type })
        assertFalse(edt { area.isFocusable })
        assertEquals(0, edt { action(area).accessibleActionCount })
    }

    fun `test an action makes the area a hand-cursor focus stop`() {
        val area = edt { HoverArea(JBLabel("3")) }

        edt { area.action = {} }

        assertEquals(Cursor.HAND_CURSOR, edt { area.cursor.type })
        assertTrue(edt { area.isFocusable })
        assertEquals(AccessibleRole.PUSH_BUTTON, edt { area.accessibleContext.accessibleRole })
        assertEquals(1, edt { action(area).accessibleActionCount })
    }

    fun `test the hand cursor reaches the content, not just the area`() {
        val label = JBLabel("3")
        val area = edt { HoverArea(label) }

        edt { area.action = {} }

        // The pointer is over the label for most of the pill's area, so a cursor set only on the wrapper
        // would flip back to the arrow exactly where the user aims.
        assertEquals(Cursor.HAND_CURSOR, edt { label.cursor.type })
    }

    fun `test hovering an interactive area paints the pill`() {
        val area = edt { HoverArea(JBLabel("3")).also { it.action = {} } }
        val idle = edt { paint(area) }

        edt { enter(area) }

        assertFalse("hovering must change what the area paints", same(idle, edt { paint(area) }))
    }

    fun `test hovering an inert area paints nothing extra`() {
        val area = edt { HoverArea(JBLabel("3")) }
        val idle = edt { paint(area) }

        edt { enter(area) }

        // A pill without a click behind it reads as a button that does nothing.
        assertTrue(same(idle, edt { paint(area) }))
    }

    fun `test leaving for the content is not leaving the area`() {
        val label = JBLabel("3")
        val area = edt { HoverArea(label).also { it.action = {} } }
        edt {
            area.size = Dimension(60, 24)
            area.doLayout()
            enter(area)
        }
        val hovered = edt { paint(area) }

        // The listener sits on the whole subtree, so moving onto the label fires exit on the wrapper.
        edt { exit(area, label, 1, 1) }

        assertTrue("moving onto the content must keep the pill", same(hovered, edt { paint(area) }))
    }

    fun `test leaving the bounds drops the pill`() {
        val area = edt { HoverArea(JBLabel("3")).also { it.action = {} } }
        val idle = edt { paint(area) }
        edt {
            area.size = Dimension(60, 24)
            area.doLayout()
            enter(area)
        }

        edt { exit(area, area, 200, 200) }

        assertTrue(same(idle, edt { paint(area) }))
    }

    fun `test a click runs the action once`() {
        var hits = 0
        val area = edt { HoverArea(JBLabel("3")).also { it.action = { hits++ } } }

        edt { click(area) }

        assertEquals(1, hits)
    }

    fun `test a click on the content runs the action`() {
        var hits = 0
        val label = JBLabel("3")
        val area = edt { HoverArea(label).also { it.action = { hits++ } } }

        edt { click(label) }

        assertEquals(1, hits)
    }

    fun `test a click without an action does nothing`() {
        val area = edt { HoverArea(JBLabel("3")) }

        edt { click(area) }

        assertEquals(0, edt { action(area).accessibleActionCount })
    }

    fun `test a hidden or disabled ancestor blocks activation`() {
        var hits = 0
        val area = edt { HoverArea(JBLabel("3")).also { it.action = { hits++ } } }
        val host = edt { JPanel().also { it.add(area) } }

        edt {
            host.isVisible = false
            click(area)
        }
        assertEquals("a hidden host must not answer a synthetic click", 0, hits)

        edt {
            host.isVisible = true
            host.isEnabled = false
            click(area)
        }
        assertEquals("a disabled host must not answer either", 0, hits)

        edt {
            host.isEnabled = true
            click(area)
        }
        assertEquals(1, hits)
    }

    fun `test enter and space activate a focused area`() {
        var hits = 0
        val area = edt { HoverArea(JBLabel("3")).also { it.action = { hits++ } } }

        edt {
            key(area, KeyEvent.VK_ENTER)
            key(area, KeyEvent.VK_SPACE)
        }

        assertEquals(2, hits)
    }

    fun `test the accessible name defaults to the tooltip`() {
        val area = edt { HoverArea(JBLabel("3")).also { it.action = {} } }

        edt { area.tooltip("<html>3 of 8 review conversations unresolved</html>") }

        // Stripped of its markup, because a screen reader should not read out the tags.
        assertEquals("3 of 8 review conversations unresolved", edt { area.accessibleContext.accessibleName })
        assertEquals("<html>3 of 8 review conversations unresolved</html>", edt { area.toolTipText })
    }

    fun `test a click hint tooltip can be announced by the visible text instead`() {
        val area = edt { HoverArea(JBLabel("4 checks passed")).also { it.action = {} } }

        edt { area.tooltip("<html>Click to open the checks in your browser.</html>", name = "4 checks passed") }

        // The hint alone would announce that something opens without saying what.
        assertEquals("4 checks passed", edt { area.accessibleContext.accessibleName })
        assertEquals("<html>Click to open the checks in your browser.</html>", edt { area.toolTipText })
    }

    fun `test the tooltip reaches the content so the whole pill answers`() {
        val label = JBLabel("3")
        val area = edt { HoverArea(label) }

        edt { area.tooltip("Click to open") }

        assertEquals("Click to open", edt { label.toolTipText })

        edt { area.tooltip(null) }
        assertNull(edt { label.toolTipText })
    }

    @RequiresEdt
    private fun action(area: HoverArea): AccessibleAction = area.accessibleContext as AccessibleAction

    @RequiresEdt
    private fun paint(area: HoverArea): BufferedImage {
        if (area.width == 0) {
            area.size = Dimension(60, 24)
            area.doLayout()
        }
        val image = UIUtil.createImage(area, area.width, area.height, BufferedImage.TYPE_INT_ARGB)
        val canvas = image.createGraphics()
        try {
            area.paint(canvas)
        } finally {
            canvas.dispose()
        }
        return image
    }

    private fun same(a: BufferedImage, b: BufferedImage): Boolean {
        if (a.width != b.width || a.height != b.height) return false
        for (x in 0 until a.width) {
            for (y in 0 until a.height) {
                if (a.getRGB(x, y) != b.getRGB(x, y)) return false
            }
        }
        return true
    }

    @RequiresEdt
    private fun enter(target: Component) {
        target.dispatchEvent(
            MouseEvent(target, MouseEvent.MOUSE_ENTERED, System.currentTimeMillis(), 0, 1, 1, 0, false),
        )
    }

    @RequiresEdt
    private fun exit(area: HoverArea, source: Component, x: Int, y: Int) {
        area.dispatchEvent(MouseEvent(source, MouseEvent.MOUSE_EXITED, System.currentTimeMillis(), 0, x, y, 0, false))
    }

    @RequiresEdt
    private fun click(target: Component) {
        target.dispatchEvent(
            MouseEvent(target, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, 1, 1, 1, false, MouseEvent.BUTTON1),
        )
    }

    /** Activated the way Swing does it: resolve the focused input map, then run the bound action. */
    @RequiresEdt
    private fun key(area: HoverArea, code: Int) {
        val stroke = KeyStroke.getKeyStroke(code, 0)
        val name = area.getInputMap(JComponent.WHEN_FOCUSED).get(stroke) ?: error("no binding for $code")
        val bound = area.actionMap.get(name) ?: error("no action for $name")
        bound.actionPerformed(ActionEvent(area, ActionEvent.ACTION_PERFORMED, name.toString()))
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
