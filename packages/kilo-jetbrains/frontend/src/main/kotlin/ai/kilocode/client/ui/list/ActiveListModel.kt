package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.UiStyle
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Container
import java.awt.Point
import java.awt.Rectangle
import javax.swing.Icon
import javax.swing.JList
import javax.swing.ListSelectionModel
import javax.swing.ListCellRenderer
import javax.swing.SwingUtilities

private const val CELL_GAP = 8

internal data class ActiveListBadge(val text: String, val style: UiStyle.Badge.Style = UiStyle.Badge.Secondary)

internal enum class ActiveListRowHeight { EQUAL, PREFERRED }

internal data class ActiveListConfig(
    val height: ActiveListRowHeight,
    val description: Boolean = true,
    val descriptionIndent: Boolean = true,
    val tooltip: Boolean = true,
    val selection: Int = ListSelectionModel.SINGLE_SELECTION,
) {
    companion object {
        val Equal = ActiveListConfig(ActiveListRowHeight.EQUAL)
        val Preferred = ActiveListConfig(ActiveListRowHeight.PREFERRED)
    }
}

internal data class ActiveListCell(
    val id: String,
    val label: String,
    val enabled: Boolean = true,
    val alwaysVisible: Boolean = false,
    val icon: Icon? = null,
    val iconOnly: Boolean = false,
    val primary: Boolean = false,
)

/**
 * A row in an [ActiveList]. Carries the display contract shared by settings pages, the worktree
 * list, and the session history stack: a leading icon, a bold title with an inline [note], a
 * secondary [description] line, inline [badges], trailing right-aligned [meta] text, and
 * selection-revealed action [cells].
 */
internal interface ActiveListItem {
    val key: String
    val title: String
    val note: String? get() = null
    val description: String? get() = null
    /** Right-aligned secondary text shown before the action cells (e.g. a relative timestamp). */
    val meta: String? get() = null
    val doubleClick: String? get() = null
    val icon: Icon? get() = null
    val section: String? get() = null
    val badges: List<ActiveListBadge> get() = emptyList()
    val cells: List<ActiveListCell> get() = emptyList()
    val disabled: Boolean get() = false
    /** Extra text matched by the filter field in addition to [title]; null matches title only. */
    val search: String? get() = null
}

internal fun activeListSectionTitle(items: List<ActiveListItem>, index: Int): String? {
    val item = items.getOrNull(index) ?: return null
    val prev = items.getOrNull(index - 1)
    return if (prev?.section != item.section) item.section else null
}

internal fun activeListVisibleCells(item: ActiveListItem, selected: Boolean): List<ActiveListCell> {
    if (item.disabled) return emptyList()
    return item.cells.filter { selected || it.alwaysVisible }
}

internal fun activeListCellGap() = JBUI.scale(CELL_GAP)

/**
 * Clickable action-cell rectangles for a row, in list coordinates.
 *
 * The rectangles are read back from the actual rendered component tree instead of being
 * re-derived by hand. This keeps the click targets identical to what the [ActiveListRenderer]
 * draws — including the horizontal insets the platform's [com.intellij.ui.popup.list.SelectablePanel]
 * adds in the New UI, which a hand-computed layout would miss.
 */
internal fun activeListCellBounds(
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
    activeListLayout(comp)
    val out = linkedMapOf<String, Rectangle>()
    for (action in activeListActionCells(comp)) {
        val origin = SwingUtilities.convertPoint(action, 0, 0, comp)
        out[action.cellId] = Rectangle(cell.x + origin.x, cell.y + origin.y, action.width, action.height)
    }
    return out
}

internal fun activeListCellAt(
    list: JList<*>,
    index: Int,
    point: Point,
    selected: Boolean,
): String? {
    val model = list.model
    if (index < 0 || index >= model.size) return null
    val item = model.getElementAt(index) as? ActiveListItem ?: return null
    val cells = activeListCellBounds(list, index, selected)
    return activeListVisibleCells(item, selected)
        .firstOrNull { cell -> cell.enabled && cells[cell.id]?.contains(point) == true }
        ?.id
}

private fun activeListLayout(component: Component) {
    if (component !is Container) return
    component.doLayout()
    for (child in component.components) activeListLayout(child)
}

private fun activeListActionCells(component: Component): List<ActiveListActionCell> {
    val out = mutableListOf<ActiveListActionCell>()
    fun visit(c: Component) {
        if (c is ActiveListActionCell && c.isVisible) out += c
        if (c is Container) c.components.forEach(::visit)
    }
    visit(component)
    return out
}
