package ai.kilocode.client.ui.tree

import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeModel

/** Keyed hierarchy ownership, independent of selection, layout and pointer state. */
internal class ActiveTreeModel {
    val root = DefaultMutableTreeNode(null, true)
    val model = DefaultTreeModel(root, true)
    val entries = LinkedHashMap<String, ActiveEntry>()
    var snapshot: List<ActiveTreeNode> = emptyList()
        private set

    fun keys(nodes: List<ActiveTreeNode>): List<String> = nodes.flatMap {
        listOf(it.item.key) + keys(it.children.orEmpty())
    }

    @RequiresEdt
    fun update(nodes: List<ActiveTreeNode>) {
        val keys = keys(nodes)
        require(keys.size == keys.toSet().size) { "ActiveTree keys must be unique" }
        snapshot = nodes
        sync(nodes)
        entries.keys.retainAll(keys.toSet())
    }

    @RequiresEdt
    fun sync(nodes: List<ActiveTreeNode> = snapshot, parent: DefaultMutableTreeNode = root) {
        val wanted = nodes.map(::node)
        for (index in parent.childCount - 1 downTo 0) {
            val child = parent.getChildAt(index) as ActiveEntry
            if (child !in wanted) model.removeNodeFromParent(child)
        }
        wanted.forEachIndexed { index, node ->
            if (node.parent !== parent || parent.getIndex(node) != index) move(node, parent, index)
        }
        nodes.forEachIndexed { index, spec ->
            spec.children?.let { sync(it, wanted[index]) }
        }
    }

    @RequiresEdt
    fun move(node: ActiveEntry, parent: DefaultMutableTreeNode, index: Int) {
        if (node.parent != null) model.removeNodeFromParent(node)
        model.insertNodeInto(node, parent, minOf(index, parent.childCount))
    }

    @RequiresEdt
    private fun node(spec: ActiveTreeNode): ActiveEntry {
        val entry = entries.getOrPut(spec.item.key) { ActiveEntry(spec.item.key, spec.item, spec.branch) }
        if (entry.item != spec.item) {
            entry.item = spec.item
            model.nodeChanged(entry)
        }
        if (entry.allowsChildren != spec.branch) {
            if (!spec.branch) {
                for (index in entry.childCount - 1 downTo 0) {
                    model.removeNodeFromParent(entry.getChildAt(index) as DefaultMutableTreeNode)
                }
            }
            entry.allowsChildren = spec.branch
            model.nodeStructureChanged(entry)
        }
        return entry
    }
}
