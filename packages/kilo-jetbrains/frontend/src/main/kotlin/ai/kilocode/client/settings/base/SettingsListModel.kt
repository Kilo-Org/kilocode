package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.UiStyle
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import java.awt.Point
import java.awt.Rectangle
import javax.swing.Icon
import javax.swing.JList

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

internal fun settingsListCellAt(
    list: JList<*>,
    bounds: Rectangle,
    point: Point,
    item: SettingsListItem,
    selected: Boolean,
): String? {
    val cells = settingsListCellBounds(list, bounds, item, selected)
    return settingsListVisibleCells(item, selected)
        .firstOrNull { cell -> cell.enabled && cells[cell.id]?.contains(point) == true }
        ?.id
}

internal fun settingsListCellBounds(
    list: JList<*>,
    bounds: Rectangle,
    item: SettingsListItem,
    selected: Boolean,
): Map<String, Rectangle> {
    val height = settingsListCellHeight(list)
    var edge = bounds.x + bounds.width - UiStyle.Gap.pad()
    val out = linkedMapOf<String, Rectangle>()
    for (cell in settingsListVisibleCells(item, selected).asReversed()) {
        val size = settingsListCellSize(list, cell)
        val width = size.width
        val h = height.coerceAtLeast(size.height)
        val top = bounds.y + (bounds.height - h) / 2
        val left = edge - width
        out[cell.id] = Rectangle(left, top, width, h)
        edge = left - JBUI.scale(CELL_GAP)
    }
    return out
}

internal fun settingsListCellSize(list: JList<*>, cell: SettingsListCell): Dimension {
    val label = SettingsListActionCell().apply {
        update(cell)
        font = list.font
        isEnabled = cell.enabled
    }
    val size = label.preferredSize
    if (!cell.iconOnly) return size
    val min = settingsListCellHeight(list)
    return Dimension(size.width.coerceAtLeast(min), size.height.coerceAtLeast(min))
}

private fun settingsListCellHeight(list: JList<*>): Int {
    val metrics = list.getFontMetrics(list.font)
    return metrics.height + UiStyle.Gap.sm() * 2
}

internal fun settingsListCellGap() = JBUI.scale(CELL_GAP)
