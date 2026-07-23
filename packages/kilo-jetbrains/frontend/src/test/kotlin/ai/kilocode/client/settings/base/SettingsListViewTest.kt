package ai.kilocode.client.settings.base

import ai.kilocode.client.testing.fire
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ActiveListActionCell
import ai.kilocode.client.ui.list.ActiveListActive
import ai.kilocode.client.ui.list.ActiveListCell
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListRenderer
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.client.ui.list.ActiveListView
import ai.kilocode.client.ui.list.activeListCellAt
import ai.kilocode.client.ui.list.activeListCellBounds
import com.intellij.icons.AllIcons
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.CollectionListModel
import com.intellij.ui.ScrollingUtil
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.UIUtil
import java.awt.Container
import java.awt.Dimension
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.ListSelectionModel
import javax.swing.Scrollable
import javax.swing.SwingConstants
import javax.swing.SwingUtilities

class SettingsListViewTest : BasePlatformTestCase() {
    fun `test list shows description tooltip over row body`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            val row = item("with", "Alpha", "Use <safe> text\nAcross lines")
            view.update(listOf(row, item("without", "Beta", null)))
            view.list.size = Dimension(320, 120)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            val bounds = view.list.getCellBounds(0, 0)
            val tip = view.list.getToolTipText(event(view.list, Point(bounds.x + 4, bounds.y + 4)))

