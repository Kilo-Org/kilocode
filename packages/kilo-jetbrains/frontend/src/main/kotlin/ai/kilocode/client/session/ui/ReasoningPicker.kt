package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.PickerButton
import com.intellij.icons.AllIcons
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.ListPopup
import com.intellij.openapi.ui.popup.PopupStep
import com.intellij.openapi.ui.popup.PopupShowOptions
import com.intellij.openapi.ui.popup.util.BaseListPopupStep
import com.intellij.util.ui.EmptyIcon
import java.awt.Cursor
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.Icon

/**
 * Clickable label-style dropdown picker with a native filled background.
 *
 * Shows the selected item's display text with a down-arrow. On click,
 * opens a list popup above the picker. Disabled (greyed out, not
 * clickable) when no items are loaded.
 */
class ReasoningPicker : PickerButton() {

    private companion object {
        val checked: Icon = AllIcons.Actions.Checked
        val empty: Icon = EmptyIcon.create(checked)
    }

    data class Item(val id: String, val display: String, val group: String? = null) {
        override fun toString() = display
    }

    var onSelect: (Item) -> Unit = {}

    private var items: List<Item> = emptyList()
    private var selected: Item? = null

    init {
        isEnabled = false
        isVisible = false
        text = " "
        syncTooltip()

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

    /** Whether [cycle] would move to a different reasoning effort than the one selected now. */
    fun canCycle(): Boolean = isVisible && nextCycleItem() != null

    /** Selects the next reasoning effort after the current one, wrapping at the end. */
    fun cycle() {
        if (!isVisible) return
        val next = nextCycleItem() ?: return
        selected = next
        refresh()
        onSelect(next)
    }

    private fun nextCycleItem(): Item? {
        if (items.isEmpty()) return null
        val index = items.indexOfFirst { it.id == selected?.id }
        val next = items[(index + 1).mod(items.size)]
        return next.takeIf { it.id != selected?.id }
    }

    override fun syncTooltip() {
        toolTipText = tip(KiloBundle.message("reasoning.picker.tooltip"))
    }

    internal fun selectedForTest(): Item? = selected

    internal fun iconForTest(item: Item): Icon = icon(item)

    private fun refresh() {
        if (items.isEmpty()) {
            isEnabled = false
            isVisible = false
            text = " "
            cursor = Cursor.getDefaultCursor()
            return
        }
        isVisible = true
        val display = selected?.display ?: items.firstOrNull()?.display ?: ""
        text = "$display ▾"
        isEnabled = true
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    fun open() {
        if (!isEnabled || items.isEmpty()) return
        showPopup()
    }

    private fun showPopup() {
        val step = object : BaseListPopupStep<Item>("", items) {
            override fun getTextFor(value: Item) = value.display

            override fun getIconFor(value: Item): Icon = icon(value)

            override fun onChosen(value: Item, final: Boolean): PopupStep<*>? {
                selected = value
                refresh()
                onSelect(value)
                return FINAL_CHOICE
            }
        }

        val popup: ListPopup = JBPopupFactory.getInstance().createListPopup(step)
        restoreFocusOnPick(popup)
        popup.show(PopupShowOptions.aboveComponent(this))
    }

    private fun icon(item: Item): Icon = if (item.id == selected?.id) checked else empty
}
