package ai.kilocode.client.diff

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.diff.DiffManager
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.TreeSpeedSearch
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.treeStructure.Tree
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Component
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.JTree
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.TreeCellRenderer
import javax.swing.tree.TreeNode
import javax.swing.tree.TreePath

@RequiresEdt
internal fun buildDiffEditor(project: Project, files: List<DiffFileDto>, parent: Disposable, branch: String? = null): JComponent {
    val panel = DiffManager.getInstance().createRequestPanel(project, parent, null)
    val tree = buildFileTree(files)
    tree.addTreeSelectionListener {
        val node = tree.lastSelectedPathComponent as? DefaultMutableTreeNode ?: return@addTreeSelectionListener
        val file = (node.userObject as? Node)?.file ?: return@addTreeSelectionListener
        panel.setRequest(diffRequest(project, file, branch), diffTitle(file.file, branch))
    }
    files.firstOrNull()?.let {
        panel.setRequest(diffRequest(project, it, branch), diffTitle(it.file, branch))
        selectTreeNode(tree, it.file)
    }

    return OnePixelSplitter(false, 0.25f).apply {
        firstComponent = buildTreePanel(tree, files)
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
    updateStats(root)
    val tree = Tree(DefaultTreeModel(root)).apply {
        isRootVisible = false
        showsRootHandles = true
        isOpaque = true
        cellRenderer = Renderer()
    }
    TreeSpeedSearch(tree) { path ->
        val node = path.lastPathComponent as? DefaultMutableTreeNode
        (node?.userObject as? Node)?.name.orEmpty()
    }
    expandAll(tree)
    return tree
}

private fun buildTreePanel(tree: Tree, files: List<DiffFileDto>): JComponent {
    val stats = Stats(files.sumOf { it.additions }, files.sumOf { it.deletions })
    val toolbar = ActionManager.getInstance().createActionToolbar(
        ActionPlaces.TOOLBAR,
        DefaultActionGroup(
            TreeAction(KiloBundle.message("diff.editor.tree.expandAll"), AllIcons.Actions.Expandall) { expandAll(tree) },
            TreeAction(KiloBundle.message("diff.editor.tree.collapseAll"), AllIcons.Actions.Collapseall) { collapseAll(tree) },
        ),
        true,
    )
    toolbar.targetComponent = tree
    toolbar.updateActionsImmediately()
    val row = JPanel(BorderLayout()).apply {
        add(toolbar.component, BorderLayout.WEST)
        add(DiffStatBadge(stats.additions, stats.deletions, inset = UiStyle.Gap.pad()), BorderLayout.EAST)
    }
    return JPanel(BorderLayout()).apply {
        add(row, BorderLayout.NORTH)
        add(
            JBScrollPane(tree).apply {
                horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            },
            BorderLayout.CENTER,
        )
    }
}

private fun expandAll(tree: Tree) {
    var i = 0
    while (i < tree.rowCount) {
        tree.expandRow(i)
        i += 1
    }
}

private fun collapseAll(tree: Tree) {
    for (i in tree.rowCount - 1 downTo 0) tree.collapseRow(i)
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

private fun updateStats(node: DefaultMutableTreeNode): Stats {
    val item = node.userObject as? Node ?: return Stats(0, 0)
    if (item.file != null) return Stats(item.additions, item.deletions)
    val stats = (0 until node.childCount)
        .map { updateStats(node.getChildAt(it) as? DefaultMutableTreeNode ?: return@map Stats(0, 0)) }
        .fold(Stats(0, 0)) { acc, child -> Stats(acc.additions + child.additions, acc.deletions + child.deletions) }
    item.additions = stats.additions
    item.deletions = stats.deletions
    return stats
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

private data class Stats(val additions: Int, val deletions: Int)

private class Node(val name: String, val path: String, val dir: Boolean, val file: DiffFileDto?) {
    var additions: Int = file?.additions ?: 0
    var deletions: Int = file?.deletions ?: 0
}

private class Renderer : JPanel(BorderLayout()), TreeCellRenderer {
    private val text = SimpleColoredComponent()
    private val badge = DiffStatBadge(0, 0, DiffStatBadge.Variant.COMPACT)

    init {
        UiStyle.Components.transparent(this, text)
        border = JBUI.Borders.empty(0, UiStyle.Gap.sm(), 0, UiStyle.Gap.xl())
        add(text, BorderLayout.CENTER)
        add(badge, BorderLayout.EAST)
    }

    override fun getTreeCellRendererComponent(
        tree: JTree,
        value: Any?,
        selected: Boolean,
        expanded: Boolean,
        leaf: Boolean,
        row: Int,
        hasFocus: Boolean,
    ): Component {
        val node = value as? DefaultMutableTreeNode
        val item = node?.userObject as? Node
        text.clear()
        text.icon = if (item?.dir == true) AllIcons.Nodes.Folder else AllIcons.FileTypes.Text
        text.append(item?.name?.ifBlank { item.path }.orEmpty())
        val changed = item != null && (item.additions != 0 || item.deletions != 0)
        badge.isVisible = changed
        if (changed) badge.update(item.additions, item.deletions)
        return this
    }
}

private class TreeAction(
    text: String,
    icon: Icon,
    private val action: () -> Unit,
) : DumbAwareAction(text, text, icon) {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun actionPerformed(e: AnActionEvent) = action()
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
