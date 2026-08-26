package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.UiStyle
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Container
import java.awt.Cursor
import java.awt.Point
import java.awt.Rectangle
import javax.swing.Icon
import javax.swing.JList
import javax.swing.ListSelectionModel
import javax.swing.ListCellRenderer
import javax.swing.SwingUtilities

private const val CELL_GAP = 8

internal data class ActiveListBadge(val text: String, val style: UiStyle.Badge.Style = UiStyle.Badge.Secondary)

internal data class ActiveListMetrics(
    val additions: Int = 0,
    val deletions: Int = 0,
    val ahead: Int = 0,
    val behind: Int = 0,
    val pr: ActiveListBadge? = null,
    val prTooltip: String? = null,
    /** Click handler for the changes badge, e.g. open the branch diff. Null leaves it inert. */
    val onChanges: (() -> Unit)? = null,
    /** Click handler for the PR badge, e.g. open the pull request. Null leaves it inert. */
    val onPr: (() -> Unit)? = null,
)

internal enum class ActiveListRowHeight { EQUAL, PREFERRED }

internal enum class ActiveListWeight { PLAIN, BOLD }

internal data class ActiveListConfig(
    val height: ActiveListRowHeight = ActiveListRowHeight.EQUAL,
    val description: Boolean = true,
    val descriptionIndent: Boolean = true,
    val tooltip: Boolean = true,
    val selection: Int = ListSelectionModel.SINGLE_SELECTION,
    val hoverActions: Boolean = false,
    /** Weight used for the primary row title. */
    val title: ActiveListWeight = ActiveListWeight.BOLD,
    /** Weight used for section headers. */
    val header: ActiveListWeight = ActiveListWeight.BOLD,
    /** Show a separator line above section headers, except above the first row. */
    val divider: Boolean = true,
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
    /** Show this button even when the row is not the active focused selection. */
    val alwaysVisible: Boolean = false,
    val icon: Icon? = null,
    val iconOnly: Boolean = false,
    val primary: Boolean = false,
    /** Hover tooltip; falls back to [label] when null. */
    val tooltip: String? = null,
    /** Cursor shown while hovering the button; defaults to the action (hand) cursor. */
    val cursor: Int = Cursor.HAND_CURSOR,
    /**
     * Click handler; when set it replaces the list-level onCell callback for this cell. Defaults to
     * null so existing cells keep routing through onCell and stay value-equal across row rebuilds.
     * A per-cell handler must be a stable reference when the owning list relies on row equality to
     * skip rebuilds.
     */
    val action: (() -> Unit)? = null,
)

/**
 * A component in a rendered [ActiveListItem] row that the list hit-tests for clicks, hover cursor,
 * and tooltips. Implemented by the action-cell buttons and by rich trailing badges (the worktree
 * changes/PR metrics) so both flow through the same click/cursor/tooltip plumbing.
 */
internal interface ActiveListHitCell {
    val cellId: String
    fun cellEnabled(): Boolean
    fun cellCursor(): Int
    fun cellTooltip(): String?
    fun cellAction(): (() -> Unit)?
}

/**
 * A row in an [ActiveList]. Carries the display contract shared by settings pages, the worktree
 * list, and the session history stack: a leading icon, a title whose weight follows
 * [ActiveListConfig.title] with an inline [note], a secondary [description] line, inline [badges],
 * optional right-aligned [trailing] text, and action [cells]. Action cells are shown only for the
 * active focused selection unless [ActiveListCell.alwaysVisible] is true.
 */
internal interface ActiveListItem {
    val key: String
    /**
     * Stable identity used to restore selection across refreshes. Defaults to [key]; override when
     * the key is not stable for the row's lifetime.
     */
    val identity: Any get() = key
    val title: String
    val note: String? get() = null
    val description: String? get() = null
    /** Hover tooltip text; defaults to [description] when not overridden. */
    val tooltip: String? get() = description
    val doubleClick: String? get() = null
    val icon: Icon? get() = null
    /**
     * Recolor [icon] to the row foreground when the row is the focused selection. Enable it only for
     * monochrome glyphs that should read as part of the highlighted text; leave it off for colored
     * status icons (running, question, error) so they keep their own hue.
     */
    val tinted: Boolean get() = false
    val section: String? get() = null
    val badges: List<ActiveListBadge> get() = emptyList()
    /** Right-aligned secondary text, such as a relative timestamp. */
    val trailing: String? get() = null
    val metrics: ActiveListMetrics? get() = null
    val cells: List<ActiveListCell> get() = emptyList()
    val disabled: Boolean get() = false
    /** Non-null while a background operation owns this row; the text is shown trailing. */
    val progress: String? get() = null
    /** Extra text matched by the filter field in addition to [title]; null matches title only. */
    val search: String? get() = null
}

