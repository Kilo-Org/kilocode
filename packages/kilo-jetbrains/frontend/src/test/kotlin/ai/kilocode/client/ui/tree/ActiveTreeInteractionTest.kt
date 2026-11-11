package ai.kilocode.client.ui.tree

import ai.kilocode.client.ui.active.ActiveBadge
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveMenu
import ai.kilocode.client.ui.active.ACTIVE_MENU_CELL
import ai.kilocode.client.ui.active.ActiveMove
import ai.kilocode.client.ui.active.ActiveReorder
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.iconButtonSize
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.tree.ui.DefaultTreeUI
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Point
import java.awt.event.MouseEvent
import java.awt.event.ActionEvent
import java.awt.event.InputEvent
import java.awt.event.KeyEvent
import javax.swing.KeyStroke
import javax.swing.plaf.metal.MetalTreeUI
import javax.swing.tree.TreePath

private const val BADGE = "pull-request"

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

    fun `test a badge under the pointer is the only hovered cell`() {
        val tree = ActiveTree("")
        tree.update(listOf(ActiveTreeNode(BadgeRow("a")), ActiveTreeNode(BadgeRow("b"))))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(DefaultTreeUI())
        view.setSize(400, 300)
        val first = view.hierarchy.entries.getValue("a")
        val second = view.hierarchy.entries.getValue("b")

        moveTo(view, first)
        assertEquals(BADGE, view.state(first, false, false).hoveredCell)
        assertNull(view.state(second, false, false).hoveredCell)

        moveTo(view, second)
        assertNull(view.state(first, false, false).hoveredCell)
        assertEquals(BADGE, view.state(second, false, false).hoveredCell)

        val frame = requireNotNull(view.regions.frame(second))
        view.dispatchEvent(
            MouseEvent(
                view, MouseEvent.MOUSE_MOVED, 0, 0, frame.x + 1, frame.y + frame.height / 2, 0, false,
                MouseEvent.NOBUTTON,
            ),
        )
        assertNull(view.state(second, false, false).hoveredCell)
    }

    fun `test the menu button is hoverable around its compact icon box`() {
        val menu = ActiveMenu(DataKey.create<String>("test.menu.compact"), DefaultActionGroup(), { it.key })
        val tree = ActiveTree("", menu = menu)
        tree.update(listOf(ActiveTreeNode(BadgeRow("a")), ActiveTreeNode(BadgeRow("b"))))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(DefaultTreeUI())
        view.setSize(400, 300)
        val entry = view.hierarchy.entries.getValue("a")
        val frame = requireNotNull(view.regions.frame(entry))
        moveTo(view, Point(frame.x + 1, frame.y + frame.height / 2))
        val hit = view.regions.hits(entry).single { it.id == ACTIVE_MENU_CELL }
        val cell = requireNotNull(view.regions.cell(entry))
        val standard = iconButtonSize(AllIcons.Actions.More)

        assertEquals("The menu hover uses the standard icon-button width", standard.width, hit.bounds.width)
        assertEquals("The menu hover uses the standard icon-button height", standard.height, hit.bounds.height)
        assertTrue("The menu hover is not stretched over the row height", hit.bounds.height < cell.height)
        assertEquals("The menu hover stays vertically centered", frame.y + (frame.height - hit.bounds.height) / 2,
            hit.bounds.y)
        assertTrue("The menu hover stays inside the trailing edge",
            hit.bounds.x + hit.bounds.width <= cell.x + cell.width)

        for (x in listOf(hit.bounds.x, hit.bounds.x + hit.bounds.width / 2, hit.bounds.x + hit.bounds.width - 1)) {
            moveTo(view, Point(x, hit.bounds.y + hit.bounds.height / 2))
            assertEquals(ACTIVE_MENU_CELL, view.state(entry, false, false).hoveredCell)
        }
    }

    fun `test unsupported delegate owns disclosure and group body clicks`() {
        var selections = 0
        val actions = ActiveTreeActions(select = { selections++ })
        val tree = ActiveTree("", actions = actions)
        val view = tree.preferredFocus() as ActiveTreeView
        val ui = Fallback()
        view.setUI(ui)
        tree.update(listOf(ActiveTreeNode(Row("main")), nodes().single()))
        view.setSize(400, 300)
        tree.select("main", false)
        selections = 0
        val entry = view.hierarchy.entries.getValue("group")
        val path = TreePath(entry.path)
        val bounds = view.getPathBounds(path)
        val y = bounds.y + bounds.height / 2
        val x = (0 until view.width).first { ui.contains(path, Point(it, y)) }
        val point = Point(x, y)
        val pointer = ActiveTreePointer(view, actions)
        assertNull(view.regions.control(entry))
        fun event(id: Int, point: Point, count: Int = 1) = MouseEvent(view, id, 0, 0,
            point.x, point.y, count, false, MouseEvent.BUTTON1)

        for (expanded in listOf(false, true)) {
            assertFalse(pointer.process(event(MouseEvent.MOUSE_PRESSED, point)))
            ui.press(path, point)
            assertEquals(expanded, view.isExpanded(path))
            for (id in listOf(MouseEvent.MOUSE_RELEASED, MouseEvent.MOUSE_CLICKED)) {
                assertFalse(pointer.process(event(id, point)))
                assertEquals("Native disclosure must not be toggled again", expanded, view.isExpanded(path))
            }
        }

        val body = Point(bounds.x + bounds.width / 2, y)
        assertFalse(ui.contains(path, body))
        for (count in 1..2) {
            assertFalse("Unknown delegate owns group body clicks", pointer.process(event(MouseEvent.MOUSE_CLICKED, body, count)))
            assertTrue(view.isExpanded(path))
        }
        assertEquals(listOf("main"), tree.selectedKeys())
        assertEquals(0, selections)
    }

    fun `test shift F10 checks branch menu eligibility`() {
        val calls = mutableListOf<String>()
        val menu = ActiveMenu(DataKey.create<String>("test.menu.branch.keyboard"), DefaultActionGroup(), { it.key },
            eligible = {
                calls += it.key
                false
            })
        val tree = ActiveTree("", menu = menu)
        tree.update(nodes())
        tree.select("group", false)
        val view = tree.preferredFocus() as ActiveTreeView
        calls.clear()

        val action = view.getActionForKeyStroke(KeyStroke.getKeyStroke(KeyEvent.VK_F10, InputEvent.SHIFT_DOWN_MASK))
        assertNotNull(action)
        action.actionPerformed(ActionEvent(view, ActionEvent.ACTION_PERFORMED, "menu"))

        assertEquals(listOf("group"), calls)
    }

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

    @RequiresEdt
    private fun moveTo(view: ActiveTreeView, entry: ActiveEntry) {
        val hit = view.regions.hits(entry).single { it.id == BADGE }
        moveTo(view, Point(hit.bounds.centerX.toInt(), hit.bounds.centerY.toInt()))
    }

    private fun moveTo(view: ActiveTreeView, point: Point) {
        view.dispatchEvent(
            MouseEvent(view, MouseEvent.MOUSE_MOVED, 0, 0, point.x, point.y, 0, false, MouseEvent.NOBUTTON),
        )
    }

    private fun nodes() = listOf(ActiveTreeNode(Row("group"), listOf("a", "b", "c").map {
        ActiveTreeNode(Row(it))
    }))

    private class BadgeRow(override val key: String) : ActiveItem {
        override val title = key
        override val secondaryBadges = listOf(
            ActiveBadge("#1", UiStyle.Badge.PullRequestOpen, id = BADGE, action = {}),
        )
    }

    @RequiresEdt
    private fun keys(view: ActiveTreeView): List<String> = view.hierarchy.entries.getValue("group").let { node ->
        (0 until node.childCount).map { (node.getChildAt(it) as ActiveEntry).key }
    }

    private class Delegate : DefaultTreeUI() {
        @RequiresEdt
        fun contains(path: TreePath, point: Point): Boolean = isLocationInExpandControl(path, point.x, point.y)
    }

    private class Fallback : MetalTreeUI() {
        @RequiresEdt
        fun contains(path: TreePath, point: Point): Boolean = isLocationInExpandControl(path, point.x, point.y)

        @RequiresEdt
        fun press(path: TreePath, point: Point) = checkForClickInExpandControl(path, point.x, point.y)
    }
}
