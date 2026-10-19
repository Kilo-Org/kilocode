package ai.kilocode.client.ui.list

import ai.kilocode.client.testing.fire
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import java.awt.Point
import java.awt.Rectangle
import java.awt.event.InputEvent
import java.awt.event.MouseEvent

class ActiveListCollapseTest : BasePlatformTestCase() {

    fun `test section toolbar precedes toggle and clicks do not select open or fold`() {
        var calls = 0
        val opened = mutableListOf<String>()
        val action = object : DumbAwareAction("Add") {
            override fun actionPerformed(e: AnActionEvent) { calls++ }
        }
        val view = ActiveListView(
            empty = "",
            collapse = ActiveListCollapse(actions = { if (it == "wt") listOf(action) else emptyList() }),
            onOpen = { row, _ -> opened += row.key },
            onCell = { _, _ -> fail("Unexpected row action") },
        )
        view.update(listOf(row("cur", null), row("a", "wt"), row("b", "wt"), row("c", "other")))
        layout(view)
        view.select("cur")
        for (folded in listOf(false, true)) {
            layout(view)
            val hits = activeListHits(view.list, 1, false)
            val button = hits.single { it.id.startsWith("$ACTIVE_LIST_SECTION_CELL:action:") }
            val band = hits.single { it.id == ACTIVE_LIST_SECTION_CELL }.bounds
            assertEquals(view.list.width, band.width)
            assertTrue(button.bounds.width > 0)
            assertTrue(button.bounds.x > band.width / 2)
            assertTrue(button.bounds.x + button.bounds.width < band.x + band.width)
            click(view, center(button.bounds))
            assertEquals(if (folded) 3 else 4, view.list.model.size)
            assertEquals("cur", view.selected()?.key)
            assertTrue(opened.isEmpty())
            click(view, Point(band.x + 1, band.y + band.height / 2))
        }
        assertEquals(2, calls)
        assertFalse(activeListHits(view.list, 3, false).any { it.id.startsWith("$ACTIVE_LIST_SECTION_CELL:action:") })
    }

    fun `test disabled toolbar click does not toggle section`() {
        val action = object : DumbAwareAction("Add") {
            override fun update(e: AnActionEvent) { e.presentation.isEnabled = false }
            override fun actionPerformed(e: AnActionEvent) { fail("Disabled action ran") }
        }
        val view = view(ActiveListCollapse(actions = { listOf(action) }))
        view.update(listOf(row("cur", null), row("a", "wt")))
        layout(view)
        view.select("cur")
        val button = activeListHits(view.list, 1, false).single { it.id.startsWith("$ACTIVE_LIST_SECTION_CELL:action:") }
        click(view, center(button.bounds))
        assertEquals(2, view.list.model.size)
        assertEquals("cur", view.selected()?.key)
    }

    fun `test entire separator band toggles without opening its worktree`() {
        val opened = mutableListOf<String>()
        val view = ActiveListView(
            empty = "",
            collapse = ActiveListCollapse(),
            onOpen = { row, _ -> opened += row.key },
            onCell = { _, _ -> },
        )
        view.update(listOf(row("cur", null), row("a", "wt"), row("b", "wt")))
        for (x in listOf(1, 80, 180, 350)) {
            layout(view)
            val area = activeListCellBounds(view.list, 1, false).getValue(ACTIVE_LIST_SECTION_CELL)
            assertEquals(view.list.width, area.width)
            click(view, Point(x, area.y + area.height / 2))
            assertTrue(rows(view).last() is ActiveListSectionRow)
            click(view, chevron(view, 1))
            assertEquals(3, view.list.model.size)
        }
        assertTrue(opened.isEmpty())
    }

    fun `test collapse rows replace one run with a counted stand-in`() {
        val rows = listOf(row("cur", null), row("a", "wt"), row("b", "wt"), row("c", "wt"))

        val out = activeListCollapseRows(rows, setOf("wt")) { section, count -> "$section $count" }

        assertEquals(listOf("cur", sectionKey("wt")), out.map { it.key })
        assertTrue(out[1] is ActiveListSectionRow)
        assertEquals("wt 3", out[1].title)
    }

    fun `test collapse rows leave other sections and sectionless rows alone`() {
        val rows = listOf(row("cur", null), row("a", "wt"), row("b", "wt"), row("x", "remote"))

        val out = activeListCollapseRows(rows, setOf("remote")) { section, count -> "$section $count" }

        assertEquals(listOf("cur", "a", "b", sectionKey("remote")), out.map { it.key })
        assertEquals("remote 1", out.last().title)
    }

    fun `test collapse rows ignore an unknown section`() {
        val rows = listOf(row("cur", null), row("a", "wt"))

        assertEquals(rows.map { it.key }, activeListCollapseRows(rows, setOf("gone")) { _, _ -> "" }.map { it.key })
    }

    fun `test chevron folds the run and expands it again with the selection`() {
        val view = view()
        view.update(listOf(row("cur", null), row("wt-a", "wt"), row("wt-b", "wt")))
        layout(view)
        assertTrue(view.select("wt-b"))
        assertEquals(3, view.list.model.size)

        click(view, chevron(view, 1))

        assertEquals(listOf("cur", sectionKey("wt")), rows(view).map { it.key })
        assertEquals("wt  2", rows(view).last().title)
        assertNull(view.selected())

        click(view, chevron(view, 1))

        assertEquals(listOf("cur", "wt-a", "wt-b"), rows(view).map { it.key })
        assertEquals("wt-b", view.selected()?.key)
    }