internal fun activeListSectionTitle(items: List<ActiveListItem>, index: Int): String? {
    val item = items.getOrNull(index) ?: return null
    val prev = items.getOrNull(index - 1)
    return if (prev?.section != item.section) item.section else null
}

internal fun activeListVisibleCells(
    item: ActiveListItem,
    active: Boolean,
    menu: Boolean = false,
): List<ActiveListCell> {
    if (item.disabled) return emptyList()
    if (item.progress != null) return emptyList()
    val cells = item.cells.filter { active || it.alwaysVisible }
    if (!menu) return cells
    return cells + activeListMenuCell()
}

internal fun activeListVisibleCells(item: ActiveListItem, active: Boolean): List<ActiveListCell> {
    return activeListVisibleCells(item, active, false)
}

internal fun activeListCellGap() = JBUI.scale(CELL_GAP)

/** A hit-tested region of a rendered row, in list coordinates, with its interaction metadata. */
internal class ActiveListHit(
    val id: String,
    val bounds: Rectangle,
    val enabled: Boolean,
    val cursor: Int,
    val tooltip: String?,
    val action: (() -> Unit)?,
)

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
): List<ActiveListHit> {
    val model = list.model
    if (index < 0 || index >= model.size) return emptyList()
    @Suppress("UNCHECKED_CAST")
    val renderer = list.cellRenderer as? ListCellRenderer<Any?> ?: return emptyList()
    val cell = list.getCellBounds(index, index) ?: return emptyList()
    // Render as focused so the region geometry is available for hit-testing even when the list is
    // not the focus owner. Painting still hides the cells on an unfocused list; this only resolves
    // hit targets and keeps them stable regardless of focus.
    val comp = renderer.getListCellRendererComponent(list, model.getElementAt(index), index, selected, true)
    comp.setBounds(0, 0, cell.width, cell.height)
    activeListLayout(comp)
    val out = mutableListOf<ActiveListHit>()
    forEachHitCell(comp) { hit ->
        val target = hit as Component
        val origin = SwingUtilities.convertPoint(target, 0, 0, comp)
        out += ActiveListHit(
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
    val item = model.getElementAt(index) as? ActiveListItem ?: return null
    val hits = activeListHits(list, index, selected)
    if (hits.isEmpty()) return null
    val bounds = hits.associate { it.id to it.bounds }
    val fromCell = activeListVisibleCells(item, selected, menu)
        .firstOrNull { cell -> cell.enabled && bounds[cell.id]?.contains(point) == true }
        ?.id
    if (fromCell != null) return fromCell
    // Regions that are not backed by an ActiveListCell (the changes/PR badges) are actionable in
    // place: match the first enabled one with a handler under the point.
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

internal fun activeListLayout(component: Component) {
    if (component !is Container) return
    component.doLayout()
    for (child in component.components) activeListLayout(child)
}

/**
 * Marks a rendered row and everything under it invalid.
 *
 * A list renderer is one component reused for every row, and it changes content without changing
 * size. Swing caches each container's preferred/minimum size and - through
 * [java.awt.Container.validate], the layout pass painting uses - skips subtrees that are still
 * valid, so a row would otherwise be laid out with sizes measured for whichever row the renderer
 * rendered before it. Invalidating the whole stamp keeps painting and the [activeListLayout] pass
 * behind [activeListHits] on the same geometry.
 */
internal fun activeListInvalidate(component: Component) {
    component.invalidate()
    if (component is Container) for (child in component.components) activeListInvalidate(child)
}

private fun forEachHitCell(component: Component, action: (ActiveListHitCell) -> Unit) {
    fun visit(c: Component) {
        // Skip hidden subtrees so a badge left visible inside a hidden trailing panel is not
        // collected as a live hit target.
        if (!c.isVisible) return
        if (c is ActiveListHitCell) action(c)
        if (c is Container) c.components.forEach(::visit)
    }
    visit(component)
}