            assertEquals("<html>Use &lt;safe&gt; text<br>Across lines</html>", tip)
        }
    }

    fun `test tooltip config suppresses description tooltip but keeps action tooltip`() {
        edt {
            val cfg = ActiveListConfig.Equal.copy(tooltip = false)
            val view = ActiveListView("Empty", cfg) { _, _ -> }
            val row = item("with", "Alpha", "Description", ActiveListCell("edit", "Edit", alwaysVisible = true))
            view.update(listOf(row))
            layout(view)

            val bounds = view.list.getCellBounds(0, 0)
            val area = activeListCellBounds(view.list, 0, selected = true).getValue("edit")

            assertNull(view.list.getToolTipText(event(view.list, Point(bounds.x + 4, bounds.y + 4))))
            assertEquals("Edit", view.list.getToolTipText(event(view.list, center(area))))
        }
    }

    fun `test rows use equal height from tallest rendered row`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(listOf(
                item("with", "Alpha", "Description makes this row taller"),
                item("without", "Beta", null),
            ))
            layout(view)

            val first = view.list.getCellBounds(0, 0)
            val second = view.list.getCellBounds(1, 1)

            assertEquals(first.height, second.height)
        }
    }

    fun `test filtering recalculates equal row height for visible rows`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(listOf(
                item("shown-desc", "Shown described", "Description makes this row taller"),
                item("hidden", "Hidden", "Filtered row has a description"),
                item("shown-plain", "Shown plain", null),
            ))
            view.filter("Shown")
            layout(view)

            val first = view.list.getCellBounds(0, 0)
            val second = view.list.getCellBounds(1, 1)

            assertEquals(2, view.list.model.size)
            assertEquals(first.height, second.height)
        }
    }

    fun `test preferred row height uses each rendered row height`() {
        edt {
            val view = ActiveListView("Empty", ActiveListConfig.Preferred) { _, _ -> }
            view.update(listOf(
                item("with", "Alpha", "Description makes this row taller"),
                item("without", "Beta", null),
            ))
            layout(view)

            val first = view.list.getCellBounds(0, 0)
            val second = view.list.getCellBounds(1, 1)

            assertEquals(-1, view.list.fixedCellHeight)
            assertTrue(first.height > second.height)
        }
    }

    fun `test filtering keeps preferred row heights for visible rows`() {
        edt {
            val view = ActiveListView("Empty", ActiveListConfig.Preferred) { _, _ -> }
            view.update(listOf(
                item("shown-desc", "Shown described", "Description makes this row taller"),
                item("hidden", "Hidden", "Filtered row has a description"),
                item("shown-plain", "Shown plain", null),
            ))
            view.filter("Shown")
            layout(view)

            val first = view.list.getCellBounds(0, 0)
            val second = view.list.getCellBounds(1, 1)

            assertEquals(2, view.list.model.size)
            assertEquals(-1, view.list.fixedCellHeight)
            assertTrue(first.height > second.height)
        }
    }

    fun `test renderer keeps title flush and indents description only`() {
        edt {
            val row = item("with", "Alpha", "Description")
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, true)
            renderer.setSize(320, renderer.preferredSize.height)
            layout(renderer)

            val title = components(renderer).filterIsInstance<SimpleColoredComponent>().single()
            val desc = components(renderer).filterIsInstance<JBLabel>().single { it.text == "Description" }

            assertEquals(0, title.insets.left)
            assertTrue(desc.insets.left > title.insets.left)
        }
    }

    fun `test renderer centers leading icon vertically in the row`() {
        edt {
            val row = object : ActiveListItem {
                override val key = "with"
                override val title = "Alpha"
                override val description = "Description"
                override val icon = AllIcons.Nodes.Plugin
            }
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, true)
            renderer.setSize(320, renderer.preferredSize.height)
            layout(renderer)

            val icon = components(renderer).filterIsInstance<JBLabel>().single { it.icon === AllIcons.Nodes.Plugin }

            assertTrue(kotlin.math.abs(centerY(renderer, icon) - renderer.height / 2) <= 1)
        }
    }

    fun `test title only config suppresses descriptions and tooltips`() {
        edt {
            val cfg = ActiveListConfig.Equal.copy(description = false)
            val row = item("with", "Alpha", "Description", ActiveListCell("edit", "Edit"))
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, cfg)
            val view = ActiveListView("Empty", cfg) { _, _ -> }

            renderer.getListCellRendererComponent(list, row, 0, true, true)
            renderer.setSize(320, renderer.preferredSize.height + UiStyle.Gap.xl())
            layout(renderer)
            view.update(listOf(row))
            layout(view)
            val bounds = view.list.getCellBounds(0, 0)
            val title = components(renderer).filterIsInstance<SimpleColoredComponent>().single()
            val action = components(renderer).filterIsInstance<JBLabel>().single { it.text == "Edit" }

            assertTrue(components(renderer).filterIsInstance<JBLabel>().none { it.text == "Description" && it.isVisible })
            assertNull(view.list.getToolTipText(event(view.list, Point(bounds.x + 4, bounds.y + 4))))
            assertTrue(kotlin.math.abs(centerY(renderer, title) - centerY(renderer, action)) <= 1)
            assertTrue(kotlin.math.abs(centerY(renderer, action) - renderer.height / 2) <= 1)
        }
    }

    fun `test action click invokes from full rendered area`() {
        edt {
            val calls = mutableListOf<String>()
            val view = ActiveListView("Empty") { key, id -> calls += "$key:$id" }
            val row = item("with", "Alpha", null, ActiveListCell("edit", "Edit"))
            view.update(listOf(row))
            view.list.size = Dimension(320, 80)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            val area = activeListCellBounds(view.list, 0, selected = true).getValue("edit")
            val point = Point(area.x + area.width - 1, area.y + area.height - 1)

            click(view, point)

            assertEquals(listOf("with:edit"), calls)
        }
    }

    fun `test action hit test ignores stale indexes`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(listOf(item("with", "Alpha", null, ActiveListCell("edit", "Edit"))))
            layout(view)

            assertNull(activeListCellAt(view.list, -1, Point(0, 0), selected = true))
            assertNull(activeListCellAt(view.list, view.list.model.size, Point(0, 0), selected = true))
        }
    }

    fun `test double click invokes primary cell instead of first visual cell`() {
        edt {
            val calls = mutableListOf<String>()
            val view = ActiveListView("Empty") { key, id -> calls += "$key:$id" }
            val row = item(
                "with",
                "Alpha",
                null,
                ActiveListCell("connect", "Connect"),
                ActiveListCell("edit", "Edit", primary = true),
            )
            view.update(listOf(row))
            layout(view)
            val bounds = view.list.getCellBounds(0, 0)
            val point = Point(bounds.x + 4, bounds.y + bounds.height / 2)

            fire(view.list, mouse(view, MouseEvent.MOUSE_CLICKED, point, count = 2))

            assertEquals(listOf("with:edit"), calls)
        }
    }

    fun `test disabled action click does not invoke`() {
        edt {
            val calls = mutableListOf<String>()
            val view = ActiveListView("Empty") { key, id -> calls += "$key:$id" }
            val row = item("with", "Alpha", null, ActiveListCell("edit", "Edit", enabled = false))
            view.update(listOf(row))
            view.list.size = Dimension(320, 80)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            val area = activeListCellBounds(view.list, 0, selected = true).getValue("edit")

            click(view, center(area))

            assertTrue(calls.isEmpty())
        }
    }

    fun `test unfocused selected row is not painted as active`() {
        edt {
            val row = item("with", "Alpha", "Description")
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, false)

            val desc = components(renderer).filterIsInstance<JBLabel>().single { it.text == "Description" }
            assertEquals(UiStyle.Colors.weak(), desc.foreground)
        }
    }

    fun `test in-place action cells are hidden on unfocused selected row`() {
        edt {
            val row = item("with", "Alpha", "Description", ActiveListCell("edit", "Edit"))
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, false)
            assertTrue(actionCells(renderer).none { it.isVisible })

            renderer.getListCellRendererComponent(list, row, 0, true, true)
            assertEquals(listOf("edit"), actionCells(renderer).filter { it.isVisible }.map { it.cellId })
        }
    }

    fun `test always visible action cells stay on unfocused row`() {
        edt {
            val row = item("with", "Alpha", "Description", ActiveListCell("level", "Allow", alwaysVisible = true))
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, false)

            assertEquals(listOf("level"), actionCells(renderer).filter { it.isVisible }.map { it.cellId })
        }
    }

    fun `test active popup paints selected row as active without focus`() {
        edt {
            val row = item("with", "Alpha", "Description")
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = object : JBList<ActiveListItem>(model), ActiveListActive {
                override fun active(): Boolean = true
            }
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, false)

            val desc = components(renderer).filterIsInstance<JBLabel>().single { it.text == "Description" }
            assertEquals(UIUtil.getListForeground(true, true), desc.foreground)
        }
    }

    fun `test action click invokes on second selected row in multi selection list`() {
        edt {
            val calls = mutableListOf<String>()
            val cfg = ActiveListConfig.Equal.copy(selection = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION)
            val view = ActiveListView("Empty", cfg) { key, id -> calls += "$key:$id" }
            view.update(listOf(
                item("a", "Alpha", null, ActiveListCell("edit", "Edit", alwaysVisible = false)),
                item("b", "Beta", null, ActiveListCell("edit", "Edit", alwaysVisible = false)),
            ))
            layout(view)
            view.list.selectedIndices = intArrayOf(0, 1)

            val area = activeListCellBounds(view.list, 1, selected = true).getValue("edit")
            click(view, center(area))

            assertEquals(listOf("b:edit"), calls)
        }
    }

    fun `test preserve no scroll keeps scroll position after row change`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            val rows = (0 until 30).map { item("row$it", "Row $it", null, ActiveListCell("level", "Allow", alwaysVisible = true)) }
            view.update(rows)
            val scroll = JBScrollPane(view.list)
            scroll.size = Dimension(320, 80)
            scroll.doLayout()
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            view.list.selectedIndex = 25
            ScrollingUtil.ensureIndexIsVisible(view.list, 25, 0)
            scroll.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            val before = scroll.viewport.viewPosition.y
            assertTrue("expected a scrolled viewport", before > 0)

            view.update(rows, ActiveListSelection.PreserveNoScroll)
            UIUtil.dispatchAllInvocationEvents()

            assertEquals(before, scroll.viewport.viewPosition.y)
            assertEquals("row25", view.selected()?.key)
        }
    }

    fun `test update selects preferred key`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(listOf(item("a", "Alpha", null), item("b", "Beta", null)))
            view.update(
                listOf(item("a", "Alpha", null), item("b", "Beta", null), item("c", "Gamma", null)),
                ActiveListSelection.Key("c"),
            )

            assertEquals("c", view.selected()?.key)
        }
    }

    fun `test update selects preferred index`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(listOf(item("a", "Alpha", null), item("b", "Beta", null), item("c", "Gamma", null)))
            view.list.selectedIndex = 1
            view.update(listOf(item("a", "Alpha", null), item("c", "Gamma", null)), ActiveListSelection.Index(1))

            assertEquals("c", view.selected()?.key)
        }
    }

    fun `test list view tracks viewport width`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(listOf(item("long", "Alpha", "A very long description that should wrap instead of scrolling")))

            assertTrue((view as Scrollable).getScrollableTracksViewportWidth())
            assertFalse(view.getScrollableTracksViewportHeight())
            assertEquals(160, view.getScrollableBlockIncrement(java.awt.Rectangle(0, 0, 320, 160), SwingConstants.VERTICAL, 1))
        }
    }

    private fun item(id: String, name: String, note: String?, vararg cells: ActiveListCell) = object : ActiveListItem {
        override val key = id
        override val title = name
        override val description = note
        override val cells = cells.toList()
    }

    private fun layout(view: ActiveListView) {
        view.list.size = Dimension(320, 160)
        view.list.doLayout()
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun layout(root: Container) {
        root.doLayout()
        root.components.filterIsInstance<Container>().forEach { layout(it) }
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun actionCells(root: java.awt.Component): List<ActiveListActionCell> =
        components(root).filterIsInstance<ActiveListActionCell>()

    private fun components(root: java.awt.Component): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        fun visit(item: java.awt.Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private fun centerY(root: java.awt.Component, child: java.awt.Component): Int {
        val point = SwingUtilities.convertPoint(child.parent, child.location, root)
        return point.y + child.height / 2
    }

    private fun topY(root: java.awt.Component, child: java.awt.Component): Int =
        SwingUtilities.convertPoint(child.parent, child.location, root).y

    private fun center(rect: java.awt.Rectangle) = Point(rect.x + rect.width / 2, rect.y + rect.height / 2)

    private fun click(view: ActiveListView, point: Point) {
        fire(view.list, mouse(view, MouseEvent.MOUSE_PRESSED, point))
        fire(view.list, mouse(view, MouseEvent.MOUSE_RELEASED, point))
    }

    private fun mouse(view: ActiveListView, id: Int, point: Point, count: Int = 1) = MouseEvent(
        view.list,
        id,
        System.currentTimeMillis(),
        if (id == MouseEvent.MOUSE_PRESSED) InputEvent.BUTTON1_DOWN_MASK else 0,
        point.x,
        point.y,
        count,
        false,
        MouseEvent.BUTTON1,
    )

    private fun event(list: javax.swing.JList<*>, point: Point) = MouseEvent(
        list,
        MouseEvent.MOUSE_MOVED,
        System.currentTimeMillis(),
        0,
        point.x,
        point.y,
        0,
        false,
    )

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }
}
