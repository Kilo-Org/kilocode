package ai.kilocode.client.session

import ai.kilocode.client.session.ui.SessionDropOverlay
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.account.SessionAccountOverlay
import ai.kilocode.client.session.ui.rail.PromptRail
import ai.kilocode.client.ui.UiStyle
import com.intellij.ui.components.JBScrollPane
import java.awt.Point
import java.awt.Rectangle
import java.awt.Component
import java.awt.Container
import javax.swing.JLayeredPane
import javax.swing.SwingUtilities

class PromptRailLayoutTest : SessionUiTestBase() {
    fun `test rail is hidden until two prompts exist`() {
        showMessages()
        val rail = find<PromptRail>(ui)
        assertFalse(rail.isVisible)

        fillTranscript(1)
        layoutAll(ui)
        drainScroll()
        assertFalse(rail.isVisible)

        fillTranscript(1, start = 1)
        layoutAll(ui)
        drainScroll()
        assertTrue(rail.isVisible)
    }

    fun `test wide rail uses standard right inset outside readable lane`() {
        showMessages()
        fillTranscript(30)
        ui.setSize(1600, 600)
        layoutAll(ui)
        ui.promptRail.refresh()
        find<SessionRootPanel>(ui).overlay.doLayout()
        drainScroll()
        val rail = find<PromptRail>(ui)
        val root = find<SessionRootPanel>(ui)
        val pane = scrollComponent() as JBScrollPane
        val vp = SwingUtilities.convertRectangle(pane.viewport, Rectangle(pane.viewport.size), root.overlay)
        val bar = SwingUtilities.convertRectangle(pane.verticalScrollBar, Rectangle(pane.verticalScrollBar.size), root.overlay)

        assertEquals(bar.x - UiStyle.Gap.pad(), rail.x + rail.width)
        assertFalse("rail=${rail.bounds} bar=$bar vp=$vp", rail.bounds.intersects(bar))
    }

    fun `test narrow rail covers scrollbar and remains above content`() {
        showMessages()
        fillTranscript(12)
        ui.setSize(420, 600)
        layoutAll(ui)
        ui.promptRail.refresh()
        find<SessionRootPanel>(ui).overlay.doLayout()
        drainScroll()
        val rail = find<PromptRail>(ui)
        val root = find<SessionRootPanel>(ui)
        val pane = scrollComponent() as JBScrollPane
        val bar = SwingUtilities.convertRectangle(pane.verticalScrollBar, Rectangle(pane.verticalScrollBar.size), root.overlay)

        assertSame(root.overlay, rail.parent)
        assertEquals(JLayeredPane.PALETTE_LAYER, root.getLayer(root.overlay))
        assertTrue("available=${rail.available()} entries=${rail.entries().size} bounds=${rail.bounds}", rail.isVisible)
        assertTrue("rail=${rail.bounds} bar=$bar", rail.bounds.intersects(bar))
        val point = SwingUtilities.convertPoint(rail, Point(rail.width / 2, rail.tickCenterY(0)), root)
        assertSame(rail, SwingUtilities.getDeepestComponentAt(root, point.x, point.y))
        val free = SwingUtilities.convertPoint(rail, Point(rail.width / 2, 1), root)
        val below = SwingUtilities.getDeepestComponentAt(root, free.x, free.y)
        assertTrue(below === pane.verticalScrollBar || SwingUtilities.isDescendingFrom(below, pane.verticalScrollBar))
        assertFalse(root.isOptimizedDrawingEnabled)
    }

    fun `test rail stays below the other session overlays`() {
        showMessages()
        fillTranscript(3)
        val rail = find<PromptRail>(ui)
        val root = find<SessionRootPanel>(ui)
        val drop = find<SessionDropOverlay>(ui)
        val account = find<SessionAccountOverlay>(ui)

        assertTrue(root.overlay.getComponentZOrder(rail) > root.overlay.getComponentZOrder(drop))
        assertTrue(root.overlay.getComponentZOrder(rail) > root.overlay.getComponentZOrder(account))
        assertTrue(root.overlay.getComponentZOrder(rail) > root.overlay.getComponentZOrder(jumpButton()))
    }

    fun `test scrolling changes active prompt and jump scrolls to prompt top`() {
        showMessages()
        fillTranscript(10)
        val rail = find<PromptRail>(ui)
        val bar = scrollBar()
        setValue(bar, 0)
        assertEquals(0, rail.active())

        setValue(bar, bottom(bar) / 2)
        assertTrue((rail.active() ?: 0) > 0)

        assertTrue(ui.scroll.scrollMessageTop("msg_2"))
        drainScroll()
        val turn = find<ai.kilocode.client.session.ui.SessionMessageListPanel>(ui).findTurn("msg_2")!!
        val expected = SwingUtilities.convertPoint(turn, Point(0, 0), scrollView()).y
            .coerceIn(0, bottom(bar))
        assertEquals(expected, bar.value)
        assertFalse(ui.scroll.following())
    }

    fun `test repeated updates retain the rail and overlay tree`() {
        showMessages()
        fillTranscript(10)
        val root = find<SessionRootPanel>(ui)
        val rail = find<PromptRail>(ui)
        val count = root.overlay.componentCount
        val items = rail.items()
        val entries = rail.entries()

        repeat(300) { rail.update(items, entries, it % items.size) }

        assertSame(rail, find<PromptRail>(ui))
        assertEquals(count, root.overlay.componentCount)
    }

    private fun layoutAll(comp: Component) {
        comp.doLayout()
        if (comp is Container) comp.components.forEach(::layoutAll)
    }
}
