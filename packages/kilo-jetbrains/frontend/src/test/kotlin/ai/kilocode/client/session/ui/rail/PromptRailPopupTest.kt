package ai.kilocode.client.session.ui.rail

import ai.kilocode.client.ui.HoverIcon
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import java.awt.Rectangle
import javax.swing.JList
import javax.swing.JScrollPane
import javax.swing.JViewport

class PromptRailPopupTest : BasePlatformTestCase() {
    /**
     * Lays the body out the way the platform does: clamp it with [PromptRailPopup.fitWithin], size it to
     * the preferred size that clamp produces, then lay out. The earlier version of this test sized the
     * body to an arbitrary height instead, which hid the bug where the list never clipped.
     */
    private fun shown(count: Int, hovered: Int = 0): Fixture {
        val popup = popup(items(count), hovered)
        popup.fitWithin(CAP_W, CAP_H)
        val root = popup.component
        root.size = root.preferredSize
        layoutAll(root)
        val scroll = findScroll(root) ?: error("expected the row list to own a scroll pane")
        return Fixture(popup, scroll.viewport)
    }

    private class Fixture(val popup: PromptRailPopup, val port: JViewport)

    /** Exactly one scroll pane: a nested second one left neither owning the scrolling. */
    fun `test the row list owns the only scroll pane`() {
        val fix = shown(40)

        assertEquals(1, countScrolls(fix.popup.component))

        Disposer.dispose(fix.popup.disposable)
    }

    /**
     * The regression: the viewport has to actually clip. It previously inherited a ~32k extent from the
     * wrapper's `Short.MAX_VALUE` measuring pass, so every row counted as visible and nothing scrolled.
     */
    fun `test the viewport clips to the balloon instead of the content`() {
        val fix = shown(40)
        val view = fix.port.view ?: error("expected a view")

        assertTrue("extent ${fix.port.extentSize.height} must be clamped", fix.port.extentSize.height <= CAP_H)
        assertTrue(
            "content ${view.height} must exceed the extent ${fix.port.extentSize.height} so it can scroll",
            view.height > fix.port.extentSize.height,
        )

        Disposer.dispose(fix.popup.disposable)
    }

    /** Revealing downwards was the broken direction, so both are covered explicitly. */
    fun `test rows reveal in both directions`() {
        val fix = shown(40)

        fix.popup.select(39)
        val down = fix.port.viewPosition.y
        assertTrue("selecting the last row must scroll down, stayed at $down", down > 0)

        fix.popup.select(0)
        assertEquals("selecting the first row must scroll back to the top", 0, fix.port.viewPosition.y)

        fix.popup.select(39)
        assertEquals("the last row must scroll down again", down, fix.port.viewPosition.y)

        Disposer.dispose(fix.popup.disposable)
    }

    /** A row requested before the body had bounds still has to be revealed once it does. */
    fun `test a row requested before layout is revealed once laid out`() {
        val popup = popup(items(40), hovered = 30)
        popup.fitWithin(CAP_W, CAP_H)
        val root = popup.component

        // Pre-layout there is no viewport to measure, so nothing may be scrolled yet.
        assertNull(findScroll(root)?.viewport?.view?.takeIf { it.height > 0 })

        root.size = root.preferredSize
        layoutAll(root)

        val port = findScroll(root)?.viewport ?: error("expected the row list to own a scroll pane")
        assertTrue("row 30 must be revealed once laid out", port.viewPosition.y > 0)

        // Replaying layout must not drift the settled position.
        val settled = port.viewPosition
        layoutAll(root)
        assertEquals(settled, port.viewPosition)

        Disposer.dispose(popup.disposable)
    }

    /** Every hovered row must end up visible, whichever way the pointer travels. */
    fun `test every hovered row is revealed`() {
        val fix = shown(40)

        val list = findList(fix.popup.component) ?: error("expected a JList of rows")
        for (index in listOf(39, 0, 20, 7, 33, 12, 38, 1)) {
            fix.popup.select(index)

            assertEquals("row $index must be selected", index, list.selectedIndex)
            val view = Rectangle(fix.port.viewPosition, fix.port.extentSize)
            val cell = list.getCellBounds(index, index)
            assertTrue("row $index at $cell must be visible in $view", view.contains(cell))
        }

        Disposer.dispose(fix.popup.disposable)
    }

