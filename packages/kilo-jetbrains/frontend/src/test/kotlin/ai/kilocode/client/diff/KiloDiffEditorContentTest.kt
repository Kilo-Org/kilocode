package ai.kilocode.client.diff

import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.treeStructure.Tree
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Container
import javax.swing.SwingUtilities
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.TreePath

class KiloDiffEditorContentTest : BasePlatformTestCase() {
    fun `test tree toolbar shows aggregate badge`() {
        val parent = Disposer.newDisposable()
        try {
            val view = buildDiffEditor(project, files(), parent, "feature/test")
            val badges = components(view).filterIsInstance<DiffStatBadge>()

            assertTrue(badges.any { it.addedLabelForTest().text == "+5" && it.removedLabelForTest().text == "-4" })
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test tree renderer shows compact row change badge`() {
        val parent = Disposer.newDisposable()
        try {
            val view = buildDiffEditor(project, files(), parent, "feature/test")
            val tree = components(view).filterIsInstance<Tree>().single()
            val badge = rowBadge(renderer(tree, leaf(tree)))

            assertTrue(badge.isVisible)
            assertTrue(badge.preferredSize.height < DiffStatBadge(1, 1).preferredSize.height)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test row renderer places badge east of filename`() {
        val parent = Disposer.newDisposable()
        try {
            val view = buildDiffEditor(project, files(), parent, "feature/test")
            val tree = components(view).filterIsInstance<Tree>().single()
            val row = renderer(tree, leaf(tree)) as Container
            val layout = row.layout as BorderLayout
            val east = layout.getLayoutComponent(BorderLayout.EAST)
            val center = layout.getLayoutComponent(BorderLayout.CENTER)

            assertTrue(east is DiffStatBadge)
            assertNotNull(center)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test row badge hidden when node has no changes`() {
        val parent = Disposer.newDisposable()
        try {
            val view = buildDiffEditor(project, listOf(file("src/Empty.kt", 0, 0)), parent, "feature/test")
            val tree = components(view).filterIsInstance<Tree>().single()
            val badge = rowBadge(renderer(tree, leaf(tree)))

            assertFalse(badge.isVisible)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test tree expands all rows on show`() {
        val parent = Disposer.newDisposable()
        try {
            val view = buildDiffEditor(project, files(), parent, "feature/test")
            val tree = components(view).filterIsInstance<Tree>().single()

            assertEquals(4, tree.rowCount)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test tree paints tool window background`() {
        val parent = Disposer.newDisposable()
        try {
            val view = buildDiffEditor(project, files(), parent, "feature/test")
            val tree = components(view).filterIsInstance<Tree>().single()
            val scroll = SwingUtilities.getAncestorOfClass(JBScrollPane::class.java, tree) as JBScrollPane
            val row = (scroll.parent.layout as BorderLayout).getLayoutComponent(BorderLayout.NORTH) as Container
            val toolbar = (row.layout as BorderLayout).getLayoutComponent(BorderLayout.WEST)

            assertTrue(tree.isOpaque)
            assertEquals(JBUI.CurrentTheme.ToolWindow.background(), tree.background)
            assertEquals(JBUI.CurrentTheme.ToolWindow.background(), row.background)
            assertEquals(JBUI.CurrentTheme.ToolWindow.background(), toolbar.background)
            assertEquals(0, scroll.border.getBorderInsets(scroll).top)
            assertEquals(0, scroll.border.getBorderInsets(scroll).left)
            assertEquals(0, scroll.border.getBorderInsets(scroll).bottom)
            assertEquals(0, scroll.border.getBorderInsets(scroll).right)
            assertEquals(0, scroll.viewportBorder.getBorderInsets(scroll).top)
            assertEquals(0, scroll.viewportBorder.getBorderInsets(scroll).left)
            assertEquals(0, scroll.viewportBorder.getBorderInsets(scroll).bottom)
            assertEquals(0, scroll.viewportBorder.getBorderInsets(scroll).right)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test row renderer reuses badge instance`() {
        val parent = Disposer.newDisposable()
        try {
            val view = buildDiffEditor(project, files(), parent, "feature/test")
            val tree = components(view).filterIsInstance<Tree>().single()
            val leaf = leaf(tree)
            val first = renderer(tree, leaf)
            val second = renderer(tree, leaf)

            assertSame(first, second)
            assertSame(rowBadge(first), rowBadge(second))
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test branch is included in diff title`() {
        val request = diffRequest(project, file("src/App.kt", 1, 1), "feature/test")

        assertEquals("src/App.kt (feature/test)", request.title)
    }

    private fun renderer(tree: Tree, node: DefaultMutableTreeNode): Component =
        tree.cellRenderer.getTreeCellRendererComponent(
            tree,
            node,
            false,
            tree.isExpanded(TreePath(node.path)),
            node.isLeaf,
            0,
            false,
        )

    private fun leaf(tree: Tree): DefaultMutableTreeNode {
        val root = tree.model.root as DefaultMutableTreeNode
        val src = root.getChildAt(0) as DefaultMutableTreeNode
        return src.getChildAt(0) as DefaultMutableTreeNode
    }

    private fun rowBadge(row: Component): DiffStatBadge = components(row).filterIsInstance<DiffStatBadge>().single()

    private fun components(root: Component): List<Component> {
        val out = mutableListOf<Component>()
        fun visit(node: Component) {
            out.add(node)
            if (node is Container) node.components.forEach(::visit)
        }
        visit(root)
        return out
    }

    private fun files() = listOf(
        file("src/App.kt", 2, 1),
        file("test/AppTest.kt", 3, 3),
    )

    private fun file(path: String, additions: Int, deletions: Int) = DiffFileDto(
        file = path,
        additions = additions,
        deletions = deletions,
        patch = "@@ -1 +1 @@\n-old\n+new",
    )
}
