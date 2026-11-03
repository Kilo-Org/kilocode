package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.active.ActiveHit
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.activeHitCells
import ai.kilocode.client.ui.active.activeLayout
import ai.kilocode.client.ui.active.activeVisibleCells
import java.awt.Point
import java.awt.Rectangle
import javax.swing.JList
import javax.swing.ListCellRenderer

internal fun activeListSectionTitle(items: List<ActiveItem>, index: Int): String? {
    val item = items.getOrNull(index) ?: return null
    val prev = items.getOrNull(index - 1)
    return if (prev?.section != item.section) item.section else null
}
/**
 * Hit-test regions for a row, in list coordinates, read back from the actual rendered component
 * tree instead of being re-derived by hand. This keeps the click/cursor/tooltip targets identical
 * to what the [ActiveListRenderer] draws — including the action-cell overlay layer and the
 * horizontal insets the platform's [com.intellij.ui.popup.list.SelectablePanel] adds in the New
 * UI, which a hand-computed layout would miss.
 */
internal fun activeListHits(
    list: JList<*>,
    index: Int,
    selected: Boolean,
): List<ActiveHit> {
    val model = list.model
    if (index < 0 || index >= model.size) return emptyList()
    @Suppress("UNCHECKED_CAST")
    val renderer = list.cellRenderer as? ListCellRenderer<Any?> ?: return emptyList()
    val cell = list.getCellBounds(index, index) ?: return emptyList()
    // Render as focused so the region geometry and focused/unfocused selection state never alter
    // hit targets.
    val comp = renderer.getListCellRendererComponent(list, model.getElementAt(index), index, selected, true)
    comp.setBounds(0, 0, cell.width, cell.height)
    activeLayout(comp)
    return activeHitCells(comp, cell.x, cell.y)
}

/** Clickable action-cell rectangles for a row, in list coordinates. */
internal fun activeListCellBounds(
    list: JList<*>,
    index: Int,
    selected: Boolean,
): Map<String, Rectangle> {
    val out = linkedMapOf<String, Rectangle>()
    for (hit in activeListHits(list, index, selected)) out[hit.id] = hit.bounds
    return out
}

internal fun activeListCellAt(
    list: JList<*>,
    index: Int,
    point: Point,
    selected: Boolean,
    menu: Boolean = false,
): String? {
    val model = list.model
    if (index < 0 || index >= model.size) return null
    val item = model.getElementAt(index) as? ActiveItem ?: return null
    val hits = activeListHits(list, index, selected)
    if (hits.isEmpty()) return null
    val bounds = hits.associate { it.id to it.bounds }
    val fromCell = activeVisibleCells(item, selected, menu)
        .firstOrNull { cell -> cell.enabled && bounds[cell.id]?.contains(point) == true }
        ?.id
    if (fromCell != null) return fromCell
    return hits.firstOrNull { it.enabled && it.action != null && it.bounds.contains(point) }?.id
}

internal fun activeListCellAt(
    list: JList<*>,
    index: Int,
    point: Point,
    selected: Boolean,
): String? {
    return activeListCellAt(list, index, point, selected, false)
}
