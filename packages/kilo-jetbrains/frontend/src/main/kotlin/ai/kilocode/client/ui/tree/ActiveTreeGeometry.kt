package ai.kilocode.client.ui.tree

import ai.kilocode.client.ui.active.ActiveHit
import ai.kilocode.client.ui.active.activeHitCells
import ai.kilocode.client.ui.active.activeLayout
import com.intellij.ui.tree.ui.CustomBoundsTreeUI
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Point
import java.awt.Rectangle
import javax.swing.tree.TreePath

/** Uses the native delegate's painted bounds for both renderer layout and hit regions. */
internal class ActiveTreeGeometry(private val view: ActiveTreeView, private val renderer: ActiveTreeRenderer) {
    @RequiresEdt
    fun bounds(entry: ActiveEntry): Rectangle? {
        val path = TreePath(entry.path)
        val row = view.getRowForPath(path)
        return if (row < 0) null else {
            val actual = (view.ui as? CustomBoundsTreeUI)?.getActualPathBounds(view, path)
                ?.takeIf { it.width > 0 && it.height > 0 }
            actual ?: view.getRowBounds(row)
        }
    }

    @RequiresEdt
    fun entry(point: Point): ActiveEntry? =
        (view.getClosestPathForLocation(point.x, point.y)?.lastPathComponent as? ActiveEntry)
            ?.takeIf { bounds(it)?.contains(point) == true }

    @RequiresEdt
    fun hits(entry: ActiveEntry): List<ActiveHit> {
        val bounds = bounds(entry)?.takeIf { view.ui is CustomBoundsTreeUI }
        return bounds?.let {
            val selected = view.selectionModel.isPathSelected(TreePath(entry.path))
            val comp = renderer.component(view.state(entry, selected, view.hasFocus(), it.width))
            comp.setBounds(it.x, it.y, it.width, it.height)
            activeLayout(comp)
            activeHitCells(comp, it.x, it.y)
        }.orEmpty()
    }

    @RequiresEdt
    fun hit(event: java.awt.event.MouseEvent, enabled: Boolean): ActiveTreeHit? = entry(event.point)?.let { entry ->
        val cell = hits(entry).firstOrNull { (!enabled || it.enabled) && it.bounds.contains(event.point) }
        ActiveTreeHit(entry, cell?.id)
    }
}

internal data class ActiveTreeHit(val entry: ActiveEntry, val id: String?)
