package ai.kilocode.client.diff

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.diff.DiffManager
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.ui.ColoredTreeCellRenderer
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.TreeSpeedSearch
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.treeStructure.Tree
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JTree
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.TreeNode
import javax.swing.tree.TreePath

@RequiresEdt
internal fun buildDiffEditor(project: Project, files: List<DiffFileDto>, parent: Disposable): JComponent {
    val panel = DiffManager.getInstance().createRequestPanel(project, parent, null)
    val tree = buildFileTree(files)
    tree.addTreeSelectionListener {
        val node = tree.lastSelectedPathComponent as? DefaultMutableTreeNode ?: return@addTreeSelectionListener
        val file = (node.userObject as? Node)?.file ?: return@addTreeSelectionListener
        panel.setRequest(diffRequest(project, file), file.file)
    }
    files.firstOrNull()?.let {
        panel.setRequest(diffRequest(project, it), it.file)
        selectTreeNode(tree, it.file)
    }

    return OnePixelSplitter(false, 0.25f).apply {
        firstComponent = JBScrollPane(tree)
        secondComponent = panel.component
    }
}

@RequiresEdt
internal fun emptyChangesComponent(): JComponent = JPanel(BorderLayout()).apply {
    add(com.intellij.ui.components.JBLabel(KiloBundle.message("diff.editor.empty")), BorderLayout.CENTER)
}

private fun buildFileTree(files: List<DiffFileDto>): Tree {
    val root = DefaultMutableTreeNode(Node("", "", true, null))
    for (file in files) addFile(root, file)
    val tree = Tree(DefaultTreeModel(root)).apply {
        isRootVisible = false
        showsRootHandles = true
        cellRenderer = Renderer()
    }
    TreeSpeedSearch(tree) { path ->
        val node = path.lastPathComponent as? DefaultMutableTreeNode
        (node?.userObject as? Node)?.name.orEmpty()
    }
    for (i in 0 until tree.rowCount) tree.expandRow(i)
    return tree
}

private fun addFile(root: DefaultMutableTreeNode, file: DiffFileDto) {
    var node = root
    val parts = file.file.split('/').filter { it.isNotBlank() }
    for ((index, part) in parts.withIndex()) {
        val path = parts.take(index + 1).joinToString("/")
        val leaf = index == parts.lastIndex
        val child = child(node, path) ?: DefaultMutableTreeNode(Node(part, path, !leaf, if (leaf) file else null)).also(node::add)
        node = child
    }
}

private fun child(node: DefaultMutableTreeNode, path: String): DefaultMutableTreeNode? {
    for (i in 0 until node.childCount) {
        val child = node.getChildAt(i) as? DefaultMutableTreeNode ?: continue
        if ((child.userObject as? Node)?.path == path) return child
    }
    return null
}

private fun selectTreeNode(tree: Tree, path: String) {
    val node = find(tree.model.root as? DefaultMutableTreeNode ?: return, path) ?: return
    val selection = TreePath(node.path)
    tree.selectionPath = selection
    tree.scrollPathToVisible(selection)
}

private fun find(node: DefaultMutableTreeNode, path: String): DefaultMutableTreeNode? {
    if ((node.userObject as? Node)?.path == path) return node
    for (i in 0 until node.childCount) {
        val found = find(node.getChildAt(i) as? DefaultMutableTreeNode ?: continue, path)
        if (found != null) return found
    }
    return null
}

private data class Node(val name: String, val path: String, val dir: Boolean, val file: DiffFileDto?)

private class Renderer : ColoredTreeCellRenderer() {
    override fun customizeCellRenderer(
        tree: JTree,
        value: Any?,
        selected: Boolean,
        expanded: Boolean,
        leaf: Boolean,
        row: Int,
        hasFocus: Boolean,
    ) {
        val node = value as? DefaultMutableTreeNode ?: return
        val item = node.userObject as? Node ?: return
        icon = if (item.dir) AllIcons.Nodes.Folder else AllIcons.FileTypes.Text
        val file = item.file
        append(item.name.ifBlank { item.path })
        if (file != null) {
            append("  -${file.deletions} +${file.additions}", SimpleTextAttributes.GRAYED_ATTRIBUTES)
        }
    }
}

private val TreeNode.path: Array<TreeNode>
    get() {
        val list = mutableListOf<TreeNode>()
        var node: TreeNode? = this
        while (node != null) {
            list += node
            node = node.parent
        }
        return list.asReversed().toTypedArray()
    }