    fun `test chevron never opens the row that carries the band`() {
        val view = view()
        view.update(listOf(row("cur", null), row("wt-a", "wt"), row("wt-b", "wt")))
        layout(view)

        click(view, chevron(view, 1))

        assertEquals(listOf("cur", sectionKey("wt")), rows(view).map { it.key })
    }

    fun `test stand-in never takes the selection`() {
        val view = view()
        view.update(listOf(row("cur", null), row("wt-a", "wt"), row("wt-b", "wt")))
        layout(view)
        click(view, chevron(view, 1))
        layout(view)

        view.selectIndex(1)
        assertNull(view.selected())

        view.selectIndex(0)
        view.move(1)
        assertEquals("cur", view.selected()?.key)

        view.list.selectedIndex = 1
        assertEquals("cur", view.selected()?.key)
    }

    fun `test collapsed run keeps data row height`() {
        val view = view()
        view.update(listOf(row("cur", null), row("wt-a", "wt"), row("wt-b", "wt")))
        layout(view)
        val body = view.list.getCellBounds(0, 0)!!.height
        val band = view.list.getCellBounds(1, 1)!!.height - body

        click(view, chevron(view, 1))
        layout(view)

        assertEquals(body, view.list.getCellBounds(0, 0)!!.height)
        assertEquals(band, view.list.getCellBounds(1, 1)!!.height)
    }

    fun `test collapsed section persists through the holder`() {
        var saved: Set<String> = emptySet()
        val store = ActiveListCollapse(load = { saved }, save = { saved = it })
        val view = view(store)
        view.update(listOf(row("cur", null), row("wt-a", "wt")))
        layout(view)
        click(view, chevron(view, 1))

        assertEquals(setOf("wt"), saved)

        val reopened = view(ActiveListCollapse(load = { saved }))
        reopened.update(listOf(row("cur", null), row("wt-a", "wt")))
        layout(reopened)

        assertEquals(listOf("cur", sectionKey("wt")), rows(reopened).map { it.key })
    }

    fun `test filter forces collapsed sections open`() {
        val view = view()
        view.update(listOf(row("cur", null), row("wt-a", "wt"), row("wt-b", "wt")))
        layout(view)
        click(view, chevron(view, 1))

        view.filter("wt-b")
        assertEquals(listOf("wt-b"), rows(view).map { it.key })

        view.filter("")
        assertEquals(listOf("cur", sectionKey("wt")), rows(view).map { it.key })
    }

    fun `test drag within a collapsed list targets the item slot`() {
        val moves = mutableListOf<ActiveListMove>()
        val view = view(moves = moves)
        view.update(listOf(row("cur", null), row("wt-a", "wt"), row("wt-b", "wt")))
        layout(view)
        click(view, chevron(view, 1))
        click(view, chevron(view, 1))
        layout(view)

        view.over("wt-b", center(view, 1))
        view.drop()

        assertEquals(listOf("cur", "wt-b", "wt-a"), rows(view).map { it.key })
        val move = moves.single()
        assertEquals("wt-b", move.key)
        assertEquals(2, move.from)
        assertEquals(1, move.to)
        assertEquals(listOf("cur", "wt-b", "wt-a"), move.keys)
    }

    fun `test list without collapse has no chevron target`() {
        val view = view(collapse = null)
        view.update(listOf(row("cur", null), row("wt-a", "wt"), row("wt-b", "wt")))
        layout(view)

        assertTrue(activeListCellBounds(view.list, 1, selected = false)[ACTIVE_LIST_SECTION_CELL] == null)
    }

    private fun view(collapse: ActiveListCollapse? = ActiveListCollapse(), moves: MutableList<ActiveListMove> = mutableListOf()): ActiveListView {
        return ActiveListView(
            empty = "",
            cfg = ActiveListConfig(),
            collapse = collapse,
            reorder = ActiveListReorder(movable = { it.section != null }, onMove = { moves += it }),
            onCell = { _, _ -> },
        )
    }

    private fun rows(view: ActiveListView): List<ActiveListItem> =
        (0 until view.list.model.size).map { view.list.model.getElementAt(it) }

    private fun layout(view: ActiveListView) {
        view.setBounds(0, 0, 360, 600)
        view.doLayout()
        view.list.setBounds(0, 0, 360, 600)
        view.list.doLayout()
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun chevron(view: ActiveListView, band: Int): Point {
        // Model changes move the rows; the list only parts them out on its next layout pass.
        layout(view)
        val area = activeListCellBounds(view.list, band, selected = false).getValue(ACTIVE_LIST_SECTION_CELL)
        return center(area)
    }

    private fun click(view: ActiveListView, point: Point) {
        fire(view.list, mouse(view, MouseEvent.MOUSE_PRESSED, point))
        fire(view.list, mouse(view, MouseEvent.MOUSE_RELEASED, point))
        fire(view.list, mouse(view, MouseEvent.MOUSE_CLICKED, point))
    }

    private fun mouse(view: ActiveListView, id: Int, point: Point) = MouseEvent(
        view.list,
        id,
        System.currentTimeMillis(),
        InputEvent.BUTTON1_DOWN_MASK,
        point.x,
        point.y,
        1,
        false,
        MouseEvent.BUTTON1,
    )

    private fun center(area: Rectangle) = Point(area.x + area.width / 2, area.y + area.height / 2)

    private fun center(view: ActiveListView, index: Int): Point {
        val bounds = view.list.getCellBounds(index, index) ?: error("no bounds for $index")
        return Point(bounds.x + 8, bounds.y + bounds.height / 2)
    }

    private fun row(key: String, section: String?): ActiveListItem = object : ActiveListItem {
        override val key = key
        override val title = if (section == null) key else "$section title"
        override val section = section
        override val search = key
    }
}
