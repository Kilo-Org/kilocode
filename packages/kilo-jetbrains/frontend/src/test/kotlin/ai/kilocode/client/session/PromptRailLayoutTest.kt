package ai.kilocode.client.session

import ai.kilocode.client.session.ui.SessionDropOverlay
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.account.SessionAccountOverlay
import ai.kilocode.client.session.ui.rail.PromptRail
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
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

    /**
     * With many prompts the tick band covers the whole viewport, and in the narrow layout the rail is
     * drawn over the scrollbar. The rail must therefore claim only the rows its ticks occupy, or the
     * thumb cannot be dragged and track clicks never reach the scrollbar.
     */
    fun `test presses between ticks reach the scrollbar`() {
        showMessages()
        // Enough prompts that the band spans the viewport, which is the case that locked the bar.
        fillTranscript(60)
        ui.setSize(420, 600)
        layoutAll(ui)
        ui.promptRail.refresh()
        val root = find<SessionRootPanel>(ui)
        root.overlay.doLayout()
        drainScroll()
        val rail = find<PromptRail>(ui)
        assertTrue("the rail must be showing for this case", rail.isVisible)
        assertNotNull("the narrow layout must hand the rail its scrollbar", rail.barTarget)

        // Hover still works along the whole band, so the card opens wherever the pointer rests.
        val x = rail.width / 2
        assertTrue(rail.contains(x, rail.tickCenterY(0)))
        assertTrue(rail.contains(x, rail.tickCenterY(rail.entries().lastIndex)))

        // A press off a tick is handed to the bar; one on a tick stays the rail's own. Asserted by what
        // the bar receives rather than by its value, which needs a realised UI to move.
        val bar = scrollBar()
        val got = mutableListOf<Int>()
        bar.addMouseListener(object : java.awt.event.MouseAdapter() {
            override fun mousePressed(e: java.awt.event.MouseEvent) {
                got.add(e.y)
            }
        })

        val mid = (rail.tickCenterY(0) + rail.tickCenterY(1)) / 2
        rail.dispatchEvent(pressAt(rail, mid))
        assertEquals("a press between ticks must reach the scrollbar", 1, got.size)

        rail.dispatchEvent(pressAt(rail, rail.tickCenterY(2)))
        assertEquals("a press on a tick must not reach the scrollbar", 1, got.size)

        var jumped = false
        rail.onSelect = { jumped = true }
        rail.dispatchEvent(clickAt(rail, rail.tickCenterY(2)))
        assertTrue("a click on a tick must still navigate", jumped)
    }

    private fun pressAt(rail: PromptRail, y: Int) = java.awt.event.MouseEvent(
        rail,
        java.awt.event.MouseEvent.MOUSE_PRESSED,
        0L,
        0,
        rail.width / 2,
        y,
        1,
        false,
        java.awt.event.MouseEvent.BUTTON1,
    )

    private fun clickAt(rail: PromptRail, y: Int) = java.awt.event.MouseEvent(
        rail,
        java.awt.event.MouseEvent.MOUSE_CLICKED,
        0L,
        0,
        rail.width / 2,
        y,
        1,
        false,
        java.awt.event.MouseEvent.BUTTON1,
    )

    /**
     * The rail is drawn over the transcript's right edge, so the transcript has to reserve room for a
     * full-size tick. Without it a tick sits on top of the prompt bubble.
     */
    fun `test the transcript reserves room for the rail`() {
        val inner = SessionUiStyle.SessionLayout.INNER_RIGHT
        val tick = SessionUiStyle.PromptRail.TICK_HOVER

        assertTrue(
            "right inset $inner must clear a $tick tick",
            inner >= tick,
        )
        assertEquals("and clear it by the smallest standard gap", UiStyle.Gap.XS, inner - tick)
        assertTrue(
            "the reserved edge must be wider than the plain inset it replaces",
            inner > SessionUiStyle.SessionLayout.INNER_HORIZONTAL,
        )
    }

    /**
     * A top-anchored jump to the latest turn lands within the follow threshold of the bottom, so
     * re-arming follow there would let the next streamed delta pull the view back down and undo it.
     */
    fun `test jumping to the latest prompt does not re-arm follow`() {
        showMessages()
        // The viewport needs a real extent, or the scrollbar reports visibleAmount 0 and the
        // near-the-bottom condition this guards against can never be reached.
        ui.setSize(900, 400)
        layoutAll(ui)
        fillTranscript(10)
        layoutAll(ui)
        drainScroll()
        val bar = scrollBar()

        assertTrue(ui.scroll.scrollMessageTop("msg_9"))
        drainScroll()

        // The target lands inside the follow threshold of the bottom, which is exactly the case where
        // re-arming follow would let the next streamed delta undo the jump.
        assertTrue(bar.value + bar.visibleAmount >= bar.maximum - JBUI.scale(32))
        assertFalse("a top jump must leave follow disarmed", ui.scroll.following())

        val landed = bar.value
        fillTranscript(1, start = 10)
        drainScroll()
        assertEquals("a streamed update must not drag the view off the jump target", landed, bar.value)
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
