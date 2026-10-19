package ai.kilocode.client.ui.list

import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import java.awt.Point
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
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

    fun `test moving between hover-aware cells repaints state without repeating row hover`() {
        val action = object : DumbAwareAction("Add") {
            override fun actionPerformed(e: AnActionEvent) {}
        }
        val view = ActiveListView(
            empty = "",
            collapse = ActiveListCollapse(actions = { listOf(action) }),
            onHover = { item -> seen.add(item?.key) },
            onCell = { _, _ -> },
        )
        view.update(listOf(row("a", "wt")))
        layout(view)
        val hits = activeListHits(view.list, 0, false)
        val button = hits.single { it.id.startsWith("$ACTIVE_LIST_SECTION_CELL:action:") }
        val toggle = hits.single { it.id == ACTIVE_LIST_SECTION_TOGGLE_CELL }
        val idle = paint(view)

        move(view, center(button.bounds))
        assertEquals(button.id, (view.list as ActiveListActive).hoveredCell())
        assertEquals(listOf("a"), seen)
        assertImagesDiffer(idle, paint(view))

        move(view, center(toggle.bounds))
        assertEquals(toggle.id, (view.list as ActiveListActive).hoveredCell())
        assertEquals(listOf("a"), seen)
        assertImagesDiffer(idle, paint(view))

        val band = hits.single { it.id == ACTIVE_LIST_SECTION_CELL }.bounds
        move(view, Point(band.x + 1, band.y + band.height / 2))
        assertNull((view.list as ActiveListActive).hoveredCell())
        assertEquals(listOf("a"), seen)
        assertImagesEqual(idle, paint(view))

        exit(view)
        assertEquals(-1, (view.list as ActiveListActive).hoveredIndex())
        assertNull((view.list as ActiveListActive).hoveredCell())
        assertEquals(listOf("a", null), seen)
    }

    fun `test ordinary action cells do not opt into renderer hover`() {
        assertFalse(ActiveListHoverCell::class.java.isInstance(ActiveListActionCell()))
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

    private fun move(view: ActiveListView, point: Point) {
        view.list.dispatchEvent(
            MouseEvent(view.list, MouseEvent.MOUSE_MOVED, System.currentTimeMillis(), 0, point.x, point.y, 0, false),
        )
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

    private fun row(key: String, section: String): ActiveListItem = object : ActiveListItem {
        override val key = key
        override val title = key
        override val search = key
        override val section = section
    }

    private fun center(bounds: java.awt.Rectangle) = Point(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
    )

    private fun paint(view: ActiveListView): BufferedImage {
        val bounds = view.list.getCellBounds(0, 0)
        val value = view.list.model.getElementAt(0)
        val component = view.list.cellRenderer.getListCellRendererComponent(view.list, value, 0, false, true)
        component.setBounds(0, 0, bounds.width, bounds.height)
        activeListLayout(component)
        val image = BufferedImage(bounds.width, bounds.height, BufferedImage.TYPE_INT_ARGB)
        val canvas = image.createGraphics()
        try {
            component.paint(canvas)
        } finally {
            canvas.dispose()
        }
        return image
    }

    private fun assertImagesDiffer(before: BufferedImage, after: BufferedImage) {
        assertTrue(
            "expected the hovered renderer button to paint platform hover chrome",
            (0 until before.width).any { x ->
                (0 until before.height).any { y -> before.getRGB(x, y) != after.getRGB(x, y) }
            },
        )
    }

    private fun assertImagesEqual(before: BufferedImage, after: BufferedImage) {
        assertFalse(
            "expected the renderer button to return to its idle pixels after hover exits",
            (0 until before.width).any { x ->
                (0 until before.height).any { y -> before.getRGB(x, y) != after.getRGB(x, y) }
            },
        )
    }
}
