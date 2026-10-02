package ai.kilocode.client.session.ui.rail

import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBList
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import java.awt.Rectangle

class PromptRailPopupTest : BasePlatformTestCase() {
    /**
     * The expandable-item hint renders a truncated row's full text as a strip outside the list bounds, so
     * it escapes the balloon and paints over the ticks the navigator is anchored to.
     */
    fun `test navigator list does not use expandable item hints`() {
        val popup = popup(items(6))

        val list = find(popup.component) ?: error("expected a JBList in the navigator body")
        assertFalse(list.expandableItemsHandler.isEnabled)

        Disposer.dispose(popup.disposable)
    }

    /** The cap is what keeps the balloon inside the room left of the rail instead of being re-pointed. */
    fun `test body honors the width cap`() {
        val popup = popup(items(12))
        val cap = 240

        popup.fitWithin(cap, 400)

        assertTrue(
            "preferred width ${popup.component.preferredSize.width} must not exceed the $cap cap",
            popup.component.preferredSize.width <= cap,
        )
        assertTrue(popup.component.preferredSize.height <= 400)

        Disposer.dispose(popup.disposable)
    }

    /**
     * Hovering a tick re-selects in the open balloon, so a row below the fold has to be scrolled to.
     * Rows already fully visible must not scroll, or the list would jump while the pointer moves.
     */
    fun `test selecting an offscreen row scrolls it into view`() {
        val popup = popup(items(40))
        popup.fitWithin(320, 220)
        val root = popup.component
        // scrollRectToVisible re-lays out the scroll pane, so the tree needs real sizes first or the
        // viewport collapses to zero and every row counts as off screen.
        root.size = Dimension(320, 220)
        layoutAll(root)
        val port = popup.rows.viewport
        val list = find(root) ?: error("expected a JBList in the navigator body")

        popup.select(0)
        assertEquals(0, port.viewPosition.y)

        popup.select(35)

        assertEquals(35, list.selectedIndex)
        val cell = list.getCellBounds(35, 35)
        val view = Rectangle(port.viewPosition, port.extentSize)
        assertTrue("row 35 at $cell must be visible in $view", view.contains(cell))

        // A row already in view must not scroll, or the list would jump as the pointer moves.
        val settled = port.viewPosition
        popup.select(35)
        assertEquals(settled, port.viewPosition)

        Disposer.dispose(popup.disposable)
    }

    private fun layoutAll(comp: Component) {
        comp.doLayout()
        if (comp is Container) comp.components.forEach(::layoutAll)
    }

    private fun popup(items: List<PromptRailItem>) = PromptRailPopup(
        items = items,
        hovered = 0,
        onSelect = {},
        onFirst = {},
        onLatest = {},
    )

    private fun items(count: Int) = List(count) {
        PromptRailItem(
            id = "msg_$it",
            queued = false,
            prompt = "Prompt $it that is long enough to be clamped by the navigator row width",
            answer = "Answer $it that is also long enough to wrap across the two lines the row allows",
        )
    }

    private fun find(root: Component): JBList<*>? {
        if (root is JBList<*>) return root
        if (root !is Container) return null
        return root.components.firstNotNullOfOrNull(::find)
    }
}
