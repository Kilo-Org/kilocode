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
        val point = Point(frame.x + frame.width - 1, frame.y + frame.height / 2)
        view.dispatchEvent(MouseEvent(view, MouseEvent.MOUSE_CLICKED, 0, 0, point.x, point.y, 2, false, MouseEvent.BUTTON1))
        assertFalse("Double click on group body still collapses", view.isExpanded(path))
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
            val expected = java.awt.image.BufferedImage(arrow.width, arrow.height, java.awt.image.BufferedImage.TYPE_INT_ARGB)
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
            for (y in 0 until arrow.height) for (x in 0 until arrow.width) {
                val color = java.awt.Color(expected.getRGB(x, y), true)
                if (color.red == color.blue && color.red == color.green) continue
                assertTrue("Painted disclosure ink $x,$y selected=$selected",
                    image.getRGB(arrow.x + x, arrow.y + y) != backdrop)
            }
        }
    }
}
