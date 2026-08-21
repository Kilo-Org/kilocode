package ai.kilocode.client.ui.list

import com.intellij.testFramework.fixtures.BasePlatformTestCase

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

    fun `test absent select creates pending anchor`() {
        val view = view()
        view.update(rows("a"))

        assertFalse(view.select("b"))
        assertNull(view.selected())
        view.update(rows("a", "b"))

        assertEquals("b", view.selected()?.key)
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
