package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.active.ActiveHit
import ai.kilocode.client.ui.active.ActiveHitCell
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.activeInvalidate
import ai.kilocode.client.ui.active.activeLayout
import ai.kilocode.client.ui.active.activeVisibleCells
import java.awt.Component
import java.awt.Container
import java.awt.Point
import java.awt.Rectangle
import javax.swing.JList
import javax.swing.ListCellRenderer
import javax.swing.SwingUtilities

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
    val out = mutableListOf<ActiveHit>()
    forEachHitCell(comp) { hit ->
        val target = hit as Component
        val origin = SwingUtilities.convertPoint(target, 0, 0, comp)
        out += ActiveHit(
            hit.cellId,
            Rectangle(cell.x + origin.x, cell.y + origin.y, target.width, target.height),
            hit.cellEnabled(),
            hit.cellCursor(),
            hit.cellTooltip(),
            hit.cellAction(),
        )
    }
    return out
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

private fun forEachHitCell(component: Component, action: (ActiveHitCell) -> Unit) {
    fun visit(c: Component) {
        // Skip hidden subtrees so a badge left visible inside a hidden trailing panel is not
        // collected as a live hit target.
        if (!c.isVisible) return
        if (c is ActiveHitCell && c.cellId.isNotBlank()) action(c)
        if (c is Container) c.components.forEach(::visit)
    }
    visit(component)
}
