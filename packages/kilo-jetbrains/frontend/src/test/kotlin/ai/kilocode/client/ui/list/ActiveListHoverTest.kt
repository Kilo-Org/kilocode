package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.active.ActiveBadge
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ACTIVE_MENU_CELL
import ai.kilocode.client.ui.active.ActiveMenu
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.CollectionListModel
import com.intellij.util.ui.UIUtil
import java.awt.Point
import java.awt.event.MouseEvent
import javax.swing.JPanel

private const val BADGE = "pull-request"

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

    fun `test a badge under the pointer is the only hovered cell`() {
        val view = view()
        view.update(listOf(badgeRow("a"), badgeRow("b")))
        layout(view)
        val first = activeListCellBounds(view.list, 0, false).getValue(BADGE)
        val second = activeListCellBounds(view.list, 1, false).getValue(BADGE)

        move(view, Point(first.centerX.toInt(), first.centerY.toInt()))
        assertEquals(BADGE, state(view, 0).hoveredCell)
        assertNull(state(view, 1).hoveredCell)

        move(view, Point(second.centerX.toInt(), second.centerY.toInt()))
        assertNull(state(view, 0).hoveredCell)
        assertEquals(BADGE, state(view, 1).hoveredCell)
    }

    fun `test leaving a badge clears the hovered cell`() {
        val view = view()
        view.update(listOf(badgeRow("a")))
        layout(view)
        val badge = activeListCellBounds(view.list, 0, false).getValue(BADGE)
        move(view, Point(badge.centerX.toInt(), badge.centerY.toInt()))
        assertEquals(BADGE, state(view, 0).hoveredCell)

        exit(view)

        assertNull(state(view, 0).hoveredCell)
    }

    fun `test moving off the badge clears the cell but keeps the row`() {
        val view = view()
        view.update(listOf(badgeRow("a")))
        val pane = layout(view)
        val badge = activeListCellBounds(view.list, 0, false).getValue(BADGE)
        move(view, Point(badge.centerX.toInt(), badge.centerY.toInt()))

        move(view, 0)

        assertNull(state(view, 0).hoveredCell)
        assertNotNull(view.hoveredBounds(pane))
    }

    fun `test the row menu glyph is the hovered cell under the pointer`() {
        val key = DataKey.create<ActiveItem>("test.activeList.hover.menu")
        val menu = ActiveMenu(key, DefaultActionGroup(), element = { it })
        val view = ActiveListView("", menu = menu) { _, _ -> }
        view.update(rows("a"))
        layout(view)
        // The glyph is revealed by row hover first, then becomes a hit target.
        move(view, 0)
        val area = activeListCellBounds(view.list, 0, false).getValue(ACTIVE_MENU_CELL)
        move(view, Point(area.centerX.toInt(), area.centerY.toInt()))

        assertEquals(ACTIVE_MENU_CELL, state(view, 0).hoveredCell)
    }

    private fun state(view: ActiveListView, index: Int) =
        ActiveListRenderer(CollectionListModel<ActiveItem>())
            .state(view.list, view.list.model.getElementAt(index), index, false, false)

    private fun badgeRow(key: String): ActiveItem = object : ActiveItem {
        override val key = key
        override val title = key
        override val search = key
        override val secondaryBadges = listOf(
            ActiveBadge("#1", UiStyle.Badge.PullRequestOpen, id = BADGE, action = {}),
        )
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
        move(view, Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
    }

    private fun move(view: ActiveListView, point: Point) {
        view.list.dispatchEvent(MouseEvent(view.list, MouseEvent.MOUSE_MOVED, System.currentTimeMillis(), 0, point.x, point.y, 0, false))
    }

    private fun exit(view: ActiveListView) {
        view.list.dispatchEvent(MouseEvent(view.list, MouseEvent.MOUSE_EXITED, System.currentTimeMillis(), 0, 0, 0, 0, false))
    }

    private fun rows(vararg keys: String): List<ActiveItem> = keys.map { key ->
        object : ActiveItem {
            override val key = key
            override val title = key
            override val search = key
        }
    }
}
