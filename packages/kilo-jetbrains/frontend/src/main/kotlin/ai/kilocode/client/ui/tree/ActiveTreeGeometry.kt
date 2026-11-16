package ai.kilocode.client.ui.tree

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.active.ActiveHit
import ai.kilocode.client.ui.active.activeLayout
import ai.kilocode.client.ui.active.activePlaceholder
import ai.kilocode.client.session.ui.PickerRow
import com.intellij.openapi.util.SystemInfo
import com.intellij.ui.paint.RectanglePainter
import com.intellij.ui.render.RenderingUtil
import com.intellij.ui.tree.ui.CustomBoundsTreeUI
import com.intellij.ui.tree.ui.DefaultControl
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.tree.TreeUtil
import java.awt.Component
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Point
import java.awt.Rectangle
import javax.swing.CellRendererPane
import javax.swing.JComponent
import javax.swing.tree.TreePath

/** Uses the native delegate's painted bounds for both renderer layout and hit regions. */
internal class ActiveTreeGeometry(private val view: ActiveTreeView, private val renderer: ActiveTreeRenderer) {
    private val surface = PickerRow()
    private val pane = CellRendererPane().also { view.add(it) }

    @RequiresEdt
    fun paint(g: Graphics) {
        val clip = g.clipBounds ?: view.visibleRect
        if (clip.isEmpty) return
        val first = view.getClosestRowForLocation(clip.x, clip.y)
        val last = view.getClosestRowForLocation(clip.x, clip.y + clip.height - 1)
        if (first < 0) return
        for (row in first..last) {
            val entry = view.getPathForRow(row).lastPathComponent as? ActiveEntry ?: continue
            paint(g, entry, row)
        }
    }

    @RequiresEdt
    private fun paint(g: Graphics, entry: ActiveEntry, row: Int) {
        val state = view.state(entry, view.isRowSelected(row), view.hasFocus())
        val frame = frame(entry)
        val content = bounds(entry)
        if (frame == null || content == null) return
        val placeholder = view.placeholder(entry)
        if (placeholder || g.clipBounds?.intersects(frame) == false) {
            if (placeholder) activePlaceholder(g, area(entry, cell(entry)))
            rail(g, entry, frame)
            return
        }
        if (state.selectionColor != null) {
            surface.update(view.background, state.selectionColor, true, true)
            if (entry.allowsChildren) surface.selectionArc = 0
            paintLocal(g, surface, area(entry, frame))
        }
        rail(g, entry, frame)
        val path = TreePath(entry.path)
        ActiveTreePainter.paint(
            view, g, view.insets.left, frame.y, frame.width, frame.height,
            DefaultControl(), TreeUtil.getNodeDepth(view, path), !entry.allowsChildren,
            view.isExpanded(path), state.active,
        )
        val stamp = renderer.getTreeCellRendererComponent(
            view, entry, state.selected, view.isExpanded(path), !entry.allowsChildren, row, view.hasFocus(),
        )
        // Hit testing shares this stamp, so lay out the current row before painting it.
        val cell = cell(entry)
        stamp.setBounds(0, 0, cell.width, cell.height)
        activeLayout(stamp)
        paintLocal(g, stamp, cell)
        val lead = !SystemInfo.isMac && !state.selected && view.leadSelectionPath?.lastPathComponent === entry
        if (lead && RenderingUtil.isFocused(view) && g is Graphics2D) {
            val bounds = area(entry, frame)
            g.color = RenderingUtil.getSelectionBackground(view)
            RectanglePainter.DRAW.paint(g, bounds.x, bounds.y, bounds.width, bounds.height, 0)
        }
    }

    /** Section spacing affects paint only, never native row sizes or hit regions. */
    @RequiresEdt
    private fun area(entry: ActiveEntry, bounds: Rectangle) = Rectangle(bounds).apply {
        if (entry.allowsChildren) grow(0, -UiStyle.Gap.xs())
    }

    @RequiresEdt
    private fun rail(g: Graphics, entry: ActiveEntry, bounds: Rectangle) {
        for (section in generateSequence(entry) { it.parent as? ActiveEntry }) {
            val color = section.color?.takeIf { section.allowsChildren } ?: continue
            frame(section)?.let { frame ->
                val box = area(section, frame)
                val top = if (section === entry) box.y else bounds.y
                val last = section === entry && (section.childCount == 0 || !view.isExpanded(TreePath(section.path)))
                val bottom = if (last) box.y + box.height else bounds.y + bounds.height
                g.color = color
                g.fillRect(box.x, top, UiStyle.Gap.xs(), (bottom - top).coerceAtLeast(0))
            }
        }
    }

    @RequiresEdt
    private fun paintLocal(g: Graphics, component: Component, bounds: Rectangle) {
        val stamp = component as? JComponent
        val buffered = stamp?.isDoubleBuffered ?: false
        try {
            // The attached pane propagates the tree's paint flags to buffered renderer children.
            // Painting a detached stamp directly can corrupt the outer frame's buffer strategy.
            pane.paintComponent(g, component, view, bounds.x, bounds.y, bounds.width, bounds.height, false)
        } finally {
            stamp?.isDoubleBuffered = buffered
            pane.removeAll()
        }
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
        // DefaultTreeUI extends the painted control's hit target by two vertical pixels.
        val height = minOf(bounds.height, control.height + 2)
        val y = bounds.y + (bounds.height - height) / 2
        Rectangle(view.insets.left + local, y, control.width, height)
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
            renderer.buttons(cell.x, cell.y)
        }.orEmpty()
    }

    @RequiresEdt
    fun hit(event: java.awt.event.MouseEvent, enabled: Boolean): ActiveTreeHit? = entry(event.point)?.let { entry ->
        val cell = hits(entry).firstOrNull { (!enabled || it.enabled) && it.bounds.contains(event.point) }
        ActiveTreeHit(entry, cell?.id)
    }
}

internal data class ActiveTreeHit(val entry: ActiveEntry, val id: String?)