    fun `test the body honors the width and height caps`() {
        val fix = shown(40)
        val pref = fix.popup.component.preferredSize

        assertTrue("width ${pref.width} must not exceed $CAP_W", pref.width <= CAP_W)
        assertTrue("height ${pref.height} must not exceed $CAP_H", pref.height <= CAP_H)

        Disposer.dispose(fix.popup.disposable)
    }

    /**
     * A clicked row was reachable under the pointer, so the list must not move: re-centring it would
     * shift content out from under a deliberate click. Only tick hovers and the buttons scroll it.
     */
    fun `test selecting without scroll highlights but never moves the list`() {
        val fix = shown(40)
        val list = findList(fix.popup.component) ?: error("expected a JList of rows")

        // Park the list somewhere mid-range so a re-centre would be visible either way.
        fix.popup.select(20)
        val parked = fix.port.viewPosition

        // A row far outside the view: still no movement, because the click came from the user.
        fix.popup.select(39, scroll = false)
        assertEquals(39, list.selectedIndex)
        assertEquals("a clicked row must not move the list", parked, fix.port.viewPosition)

        fix.popup.select(0, scroll = false)
        assertEquals(0, list.selectedIndex)
        assertEquals(parked, fix.port.viewPosition)

        // A later layout must not replay a reveal the click suppressed.
        layoutAll(fix.popup.component)
        assertEquals(parked, fix.port.viewPosition)

        Disposer.dispose(fix.popup.disposable)
    }

    /** The navigator opens on hover, so a tooltip would stack a second floating surface over it. */
    fun `test the popup shows no tooltips`() {
        val fix = shown(40)
        val list = findList(fix.popup.component) ?: error("expected a JList of rows")

        assertNull(list.toolTipText)
        for (button in findButtons(fix.popup.component)) {
            assertNull("header buttons must not carry a tooltip", button.toolTipText)
            // Still labelled for screen readers.
            assertNotNull(button.accessibleContext.accessibleName)
        }

        Disposer.dispose(fix.popup.disposable)
    }

    /**
     * The header buttons have to drive the same navigation the ticks do. Scrolling the transcript alone
     * would leave the open card pointing at whichever row was last hovered.
     */
    fun `test the header buttons invoke first and latest navigation`() {
        val seen = mutableListOf<String>()
        val popup = PromptRailPopup(
            items = items(40),
            hovered = 0,
            onSelect = {},
            onFirst = { seen.add("first") },
            onLatest = { seen.add("latest") },
        )
        popup.fitWithin(CAP_W, CAP_H)
        val buttons = findButtons(popup.component)
        assertEquals("expected the first/latest buttons in the header", 2, buttons.size)

        buttons[0].doClick()
        buttons[1].doClick()

        assertEquals(listOf("first", "latest"), seen)

        Disposer.dispose(popup.disposable)
    }

    private fun findButtons(c: Component): List<HoverIcon> {
        if (c is HoverIcon) return listOf(c)
        if (c !is Container) return emptyList()
        return c.components.flatMap { findButtons(it) }
    }

    private fun findList(c: Component): JList<*>? {
        if (c is JList<*>) return c
        if (c !is Container) return null
        return c.components.firstNotNullOfOrNull { findList(it) }
    }

    private fun countScrolls(c: Component): Int {
        val self = if (c is JScrollPane) 1 else 0
        if (c !is Container) return self
        return self + c.components.sumOf { countScrolls(it) }
    }

    private fun findScroll(c: Component): JScrollPane? {
        if (c is JScrollPane) return c
        if (c !is Container) return null
        return c.components.firstNotNullOfOrNull { findScroll(it) }
    }

    private fun layoutAll(c: Component) {
        c.doLayout()
        if (c is Container) c.components.forEach(::layoutAll)
    }

    private fun popup(items: List<PromptRailItem>, hovered: Int = 0) = PromptRailPopup(
        items = items,
        hovered = hovered,
        onSelect = {},
        onFirst = {},
        onLatest = {},
    )

    private fun items(count: Int) = List(count) {
        PromptRailItem(
            id = "msg_$it",
            queued = false,
            prompt = "Prompt $it that is long enough to be clamped by the navigator row width",
            answer = "Answer $it that is also long enough to wrap across the lines the row allows",
        )
    }

    private companion object {
        const val CAP_W = 320
        const val CAP_H = 260
    }
}
