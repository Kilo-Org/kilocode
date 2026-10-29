package ai.kilocode.client.ui.tree

import ai.kilocode.client.ui.active.ActiveHit
import ai.kilocode.client.ui.active.activeHitCells
import ai.kilocode.client.ui.active.activeLayout
import ai.kilocode.client.session.ui.PickerRow
import com.intellij.ui.tree.ui.CustomBoundsTreeUI
import com.intellij.ui.tree.ui.DefaultControl
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.tree.TreeUtil
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Point
import java.awt.Rectangle
import javax.swing.tree.TreePath
import javax.swing.SwingUtilities
import java.awt.Graphics

/** Uses the native delegate's painted bounds for both renderer layout and hit regions. */
internal class ActiveTreeGeometry(private val view: ActiveTreeView, private val renderer: ActiveTreeRenderer) {
    private val surface = PickerRow()

    @RequiresEdt
    fun paint(g: Graphics) {
        for (row in 0 until view.rowCount) {
            val entry = view.getPathForRow(row).lastPathComponent as? ActiveEntry ?: continue
            paint(g, entry, row)
        }
    }

    @RequiresEdt
    private fun paint(g: Graphics, entry: ActiveEntry, row: Int) {
        val state = view.state(entry, view.isRowSelected(row), view.hasFocus())
        val frame = frame(entry)
        val content = bounds(entry)
        if (view.placeholder(entry)) return
        if (frame == null || content == null || g.clipBounds?.intersects(frame) == false) return
        if (state.selectionColor != null) {
            surface.update(view.background, state.selectionColor, true, true)
            SwingUtilities.paintComponent(g, surface, view, frame.x, frame.y, frame.width, frame.height)
        }
        val path = TreePath(entry.path)
        ActiveTreePainter.paint(
            view, g, view.insets.left, frame.y, frame.width, frame.height,
            DefaultControl(), TreeUtil.getNodeDepth(view, path), !entry.allowsChildren,
            view.isExpanded(path), state.active,
        )
        val stamp = renderer.getTreeCellRendererComponent(
            view, entry, state.selected, view.isExpanded(path), !entry.allowsChildren, row, view.hasFocus(),
        )
        // The stamp is also reused for hit testing. SwingUtilities.paintComponent does not validate
        // it like the native tree renderer pane does, so lay it out in local coordinates first.
        val cell = cell(entry)
        stamp.setBounds(0, 0, cell.width, cell.height)
        activeLayout(stamp)
        SwingUtilities.paintComponent(g, stamp, view, cell.x, cell.y, cell.width, cell.height)
    }

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

    /**
     * Row body width at [entry]. It never asks the UI delegate for bounds: the native layout cache
     * sizes rows from the stamp being built, so that would recurse from inside the paint pass.
     */
    @RequiresEdt
    fun width(entry: ActiveEntry): Int {
        val depth = TreeUtil.getNodeDepth(view, TreePath(entry.path))
        val offset = ActiveTreePainter.getRendererOffset(DefaultControl(), depth, !entry.allowsChildren)
        val bodyX = view.insets.left + offset
        return (view.width - view.insets.right - bodyX).coerceAtLeast(0)
    }

    /**
     * Renderer origin of [entry]. A branch reserves its disclosure slot before the body starts, so the
     * group title never runs underneath the arrow.
     */
    @RequiresEdt
    fun cell(entry: ActiveEntry): Rectangle = bounds(entry)?.let { bounds ->
        val control = DefaultControl()
        val path = TreePath(entry.path)
        val depth = TreeUtil.getNodeDepth(view, path)
        val offset = ActiveTreePainter.getRendererOffset(control, depth, !entry.allowsChildren)
        val x = view.insets.left + offset
        val end = view.width - view.insets.right
        Rectangle(x, bounds.y, (end - x).coerceAtLeast(0), bounds.height)
    } ?: Rectangle()

    /**
     * Selection of [entry]. It includes the disclosure column, so a press anywhere on it selects the
     * row while the painted body keeps the list's cell grid.
     */
    @RequiresEdt
    fun frame(entry: ActiveEntry): Rectangle? = bounds(entry)?.let { bounds ->
        if (view.ui !is CustomBoundsTreeUI) return@let bounds
        val depth = TreeUtil.getNodeDepth(view, TreePath(entry.path))
        val x = view.insets.left + ActiveTreePainter.step(depth)
        Rectangle(x, bounds.y, (view.width - view.insets.right - x).coerceAtLeast(0), bounds.height)
    }

    /** The public painter's control slot, shared with native painting and headless pointer handling. */
    @RequiresEdt
    fun control(entry: ActiveEntry): Rectangle? = bounds(entry)?.let { bounds ->
        if (view.ui !is CustomBoundsTreeUI) return@let null
        val control = DefaultControl()
        val depth = TreeUtil.getNodeDepth(view, TreePath(entry.path))
        val local = ActiveTreePainter.getControlOffset(control, depth, !entry.allowsChildren)
        if (local < 0) return@let null
        val y = bounds.y + (bounds.height - control.height) / 2
        Rectangle(view.insets.left + local, y, control.width, control.height)
    }

    @RequiresEdt
    fun entry(point: Point): ActiveEntry? =
        (view.getClosestPathForLocation(point.x, point.y)?.lastPathComponent as? ActiveEntry)
            ?.takeIf { frame(it)?.contains(point) == true }

    @RequiresEdt
    fun hits(entry: ActiveEntry): List<ActiveHit> {
        val bounds = bounds(entry)?.takeIf { view.ui is CustomBoundsTreeUI }
        return bounds?.let {
            val selected = view.selectionModel.isPathSelected(TreePath(entry.path))
            val cell = cell(entry)
            val comp = renderer.component(view.state(entry, selected, view.hasFocus(), cell.width))
            comp.setBounds(0, 0, cell.width, cell.height)
            activeLayout(comp)
            activeHitCells(comp, cell.x, cell.y)
        }.orEmpty()
    }

    @RequiresEdt
    fun hit(event: java.awt.event.MouseEvent, enabled: Boolean): ActiveTreeHit? = entry(event.point)?.let { entry ->
        val cell = hits(entry).firstOrNull { (!enabled || it.enabled) && it.bounds.contains(event.point) }
        ActiveTreeHit(entry, cell?.id)
    }
}

internal data class ActiveTreeHit(val entry: ActiveEntry, val id: String?)
