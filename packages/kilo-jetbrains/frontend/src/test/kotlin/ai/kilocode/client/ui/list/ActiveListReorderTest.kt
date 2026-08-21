package ai.kilocode.client.ui.list

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import java.awt.Point
import java.awt.Rectangle

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

    fun `test grabbing a section header row still anchors inside the body image`() {
        val view = view(mutableListOf())
        view.update(sectioned())
        layout(view)

        // Row 1 carries the "wt" section band above its body; grab inside that band.
        val bounds = view.list.getCellBounds(1, 1)!!
        val image = view.dragImage(Point(bounds.x + 8, bounds.y + 1)) ?: error("expected a drag image")
        assertEquals(0, image.second.y)
    }

    private fun view(moves: MutableList<ActiveListMove>): ActiveListView {
        return ActiveListView(
            empty = "",
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

    private fun center(view: ActiveListView, index: Int): Point {
        val bounds: Rectangle = view.list.getCellBounds(index, index) ?: error("no bounds for $index")
        return Point(bounds.x + 8, bounds.y + bounds.height / 2)
    }

    private fun sectioned(): List<ActiveListItem> {
        return listOf(row("cur", null), row("a", "wt"), row("b", "wt"), row("c", "wt"))
    }

    private fun rows(vararg keys: String): List<ActiveListItem> = keys.map { row(it, "wt") }

    private fun row(key: String, section: String?): ActiveListItem = object : ActiveListItem {
        override val key = key
        override val title = key
        override val section = section
    }
}
