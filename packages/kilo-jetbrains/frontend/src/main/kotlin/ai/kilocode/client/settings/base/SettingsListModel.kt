package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.UiStyle
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Container
import java.awt.Point
import java.awt.Rectangle
import javax.swing.Icon
import javax.swing.JList
import javax.swing.ListCellRenderer
import javax.swing.SwingUtilities

private const val CELL_GAP = 8

internal data class SettingsBadge(val text: String, val style: UiStyle.Badge.Style = UiStyle.Badge.Secondary)

internal enum class SettingsListRowHeight { EQUAL, PREFERRED }

internal data class SettingsListConfig(
    val height: SettingsListRowHeight,
    val description: Boolean = true,
    val descriptionIndent: Boolean = true,
) {
    companion object {
        val Equal = SettingsListConfig(SettingsListRowHeight.EQUAL)
        val Preferred = SettingsListConfig(SettingsListRowHeight.PREFERRED)
    }
}

internal data class SettingsListCell(
    val id: String,
    val label: String,
    val enabled: Boolean = true,
    val alwaysVisible: Boolean = false,
    val icon: Icon? = null,
    val iconOnly: Boolean = false,
    val primary: Boolean = false,
)

internal interface SettingsListItem {
    val key: String
    val title: String
    val description: String? get() = null
    val icon: Icon? get() = null
    val section: String? get() = null
    val badges: List<SettingsBadge> get() = emptyList()
    val cells: List<SettingsListCell> get() = emptyList()
    val disabled: Boolean get() = false
}

internal fun settingsListSectionTitle(items: List<SettingsListItem>, index: Int): String? {
    val item = items.getOrNull(index) ?: return null
    val prev = items.getOrNull(index - 1)
    return if (prev?.section != item.section) item.section else null
}

internal fun settingsListVisibleCells(item: SettingsListItem, selected: Boolean): List<SettingsListCell> {
    if (item.disabled) return emptyList()
    return item.cells.filter { selected || it.alwaysVisible }
}

internal fun settingsListCellGap() = JBUI.scale(CELL_GAP)

/**
 * Clickable action-cell rectangles for a row, in list coordinates.
 *
 * The rectangles are read back from the actual rendered component tree instead of being
 * re-derived by hand. This keeps the click targets identical to what the [SettingsListRenderer]
 * draws — including the horizontal insets the platform's [com.intellij.ui.popup.list.SelectablePanel]
 * adds in the New UI, which a hand-computed layout would miss.
 */
internal fun settingsListCellBounds(
    list: JList<*>,
    index: Int,
    selected: Boolean,
): Map<String, Rectangle> {
    val model = list.model
    if (index < 0 || index >= model.size) return emptyMap()
    @Suppress("UNCHECKED_CAST")
    val renderer = list.cellRenderer as? ListCellRenderer<Any?> ?: return emptyMap()
    val cell = list.getCellBounds(index, index) ?: return emptyMap()
    val comp = renderer.getListCellRendererComponent(list, model.getElementAt(index), index, selected, list.hasFocus())
    comp.setBounds(0, 0, cell.width, cell.height)
    settingsListLayout(comp)
    val out = linkedMapOf<String, Rectangle>()
    for (action in settingsListActionCells(comp)) {
        val origin = SwingUtilities.convertPoint(action, 0, 0, comp)
        out[action.cellId] = Rectangle(cell.x + origin.x, cell.y + origin.y, action.width, action.height)
    }
    return out
}

internal fun settingsListCellAt(
    list: JList<*>,
    index: Int,
    point: Point,
    selected: Boolean,
): String? {
    val model = list.model
    if (index < 0 || index >= model.size) return null
    val item = model.getElementAt(index) as? SettingsListItem ?: return null
    val cells = settingsListCellBounds(list, index, selected)
    return settingsListVisibleCells(item, selected)
        .firstOrNull { cell -> cell.enabled && cells[cell.id]?.contains(point) == true }
        ?.id
}

private fun settingsListLayout(component: Component) {
    if (component !is Container) return
    component.doLayout()
    for (child in component.components) settingsListLayout(child)
}

private fun settingsListActionCells(component: Component): List<SettingsListActionCell> {
    val out = mutableListOf<SettingsListActionCell>()
    fun visit(c: Component) {
        if (c is SettingsListActionCell && c.isVisible) out += c
        if (c is Container) c.components.forEach(::visit)
    }
    visit(component)
    return out
}
