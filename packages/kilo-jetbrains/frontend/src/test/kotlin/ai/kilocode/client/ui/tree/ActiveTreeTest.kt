package ai.kilocode.client.ui.tree

import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveSelection
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import javax.swing.tree.TreePath
import javax.swing.event.TreeModelListener
import javax.swing.event.TreeModelEvent
import ai.kilocode.client.ui.active.ActiveReorder
import ai.kilocode.client.ui.active.ActiveMove
import java.awt.Point
import ai.kilocode.client.ui.active.ActiveCell
import ai.kilocode.client.ui.active.activeHitCells
import ai.kilocode.client.ui.active.activeLayout
import java.awt.event.MouseEvent
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.tree.DefaultMutableTreeNode

class ActiveTreeTest : BasePlatformTestCase() {
    private data class Row(override val key: String, override val title: String, override val description: String? = null) : ActiveItem

    fun `test native cached height matches renderer and empty group remains a branch`() {
        val tree = ActiveTree("")
        tree.update(listOf(ActiveTreeNode(Row("group", "Local"), listOf(ActiveTreeNode(Row("leaf", "Title", "Description"))))))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 200)
        val entry = view.getPathForRow(1).lastPathComponent as ActiveEntry
        assertFalse(entry.allowsChildren)
        val stamp = view.cellRenderer.getTreeCellRendererComponent(view, entry, false, false, true, 1, false)
        assertEquals("ui=${view.ui} rowHeight=${view.rowHeight}", stamp.preferredSize.height, view.getRowBounds(1).height)
        tree.update(listOf(ActiveTreeNode(Row("group", "Local"), emptyList())))
        val group = view.getPathForRow(0).lastPathComponent as ActiveEntry
        assertFalse(view.model.isLeaf(group))
    }

    fun `test keyed refresh preserves collapsed branch and explicit selection reveals it`() {
        val tree = ActiveTree("")
        val nodes = listOf(ActiveTreeNode(Row("group", "Local"), listOf(ActiveTreeNode(Row("leaf", "Title", "Description")))))
        tree.update(nodes)
        val view = tree.preferredFocus() as ActiveTreeView
        val path = view.getPathForRow(0)
        val group = path.lastPathComponent
        view.collapsePath(path)
        tree.update(listOf(ActiveTreeNode(Row("group", "Renamed"), nodes.single().children)), ActiveSelection.Preserve)
        assertSame(group, view.getPathForRow(0).lastPathComponent)
        assertFalse(view.isExpanded(path))
        assertTrue(tree.select("leaf", false))
        assertTrue(view.isExpanded(path))
        assertEquals(listOf("leaf"), tree.selectedKeys())
        assertEquals("leaf", (view.selectionPath.lastPathComponent as ActiveEntry).key)
        assertNotNull(TreePath((view.selectionPath.lastPathComponent as ActiveEntry).path))
    }

    fun `test equal leaves measure collapsed descendants and no op refresh emits no model events`() {
        val tree = ActiveTree("")
        val nodes = listOf(ActiveTreeNode(Row("group", "Local"), listOf(
            ActiveTreeNode(Row("short", "Title")),
            ActiveTreeNode(Row("long", "Title", "Description")),
        )))
        tree.update(nodes)
        val view = tree.preferredFocus() as ActiveTreeView
        assertEquals(view.getRowBounds(1).height, view.getRowBounds(2).height)
        assertTrue(view.getRowBounds(0).height < view.getRowBounds(1).height)
        var events = 0
        view.model.addTreeModelListener(object : TreeModelListener {
            override fun treeNodesChanged(event: TreeModelEvent) { events++ }
            override fun treeNodesInserted(event: TreeModelEvent) { events++ }
            override fun treeNodesRemoved(event: TreeModelEvent) { events++ }
            override fun treeStructureChanged(event: TreeModelEvent) { events++ }
        })
        tree.update(nodes)
        assertEquals(0, events)
        tree.clearSelection()
        assertFalse(tree.select("pending", false))
        tree.update(nodes + ActiveTreeNode(Row("pending", "Pending")))
        assertEquals(listOf("pending"), tree.selectedKeys())
    }

    fun `test slide uses removed rows old sibling position`() {
        val tree = ActiveTree("")
        fun nodes(vararg keys: String) = listOf(ActiveTreeNode(Row("group", "Local"), keys.map { ActiveTreeNode(Row(it, it)) }))
        tree.update(nodes("a", "b", "c"))
        tree.select("b", false)
        tree.update(nodes("a", "c"), ActiveSelection.Slide)
        assertEquals(listOf("c"), tree.selectedKeys())
        tree.update(nodes("a"), ActiveSelection.Slide)
        assertEquals(listOf("a"), tree.selectedKeys())
    }

    fun `test cached equal heights grow and shrink when the tallest row changes or is removed`() {
        val tree = ActiveTree("")
        val short = ActiveTreeNode(Row("a", "A"))
        val tall = ActiveTreeNode(Row("b", "B", "Description"))
        tree.update(listOf(short, tall))
        val view = tree.preferredFocus() as ActiveTreeView
        val height = view.getRowBounds(0).height

        tree.update(listOf(short, ActiveTreeNode(Row("b", "B"))))
        val compact = view.getRowBounds(0).height
        assertTrue(compact < height)
        assertEquals(compact, view.getRowBounds(1).height)

        tree.update(listOf(short, tall))
        assertEquals(height, view.getRowBounds(0).height)
        tree.update(listOf(short))
        assertEquals(compact, view.getRowBounds(0).height)
    }

    fun `test unchanged sibling reconciliation does not search for each child index`() {
        var searches = 0
        val parent = object : javax.swing.tree.DefaultMutableTreeNode(null, true) {
            override fun getIndex(child: javax.swing.tree.TreeNode?): Int {
                searches++
                return super.getIndex(child)
            }
        }
        val model = ActiveTreeModel()
        val nodes = (0 until 200).map { ActiveTreeNode(Row(it.toString(), "Row $it")) }
        model.sync(nodes, parent)
        searches = 0

        model.sync(nodes, parent)

        assertEquals("Unchanged sibling ordering should use direct indexed access", 0, searches)
        assertEquals(200, parent.childCount)
    }

    fun `test missing pending request does not discard surviving selection`() {
        val tree = ActiveTree("")
        tree.update(listOf(ActiveTreeNode(Row("a", "A"))))
        tree.select("a", false)
        assertFalse(tree.select("missing", false))
        tree.update(listOf(ActiveTreeNode(Row("a", "Renamed"))))
        assertEquals(listOf("a"), tree.selectedKeys())
        tree.update(listOf(ActiveTreeNode(Row("a", "Renamed")), ActiveTreeNode(Row("missing", "Arrived"))))
        assertEquals(listOf("missing"), tree.selectedKeys())
    }

    fun `test unsupported UI keeps content and selection but hides geometry dependent actions`() {
        val calls = mutableListOf<String>()
        val row = object : ActiveItem {
            override val key = "leaf"
            override val title = "Title"
            override val description = "Description"
            override val cells = listOf(ActiveCell("action", "Action", alwaysVisible = true, action = { calls += "cell" }))
        }
        val tree = ActiveTree("", actions = ActiveTreeActions(open = { _, _ -> calls += "open" }))
        tree.update(listOf(ActiveTreeNode(row)))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(javax.swing.plaf.metal.MetalTreeUI())
        view.setSize(400, 300)
        tree.select("leaf", false)
        val path = view.getPathForRow(0)
        val stamp = view.cellRenderer.getTreeCellRendererComponent(view, path.lastPathComponent, true, false, true, 0, true)
        stamp.setSize(view.getRowBounds(0).size)
        activeLayout(stamp)
        assertTrue(activeHitCells(stamp, 0, 0).none { it.id == "action" })
        val bounds = view.getRowBounds(0)
        view.dispatchEvent(MouseEvent(view, MouseEvent.MOUSE_CLICKED, 0, 0,
            bounds.x + 1, bounds.y + bounds.height / 2, 1, false, MouseEvent.BUTTON1))
        assertEquals(listOf("open"), calls)
        assertEquals(listOf("leaf"), tree.selectedKeys())
    }

    fun `test sibling drag retains node and row height and cancels on collapse`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = ActiveReorder({ it.key != "group" }, { moves += it }))
        val nodes = listOf(ActiveTreeNode(Row("group", "Local"), listOf(
            ActiveTreeNode(Row("a", "A", "Description")), ActiveTreeNode(Row("b", "B")),
        )))
        tree.update(nodes)
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        val node = view.getPathForRow(2).lastPathComponent
        val height = view.getRowBounds(2).height
        view.over("b", Point(100, 0))
        assertSame(node, view.getPathForRow(1).lastPathComponent)
        assertEquals(height, view.getRowBounds(1).height)
        view.drop()
        assertEquals(listOf("b", "a"), moves.single().keys)
        view.over("a", Point(100, 0))
        val entry = view.getPathForRow(1).lastPathComponent as ActiveEntry
        assertEquals("a", entry.key)
        assertTrue(view.placeholder(entry))
        view.collapsePath(view.getPathForRow(0))
        assertFalse(view.placeholder(entry))
        view.expandPath(view.getPathForRow(0))
        assertEquals("a", (view.getPathForRow(1).lastPathComponent as ActiveEntry).key)
        assertEquals("b", (view.getPathForRow(2).lastPathComponent as ActiveEntry).key)
        view.drop()
        assertEquals(1, moves.size)
    }

    fun `test removed selection does not disable no op refresh or reselect recreated key`() {
        val tree = ActiveTree("")
        val nodes = listOf(ActiveTreeNode(Row("a", "A")))
        tree.update(nodes + ActiveTreeNode(Row("b", "B")))
        tree.select("b", false)
        tree.update(nodes)
        com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents()
        var calls = 0
        (tree.preferredFocus() as ActiveTreeView).onGeometry = { calls++ }
        tree.update(nodes)
        assertEquals(0, calls)
        tree.update(nodes + ActiveTreeNode(Row("b", "Recreated")))
        assertNull(tree.selected())
    }

    fun `test empty refresh retains selection until rows return`() {
        val tree = ActiveTree("")
        val nodes = listOf(ActiveTreeNode(Row("a", "A")))
        tree.update(nodes)
        tree.select("a", false)
        tree.update(emptyList())
        tree.update(nodes)
        assertEquals("a", tree.selected()?.key)
    }

    fun `test permanently empty group expires removed selection before no op polls`() {
        val tree = ActiveTree("")
        val empty = listOf(ActiveTreeNode(Row("group", "Local"), emptyList()))
        val nodes = listOf(ActiveTreeNode(Row("group", "Local"), listOf(ActiveTreeNode(Row("a", "A")))))
        tree.update(nodes)
        tree.select("a", false)
        tree.update(empty)
        com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents()
        var calls = 0
        (tree.preferredFocus() as ActiveTreeView).onGeometry = { calls++ }
        repeat(3) { tree.update(empty) }
        assertEquals(0, calls)
        tree.update(nodes)
        assertNull(tree.selected())
    }

    fun `test reveal background descendant anchors without changing selection`() {
        val tree = ActiveTree("")
        val main = ActiveTreeNode(Row("main", "Main"))
        val empty = ActiveTreeNode(Row("group", "Local"), emptyList())
        tree.update(listOf(main, empty.copy(children = listOf(ActiveTreeNode(Row("a", "A"))))))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 200)
        tree.select("main", false)
        val path = view.getPathForRow(1)
        view.collapsePath(path)
        assertTrue(tree.reveal("a"))
        assertTrue(view.isExpanded(path))
        assertNotNull(tree.point("a"))
        assertEquals(listOf("main"), tree.selectedKeys())
        tree.update(listOf(main, empty))
        assertEquals(listOf("main"), tree.selectedKeys())
    }

    fun `test later reveal wins over queued refresh viewport restoration`() {
        val tree = ActiveTree("")
        val nodes = (0 until 30).map { ActiveTreeNode(Row("k$it", "Row $it")) }
        tree.update(nodes)
        val view = tree.preferredFocus() as ActiveTreeView
        val scroll = com.intellij.ui.components.JBScrollPane(view)
        scroll.setSize(400, 100)
        scroll.doLayout()
        view.setSize(view.preferredSize)
        com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents()
        tree.update(nodes + ActiveTreeNode(Row("new", "New")))
        scroll.doLayout()
        scroll.viewport.doLayout()
        tree.select("new")
        val position = scroll.viewport.viewPosition
        assertTrue(position.y > 0)
        com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents()
        assertEquals(position, scroll.viewport.viewPosition)
    }

    fun `test scroll adjustment invokes callback once`() {
        val tree = ActiveTree("")
        var calls = 0
        tree.onScroll = { calls++ }
        val scroll = tree.components.single() as com.intellij.ui.components.JBScrollPane
        val view = tree.preferredFocus() as ActiveTreeView
        view.onGeometry = { calls++ }
        val event = java.awt.event.AdjustmentEvent(scroll.verticalScrollBar,
            java.awt.event.AdjustmentEvent.ADJUSTMENT_VALUE_CHANGED, java.awt.event.AdjustmentEvent.TRACK, 1)
        scroll.verticalScrollBar.adjustmentListeners.first { it.javaClass.name.contains("ActiveTree") }
            .adjustmentValueChanged(event)
        assertEquals(1, calls)
    }

    fun `test movable siblings reorder beside fixed row but cannot cross it`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = ActiveReorder({ it.key != "fixed" }, { moves += it }))
        tree.update(listOf(ActiveTreeNode(Row("group", "Local"), listOf(
            ActiveTreeNode(Row("fixed", "Fixed")), ActiveTreeNode(Row("a", "A")), ActiveTreeNode(Row("b", "B")),
        ))))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        val bounds = view.getRowBounds(2)
        view.over("b", Point(100, bounds.y))
        view.drop()
        assertEquals(listOf("fixed", "b", "a"), moves.single().keys)
        view.over("a", Point(100, 0))
        assertFalse(view.placeholder(view.hierarchy.entries.getValue("a")))
        view.drop()
        assertEquals(1, moves.size)
    }

    fun `test root leaves reorder with default sibling only options`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = ActiveReorder(onMove = { moves += it }))
        tree.update(listOf("a", "b", "c").map { ActiveTreeNode(Row(it, it)) })
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        val entry = view.hierarchy.entries.getValue("c")

        view.over("c", Point(100, 0))

        assertEquals(listOf("c", "a", "b"), keys(view.hierarchy.root))
        assertSame(entry, view.getPathForRow(0).lastPathComponent)
        assertEquals(listOf("c"), tree.selectedKeys())
        view.drop()
        assertEquals(ActiveMove("c", 2, 0, listOf("c", "a", "b")), moves.single())
    }

    fun `test legacy branches remain immovable and leaves stay with their siblings`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = ActiveReorder(onMove = { moves += it }))
        tree.update(listOf(section("first", "a", "b"), section("second", "c")))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        val first = view.hierarchy.entries.getValue("first")

        assertNull(view.pickable(body(view, "first")))
        view.over("first", body(view, "second"))
        assertFalse(view.placeholder(first))
        view.over("a", body(view, "second"))
        view.drop()

        assertEquals(listOf("b", "a"), keys(first))
        assertEquals(listOf("c"), keys(view.hierarchy.entries.getValue("second")))
        assertEquals("first", moves.single().parent)
        assertEquals("first", moves.single().previous)
    }

    fun `test leaf crosses sections while retaining its original root source`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves))
        tree.update(listOf(ActiveTreeNode(Row("a", "A")), section("first", "b"), section("second", "c")))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        val entry = view.hierarchy.entries.getValue("a")

        view.over("a", body(view, "first"))
        assertEquals(listOf("b", "a"), keys(view.hierarchy.entries.getValue("first")))
        view.over("a", body(view, "second"))

        assertEquals(listOf("b"), keys(view.hierarchy.entries.getValue("first")))
        assertEquals(listOf("c", "a"), keys(view.hierarchy.entries.getValue("second")))
        assertSame(entry, view.selectionPath.lastPathComponent)
        view.drop()
        assertEquals(ActiveMove("a", 0, 1, listOf("c", "a"), "second", null), moves.single())
    }

    fun `test leaf gutter drop leaves a section after another expanded section as a unit`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves))
        tree.update(listOf(section("first", "a"), section("second", "b", "c"), ActiveTreeNode(Row("d", "D"))))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
        view.setSize(400, 300)
        val second = view.hierarchy.entries.getValue("second")
        val point = body(view, "b")

        view.over("a", Point(view.insets.left, point.y))
        view.drop()

        assertEquals(listOf("first", "second", "a", "d"), keys(view.hierarchy.root))
        assertEquals(listOf("b", "c"), keys(second))
        assertTrue(view.isExpanded(TreePath(second.path)))
        assertEquals(ActiveMove("a", 0, 2, listOf("first", "second", "a", "d"), null, "first"), moves.single())
    }

    fun `test leaf enters another section at the pointed sibling position`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves))
        tree.update(listOf(section("first", "a", "b"), section("second", "c", "d")))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        val bounds = view.regions.cell(view.hierarchy.entries.getValue("c"))

        view.over("a", Point(bounds.x + bounds.width / 2, bounds.y))
        view.drop()

        assertEquals(listOf("b"), keys(view.hierarchy.entries.getValue("first")))
        assertEquals(ActiveMove("a", 0, 0, listOf("a", "c", "d"), "second", "first"), moves.single())
    }

    fun `test disclosure gutter inserts beside a section instead of into it`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
        tree.update(listOf(ActiveTreeNode(Row("a", "A")), section("section", "b")))
        view.setSize(400, 300)
        val entry = view.hierarchy.entries.getValue("section")
        val control = requireNotNull(view.regions.control(entry))

        view.over("a", Point(control.x + control.width - 1, control.y + control.height / 2))
        view.drop()

        assertEquals(listOf("b"), keys(entry))
        assertEquals(ActiveMove("a", 0, 1, listOf("section", "a")), moves.single())
    }

    fun `test branch header strips insert beside the whole expanded section`() {
        for (bottom in listOf(false, true)) {
            val moves = mutableListOf<ActiveMove>()
            val tree = ActiveTree("", reorder = sections(moves))
            tree.update(listOf(section("section", "b", "c"), ActiveTreeNode(Row("a", "A"))))
            val view = tree.preferredFocus() as ActiveTreeView
            view.setSize(400, 300)
            val entry = view.hierarchy.entries.getValue("section")
            val cell = view.regions.cell(entry)

            view.over("a", Point(cell.x + cell.width / 2, cell.y + if (bottom) cell.height - 1 else 0))

            assertSame(view.hierarchy.root, view.hierarchy.entries.getValue("a").parent)
            assertEquals(if (bottom) listOf("section", "a") else listOf("a", "section"), keys(view.hierarchy.root))
            assertEquals(listOf("b", "c"), keys(entry))
            assertTrue(view.isExpanded(TreePath(entry.path)))
            view.drop()
            assertEquals(if (bottom) 0 else 1, moves.size)
        }
    }

    fun `test empty or collapsed section keeps its target across repeated hover events`() {
        for (empty in listOf(true, false)) {
            val moves = mutableListOf<ActiveMove>()
            val tree = ActiveTree("", reorder = sections(moves))
            val view = tree.preferredFocus() as ActiveTreeView
            view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
            tree.update(listOf(ActiveTreeNode(Row("a", "A")),
                if (empty) section("section") else section("section", "b")))
            view.setSize(400, 300)
            val entry = view.hierarchy.entries.getValue("section")
            val path = TreePath(entry.path)
            view.collapsePath(path)
            val point = body(view, "section")

            for (offset in listOf(0, 1, 0, -1)) {
                view.over("a", Point(point.x + offset, point.y))

                val leaf = view.hierarchy.entries.getValue("a")
                assertSame(entry, leaf.parent)
                assertEquals(if (empty) listOf("a") else listOf("b", "a"), keys(entry))
                assertTrue(view.isExpanded(path))
                assertTrue(view.getRowForPath(TreePath(leaf.path)) >= 0)
                assertTrue(view.placeholder(leaf))
                assertEquals(listOf("a"), tree.selectedKeys())
            }
            view.drop()
            assertEquals(ActiveMove("a", 0, if (empty) 0 else 1, keys(entry), "section", null), moves.single())
            assertTrue("A successful drop leaves the receiving section expanded", view.isExpanded(path))
        }
    }

    fun `test branch header hover releases its original target when moving to a sibling`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
        tree.update(listOf(ActiveTreeNode(Row("a", "A")), section("section", "b", "c")))
        view.setSize(400, 300)
        val entry = view.hierarchy.entries.getValue("section")
        val point = body(view, "section")

        for (offset in listOf(0, 1, -1, 0)) {
            view.over("a", Point(point.x + offset, point.y + offset))
            assertEquals(listOf("b", "c", "a"), keys(entry))
        }
        val outside = view.regions.cell(view.hierarchy.entries.getValue("c"))
        view.over("a", Point(outside.x + outside.width / 2, outside.y))
        assertEquals(listOf("b", "a", "c"), keys(entry))
        val bounds = view.regions.cell(view.hierarchy.entries.getValue("b"))
        view.over("a", Point(bounds.x + bounds.width / 2, bounds.y))
        assertEquals(listOf("a", "b", "c"), keys(entry))
        view.over("a", point)
        assertEquals(listOf("a", "b", "c"), keys(entry))
        view.drop()

        assertEquals(ActiveMove("a", 0, 0, listOf("a", "b", "c"), "section", null), moves.single())
    }

    fun `test cancelling repeated hover into an empty section restores its collapsed state`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves))
        tree.update(listOf(ActiveTreeNode(Row("a", "A")), section("section")))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        val entry = view.hierarchy.entries.getValue("section")
        val path = TreePath(entry.path)
        view.collapsePath(path)
        val point = body(view, "section")
        for (offset in listOf(0, 1, 0)) {
            view.over("a", Point(point.x + offset, point.y))
            assertSame(entry, view.hierarchy.entries.getValue("a").parent)
            assertTrue(view.isExpanded(path))
        }

        tree.setLocked(true)

        assertEquals(listOf("a", "section"), keys(view.hierarchy.root))
        assertEmpty(keys(entry))
        assertFalse(view.isExpanded(path))
        assertEquals(listOf("a"), tree.selectedKeys())
        assertFalse(view.placeholder(view.hierarchy.entries.getValue("a")))
        view.drop()
        assertEmpty(moves)
    }

    fun `test reparenting detour cannot bypass an original fixed root sibling`() {
        for (collapsed in listOf(false, true)) {
            val moves = mutableListOf<ActiveMove>()
            val tree = ActiveTree("", reorder = sections(moves) { it.key != "fixed" })
            val view = tree.preferredFocus() as ActiveTreeView
            view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
            tree.update(listOf(ActiveTreeNode(Row("a", "A")), ActiveTreeNode(Row("fixed", "Fixed")),
                section("section", "b")))
            view.setSize(400, 300)
            val entry = view.hierarchy.entries.getValue("a")
            val section = view.hierarchy.entries.getValue("section")
            val path = TreePath(section.path)
            if (collapsed) view.collapsePath(path)

            view.over("a", Point(view.insets.left, view.height))
            assertEquals(listOf("a", "fixed", "section"), keys(view.hierarchy.root))
            assertFalse(view.placeholder(entry))

            val point = body(view, "section")
            for (offset in listOf(0, 1, 0)) {
                view.over("a", Point(point.x + offset, point.y))
                assertSame(section, entry.parent)
                assertEquals(listOf("fixed", "section"), keys(view.hierarchy.root))
                assertEquals(listOf("b", "a"), keys(section))
            }
            val gutter = Point(view.insets.left, body(view, "b").y)
            repeat(2) {
                view.over("a", gutter)
                assertEquals(listOf("a", "fixed", "section"), keys(view.hierarchy.root))
                assertEquals(listOf("b"), keys(section))
                assertFalse(view.placeholder(entry))
                assertEquals(!collapsed, view.isExpanded(path))
            }
            view.drop()
            assertEmpty(moves)
        }
    }

    fun `test refresh replaces the original barrier snapshot before returning from a section`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves) { it.key != "fixed" })
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
        val leaf = ActiveTreeNode(Row("a", "A"))
        tree.update(listOf(leaf, section("section", "b")))
        view.setSize(400, 300)
        val point = body(view, "section")
        for (offset in listOf(0, 1)) view.over("a", Point(point.x + offset, point.y))

        tree.update(listOf(leaf, ActiveTreeNode(Row("fixed", "Fixed")), section("section", "b")))

        val entry = view.hierarchy.entries.getValue("a")
        assertSame(view.hierarchy.entries.getValue("section"), entry.parent)
        view.over("a", Point(view.insets.left, body(view, "b").y))
        assertEquals(listOf("a", "fixed", "section"), keys(view.hierarchy.root))
        assertFalse(view.placeholder(entry))
        view.drop()
        assertEmpty(moves)
    }

    fun `test returning from a section can reorder within the original fixed sibling segment`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves) { it.key != "fixed" })
        tree.update(listOf(ActiveTreeNode(Row("a", "A")), ActiveTreeNode(Row("c", "C")),
            ActiveTreeNode(Row("fixed", "Fixed")), section("section", "b")))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        val point = body(view, "section")
        for (offset in listOf(0, 1)) view.over("a", Point(point.x + offset, point.y))
        val bounds = view.regions.cell(view.hierarchy.entries.getValue("fixed"))
        val target = Point(bounds.x + bounds.width / 2, bounds.y)

        for (offset in listOf(0, 1, 0)) view.over("a", Point(target.x + offset, target.y))
        view.drop()

        assertEquals(ActiveMove("a", 0, 1, listOf("c", "a", "fixed", "section")), moves.single())
        assertEquals(listOf("b"), keys(view.hierarchy.entries.getValue("section")))
    }

    fun `test sections cannot nest and move their expanded children together`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
        tree.update(listOf(section("first", "a", "b"), section("second", "c", "d")))
        view.setSize(400, 300)
        val first = view.hierarchy.entries.getValue("first")
        val second = view.hierarchy.entries.getValue("second")
        val child = view.hierarchy.entries.getValue("a")
        assertEquals("first", view.pickable(body(view, "first")))

        view.over("first", body(view, "c"))

        assertEquals(listOf("second", "first"), keys(view.hierarchy.root))
        assertEquals(listOf("a", "b"), keys(first))
        assertEquals(listOf("c", "d"), keys(second))
        assertSame(child, first.getChildAt(0))
        assertTrue(view.isExpanded(TreePath(first.path)))
        assertTrue(view.isExpanded(TreePath(second.path)))
        assertEquals(listOf("second", "c", "d", "first", "a", "b"), (0 until view.rowCount).map {
            (view.getPathForRow(it).lastPathComponent as ActiveEntry).key
        })
        view.drop()
        assertEquals(ActiveMove("first", 0, 1, listOf("second", "first")), moves.single())
    }

    fun `test cancelling a cross parent preview restores selection and expansion without callbacks`() {
        var selections = 0
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", actions = ActiveTreeActions(select = { selections++ }), reorder = sections(moves))
        tree.update(listOf(section("first", "a", "b"), section("second", "c")))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        val first = view.hierarchy.entries.getValue("first")
        val second = view.hierarchy.entries.getValue("second")
        val path = TreePath(second.path)
        view.collapsePath(path)
        tree.select("a", false)
        val point = body(view, "second")
        for (offset in listOf(0, 1, 0)) view.over("a", Point(point.x + offset, point.y))
        val entry = view.hierarchy.entries.getValue("a")
        assertSame(second, entry.parent)
        assertTrue(view.placeholder(entry))
        assertTrue(view.isExpanded(path))
        selections = 0

        tree.setLocked(true)

        assertEquals(listOf("a", "b"), keys(first))
        assertEquals(listOf("c"), keys(second))
        assertEquals(listOf("a"), tree.selectedKeys())
        assertSame(entry, view.selectionPath.lastPathComponent)
        assertFalse(view.placeholder(entry))
        assertTrue(view.isExpanded(TreePath(first.path)))
        assertFalse(view.isExpanded(path))
        assertEquals(0, selections)
        view.drop()
        assertEmpty(moves)
    }

    fun `test refresh reapplies a cross parent preview using the refreshed source index`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves))
        tree.update(listOf(ActiveTreeNode(Row("a", "A")), section("section", "b")))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        val entry = view.hierarchy.entries.getValue("a")
        val point = body(view, "section")
        view.over("a", point)

        tree.update(listOf(ActiveTreeNode(Row("new", "New")), ActiveTreeNode(Row("a", "Renamed")),
            section("section", "b", "c")))

        assertEquals(listOf("new", "section"), keys(view.hierarchy.root))
        assertEquals(listOf("b", "a", "c"), keys(view.hierarchy.entries.getValue("section")))
        assertSame(entry, view.selectionPath.lastPathComponent)
        assertEquals("Renamed", entry.item.title)
        assertTrue(view.placeholder(entry))
        assertEmpty(moves)
        for (offset in listOf(0, 1, 0)) view.over("a", Point(point.x + offset, point.y))
        assertEquals(listOf("b", "a", "c"), keys(view.hierarchy.entries.getValue("section")))
        view.drop()
        assertEquals(ActiveMove("a", 1, 1, listOf("b", "a", "c"), "section", null), moves.single())
    }

    fun `test authoritative parent changes invalidate a drag on refresh`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves))
        tree.update(listOf(ActiveTreeNode(Row("a", "A")), section("first", "b"), section("second", "c")))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        val first = TreePath(view.hierarchy.entries.getValue("first").path)
        view.collapsePath(first)
        view.over("a", body(view, "first"))
        assertTrue(view.isExpanded(first))

        tree.update(listOf(section("first", "b"), section("second", "a", "c")))

        val entry = view.hierarchy.entries.getValue("a")
        assertFalse(view.placeholder(entry))
        assertFalse(view.isExpanded(first))
        assertEquals("second", (entry.parent as ActiveEntry).key)
        assertEquals(listOf("a"), tree.selectedKeys())
        view.drop()
        assertEmpty(moves)
    }

    fun `test removing the destination section on refresh cancels its preview`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves))
        val leaf = ActiveTreeNode(Row("a", "A"))
        tree.update(listOf(leaf, section("first", "b"), section("second", "c")))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        view.over("a", body(view, "first"))

        tree.update(listOf(leaf, section("second", "c")))

        val entry = view.hierarchy.entries.getValue("a")
        assertSame(view.hierarchy.root, entry.parent)
        assertFalse(view.placeholder(entry))
        assertEquals(listOf("a"), tree.selectedKeys())
        view.drop()
        assertEmpty(moves)
    }

    fun `test refresh and cancellation preserve expansion while moving a root section`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves))
        val nodes = listOf(section("first", "a"), section("second", "b"))
        tree.update(nodes)
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        val first = view.hierarchy.entries.getValue("first")
        val second = view.hierarchy.entries.getValue("second")
        view.collapsePath(TreePath(second.path))
        view.over("first", body(view, "second"))
        assertEquals(listOf("second", "first"), keys(view.hierarchy.root))

        tree.update(listOf(section("first", "a", "c"), nodes.last()))

        assertEquals(listOf("second", "first"), keys(view.hierarchy.root))
        assertEquals(listOf("a", "c"), keys(first))
        assertTrue(view.isExpanded(TreePath(first.path)))
        assertFalse(view.isExpanded(TreePath(second.path)))
        tree.setLocked(true)
        assertEquals(listOf("first", "second"), keys(view.hierarchy.root))
        assertTrue(view.isExpanded(TreePath(first.path)))
        assertFalse(view.isExpanded(TreePath(second.path)))
        assertEquals(listOf("first"), tree.selectedKeys())
        view.drop()
        assertEmpty(moves)
    }

    fun `test pinned root stays first through root section and cross parent drag targets`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves, pinned = { it.key == "main" }))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
        tree.update(listOf(ActiveTreeNode(Row("main", "Main")), ActiveTreeNode(Row("local", "Local")),
            section("section", "child")))
        view.setSize(400, 300)
        val main = view.hierarchy.entries.getValue("main")
        val section = view.hierarchy.entries.getValue("section")
        val bounds = view.regions.cell(main)

        assertNull(view.pickable(body(view, "main")))
        assertEquals("local", view.pickable(body(view, "local")))
        assertEquals("child", view.pickable(body(view, "child")))
        for (key in listOf("local", "section", "child")) {
            view.over(key, Point(bounds.x + bounds.width / 2, bounds.y))
            assertEquals(listOf("main", "local", "section"), keys(view.hierarchy.root))
            assertSame(section, view.hierarchy.entries.getValue("child").parent)
            view.drop()
            assertEmpty(moves)
        }

        view.over("child", Point(bounds.x + bounds.width / 2, bounds.y + bounds.height - 1))
        assertEquals(listOf("main", "child", "local", "section"), keys(view.hierarchy.root))
        view.drop()
        assertEquals(ActiveMove("child", 0, 1, listOf("main", "child", "local", "section"), null, "section"),
            moves.single())
    }

    fun `test discovering a pinned root cancels a cross parent preview above it`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = sections(moves, pinned = { it.key == "main" }))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
        tree.update(listOf(ActiveTreeNode(Row("local", "Local")), section("section", "child")))
        view.setSize(400, 300)
        val bounds = view.regions.cell(view.hierarchy.entries.getValue("local"))
        view.over("child", Point(bounds.x + bounds.width / 2, bounds.y))
        assertEquals(listOf("child", "local", "section"), keys(view.hierarchy.root))

        tree.update(listOf(ActiveTreeNode(Row("main", "Main")), ActiveTreeNode(Row("local", "Local")),
            section("section", "child")))

        assertEquals(listOf("main", "local", "section"), keys(view.hierarchy.root))
        assertSame(view.hierarchy.entries.getValue("section"), view.hierarchy.entries.getValue("child").parent)
        assertEquals(listOf("child"), tree.selectedKeys())
        view.drop()
        assertEmpty(moves)
    }

    private fun section(key: String, vararg children: String) = ActiveTreeNode(Row(key, key), children.map {
        ActiveTreeNode(Row(it, it))
    })

    private fun sections(moves: MutableList<ActiveMove>, pinned: (ActiveItem) -> Boolean = { false },
        movable: (ActiveItem) -> Boolean = { true }) = ActiveReorder(
        movable = movable,
        pinned = pinned,
        onMove = { moves += it },
        reparent = { row, parent -> parent == null || parent.key in listOf("first", "second", "section") &&
            row.key !in listOf("first", "second", "section") },
    )

    @RequiresEdt
    private fun keys(parent: DefaultMutableTreeNode): List<String> =
        (0 until parent.childCount).map { (parent.getChildAt(it) as ActiveEntry).key }

    @RequiresEdt
    private fun body(view: ActiveTreeView, key: String): Point {
        val bounds = view.regions.cell(view.hierarchy.entries.getValue(key))
        return Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    }

    fun `test disclosure press toggles once without selecting or activating group`() {
        val calls = mutableListOf<String>()
        var selections = 0
        val tree = ActiveTree("", actions = ActiveTreeActions(
            select = { selections++ }, open = { item, _ -> calls += item.key },
        ))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
        tree.update(listOf(ActiveTreeNode(Row("main", "Main")), ActiveTreeNode(Row("group", "Local"), listOf(
            ActiveTreeNode(Row("leaf", "Child")),
        ))))
        view.setSize(400, 200)
        tree.select("main", false)
        selections = 0
        val entry = view.hierarchy.entries.getValue("group")
        val path = TreePath(entry.path)
        for (expanded in listOf(false, true)) {
            val bounds = view.regions.control(entry) ?: error("Missing disclosure")
            val point = Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
            for (id in listOf(MouseEvent.MOUSE_PRESSED, MouseEvent.MOUSE_RELEASED, MouseEvent.MOUSE_CLICKED)) {
                val event = MouseEvent(view, id, 0, 0, point.x, point.y, 1, false, MouseEvent.BUTTON1)
                view.dispatchEvent(event)
                assertTrue("Disclosure event must be consumed", event.isConsumed)
                assertEquals("Toggle happens once on press", expanded, view.isExpanded(path))
                assertEquals(listOf("main"), tree.selectedKeys())
            }
        }
        assertEquals(0, selections)
        assertEmpty(calls)
        val frame = view.regions.frame(entry) ?: error("Missing group frame")
        for (x in listOf(frame.x + 1, frame.x + frame.width - 1)) {
            tree.clearSelection()
            view.dispatchEvent(MouseEvent(view, MouseEvent.MOUSE_PRESSED, 0, 0, x,
                frame.y + frame.height / 2, 1, false, MouseEvent.BUTTON1))
            assertEquals(listOf("group"), tree.selectedKeys())
            assertTrue(view.isExpanded(path))
        }
        val point = Point(frame.x + frame.width / 2, frame.y + frame.height / 2)
        val expanded = view.isExpanded(path)
        for (id in listOf(MouseEvent.MOUSE_PRESSED, MouseEvent.MOUSE_RELEASED, MouseEvent.MOUSE_CLICKED)) {
            view.dispatchEvent(MouseEvent(view, id, 0, 0, point.x, point.y, 1, false, MouseEvent.BUTTON1))
        }
        assertEquals("Clicking the group body toggles it", !expanded, view.isExpanded(path))
        assertEquals(listOf("group"), tree.selectedKeys())
        assertEmpty(calls)
        view.dispatchEvent(MouseEvent(view, MouseEvent.MOUSE_CLICKED, 0, 0, point.x, point.y, 2, false, MouseEvent.BUTTON1))
        assertEquals("A double click does not toggle twice", !expanded, view.isExpanded(path))
        assertEmpty(calls)
    }

    fun `test native keyboard expansion and selection remain installed`() {
        val tree = ActiveTree("")
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
        tree.update(listOf(ActiveTreeNode(Row("group", "Local"), listOf(ActiveTreeNode(Row("leaf", "Child"))))))
        tree.select("group", false)
        val path = view.selectionPath
        fun action(name: String) {
            val action = view.actionMap.get(name) ?: error("Missing native $name action")
            action.actionPerformed(java.awt.event.ActionEvent(view, java.awt.event.ActionEvent.ACTION_PERFORMED, name))
        }
        action("collapse")
        assertFalse(view.isExpanded(path))
        action("expand")
        assertTrue(view.isExpanded(path))
        action("selectNext")
        assertEquals(listOf("leaf"), tree.selectedKeys())
    }

    fun `test native disclosure hit testing matches public painter and painted arrow`() {
        val tree = ActiveTree("")
        val view = tree.preferredFocus() as ActiveTreeView
        val ui = object : com.intellij.ui.tree.ui.DefaultTreeUI() {
            fun contains(path: TreePath, point: Point) = isLocationInExpandControl(path, point.x, point.y)
        }
        view.setUI(ui)
        tree.update(listOf(ActiveTreeNode(Row("main", "Main")), ActiveTreeNode(Row("group", "Local"), listOf(
            ActiveTreeNode(Row("leaf", "Child")),
        ))))
        view.setSize(400, 200)
        val entry = view.hierarchy.entries.getValue("group")
        val path = TreePath(entry.path)
        val arrow = view.regions.control(entry) ?: error("Missing arrow")
        val point = Point(arrow.x + arrow.width / 2, arrow.y + arrow.height / 2)
        assertTrue("Native delegate must hit painted arrow", ui.contains(path, point))
        assertFalse(ui.contains(path, Point(arrow.x - 1, point.y)))
        assertFalse(ui.contains(path, Point(arrow.x + arrow.width, point.y)))
        val main = view.hierarchy.entries.getValue("main")
        assertNull(view.regions.control(main))
        assertFalse(ui.contains(TreePath(main.path), Point(point.x, view.getRowBounds(0).height / 2)))
        val control = com.intellij.ui.tree.ui.DefaultControl()
        for (selected in listOf(false, true)) {
            if (selected) tree.select("group", false) else tree.clearSelection()
            val image = java.awt.image.BufferedImage(view.width, view.height, java.awt.image.BufferedImage.TYPE_INT_ARGB)
            val graphics = image.createGraphics()
            try {
                // A transparent tree inherits this backdrop from its viewport in the real UI.
                graphics.color = view.background
                graphics.fillRect(0, 0, image.width, image.height)
                view.paint(graphics)
            } finally {
                graphics.dispose()
            }
            val bounds = view.getRowBounds(1)
            val expected = java.awt.image.BufferedImage(arrow.width, bounds.height, java.awt.image.BufferedImage.TYPE_INT_ARGB)
            val stamp = expected.createGraphics()
            try {
                val color = if (selected) com.intellij.util.ui.UIUtil.getTreeBackground(true, false) else view.background
                stamp.color = color
                stamp.fillRect(0, 0, expected.width, expected.height)
                control.paint(view, stamp, 0, 0, expected.width, expected.height, true, false)
            } finally {
                stamp.dispose()
            }
            // The tree paints the control over its own rounded selection frame, so compare only the
            // pixels the icon actually inks rather than the flat backdrop behind it.
            val backdrop = image.getRGB(arrow.x - 1, arrow.y + arrow.height / 2)
            for (y in 0 until expected.height) for (x in 0 until expected.width) {
                val color = java.awt.Color(expected.getRGB(x, y), true)
                if (color.red == color.blue && color.red == color.green) continue
                assertTrue("Painted disclosure ink $x,$y selected=$selected",
                    image.getRGB(arrow.x + x, bounds.y + y) != backdrop)
            }
        }
    }
}
