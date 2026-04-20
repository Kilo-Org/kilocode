package ai.kilocode.client.session.ui

import com.intellij.icons.AllIcons
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.ListPopup
import com.intellij.openapi.ui.popup.PopupShowOptions
import com.intellij.openapi.ui.popup.PopupStep
import com.intellij.openapi.ui.popup.util.BaseListPopupStep
import com.intellij.ui.JBColor
import com.intellij.ui.RoundedLineBorder
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.Cursor
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.Icon

/**
 * Clickable label-style dropdown picker with a rounded outline.
 *
 * Shows the selected item's display text with an up-arrow. On click,
 * opens a list popup above the picker. Disabled (greyed out, not
 * clickable) when no items are loaded.
 */
class LabelPicker : JBLabel() {

    data class Item(val id: String, val display: String, val group: String? = null) {
        override fun toString() = display
    }

    var onSelect: (Item) -> Unit = {}

    private var items: List<Item> = emptyList()
    private var selected: Item? = null

    init {
        border = JBUI.Borders.compound(
            RoundedLineBorder(JBColor.border(), JBUI.scale(6)),
            JBUI.Borders.empty(2, 8),
        )
        isEnabled = false
        text = " "

        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (!isEnabled || items.isEmpty()) return
                showPopup()
            }
        })
    }

    fun setItems(values: List<Item>, default: String? = null) {
        items = values
        selected = if (default != null) values.firstOrNull { it.id == default } else values.firstOrNull()
        refresh()
    }

    fun select(id: String) {
        selected = items.firstOrNull { it.id == id }
        refresh()
    }

    private fun refresh() {
        if (items.isEmpty()) {
            isEnabled = false
            text = " "
            cursor = Cursor.getDefaultCursor()
            return
        }
        val display = selected?.display ?: items.firstOrNull()?.display ?: ""
        text = "$display ▴"
        isEnabled = true
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    private fun showPopup() {
        val step = object : BaseListPopupStep<Item>("", items) {
            override fun getTextFor(value: Item) = value.display

            override fun getIconFor(value: Item): Icon? =
                if (value.id == selected?.id) AllIcons.Actions.Checked else null

            override fun onChosen(value: Item, final: Boolean): PopupStep<*>? {
                selected = value
                refresh()
                onSelect(value)
                return FINAL_CHOICE
            }
        }

        val popup: ListPopup = JBPopupFactory.getInstance().createListPopup(step)
        popup.show(PopupShowOptions.aboveComponent(this))
    }
}
