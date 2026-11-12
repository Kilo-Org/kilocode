package ai.kilocode.client.ui.tree

import ai.kilocode.client.ui.active.ActiveMove
import ai.kilocode.client.ui.active.ActiveReorder
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Point
import java.awt.Rectangle
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.TreePath

/** A drag previews the hierarchy; cancellation reconciles the authoritative snapshot. */
internal class ActiveTreeReorder(private val view: ActiveTreeView, private val options: ActiveReorder?) {
    private data class Preview(
        val key: String, val previous: String?, val parent: String?, val from: Int, val to: Int,
        val order: List<ActiveEntry>, val area: Rectangle?,
    )
    private data class Target(val parent: DefaultMutableTreeNode, val index: Int, val area: Rectangle? = null)
    private var preview: Preview? = null
    private val opened = linkedSetOf<String>()

    fun placeholder(entry: ActiveEntry): Boolean = preview?.key == entry.key

    @RequiresEdt
    fun pick(point: Point): String? = view.regions.entry(point)?.takeIf {
        view.isEnabled && preview == null && movable(it) &&
            view.regions.hits(it).none { hit -> hit.enabled && hit.bounds.contains(point) }
    }?.key

    private fun movable(entry: ActiveEntry): Boolean =
        (!entry.allowsChildren || options?.reparent != null) && !entry.item.disabled && entry.item.progress == null &&
            options?.pinned?.invoke(entry.item) != true && options?.movable?.invoke(entry.item) == true

    @RequiresEdt
    fun over(key: String, point: Point): Boolean {
        val entry = view.hierarchy.entries[key]
        val source = entry?.parent as? DefaultMutableTreeNode
        if (entry == null || source == null || !movable(entry) ||
            options?.reparent == null && !expanded(source)) {
            cancel()
            return false
        }
        val state = preview
        // Preview insertion can shift the header away from a stationary pointer.
        val area = state?.area?.takeIf { it.contains(point) }
        val target = if (area != null) {
            Target(source, source.getIndex(entry), area)
        } else if (options?.reparent == null) {
            val siblings = siblings(source)
            val index = siblings.indexOfFirst {
                view.regions.bounds(it)?.let { bounds -> point.y <= bounds.y + bounds.height / 2 } == true
            }.takeIf { it >= 0 } ?: siblings.size
            Target(source, index)
        } else target(entry, point)
        if (target == null || !allowed(entry, target.parent)) {
            cancel()
            return false
        }
        val from = source.getIndex(entry)
        val order = state?.order ?: siblings(source)
        val same = source === target.parent
        val siblings = siblings(target.parent)
        val to = (target.index - if (same && target.index > from) 1 else 0)
            .coerceIn(0, siblings.size - if (same) 1 else 0)
        val previous = if (state != null) state.previous else (source as? ActiveEntry)?.key
        val parent = (target.parent as? ActiveEntry)?.key
        val start = state?.from ?: from
        // Returning from another parent must still respect the original fixed sibling segment.
        val blocked = to < siblings.takeWhile { options?.pinned?.invoke(it.item) == true }.size ||
            same && (minOf(from, to)..maxOf(from, to)).any { !movable(siblings[it]) } ||
            parent == previous && (minOf(start, to)..maxOf(start, to)).any { !movable(order[it]) }
        if (blocked) {
            cancel()
            return false
        }
        val next = Preview(key, previous, parent, start, to, order, target.area)
        if (next != preview) {
            preview = next
            view.preview {
                move(entry, target.parent, to)
                view.selectionModel.selectionPath = TreePath(entry.path)
            }
        }
        return true
    }

