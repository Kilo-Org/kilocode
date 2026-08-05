package ai.kilocode.client.diff

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.diff.contents.DiffContent
import com.intellij.diff.contents.DocumentContent
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.openapi.actionSystem.ActionToolbar
import com.intellij.openapi.actionSystem.Separator
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vcs.FileStatus
import com.intellij.ui.SimpleColoredComponent
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.components.JBLabel
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

    fun `test tree toolbar shows changed file count`() {
        val parent = Disposer.newDisposable()
        try {
            val view = view(files(), parent)

            assertTrue(components(view).filterIsInstance<JBLabel>().any { it.text == "2 files" })
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test tree toolbar shows singular changed file count`() {
        val parent = Disposer.newDisposable()
        try {
            val view = view(listOf(file("src/App.kt", 2, 1)), parent)

            assertTrue(components(view).filterIsInstance<JBLabel>().any { it.text == "1 file" })
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

    fun `test tree renderer uses file status color`() {
        val parent = Disposer.newDisposable()
        try {
            val color = FileStatus.ADDED.color ?: return
            val view = view(listOf(file("src/App.kt", 2, 0, status = "added")), parent)
            val tree = components(view).filterIsInstance<Tree>().single()
            val row = renderer(tree, leaf(tree))
            val text = components(row).filterIsInstance<SimpleColoredComponent>().single()
            val iter = text.iterator()

            assertTrue(iter.hasNext())
            iter.next()
            assertEquals(color, iter.textAttributes.fgColor)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test explicit and patch-derived file statuses`() {
        assertEquals(FileStatus.ADDED, fileStatus(file("src/New.kt", 1, 0, status = "added")))
        assertEquals(FileStatus.MODIFIED, fileStatus(file("src/App.kt", 1, 1, status = "modified")))
        assertEquals(FileStatus.DELETED, fileStatus(file("src/Old.kt", 0, 1, status = "deleted")))
        assertEquals(FileStatus.UNKNOWN, fileStatus(file("src/Unknown.kt", 1, 0, status = "untracked")))
        assertEquals(FileStatus.ADDED, fileStatus(file("src/New.kt", 1, 0, patch = "--- /dev/null\n+++ b/src/New.kt")))
        assertEquals(FileStatus.DELETED, fileStatus(file("src/Old.kt", 0, 1, patch = "--- a/src/Old.kt\n+++ /dev/null")))
        assertEquals(FileStatus.MODIFIED, fileStatus(file("src/App.kt", 1, 1, patch = "@@ -1 +1 @@\n-old\n+new")))
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

    fun `test folder badge shows only while collapsed`() {
        val parent = Disposer.newDisposable()
        try {
            val view = view(files(), parent)
            val tree = components(view).filterIsInstance<Tree>().single()
            val folder = folder(tree)

            tree.expandPath(TreePath(folder.path))
            assertFalse("expanded folder hides its rolled-up badge", rowBadge(renderer(tree, folder)).isVisible)

            tree.collapsePath(TreePath(folder.path))
            assertTrue("collapsed folder shows its rolled-up badge", rowBadge(renderer(tree, folder)).isVisible)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test folder row width tracks its badge visibility`() {
        val parent = Disposer.newDisposable()
        try {
            val view = view(files(), parent)
            val tree = components(view).filterIsInstance<Tree>().single()
            val path = TreePath(folder(tree).path)

            tree.expandPath(path)
            val expanded = tree.getPathBounds(path)!!.width

            // Collapsing re-shows the rolled-up badge, so the folder row's measured width must grow.
            // This expansion-dependent width is why buildFileTree invalidates JTree's layout cache on
            // toggle: a displayed tree caches path bounds across expand/collapse and would otherwise
            // paint the row at its stale narrower width, squeezing the name.
            tree.collapsePath(path)
            val collapsed = tree.getPathBounds(path)!!.width

            assertTrue("collapsed folder row must be wider to fit its badge", collapsed > expanded)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test leaf badge stays visible while its folder is expanded`() {
        val parent = Disposer.newDisposable()
        try {
            val view = view(files(), parent)
            val tree = components(view).filterIsInstance<Tree>().single()
            tree.expandPath(TreePath(folder(tree).path))

            assertTrue(rowBadge(renderer(tree, leaf(tree))).isVisible)
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

    fun `test tree toolbar installs actions in order`() {
        val parent = Disposer.newDisposable()
        try {
            // Assert against the toolbar the view actually installs (not a freshly built group), so
            // this guards the real regression: the tree toolbar losing or rewiring its actions.
            val view = view(files(), parent)
            val tree = components(view).filterIsInstance<Tree>().single()
            val scroll = SwingUtilities.getAncestorOfClass(JBScrollPane::class.java, tree) as JBScrollPane
            val row = (scroll.parent.layout as BorderLayout).getLayoutComponent(BorderLayout.NORTH) as Container
            val toolbar = (row.layout as BorderLayout).getLayoutComponent(BorderLayout.WEST) as ActionToolbar
            val actions = toolbar.actionGroup.getChildren(null).toList()
            assertEquals(KiloBundle.message("diff.editor.refresh"), actions[0].templatePresentation.text)
            assertTrue(actions[1] is Separator)
            assertEquals(KiloBundle.message("diff.editor.tree.expandAll"), actions[2].templatePresentation.text)
            assertEquals(KiloBundle.message("diff.editor.tree.collapseAll"), actions[3].templatePresentation.text)
            assertEquals(4, actions.size)
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

    fun `test diff request shows placeholder for blank added patch`() {
        val request = diffRequest(project, file("src/New.kt", 1, 0, patch = "", status = "added")) as SimpleDiffRequest
        val contents = request.contents.map(::content)

        assertEquals("", contents[0])
        assertEquals(KiloBundle.message("diff.editor.patch.unavailable"), contents[1])
    }

    fun `test diff request reconstructs added patch content`() {
        val patch = "--- src/New.kt\n+++ src/New.kt\n@@ -0,0 +1,2 @@\n+hello\n+world"
        val request = diffRequest(project, file("src/New.kt", 2, 0, patch = patch, status = "added")) as SimpleDiffRequest
        val contents = request.contents.map(::content)

        assertEquals("", contents[0])
        assertEquals("hello\nworld", contents[1])
    }

    fun `test tree displays absolute files relative to workspace`() {
        val parent = Disposer.newDisposable()
        try {
            val dir = project.basePath.orEmpty()
            val view = view(listOf(file("$dir/pkg/ui/list/ActiveListRenderer.kt", 4, 1)), parent, dir)
            val tree = components(view).filterIsInstance<Tree>().single()
            val root = tree.model.root as DefaultMutableTreeNode
            val top = root.getChildAt(0) as DefaultMutableTreeNode
            val leaf = top.getChildAt(0) as DefaultMutableTreeNode

            assertEquals("pkg/ui/list", text(tree, top))
            assertEquals("ActiveListRenderer.kt", text(tree, leaf))
            assertEquals(2, tree.rowCount)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test tree compacts single-child directory chains`() {
        val parent = Disposer.newDisposable()
        try {
            val view = view(listOf(file("a/b/c/One.kt", 1, 0), file("a/b/c/Two.kt", 2, 0)), parent)
            val tree = components(view).filterIsInstance<Tree>().single()
            val root = tree.model.root as DefaultMutableTreeNode
            val top = root.getChildAt(0) as DefaultMutableTreeNode

            assertEquals("a/b/c", text(tree, top))
            assertEquals("One.kt", text(tree, top.getChildAt(0) as DefaultMutableTreeNode))
            assertEquals("Two.kt", text(tree, top.getChildAt(1) as DefaultMutableTreeNode))
            assertEquals(3, tree.rowCount)
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test tree stops compacting at branch`() {
        val parent = Disposer.newDisposable()
        try {
            val view = view(listOf(file("a/b/c/One.kt", 1, 0), file("a/x/Two.kt", 2, 0)), parent)
            val tree = components(view).filterIsInstance<Tree>().single()
            val root = tree.model.root as DefaultMutableTreeNode
            val a = root.getChildAt(0) as DefaultMutableTreeNode

            assertEquals("a", text(tree, a))
            assertEquals("b/c", text(tree, a.getChildAt(0) as DefaultMutableTreeNode))
            assertEquals("x", text(tree, a.getChildAt(1) as DefaultMutableTreeNode))
        } finally {
            Disposer.dispose(parent)
        }
    }

    fun `test diff params includes inline token`() {
        val params = diffParams("inline", "/repo", "ses_1", "Session Changes", token = "tool:ses_1:p1")

        assertEquals("inline", params["source"])
        assertEquals("/repo", params["directory"])
        assertEquals("ses_1", params["sessionId"])
        assertEquals("Session Changes", params["title"])
        assertEquals("tool:ses_1:p1", params["token"])
    }

    fun `test inline params require directory and token`() {
        assertTrue(KiloDiffEditorKind.isValid(diffParams("inline", "/repo", null, "Session Changes", token = "turn:ses_1:u1")))
        assertFalse(KiloDiffEditorKind.isValid(mapOf("source" to "inline", "directory" to "/repo", "title" to "Session Changes")))
        assertFalse(KiloDiffEditorKind.isValid(mapOf("source" to "inline", "token" to "turn:ses_1:u1", "title" to "Session Changes")))
    }

    fun `test inline editor title uses params title`() {
        assertEquals("Session Changes", KiloDiffEditorKind.title(diffParams("inline", "/repo", null, "Session Changes", token = "token")))
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

    fun `test reverse sync skips active requested path`() {
        assertNull(reverseSyncTarget("src/App.kt", "src/App.kt", "test/AppTest.kt"))
    }

    fun `test reverse sync waits while requested path is pending`() {
        assertNull(reverseSyncTarget("src/App.kt", "test/AppTest.kt", "src/App.kt"))
    }

    fun `test reverse sync returns active path for diff-driven navigation`() {
        assertEquals("test/AppTest.kt", reverseSyncTarget("test/AppTest.kt", null, "src/App.kt"))
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

    private fun folder(tree: Tree): DefaultMutableTreeNode {
        val root = tree.model.root as DefaultMutableTreeNode
        return root.getChildAt(0) as DefaultMutableTreeNode
    }

    private fun leaf(tree: Tree): DefaultMutableTreeNode =
        folder(tree).getChildAt(0) as DefaultMutableTreeNode

    private fun rowBadge(row: Component): DiffStatBadge = components(row).filterIsInstance<DiffStatBadge>().single()

    private fun banner(editor: DiffEditorView): EditorNotificationPanel = components(editor.component)
        .filterIsInstance<EditorNotificationPanel>()
        .single()

    private fun text(tree: Tree, node: DefaultMutableTreeNode): String {
        val row = renderer(tree, node)
        val text = components(row).filterIsInstance<SimpleColoredComponent>().single()
        val iter = text.iterator()
        if (!iter.hasNext()) return ""
        iter.next()
        return iter.fragment
    }

    private fun content(content: DiffContent): String = (content as? DocumentContent)?.document?.text.orEmpty()

    private fun view(files: List<DiffFileDto>, parent: Disposable, dir: String = project.basePath.orEmpty()): Component = editor(files, parent, dir).component

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

    private fun file(
        path: String,
        additions: Int,
        deletions: Int,
        patch: String? = "@@ -1 +1 @@\n-old\n+new",
        status: String? = null,
    ) = DiffFileDto(
        file = path,
        additions = additions,
        deletions = deletions,
        patch = patch,
        status = status,
    )
}
