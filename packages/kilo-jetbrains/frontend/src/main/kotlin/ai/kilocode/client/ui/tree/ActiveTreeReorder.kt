package ai.kilocode.client.ui.tree

import ai.kilocode.client.ui.active.ActiveMove
import ai.kilocode.client.ui.active.ActiveReorder
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Point
import javax.swing.tree.TreePath

/** A drag is a sibling-only preview; cancellation reconciles the authoritative snapshot. */
internal class ActiveTreeReorder(private val view: ActiveTreeView, private val options: ActiveReorder?) {
    private data class Preview(val key: String, val parent: ActiveEntry, val from: Int, val to: Int)
    private var preview: Preview? = null

    fun placeholder(entry: ActiveEntry): Boolean = preview?.key == entry.key

    @RequiresEdt
    fun pick(point: Point): String? = view.regions.entry(point)?.takeIf {
        view.isEnabled && preview == null && movable(it) &&
            view.regions.hits(it).none { hit -> hit.enabled && hit.bounds.contains(point) }
    }?.key

    private fun movable(entry: ActiveEntry): Boolean =
        !entry.allowsChildren && !entry.item.disabled && entry.item.progress == null &&
            options?.movable?.invoke(entry.item) == true

    @RequiresEdt
    fun over(key: String, point: Point): Boolean {
        val entry = view.hierarchy.entries[key]
        val parent = entry?.parent as? ActiveEntry
        val siblings = parent?.let(::siblings).orEmpty()
        val expanded = parent != null && view.isExpanded(TreePath(parent.path))
        if (entry == null || !expanded || !movable(entry)) {
            cancel()
            return false
        }
        val from = siblings.indexOf(entry)
        val index = siblings.indexOfFirst {
            view.regions.bounds(it)?.let { bounds -> point.y <= bounds.y + bounds.height / 2 } == true
        }.takeIf { it >= 0 } ?: siblings.size
        val to = (index - if (index > from) 1 else 0).coerceIn(0, siblings.size - 1)
        val blocked = (minOf(from, to)..maxOf(from, to)).any { !movable(siblings[it]) }
        if (blocked) {
            cancel()
        }
        val next = Preview(key, parent, preview?.from ?: from, to)
        if (!blocked && next != preview) {
            preview = next
            view.preview { view.hierarchy.move(entry, parent, to) }
            view.selectionModel.selectionPath = TreePath(entry.path)
        }
        return !blocked
    }

    @RequiresEdt
    fun refresh() {
        preview?.let { state ->
            val entry = view.hierarchy.entries[state.key]
            if (entry?.parent === state.parent && view.isExpanded(TreePath(state.parent.path))) {
                view.hierarchy.move(entry, state.parent, state.to)
            } else preview = null
        }
    }

    @RequiresEdt
    fun drop() {
        preview?.let { state ->
            preview = null
            val siblings = siblings(state.parent)
            val index = siblings.indexOfFirst { it.key == state.key }
            view.repaint()
            if (index >= 0 && index != state.from) {
                options?.onMove?.invoke(ActiveMove(state.key, state.from, index, siblings.map { it.key }))
            }
        }
    }

    @RequiresEdt
    fun cancel() {
        if (preview != null) {
            preview = null
            view.preview { view.hierarchy.sync() }
        }
    }

    private fun siblings(parent: ActiveEntry): List<ActiveEntry> =
        (0 until parent.childCount).map { parent.getChildAt(it) as ActiveEntry }
}
