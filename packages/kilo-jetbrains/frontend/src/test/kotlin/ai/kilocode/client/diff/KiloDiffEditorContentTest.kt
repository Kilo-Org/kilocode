package ai.kilocode.client.diff

import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.treeStructure.Tree
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
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
            val view = view(files(), parent)
            val badges = components(view).filterIsInstance<DiffStatBadge>()

            assertTrue(badges.any { it.addedLabelForTest().text == "+5" && it.removedLabelForTest().text == "-4" })
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test tree renderer shows compact row change badge`() {
        val parent = Disposer.newDisposable()
        try {
            val view = view(files(), parent)
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
            val view = view(files(), parent)
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
            val view = view(listOf(file("src/Empty.kt", 0, 0)), parent)
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
            val view = view(files(), parent)
            val tree = components(view).filterIsInstance<Tree>().single()

            assertEquals(4, tree.rowCount)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test tree paints tool window background`() {
        val parent = Disposer.newDisposable()
        try {
            val view = view(files(), parent)
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
            val view = view(files(), parent)
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

    fun `test reload updates aggregate badge`() {
        val parent = Disposer.newDisposable()
        try {
            val editor = editor(files(), parent)

            editor.applyFiles(listOf(file("src/App.kt", 7, 6)), "feature/test")
            val badges = components(editor.component).filterIsInstance<DiffStatBadge>()

            assertTrue(badges.any { it.addedLabelForTest().text == "+7" && it.removedLabelForTest().text == "-6" })
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test reload preserves selected file`() {
        val parent = Disposer.newDisposable()
        try {
            val editor = editor(files(), parent)
            val tree = components(editor.component).filterIsInstance<Tree>().single()
            tree.selectionPath = TreePath(leaf(tree).path)

            editor.applyFiles(
                listOf(file("src/App.kt", 4, 2), file("test/AppTest.kt", 1, 1)),
                "feature/test",
            )

            assertSame(leaf(tree), tree.lastSelectedPathComponent)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test outdated banner is hidden initially`() {
        val parent = Disposer.newDisposable()
        try {
            val editor = editor(files(), parent)

            assertFalse(banner(editor).isVisible)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test outdated banner appears when files change`() {
        val parent = Disposer.newDisposable()
        try {
            val editor = editor(files(), parent)

            editor.markOutdated()
            UIUtil.dispatchAllInvocationEvents()

            assertTrue(banner(editor).isVisible)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test outdated banner appears for unsaved ide document changes`() {
        val parent = Disposer.newDisposable()
        try {
            val psi = myFixture.addFileToProject("src/App.kt", "old")
            val doc = FileDocumentManager.getInstance().getDocument(psi.virtualFile)!!
            val dir = psi.virtualFile.parent.parent.path
            val editor = editor(files(), parent, dir = dir)

            ApplicationManager.getApplication().runWriteAction { doc.setText("new") }
            UIUtil.dispatchAllInvocationEvents()

            assertTrue(banner(editor).isVisible)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test manual refresh clears banner and updates files`() {
        val parent = Disposer.newDisposable()
        try {
            val next = listOf(file("src/App.kt", 9, 8))
            val editor = editor(files(), parent) { done ->
                done(DiffEditorData.Files(next, "feature/test"))
                Job().also { it.complete() }
            }
            editor.markOutdated()
            UIUtil.dispatchAllInvocationEvents()

            editor.refresh()
            val badges = components(editor.component).filterIsInstance<DiffStatBadge>()

            assertFalse(banner(editor).isVisible)
            assertTrue(badges.any { it.addedLabelForTest().text == "+9" && it.removedLabelForTest().text == "-8" })
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test editor construction does not refresh`() {
        val parent = Disposer.newDisposable()
        var calls = 0
        try {
            editor(files(), parent) {
                calls += 1
                Job().also { it.complete() }
            }

            assertEquals(0, calls)
        } finally {
            Disposer.dispose(parent)
        }
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

    private fun banner(editor: DiffEditorView): EditorNotificationPanel = components(editor.component)
        .filterIsInstance<EditorNotificationPanel>()
        .single()

    private fun view(files: List<DiffFileDto>, parent: Disposable): Component = editor(files, parent).component

    private fun editor(
        files: List<DiffFileDto>,
        parent: Disposable,
        dir: String = project.basePath.orEmpty(),
        load: ((DiffEditorData) -> Unit) -> Job = { Job().also { it.complete() } },
    ): DiffEditorView {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        Disposer.register(parent) { scope.cancel() }
        return DiffEditorView(
            project,
            mapOf("directory" to dir, "source" to "branch"),
            files,
            parent,
            "feature/test",
            scope,
            load,
        ) {}
    }

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
