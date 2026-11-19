package ai.kilocode.client.ui.list

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.UIUtil
import java.awt.Dimension

class ActiveListSelectionTest : BasePlatformTestCase() {

    fun `test two phase rebuild keeps selection and mutes onSelect`() {
        var calls = 0
        val view = view { calls++ }
        view.update(rows("a", "b", "c"))
        calls = 0
        assertTrue(view.select("b"))
        assertEquals(1, calls)
        calls = 0

        view.update(rows("a", "c"))
        view.update(rows("a", "b", "c"))

        assertEquals("b", view.selected()?.key)
        assertEquals(0, calls)
    }

    fun `test preserve keeps absent anchor pending`() {
        val view = view()
        view.update(rows("a", "b"))
        assertTrue(view.select("b"))

        view.update(rows("a"), ActiveListSelection.Preserve)
        assertNull(view.selected())
        view.update(rows("a", "b"), ActiveListSelection.Preserve)

        assertEquals("b", view.selected()?.key)
    }

    fun `test stable key preserves selection when value changes`() {
        val view = view()
        view.update(listOf(row("a", "Alpha"), row("b", "Beta")))
        assertTrue(view.select("b"))

        view.update(listOf(row("a", "Alpha"), row("b", "Beta changed")))

        assertEquals("b", view.selected()?.key)
        assertEquals("Beta changed", view.selected()?.title)
    }

    fun `test slide selects row that took selected slot`() {
        val view = view()
        view.update(rows("a", "b", "c"))
        assertTrue(view.select("b"))

        view.update(rows("a", "c"), ActiveListSelection.Slide)
        assertEquals("c", view.selected()?.key)

        view.update(emptyList(), ActiveListSelection.Slide)
        assertNull(view.selected())
    }

    fun `test slide clears when nothing was selected`() {
        val view = view()
        view.update(rows("a", "b"))
        view.clearSelection()

        view.update(rows("a"), ActiveListSelection.Slide)

        assertNull(view.selected())
    }

    fun `test filter selects first match and clearing restores anchor`() {
        val view = view()
        view.update(rows("a", "b", "c"))
        assertTrue(view.select("b"))

        view.filter("Alpha")
        assertEquals("a", view.selected()?.key)
        view.filter("")

        assertEquals("b", view.selected()?.key)
    }

    fun `test multi select restores all surviving rows`() {
        val view = ActiveListView("", ActiveListConfig(selection = javax.swing.ListSelectionModel.MULTIPLE_INTERVAL_SELECTION)) { _, _ -> }
        view.update(rows("a", "b", "c", "d"))
        view.setSelectionIndices(intArrayOf(1, 3))

        view.update(rows("a", "b", "c", "d"))
        assertEquals(listOf("b", "d"), view.selectedKeys())
        view.update(rows("a", "b", "c"))

        assertEquals(listOf("b"), view.selectedKeys())
    }

    fun `test key policy keeps an absent row pending`() {
        val view = view()
        view.update(rows("a", "b"))

        view.update(rows("a"), ActiveListSelection.Key("b"))
        assertNull(view.selected())
        view.update(rows("a", "b"), ActiveListSelection.Preserve)

        assertEquals("b", view.selected()?.key)
    }

    fun `test clearing selection drops the anchor`() {
        val view = view()
        view.update(rows("a", "b"))
        assertTrue(view.select("b"))

        view.clearSelection()
        view.update(rows("a", "b"))

        assertNull(view.selected())
    }

    fun `test slide keeps the last row selected when it is removed`() {
        val view = view()
        view.update(rows("a", "b", "c"))
        assertTrue(view.select("c"))

        view.update(rows("a", "b"), ActiveListSelection.Slide)

        assertEquals("b", view.selected()?.key)
    }

    fun `test move steps the selection and a refresh keeps the moved row`() {
        val view = view()
        view.update(rows("a", "b", "c"))
        assertNull(view.selected())

        // From no selection the first step lands on the near end rather than skipping it.
        view.move(1)
        assertEquals("a", view.selected()?.key)
        view.clearSelection()
        view.move(-1)
        assertEquals("c", view.selected()?.key)

        view.selectIndex(0)
        view.move(1)
        assertEquals("b", view.selected()?.key)
        view.update(rows("a", "b", "c"))
        assertEquals("b", view.selected()?.key)

        view.move(-5)
        assertEquals("a", view.selected()?.key)
        view.move(9)
        assertEquals("c", view.selected()?.key)
    }

    fun `test refresh while filtered restores the anchored row`() {
        val view = view()
        view.update(rows("a", "b", "c"))
        assertTrue(view.select("b"))
        view.filter("Beta")
        assertEquals("b", view.selected()?.key)

        view.update(rows("a", "b", "c", "d"))

        assertEquals(listOf("b"), view.selectedKeys())
        assertEquals(1, view.list.model.size)
    }

    fun `test absent select creates pending anchor`() {
        val view = view()
        view.update(rows("a"))

        assertFalse(view.select("b"))
        assertNull(view.selected())
        view.update(rows("a", "b"))

        assertEquals("b", view.selected()?.key)
    }

    fun `test refresh keeps the viewport and only a moved selection scrolls`() {
        val view = view()
        val rows = (0 until 30).map { row("k$it", "Row $it") }
        view.update(rows)
        val scroll = JBScrollPane(view.list)
        scroll.size = Dimension(320, 80)
        scroll.doLayout()
        view.list.doLayout()
        UIUtil.dispatchAllInvocationEvents()

        assertTrue(view.select("k25"))
        scroll.doLayout()
        UIUtil.dispatchAllInvocationEvents()
        val before = scroll.viewport.viewPosition.y
        assertTrue("expected a scrolled viewport", before > 0)

        // Re-finding the same row must not drag the viewport back to the selection.
        view.update(rows)
        UIUtil.dispatchAllInvocationEvents()
        assertEquals(before, scroll.viewport.viewPosition.y)

        view.update(rows, ActiveListSelection.Key("k0"))
        UIUtil.dispatchAllInvocationEvents()

        assertEquals("k0", view.selected()?.key)
        assertTrue(scroll.viewport.viewPosition.y < before)
    }

    fun `test identity override restores by identity and key`() {
        val view = view()
        view.update(listOf(row("pending", "Pending", "same")))
        assertTrue(view.select("pending"))
        view.update(listOf(row("created", "Created", "same")))
        assertEquals("created", view.selected()?.key)

        assertTrue(view.select("created"))
        view.update(listOf(row("created", "Created again", "other")))
        assertEquals("created", view.selected()?.key)
    }

    fun `test progress row keeps cells in model but hides visible actions`() {
        val item = object : ActiveListItem {
            override val key = "busy"
            override val title = "Busy"
            override val progress = "Working..."
            override val cells = listOf(ActiveListCell("open", "Open", primary = true))
        }

        assertEquals(listOf("open"), item.cells.map { it.id })
        assertEquals(emptyList<ActiveListCell>(), activeListVisibleCells(item, active = true))
    }

    private fun view(onSelect: () -> Unit = {}): ActiveListView {
        return ActiveListView("") { _, _ -> }.apply { this.onSelect = onSelect }
    }

    private fun rows(vararg keys: String): List<ActiveListItem> = keys.map { row(it, title(it)) }

    private fun row(key: String, title: String, identity: Any = key): ActiveListItem = object : ActiveListItem {
        override val key = key
        override val identity = identity
        override val title = title
        override val search = title
    }

    private fun title(key: String): String = when (key) {
        "a" -> "Alpha"
        "b" -> "Beta"
        "c" -> "Gamma"
        "d" -> "Delta"
        else -> key
    }
}
