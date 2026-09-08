package ai.kilocode.client.ui.list

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import java.awt.event.MouseEvent
import javax.swing.JPanel

/**
 * The hover seam a row popup hangs off. Every path that clears hover has to report it, or a popup opened
 * from a row outlives the row it describes.
 */
class ActiveListHoverTest : BasePlatformTestCase() {
    private val seen = mutableListOf<String?>()

    fun `test moving over a row reports it and leaving the list reports nothing`() {
        val view = view()
        view.update(rows("a", "b"))
        layout(view)

        move(view, 0)
        assertEquals(listOf("a"), seen)

        move(view, 1)
        assertEquals(listOf("a", "b"), seen)

        exit(view)
        assertEquals(listOf("a", "b", null), seen)
    }

    fun `test staying on one row reports it once`() {
        val view = view()
        view.update(rows("a", "b"))
        layout(view)

        move(view, 0)
        move(view, 0)

        // The popup controller restarts its dwell on every report, so a repeat would keep it closed.
        assertEquals(listOf("a"), seen)
    }

    fun `test going busy reports the hover as gone`() {
        val view = view()
        view.update(rows("a", "b"))
        layout(view)
        move(view, 0)
        seen.clear()

        view.setBusy(true)

        assertEquals(listOf(null), seen)
    }

    fun `test a model rebuild that drops the hovered row reports the hover as gone`() {
        val view = view()
        view.update(rows("a", "b"))
        layout(view)
        move(view, 1)
        seen.clear()

        view.update(rows("a"))

        assertEquals(listOf(null), seen)
    }

    fun `test hovered bounds cover the row and sit inside the visible list`() {
        val view = view()
        view.update(rows("a", "b"))
        val pane = layout(view)
        move(view, 1)

        val bounds = view.hoveredBounds(pane) ?: error("expected bounds for the hovered row")
        val visible = view.visibleBounds(pane) ?: error("expected visible bounds for a laid out list")
        assertEquals(view.list.getCellBounds(1, 1).height, bounds.height)
        // Row edges, not a single anchor point: the popup picks its side from the row's left and right.
        assertTrue(bounds.width > 0)
        assertTrue(visible.contains(bounds.x, bounds.y))
    }

    fun `test no hovered bounds without a hovered row`() {
        val view = view()
        view.update(rows("a"))
        val pane = layout(view)

        assertNull(view.hoveredBounds(pane))
    }

    private fun view(): ActiveListView {
        return ActiveListView("", onHover = { item -> seen.add(item?.key) }) { _, _ -> }
    }

    /** Lays the list out inside a showing panel and answers the pane to convert coordinates against. */
    private fun layout(view: ActiveListView): JPanel {
        val pane = JPanel()
        pane.add(view)
        pane.setSize(400, 600)
        view.setSize(400, 600)
        view.list.setSize(400, 600)
        view.list.doLayout()
        UIUtil.dispatchAllInvocationEvents()
        return pane
    }

    private fun move(view: ActiveListView, index: Int) {
        val bounds = view.list.getCellBounds(index, index) ?: error("row $index has no bounds")
        val x = bounds.x + bounds.width / 2
        val y = bounds.y + bounds.height / 2
        view.list.dispatchEvent(MouseEvent(view.list, MouseEvent.MOUSE_MOVED, System.currentTimeMillis(), 0, x, y, 0, false))
    }

    private fun exit(view: ActiveListView) {
        view.list.dispatchEvent(MouseEvent(view.list, MouseEvent.MOUSE_EXITED, System.currentTimeMillis(), 0, 0, 0, 0, false))
    }

    private fun rows(vararg keys: String): List<ActiveListItem> = keys.map { key ->
        object : ActiveListItem {
            override val key = key
            override val title = key
            override val search = key
        }
    }
}
