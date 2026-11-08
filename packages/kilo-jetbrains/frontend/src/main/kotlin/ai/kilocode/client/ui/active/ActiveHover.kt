package ai.kilocode.client.ui.active

import java.awt.Point

/**
 * Tracks the button cell under the pointer for a list or tree row.
 *
 * A row's hit regions are rebuilt only when the pointer enters a new row or its selection changes,
 * so moving between buttons of one row does not re-render the stamp for every event. [cell] is the
 * single hovered element: the owning view replaces or clears it before painting anything else, and
 * only the row whose index matches [row] may render it.
 */
internal class ActiveHover {
    /** Row index of [cell], or -1 when the pointer is not over a row. */
    var row = -1
        private set

    /** Id of the hovered button cell, or null when the pointer is over the row body. */
    var cell: String? = null
        private set

    private var cacheRow = -1
    private var cacheSelected = false
    private var regions: List<ActiveHit> = emptyList()

    /** Updates the hovered cell for [row]; answers the enabled hit under [point], if any. */
    fun move(row: Int, selected: Boolean, point: Point, hits: () -> List<ActiveHit>): ActiveHit? {
        if (row < 0) {
            clear()
            return null
        }
        // Publish the row before measuring: the renderer stamps the hover-revealed menu from this
        // state, and the previous cell must not linger on the row being left.
        if (row != this.row) {
            this.row = row
            cell = null
        }
        if (row != cacheRow || selected != cacheSelected) {
            cacheRow = row
            cacheSelected = selected
            regions = hits()
        }
        val target = regions.firstOrNull { it.enabled && it.bounds.contains(point) }
        cell = target?.id
        return target
    }

    fun clear() {
        cacheRow = -1
        if (row < 0 && cell == null) return
        row = -1
        cell = null
    }

    /** Drops the cached regions after a model, size, scroll, or selection change. */
    fun invalidate() {
        cacheRow = -1
    }
}
