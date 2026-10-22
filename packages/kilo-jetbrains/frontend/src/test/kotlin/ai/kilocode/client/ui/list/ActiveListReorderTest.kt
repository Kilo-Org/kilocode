package ai.kilocode.client.ui.list

import ai.kilocode.client.testing.fire
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import java.awt.Image
import java.awt.Point
import java.awt.Rectangle
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage

class ActiveListReorderTest : BasePlatformTestCase() {

    fun `test gap rows remove the dragged row and insert a placeholder at the index`() {
        val rows = rows("a", "b", "c")
        val out = activeListGapRows(rows, "c", 0, 20)
        assertEquals(listOf("c", "a", "b"), out.map { it.key })
        assertTrue(out[0] is ActiveListGap)
        assertEquals(3, out.size)
    }

    fun `test gap rows keep the dragged key so selection stays anchored`() {
        val rows = rows("a", "b", "c")
        val out = activeListGapRows(rows, "b", 2, 20)
        assertEquals(listOf("a", "c", "b"), out.map { it.key })
    }

    fun `test section run spans only rows sharing the section`() {
        val rows = listOf(row("cur", null), row("a", "wt"), row("b", "wt"), row("c", "wt"))
        assertEquals(0..0, activeListSectionRun(rows, 0))
        assertEquals(1..3, activeListSectionRun(rows, 1))
        assertEquals(1..3, activeListSectionRun(rows, 3))
    }

    fun `test pick up opens a gap and drop reorders firing the move`() {
        val moves = mutableListOf<ActiveListMove>()
        val view = view(moves)
        view.update(sectioned())
        layout(view)

        val point = center(view, 3)
        assertEquals("c", view.pickable(point))
        view.over("c", center(view, 1))

        // The real row is gone from the model; a gap holds its old key at the new index.
        val display = display(view)
        assertEquals(listOf("cur", "c", "a", "b"), display.map { it.key })
        assertTrue(display[1] is ActiveListGap)

        view.drop()
        assertEquals(listOf("cur", "c", "a", "b"), display(view).map { it.key })
        val move = moves.single()
        assertEquals("c", move.key)
        assertEquals(3, move.from)
        assertEquals(1, move.to)
        assertEquals(listOf("cur", "c", "a", "b"), move.keys)
    }

    fun `test drop anchors the moved row for owner refresh`() {
        val moves = mutableListOf<ActiveListMove>()
        val view = view(moves)
        view.update(sectioned())
        layout(view)

        assertTrue(view.select("c"))
        view.over("c", center(view, 1))
        view.drop()
        view.update(sectioned().let { listOf(it[0], it[3], it[1], it[2]) })

        assertEquals("c", view.selected()?.key)
    }

    fun `test drag cannot leave its section and never displaces the current row`() {
        val moves = mutableListOf<ActiveListMove>()
        val view = view(moves)
        view.update(sectioned())
        layout(view)

        view.over("c", center(view, 0))
        // Clamped to the first worktree slot, never above the current row.
        assertEquals(listOf("cur", "c", "a", "b"), display(view).map { it.key })
    }

    fun `test cancel restores the original order and fires nothing`() {
        val moves = mutableListOf<ActiveListMove>()
        val view = view(moves)
        view.update(sectioned())
        layout(view)

        view.over("c", center(view, 1))
        view.cancel()

        assertEquals(listOf("cur", "a", "b", "c"), display(view).map { it.key })
        assertTrue(moves.isEmpty())
    }

    fun `test an external update that drops the dragged key cancels the drag`() {
        val moves = mutableListOf<ActiveListMove>()
        val view = view(moves)
        view.update(sectioned())
        layout(view)

        view.over("c", center(view, 1))
        // A refresh that no longer contains the dragged worktree (e.g. it was deleted mid-drag).
        view.update(listOf(row("cur", null), row("a", "wt"), row("b", "wt")))

        assertEquals(listOf("cur", "a", "b"), display(view).map { it.key })
        assertTrue(moves.isEmpty())
    }

    fun `test pickable rejects immovable rows and an active filter`() {
        val view = view(mutableListOf())
        view.update(sectioned())
        layout(view)

        assertNull(view.pickable(center(view, 0)))

        view.filter("a")
        layout(view)
        assertNull(view.pickable(center(view, view.list.model.size - 1)))
    }

    fun `test drag image anchors the grabbed pixel under the cursor`() {
        val view = view(mutableListOf())
        view.update(sectioned())
        layout(view)

        val point = center(view, 3)
        val image = view.dragImage(point) ?: error("expected a drag image")
        assertTrue(image.first.getWidth(null) > 0)
        assertTrue(image.first.getHeight(null) > 0)
        // AWT draws the image at cursor + offset, so the offset is the negated grab point and the
        // dragged copy sits exactly under the pointer instead of down and to the right of it.
        val bounds = view.list.getCellBounds(3, 3)!!
        assertEquals(-(point.x - bounds.x), image.second.x)
        assertTrue(image.second.x <= 0)
        assertTrue(image.second.y <= 0)
        assertTrue(-image.second.y <= image.first.getHeight(null))
    }

    fun `test dragging the row that opens a section keeps every row height`() {
        val view = view(mutableListOf())
        view.update(sectioned())
        layout(view)
        val before = heights(view)

        // Row 1 opens the "wt" section, so its cell paints the section band above its body.
        view.over("a", center(view, 2))
        layout(view)

        // The band belongs to the slot, not the dragged row: the gap takes a body-sized slot and no
        // row grows to the band-inclusive height of the cell the drag started from.
        assertEquals(before, heights(view))
    }

