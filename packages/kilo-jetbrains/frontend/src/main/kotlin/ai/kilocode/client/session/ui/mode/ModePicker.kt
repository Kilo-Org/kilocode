package ai.kilocode.client.session.ui.mode

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.PickerButton
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.PopupShowOptions
import java.awt.Cursor
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.ListSelectionModel

class ModePicker : PickerButton() {

    data class Item(
        val id: String,
        val display: String,
        val description: String? = null,
        val deprecated: Boolean = false,
    ) {
        override fun toString(): String = listOfNotNull(display, description).joinToString(" ")
    }

    var onSelect: (Item) -> Unit = {}

    private var items: List<Item> = emptyList()
    private var selected: Item? = null

    init {
        isEnabled = false
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
        items = values.sortedWith(compareBy<Item> { it.display.lowercase() }.thenBy { it.id })
        selected = default?.let { id -> items.firstOrNull { it.id == id } } ?: items.firstOrNull()
        refresh()
    }

    fun select(id: String) {
        selected = items.firstOrNull { it.id == id }
        refresh()
    }

    /** Whether [cycle] would move to a different mode than the one selected now. */
    fun canCycle(): Boolean = nextCycleItem() != null

    /** Selects the next non-deprecated mode after the current one, wrapping at the end. */
    fun cycle() {
        val next = nextCycleItem() ?: return
        selected = next
        refresh()
        onSelect(next)
    }

    private fun nextCycleItem(): Item? {
        val pool = items.filterNot { it.deprecated }
        if (pool.isEmpty()) return null
        val index = pool.indexOfFirst { it.id == selected?.id }
        val next = pool[(index + 1).mod(pool.size)]
        return next.takeIf { it.id != selected?.id }
    }

    override fun syncTooltip() {
        toolTipText = tip(KiloBundle.message("mode.picker.tooltip"))
    }

    internal fun itemsForTest(): List<Item> = items

    internal fun selectedForTest(): Item? = selected

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

    fun open() {
        if (!isEnabled || items.isEmpty()) return
        showPopup()
    }

    private fun showPopup() {
        val item = selected ?: items.first()
        val popup = JBPopupFactory.getInstance()
            .createPopupChooserBuilder(items)
            .setRenderer(ModePickerRenderer { selected?.id })
            .setSelectionMode(ListSelectionModel.SINGLE_SELECTION)
            .setSelectedValue(item, true)
            .setVisibleRowCount(minOf(ModePickerRenderer.MAX_ROWS, items.size.coerceAtLeast(1)))
            .setRequestFocus(true)
            .setCancelOnClickOutside(true)
            .setCancelKeyEnabled(true)
            .setResizable(false)
            .setMovable(false)
            .setAutoselectOnMouseMove(true)
            .setItemChosenCallback { value ->
                selected = value
                refresh()
                onSelect(value)
            }
            .createPopup()

        restoreFocusOnPick(popup)
        popup.show(PopupShowOptions.aboveComponent(this))
    }
}
