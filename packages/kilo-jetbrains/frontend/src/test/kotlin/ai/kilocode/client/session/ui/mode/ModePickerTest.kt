package ai.kilocode.client.session.ui.mode

import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBList
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import javax.swing.ListCellRenderer

@Suppress("UnstableApiUsage")
class ModePickerTest : BasePlatformTestCase() {

    fun `test active item uses check icon`() {
        val item = ModePicker.Item("code", "Code")
        val renderer = ModePickerRenderer { "code" }

        assertSame(ModePickerRenderer.checked, renderer.icon(item))
    }

    fun `test inactive item reserves icon space`() {
        val item = ModePicker.Item("plan", "Plan")
        val renderer = ModePickerRenderer { "code" }

        assertSame(ModePickerRenderer.empty, renderer.icon(item))
        assertEquals(AllIcons.Actions.Checked.iconWidth, renderer.icon(item).iconWidth)
    }

    fun `test item order is stable across selection changes`() {
        val picker = ModePicker()
        val items = listOf(
            ModePicker.Item("plan", "Plan"),
            ModePicker.Item("ask", "Ask"),
            ModePicker.Item("code", "Code"),
        )

        picker.setItems(items, "plan")
        val first = picker.itemsForTest().map { it.id }
        picker.setItems(items, "ask")
        val second = picker.itemsForTest().map { it.id }

        assertEquals(listOf("ask", "code", "plan"), first)
        assertEquals(first, second)
    }

    fun `test missing default falls back to first sorted mode`() {
        val picker = ModePicker()

        picker.setItems(listOf(
            ModePicker.Item("plan", "Plan"),
            ModePicker.Item("ask", "Ask"),
        ), "missing")

        assertEquals("Ask ▴", picker.text)
        assertEquals("ask", picker.selectedForTest()?.id)
    }

    fun `test item string includes description for chooser search`() {
        val item = ModePicker.Item("code", "Code", "Build and edit files")

        assertEquals("Code Build and edit files", item.toString())
    }

    fun `test deprecated item renders badge`() {
        val item = ModePicker.Item("old", "Old", "Deprecated mode", deprecated = true)
        val renderer = ModePickerRenderer { "code" }
        val cell: ListCellRenderer<ModePicker.Item> = renderer
        val list = JBList(listOf(item))

        cell.getListCellRendererComponent(list, item, 0, false, false)

        assertTrue(renderer.badgeVisible())
        assertEquals("deprecated", renderer.badgeText())
    }

    fun `test item without details hides details row`() {
        val item = ModePicker.Item("code", "Code")
        val renderer = ModePickerRenderer { "code" }
        val cell: ListCellRenderer<ModePicker.Item> = renderer
        val list = JBList(listOf(item))

        cell.getListCellRendererComponent(list, item, 0, false, false)

        assertFalse(renderer.detailsVisible())
    }

    fun `test blank description hides details row`() {
        val item = ModePicker.Item("code", "Code", " ")
        val renderer = ModePickerRenderer { "code" }
        val cell: ListCellRenderer<ModePicker.Item> = renderer
        val list = JBList(listOf(item))

        cell.getListCellRendererComponent(list, item, 0, false, false)

        assertFalse(renderer.detailsVisible())
    }

    fun `test renderer hides deprecated badge after reused for normal item`() {
        val old = ModePicker.Item("old", "Old", deprecated = true)
        val code = ModePicker.Item("code", "Code")
        val renderer = ModePickerRenderer { "code" }
        val cell: ListCellRenderer<ModePicker.Item> = renderer
        val list = JBList(listOf(old, code))

        cell.getListCellRendererComponent(list, old, 0, false, false)
        assertTrue(renderer.badgeVisible())

        cell.getListCellRendererComponent(list, code, 1, false, false)
        assertFalse(renderer.badgeVisible())
    }

    fun `test cycle advances to the next mode in sorted order`() {
        val picker = ModePicker()
        var selected: ModePicker.Item? = null
        picker.onSelect = { selected = it }
        picker.setItems(
            listOf(ModePicker.Item("plan", "Plan"), ModePicker.Item("ask", "Ask"), ModePicker.Item("code", "Code")),
            "ask",
        )

        picker.cycle()

        assertEquals("code", picker.selectedForTest()?.id)
        assertEquals("code", selected?.id)
        assertEquals("Code ▴", picker.text)
    }

    fun `test cycle wraps to the first mode after the last`() {
        val picker = ModePicker()
        picker.setItems(
            listOf(ModePicker.Item("plan", "Plan"), ModePicker.Item("ask", "Ask"), ModePicker.Item("code", "Code")),
            "plan",
        )

        picker.cycle()

        // Sorted order is Ask, Code, Plan; "plan" is last, so cycling wraps back to "ask".
        assertEquals("ask", picker.selectedForTest()?.id)
    }

    fun `test cycle skips deprecated modes`() {
        val picker = ModePicker()
        picker.setItems(
            listOf(
                ModePicker.Item("ask", "Ask"),
                ModePicker.Item("old", "Old", deprecated = true),
                ModePicker.Item("plan", "Plan"),
            ),
            "ask",
        )

        picker.cycle()

        assertEquals("plan", picker.selectedForTest()?.id)
    }

    fun `test canCycle is false with a single usable mode`() {
        val picker = ModePicker()
        picker.setItems(listOf(ModePicker.Item("ask", "Ask")), "ask")

        assertFalse(picker.canCycle())
    }

    fun `test canCycle is false with no items`() {
        val picker = ModePicker()

        assertFalse(picker.canCycle())
    }

    fun `test canCycle is true with two usable modes`() {
        val picker = ModePicker()
        picker.setItems(listOf(ModePicker.Item("ask", "Ask"), ModePicker.Item("code", "Code")), "ask")

        assertTrue(picker.canCycle())
    }

}
