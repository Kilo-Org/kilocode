package ai.kilocode.client.session.ui.model

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.CollectionListModel
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import java.awt.Component
import java.awt.Container
import javax.swing.Icon
import javax.swing.JButton

class ModelPopupTest : BasePlatformTestCase() {

    /**
     * A stored override may be a bare model id rather than `provider/id`: `kilo.json` is hand-edited
     * and agent imports carry whatever the source wrote. The row label and the details pane already
     * accept both, so the dropdown checkmark has to agree.
     */
    fun `test bare model id resolves to the item key`() {
        val popup = popup("gpt-5")

        assertEquals("kilo/gpt-5", popup.activeForTest())
    }

    fun `test full provider key resolves to itself`() {
        val popup = popup("kilo/gpt-5")

        assertEquals("kilo/gpt-5", popup.activeForTest())
    }

    fun `test unknown model resolves to no selection`() {
        val popup = popup("openai/o5")

        assertNull(popup.activeForTest())
    }

    fun `test absent model resolves to no selection`() {
        val popup = popup(null)

        assertNull(popup.activeForTest())
    }

    /** The resolution is memoized, so it has to follow the selection when it changes. */
    fun `test resolution follows a changed selection`() {
        var selected: String? = "gpt-5"
        val popup = ModelPopup(anchor = JButton(), items = ::items, selected = { selected }, onSelect = {})

        assertEquals("kilo/gpt-5", popup.activeForTest())

        selected = "sonnet"
        assertEquals("kilo/sonnet", popup.activeForTest())

        selected = null
        assertNull(popup.activeForTest())
    }

    /** Wires the resolved value into the renderer exactly as `ModelPopup.show` does. */
    fun `test bare model id checks the matching dropdown row`() {
        val popup = popup("gpt-5")
        val rows = modelPickerRows(items(), emptyList(), "", false, "", false).filter { it.item != null }
        val model = CollectionListModel(rows)
        val renderer = ModelPickerRenderer(model, popup::activeForTest, { emptySet() })
        val list = JBList(model)

        val checked = rows.map { row ->
            row.item!!.id to renderer.getListCellRendererComponent(list, row, rows.indexOf(row), false, false)
                .icons()
                .contains(ModelPickerRenderer.checked)
        }

        assertEquals(listOf("gpt-5" to true, "sonnet" to false), checked)
    }

    private fun popup(selected: String?) = ModelPopup(
        anchor = JButton(),
        items = ::items,
        selected = { selected },
        onSelect = {},
    )

    private fun items() = listOf(
        ModelPicker.Item("gpt-5", "GPT-5", "kilo", "Kilo"),
        ModelPicker.Item("sonnet", "Sonnet 4.6", "kilo", "Kilo"),
    )

    private fun Component.icons(): List<Icon> {
        val own = if (this is JBLabel) listOfNotNull(icon) else emptyList()
        if (this !is Container) return own
        return own + components.flatMap { it.icons() }
    }
}
