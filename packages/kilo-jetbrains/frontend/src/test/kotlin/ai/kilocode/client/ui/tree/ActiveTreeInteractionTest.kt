package ai.kilocode.client.ui.tree

import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveMove
import ai.kilocode.client.ui.active.ActiveReorder
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.tree.ui.DefaultTreeUI
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Point
import java.awt.event.MouseEvent
import javax.swing.tree.TreePath

class ActiveTreeInteractionTest : BasePlatformTestCase() {
    private data class Row(override val key: String) : ActiveItem {
        override val title = key
    }

    fun `test cancelling downward drag restores selection without notifying owner`() {
        var selections = 0
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", actions = ActiveTreeActions(select = { selections++ }),
            reorder = ActiveReorder({ true }, { moves += it }))
        tree.update(nodes())
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        tree.select("a", false)
        val entry = view.hierarchy.entries.getValue("a")
        view.over("a", Point(100, view.height))
        assertEquals(listOf("b", "c", "a"), keys(view))
        assertTrue(view.placeholder(entry))

        selections = 0
        tree.setLocked(true)

        assertEquals(listOf("a", "b", "c"), keys(view))
        assertEquals(listOf("a"), tree.selectedKeys())
        assertSame(entry, view.selectionPath.lastPathComponent)
        assertFalse(view.placeholder(entry))
        assertEquals(0, selections)
        assertTrue(moves.isEmpty())
    }

    fun `test cancelling drag preserves hidden native selection without revealing ancestors`() {
        var selections = 0
        val tree = ActiveTree("", actions = ActiveTreeActions(select = { selections++ }),
            reorder = ActiveReorder({ true }, {}))
        tree.update(nodes() + ActiveTreeNode(Row("hidden"), listOf(ActiveTreeNode(Row("d")))))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        val path = TreePath(view.hierarchy.entries.getValue("hidden").path)
        view.collapsePath(path)
        tree.select("a", false)
        view.over("a", Point(100, view.height))
        val selected = TreePath(view.hierarchy.entries.getValue("d").path)
        view.selectionModel.selectionPath = selected
        assertFalse(view.isExpanded(path))

        selections = 0
        tree.setLocked(true)

        assertEquals(listOf("a", "b", "c"), keys(view))
        assertEquals(selected, view.selectionPath)
        assertFalse(view.isExpanded(path))
        assertEquals(0, selections)
    }

    fun `test collapsing dragged branch cancels preview without reopening it`() {
        val tree = ActiveTree("", reorder = ActiveReorder({ true }, {}))
        tree.update(nodes())
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        tree.select("a", false)
        view.over("a", Point(100, view.height))
        val path = TreePath(view.hierarchy.entries.getValue("group").path)

        view.collapsePath(path)

        assertFalse(view.isExpanded(path))
        assertEquals(listOf("a", "b", "c"), keys(view))
        assertEquals(listOf("group"), tree.selectedKeys())
        assertFalse(view.placeholder(view.hierarchy.entries.getValue("a")))
    }

    fun `test upper native disclosure boundary toggles once without selecting branch`() = boundary(true)

    fun `test lower native disclosure boundary toggles once without selecting branch`() = boundary(false)

    @RequiresEdt
    private fun boundary(upper: Boolean) {
        var selections = 0
        val tree = ActiveTree("", actions = ActiveTreeActions(select = { selections++ }))
        val view = tree.preferredFocus() as ActiveTreeView
        val ui = Delegate()
        view.setUI(ui)
        tree.update(listOf(ActiveTreeNode(Row("main")),
            ActiveTreeNode(Row("group"), listOf(ActiveTreeNode(Row("leaf"))))))
        view.setSize(400, 200)
        tree.select("main", false)
        selections = 0
        val entry = view.hierarchy.entries.getValue("group")
        val path = TreePath(entry.path)
        val bounds = view.getRowBounds(view.getRowForPath(path))
        val control = requireNotNull(view.regions.control(entry))
        val x = control.x + control.width / 2
        val hits = (bounds.y until bounds.y + bounds.height).filter { ui.contains(path, Point(x, it)) }
        assertTrue(hits.isNotEmpty())
        val point = Point(x, if (upper) hits.first() else hits.last())
        assertTrue(control.contains(point))

        for (expanded in listOf(false, true)) {
            for (id in listOf(MouseEvent.MOUSE_PRESSED, MouseEvent.MOUSE_RELEASED, MouseEvent.MOUSE_CLICKED)) {
                view.dispatchEvent(MouseEvent(view, id, 0, 0, point.x, point.y, 1, false, MouseEvent.BUTTON1))
                assertEquals(expanded, view.isExpanded(path))
                assertEquals(listOf("main"), tree.selectedKeys())
            }
        }
        assertEquals(0, selections)

        val outside = Point(x, point.y + if (upper) -1 else 1)
        assertFalse(ui.contains(path, outside))
        assertFalse(control.contains(outside))
        assertTrue(view.regions.frame(entry)?.contains(outside) == true)
        for (id in listOf(MouseEvent.MOUSE_PRESSED, MouseEvent.MOUSE_RELEASED, MouseEvent.MOUSE_CLICKED)) {
            view.dispatchEvent(MouseEvent(view, id, 0, 0, outside.x, outside.y, 1, false, MouseEvent.BUTTON1))
        }
        assertFalse(view.isExpanded(path))
        assertEquals(listOf("group"), tree.selectedKeys())
        assertEquals(1, selections)
    }

    private fun nodes() = listOf(ActiveTreeNode(Row("group"), listOf("a", "b", "c").map {
        ActiveTreeNode(Row(it))
    }))

    @RequiresEdt
    private fun keys(view: ActiveTreeView): List<String> = view.hierarchy.entries.getValue("group").let { node ->
        (0 until node.childCount).map { (node.getChildAt(it) as ActiveEntry).key }
    }

    private class Delegate : DefaultTreeUI() {
        @RequiresEdt
        fun contains(path: TreePath, point: Point): Boolean = isLocationInExpandControl(path, point.x, point.y)
    }
}
