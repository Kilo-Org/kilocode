package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.testing.fire
import com.intellij.openapi.application.ApplicationManager
import com.intellij.ui.CollectionListModel
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import java.awt.Container
import java.awt.Dimension
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.SwingUtilities

class SettingsListViewTest : BasePlatformTestCase() {
    fun `test list owns formatted description tooltip`() {
        edt {
            val view = SettingsListView("Empty") { _, _ -> }
            val row = item("with", "Alpha", "Use <safe> text\nAcross lines")
            view.update(listOf(row, item("without", "Beta", null)))
            view.list.size = Dimension(320, 120)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            val bounds = view.list.getCellBounds(0, 0)
            val tip = view.list.getToolTipText(event(view.list, Point(bounds.x + 4, bounds.y + 4)))

            assertNotNull(tip)
            assertTrue(tip, tip!!.startsWith("<html>"))
            assertTrue(tip, tip.contains("Use &lt;safe&gt; text"))
            assertTrue(tip, tip.contains("<br>Across lines"))
        }
    }

    fun `test list description tooltip ignores blank rows and outside points`() {
        edt {
            val view = SettingsListView("Empty") { _, _ -> }
            view.update(listOf(item("without", "Beta", null)))
            view.list.size = Dimension(320, 80)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            val bounds = view.list.getCellBounds(0, 0)

            assertNull(view.list.getToolTipText(event(view.list, Point(bounds.x + 4, bounds.y + 4))))
            assertNull(view.list.getToolTipText(event(view.list, Point(4, bounds.y + bounds.height + 20))))
        }
    }

    fun `test rows use equal height from tallest rendered row`() {
        edt {
            val view = SettingsListView("Empty") { _, _ -> }
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
            val view = SettingsListView("Empty") { _, _ -> }
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
            val view = SettingsListView("Empty", SettingsListConfig.Preferred) { _, _ -> }
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
            val view = SettingsListView("Empty", SettingsListConfig.Preferred) { _, _ -> }
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
            val model = CollectionListModel<SettingsListItem>(listOf(row))
            val list = JBList(model)
            val renderer = SettingsListRenderer(model, SettingsListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, true)
            renderer.setSize(320, renderer.preferredSize.height)
            layout(renderer)

            val title = components(renderer).filterIsInstance<SimpleColoredComponent>().single()
            val desc = components(renderer).filterIsInstance<JBLabel>().single { it.text == "Description" }

            assertEquals(0, title.insets.left)
            assertTrue(desc.insets.left > title.insets.left)
        }
    }

    fun `test title only config suppresses descriptions and tooltips`() {
        edt {
            val cfg = SettingsListConfig.Equal.copy(description = false)
            val row = item("with", "Alpha", "Description", SettingsListCell("edit", "Edit"))
            val model = CollectionListModel<SettingsListItem>(listOf(row))
            val list = JBList(model)
            val renderer = SettingsListRenderer(model, cfg)
            val view = SettingsListView("Empty", cfg) { _, _ -> }

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
        }
    }

    fun `test action click invokes from full rendered area`() {
        edt {
            val calls = mutableListOf<String>()
            val view = SettingsListView("Empty") { key, id -> calls += "$key:$id" }
            val row = item("with", "Alpha", null, SettingsListCell("edit", "Edit"))
            view.update(listOf(row))
            view.list.size = Dimension(320, 80)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            val area = settingsListCellBounds(view.list, 0, selected = true).getValue("edit")
            val point = Point(area.x + area.width - 1, area.y + area.height - 1)

            click(view, point)

            assertEquals(listOf("with:edit"), calls)
        }
    }

    fun `test action hit test ignores stale indexes`() {
        edt {
            val view = SettingsListView("Empty") { _, _ -> }
            view.update(listOf(item("with", "Alpha", null, SettingsListCell("edit", "Edit"))))
            layout(view)

            assertNull(settingsListCellAt(view.list, -1, Point(0, 0), selected = true))
            assertNull(settingsListCellAt(view.list, view.list.model.size, Point(0, 0), selected = true))
        }
    }

    fun `test double click invokes primary cell instead of first visual cell`() {
        edt {
            val calls = mutableListOf<String>()
            val view = SettingsListView("Empty") { key, id -> calls += "$key:$id" }
            val row = item(
                "with",
                "Alpha",
                null,
                SettingsListCell("connect", "Connect"),
                SettingsListCell("edit", "Edit", primary = true),
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
            val view = SettingsListView("Empty") { key, id -> calls += "$key:$id" }
            val row = item("with", "Alpha", null, SettingsListCell("edit", "Edit", enabled = false))
            view.update(listOf(row))
            view.list.size = Dimension(320, 80)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            val area = settingsListCellBounds(view.list, 0, selected = true).getValue("edit")

            click(view, center(area))

            assertTrue(calls.isEmpty())
        }
    }

    fun `test update selects preferred key`() {
        edt {
            val view = SettingsListView("Empty") { _, _ -> }
            view.update(listOf(item("a", "Alpha", null), item("b", "Beta", null)))
            view.update(
                listOf(item("a", "Alpha", null), item("b", "Beta", null), item("c", "Gamma", null)),
                SettingsListSelection.Key("c"),
            )

            assertEquals("c", view.selected()?.key)
        }
    }

    fun `test update selects preferred index`() {
        edt {
            val view = SettingsListView("Empty") { _, _ -> }
            view.update(listOf(item("a", "Alpha", null), item("b", "Beta", null), item("c", "Gamma", null)))
            view.list.selectedIndex = 1
            view.update(listOf(item("a", "Alpha", null), item("c", "Gamma", null)), SettingsListSelection.Index(1))

            assertEquals("c", view.selected()?.key)
        }
    }

    private fun item(id: String, name: String, note: String?, vararg cells: SettingsListCell) = object : SettingsListItem {
        override val key = id
        override val title = name
        override val description = note
        override val cells = cells.toList()
    }

    private fun layout(view: SettingsListView) {
        view.list.size = Dimension(320, 160)
        view.list.doLayout()
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun layout(root: Container) {
        root.doLayout()
        root.components.filterIsInstance<Container>().forEach { layout(it) }
        UIUtil.dispatchAllInvocationEvents()
    }

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

    private fun center(rect: java.awt.Rectangle) = Point(rect.x + rect.width / 2, rect.y + rect.height / 2)

    private fun click(view: SettingsListView, point: Point) {
        fire(view.list, mouse(view, MouseEvent.MOUSE_PRESSED, point))
        fire(view.list, mouse(view, MouseEvent.MOUSE_RELEASED, point))
    }

    private fun mouse(view: SettingsListView, id: Int, point: Point, count: Int = 1) = MouseEvent(
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