    fun `test the gap keeps the dragged row body height when rows size to content`() {
        val view = view(mutableListOf(), ActiveListConfig.Preferred)
        view.update(sectioned())
        layout(view)
        val body = heights(view)[2]

        view.over("a", center(view, 2))
        layout(view)

        assertEquals(body, heights(view)[2])
    }

    fun `test grabbing a section header row still anchors inside the body image`() {
        val view = view(mutableListOf())
        view.update(sectioned())
        layout(view)

        // Row 1 carries the "wt" section band above its body; grab inside that band.
        val bounds = view.list.getCellBounds(1, 1)!!
        val image = view.dragImage(Point(bounds.x + 8, bounds.y + 1)) ?: error("expected a drag image")
        assertEquals(0, image.second.y)
    }

    fun `test the drag image of a section header row paints its whole body`() {
        val view = view(mutableListOf())
        view.update(sectioned())
        layout(view)

        // Row 1 opens the "wt" section, so its body starts below the band inside its own cell. The
        // copy still covers the body edge to edge: nothing is shifted off the image.
        val header = view.dragImage(center(view, 1))?.first ?: error("expected a drag image")
        val plain = view.dragImage(center(view, 2))?.first ?: error("expected a drag image")

        assertEquals(0, blank(header))
        assertEquals(blank(plain), blank(header))
        assertEquals(plain.getHeight(null), header.getHeight(null))
    }

    fun `test empty space under the last row is neither pickable nor draggable`() {
        val view = view(mutableListOf())
        view.update(sectioned())
        layout(view)
        val point = below(view)

        // A short list in a viewport-tracking surface leaves empty space; it belongs to no row.
        assertNull(view.pickable(point))
        assertNull(view.dragImage(point))
    }

    fun `test clicking empty space under the last row leaves the selection alone`() {
        val view = view(mutableListOf())
        view.update(sectioned())
        layout(view)

        click(view, below(view))

        assertNull(view.selected())
    }

    fun `test dragging below the last row still targets the last slot`() {
        val view = view(mutableListOf())
        view.update(sectioned())
        layout(view)

        view.over("a", below(view))

        assertEquals(listOf("cur", "b", "c", "a"), display(view).map { it.key })
    }

    fun `test the gap carries the dragged row identity so a refresh keeps the selection`() {
        val rows = listOf(row("cur", null), row("wt1", "wt", "worktree:/a"), row("wt2", "wt", "worktree:/b"))
        val view = view(mutableListOf())
        view.update(rows)
        layout(view)
        assertTrue(view.select("wt2"))

        view.over("wt2", center(view, 1))
        // A stats/activity poll refreshing the same rows mid-drag restores by identity, which the
        // placeholder must answer for — otherwise the selection is dropped while the drag runs.
        view.update(rows)

        assertEquals("wt2", view.selected()?.key)
    }

    /** A point in the empty space below the last row, which a tool-window list keeps visible. */
    private fun below(view: ActiveListView): Point {
        val last = view.list.model.size - 1
        val bounds = view.list.getCellBounds(last, last) ?: error("no bounds for $last")
        return Point(bounds.x + 8, bounds.y + bounds.height + 20)
    }

    private fun click(view: ActiveListView, point: Point) {
        val press = MouseEvent(
            view.list,
            MouseEvent.MOUSE_PRESSED,
            System.currentTimeMillis(),
            InputEvent.BUTTON1_DOWN_MASK,
            point.x,
            point.y,
            1,
            false,
            MouseEvent.BUTTON1,
        )
        fire(view.list, press)
    }

    private fun view(
        moves: MutableList<ActiveListMove>,
        cfg: ActiveListConfig = ActiveListConfig.Equal,
    ): ActiveListView {
        return ActiveListView(
            empty = "",
            cfg = cfg,
            reorder = ActiveListReorder(
                movable = { it.section != null },
                onMove = { moves += it },
            ),
            onCell = { _, _ -> },
        )
    }

    private fun layout(view: ActiveListView) {
        view.setBounds(0, 0, 300, 600)
        view.doLayout()
        view.list.setBounds(0, 0, 300, 600)
        view.list.doLayout()
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun display(view: ActiveListView): List<ActiveListItem> {
        return (0 until view.list.model.size).map { view.list.model.getElementAt(it) }
    }

    /** Rows of the image that are fully transparent, i.e. left unpainted. */
    private fun blank(image: Image): Int {
        val pixels = image as BufferedImage
        return (0 until pixels.height).count { y ->
            (0 until pixels.width).all { x -> (pixels.getRGB(x, y) ushr 24) == 0 }
        }
    }

    private fun heights(view: ActiveListView): List<Int> {
        return (0 until view.list.model.size).map { view.list.getCellBounds(it, it)!!.height }
    }

    private fun center(view: ActiveListView, index: Int): Point {
        val bounds: Rectangle = view.list.getCellBounds(index, index) ?: error("no bounds for $index")
        return Point(bounds.x + 8, bounds.y + bounds.height / 2)
    }

    private fun sectioned(): List<ActiveListItem> {
        return listOf(row("cur", null), row("a", "wt"), row("b", "wt"), row("c", "wt"))
    }

    private fun rows(vararg keys: String): List<ActiveListItem> = keys.map { row(it, "wt") }

    private fun row(key: String, section: String?, identity: Any = key): ActiveListItem = object : ActiveListItem {
        override val key = key
        override val identity = identity
        override val title = key
        override val section = section
    }
}