    /** Header edges insert beside a branch; only its central body accepts children. */
    @RequiresEdt
    private fun target(entry: ActiveEntry, point: Point): Target? {
        var row = view.getClosestPathForLocation(point.x, point.y)?.lastPathComponent as? ActiveEntry
            ?: return Target(view.hierarchy.root, 0)
        val bounds = view.regions.bounds(row) ?: return null
        if (point.y < bounds.y) return Target(view.hierarchy.root, 0)
        if (point.y >= bounds.y + bounds.height) return Target(view.hierarchy.root, view.hierarchy.root.childCount)
        val cell = view.regions.cell(row)
        val top = cell.y + cell.height / 4
        val bottom = cell.y + cell.height * 3 / 4
        if (row.allowsChildren && cell.contains(point) && view.regions.control(row)?.contains(point) != true &&
            point.y >= top && point.y < bottom &&
            allowed(entry, row)) {
            return Target(row, row.childCount, Rectangle(cell.x, top, cell.width, bottom - top))
        }
        // A gutter drop, or a branch that cannot enter another branch, targets the containing
        // sibling as a unit. In particular, an expanded section's descendants cannot be split.
        while (row.parent is ActiveEntry &&
            (point.x < (view.regions.frame(row)?.x ?: cell.x) ||
                !allowed(entry, row.parent as DefaultMutableTreeNode))) {
            row = row.parent as ActiveEntry
        }
        val parent = row.parent as? DefaultMutableTreeNode ?: return null
        val frame = view.regions.bounds(row) ?: return null
        val after = point.y >= frame.y + frame.height / 2
        return Target(parent, parent.getIndex(row) + if (after) 1 else 0)
    }

    @RequiresEdt
    private fun allowed(entry: ActiveEntry, parent: DefaultMutableTreeNode): Boolean {
        if (parent.path.any { it === entry }) return false
        val reparent = options?.reparent ?: return entry.parent === parent
        return reparent(entry.item, (parent as? ActiveEntry)?.item)
    }

    @RequiresEdt
    fun refresh() {
        preview?.let { state ->
            val entry = view.hierarchy.entries[state.key]
            val source = parent(state.previous)
            val parent = parent(state.parent)
            if (entry == null || source == null || parent == null || entry.parent !== source ||
                !movable(entry) || !allowed(entry, parent) || options?.reparent == null && !expanded(parent)) {
                cancel()
                return
            }
            val from = source.getIndex(entry)
            val to = state.to.coerceIn(0, parent.childCount - if (source === parent) 1 else 0)
            val order = siblings(source)
            val siblings = siblings(parent)
            if (to < siblings.takeWhile { options?.pinned?.invoke(it.item) == true }.size ||
                source === parent && (minOf(from, to)..maxOf(from, to)).any { !movable(siblings[it]) }) {
                cancel()
                return
            }
            preview = state.copy(from = from, to = to, order = order)
            view.preview { move(entry, parent, to) }
        }
    }

    @RequiresEdt
    fun drop() {
        // A successful drop keeps sections that were opened to reveal its preview.
        opened.clear()
        preview?.let { state ->
            preview = null
            val parent = parent(state.parent) ?: return
            val siblings = siblings(parent)
            val index = siblings.indexOfFirst { it.key == state.key }
            view.repaint()
            if (index >= 0 && (index != state.from || state.parent != state.previous)) {
                options?.onMove?.invoke(ActiveMove(state.key, state.from, index, siblings.map { it.key },
                    state.parent, state.previous))
            }
        }
    }

    @RequiresEdt
    fun cancel() {
        if (preview != null) {
            preview = null
            val collapsed = opened.toSet()
            opened.clear()
            view.preview(collapsed) {
                val selected = view.selectedKeys()
                view.hierarchy.sync()
                view.selectionModel.selectionPaths = selected.mapNotNull { key ->
                    view.hierarchy.entries[key]?.takeIf { it.root === view.hierarchy.root }?.let { TreePath(it.path) }
                }.toTypedArray()
            }
        }
    }

    @RequiresEdt
    private fun move(entry: ActiveEntry, parent: DefaultMutableTreeNode, index: Int) {
        val branch = (parent as? ActiveEntry)?.takeUnless { expanded(it) }
        view.hierarchy.move(entry, parent, index)
        if (branch == null) return
        // Keep the placeholder visible under subsequent drag events after its old row disappears.
        opened += branch.key
        view.expandPath(TreePath(branch.path))
    }

    @RequiresEdt
    private fun parent(key: String?): DefaultMutableTreeNode? =
        if (key == null) view.hierarchy.root else view.hierarchy.entries[key]?.takeIf { it.allowsChildren }

    @RequiresEdt
    private fun expanded(parent: DefaultMutableTreeNode): Boolean =
        parent === view.hierarchy.root || view.isExpanded(TreePath(parent.path))

    @RequiresEdt
    private fun siblings(parent: DefaultMutableTreeNode): List<ActiveEntry> =
        (0 until parent.childCount).map { parent.getChildAt(it) as ActiveEntry }
}
