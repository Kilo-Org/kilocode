package ai.kilocode.client.settings.base

import ai.kilocode.client.util.edtWait
import ai.kilocode.client.testing.fire
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.PickerRow
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.LayeredOverlayPanel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ActiveListActionCell
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListActive
import ai.kilocode.client.ui.list.ActiveListCell
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListMenu
import ai.kilocode.client.ui.list.ActiveListMetrics
import ai.kilocode.client.ui.list.ActiveListRenderer
import ai.kilocode.client.ui.list.ActiveListRowHeight
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.client.ui.list.ActiveListView
import ai.kilocode.client.ui.list.ActiveListWeight
import ai.kilocode.client.ui.list.ACTIVE_LIST_CHANGES_CELL
import ai.kilocode.client.ui.list.ACTIVE_LIST_MENU_CELL
import ai.kilocode.client.ui.list.ACTIVE_LIST_PR_CELL
import ai.kilocode.client.ui.list.activeListCellAt
import ai.kilocode.client.ui.list.activeListCellBounds
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.CollectionListModel
import com.intellij.ui.GroupHeaderSeparator
import com.intellij.ui.ScrollingUtil
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Container
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
import javax.swing.JLayeredPane
import javax.swing.JPanel
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

    fun `test active list config defaults to equal row height`() {
        assertEquals(ActiveListRowHeight.EQUAL, ActiveListConfig().height)
        assertEquals(ActiveListRowHeight.PREFERRED, ActiveListConfig.Preferred.height)
    }

    fun `test equal rows keep section headers out of body height`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(listOf(
                sectionItem("first", "First", "Today"),
                sectionItem("second", "Second", "Today"),
                sectionItem("third", "Third", "Yesterday"),
            ))
            layout(view)

            val first = view.list.getCellBounds(0, 0)
            val second = view.list.getCellBounds(1, 1)
            val third = view.list.getCellBounds(2, 2)

            assertTrue("fixed=${view.list.fixedCellHeight} first=${first.height} second=${second.height} third=${third.height}", first.height > second.height)
            assertTrue("fixed=${view.list.fixedCellHeight} first=${first.height} second=${second.height} third=${third.height}", third.height > second.height)
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

    fun `test renderer draws the row title in bold`() {
        edt {
            val row = item("with", "Alpha", "Description")
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, true)

            // Weight is what separates the title from the muted description beside and below it.
            val title = components(renderer).filterIsInstance<SimpleColoredComponent>().single()
            val iter = title.iterator()
            iter.next()
            assertEquals(SimpleTextAttributes.STYLE_BOLD, iter.textAttributes.style)
            assertEquals("Alpha", iter.fragment)
        }
    }

    fun `test renderer draws the row title in plain weight when configured`() {
        edt {
            val row = item("with", "Alpha", "Description")
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal.copy(title = ActiveListWeight.PLAIN))

            renderer.getListCellRendererComponent(list, row, 0, true, true)

            val title = components(renderer).filterIsInstance<SimpleColoredComponent>().single()
            val iter = title.iterator()
            iter.next()
            assertEquals(SimpleTextAttributes.STYLE_PLAIN, iter.textAttributes.style)
            assertEquals("Alpha", iter.fragment)
        }
    }

    fun `test renderer styles section header weight from config`() {
        edt {
            val first = sectionItem("one", "Alpha", "Local")
            val second = sectionItem("two", "Beta", "Remote")
            val model = CollectionListModel<ActiveListItem>(listOf(first, second))
            val list = JBList(model)
            val bold = ActiveListRenderer(model, ActiveListConfig.Equal)
            val plain = ActiveListRenderer(model, ActiveListConfig.Equal.copy(header = ActiveListWeight.PLAIN))

            bold.getListCellRendererComponent(list, second, 1, false, false)
            plain.getListCellRendererComponent(list, second, 1, false, false)

            assertTrue(components(bold).filterIsInstance<GroupHeaderSeparator>().single().font.isBold)
            assertFalse(components(plain).filterIsInstance<GroupHeaderSeparator>().single().font.isBold)
        }
    }

    fun `test renderer reads section divider visibility from config`() {
        edt {
            val first = sectionItem("one", "Alpha", "Local")
            val second = sectionItem("two", "Beta", "Remote")
            val model = CollectionListModel<ActiveListItem>(listOf(first, second))
            val list = JBList(model)
            val divider = ActiveListRenderer(model, ActiveListConfig.Equal)
            val none = ActiveListRenderer(model, ActiveListConfig.Equal.copy(divider = false))

            divider.getListCellRendererComponent(list, first, 0, false, false)
            assertTrue(components(divider).filterIsInstance<GroupHeaderSeparator>().single().isHideLine)
            divider.getListCellRendererComponent(list, second, 1, false, false)
            assertFalse(components(divider).filterIsInstance<GroupHeaderSeparator>().single().isHideLine)

            none.getListCellRendererComponent(list, first, 0, false, false)
            assertTrue(components(none).filterIsInstance<GroupHeaderSeparator>().single().isHideLine)
            none.getListCellRendererComponent(list, second, 1, false, false)
            assertTrue(components(none).filterIsInstance<GroupHeaderSeparator>().single().isHideLine)
        }
    }

    fun `test narrow row squeezes title but keeps tags full width`() {
        edt {
            val row = object : ActiveListItem {
                override val key = "with"
                override val title = "A very long session title that cannot fit in a narrow row"
                override val badges = listOf(ActiveListBadge("Running"))
            }
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, true)
            renderer.setSize(160, renderer.preferredSize.height)
            layout(renderer)

            val badge = components(renderer).filterIsInstance<JBLabel>()
                .single { (it.icon as? FilledBadgeIcon)?.text == "Running" }
            val title = components(renderer).filterIsInstance<SimpleColoredComponent>().single()

            assertTrue(badge.isVisible)
            assertTrue(badge.width >= badge.icon.iconWidth)
            assertTrue(title.width < title.preferredSize.width)
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

            renderer.getListCellRendererComponent(list, row, 0, false, false)
            renderer.setSize(320, renderer.preferredSize.height)
            layout(renderer)

            val icon = components(renderer).filterIsInstance<JBLabel>().single { it.icon === AllIcons.Nodes.Plugin }

            assertTrue(kotlin.math.abs(centerY(renderer, icon) - renderer.height / 2) <= 1)
        }
    }

    fun `test renderer recolors a tinted leading icon to the foreground on selection`() {
        edt {
            val row = object : ActiveListItem {
                override val key = "with"
                override val title = "Alpha"
                override val icon = AllIcons.Nodes.Plugin
                override val tinted = true
            }
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, false, false)
            val mark = components(renderer).filterIsInstance<JBLabel>().single { it.icon === AllIcons.Nodes.Plugin }
            renderer.getListCellRendererComponent(list, row, 0, true, true)

            // At rest the row keeps the icon's own theme color; a focused selection swaps in a
            // foreground-tinted copy so the glyph matches the highlighted title.
            assertNotSame(AllIcons.Nodes.Plugin, mark.icon)
        }
    }

    fun `test renderer keeps an untinted colored icon on selection`() {
        edt {
            val row = object : ActiveListItem {
                override val key = "with"
                override val title = "Alpha"
                override val icon = AllIcons.Nodes.Plugin
            }
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, true)

            // Colored status glyphs (running, question, error) opt out and keep their own hue: the
            // leading label still holds the original icon by identity after a focused selection.
            assertNotNull(components(renderer).filterIsInstance<JBLabel>().single { it.icon === AllIcons.Nodes.Plugin })
        }
    }

    fun `test renderer shows optional trailing text`() {
        edt {
            val with = object : ActiveListItem {
                override val key = "with"
                override val title = "Alpha"
                override val trailing = "3h ago"
            }
            val without = object : ActiveListItem {
                override val key = "without"
                override val title = "Beta"
            }
            val model = CollectionListModel<ActiveListItem>(listOf(with, without))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, with, 0, true, true)

            val trail = components(renderer).filterIsInstance<JBLabel>().single { it.text == "3h ago" }
            assertTrue(trail.isVisible)
            assertEquals(SwingConstants.RIGHT, trail.horizontalAlignment)

            renderer.getListCellRendererComponent(list, without, 1, true, true)

            assertTrue(components(renderer).filterIsInstance<JBLabel>().none { it.text == "3h ago" && it.isVisible })
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

    fun `test action cells render from overlay layer`() {
        edt {
            val row = item("with", "Alpha", null, ActiveListCell("edit", "Edit"))
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, true)
            renderer.setSize(320, renderer.preferredSize.height)
            layout(renderer)

            val layers = components(renderer).filterIsInstance<LayeredOverlayPanel>().single()
            val cell = actionCells(renderer).single()
            val pane = SwingUtilities.getAncestorOfClass(LayeredOverlayPanel.Overlay::class.java, cell)

            assertSame(layers.overlay, pane)
            assertEquals(JLayeredPane.DEFAULT_LAYER, layers.getLayer(layers.content))
            assertEquals(JLayeredPane.PALETTE_LAYER, layers.getLayer(layers.overlay))
            assertTrue(layers.getLayer(layers.overlay) > layers.getLayer(layers.content))
        }
    }

    fun `test action overlay background blends with row surface`() {
        edt {
            val first = item("selected", "Alpha", null, ActiveListCell("edit", "Edit"))
            val second = item("plain", "Beta", null, ActiveListCell("level", "Allow", alwaysVisible = true))
            val model = CollectionListModel<ActiveListItem>(listOf(first, second))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, first, 0, true, true)
            val selected = actionPill(renderer).background

            renderer.getListCellRendererComponent(list, second, 1, false, false)
            val plain = actionPill(renderer).background

            assertEquals(UIUtil.getListBackground(true, true), selected)
            assertEquals(list.background, plain)
        }
    }

    fun `test action cells do not reserve row east space`() {
        edt {
            val row = item("with", "Alpha", null, ActiveListCell("edit", "Edit"))
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, true)
            renderer.setSize(320, renderer.preferredSize.height)
            layout(renderer)

            val layers = components(renderer).filterIsInstance<LayeredOverlayPanel>().single()
            val rowPanel = layers.content.getComponent(0) as JPanel
            val text = (rowPanel.layout as BorderLayout).getLayoutComponent(BorderLayout.CENTER)
            val cell = actionCells(renderer).single()
            val start = SwingUtilities.convertPoint(text.parent, text.location, renderer).x
            val cellStart = SwingUtilities.convertPoint(cell.parent, cell.location, renderer).x

            assertTrue(text.width > start)
            assertTrue(start + text.width > cellStart)
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

    fun `test focused selected row keeps description muted`() {
        edt {
            val row = item("with", "Alpha", "Description")
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, true)

            val desc = components(renderer).filterIsInstance<JBLabel>().single { it.text == "Description" }
            assertEquals(UiStyle.Colors.weak(), desc.foreground)
        }
    }

    fun `test unfocused selected row paints inactive selection background`() {
        edt {
            val row = item("with", "Alpha", "Description")
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, false)

            val picker = components(renderer).filterIsInstance<PickerRow>().single()
            assertEquals(UIUtil.getListBackground(true, false), picker.selectionColor)
        }
    }

    fun `test focused selected row paints active selection background`() {
        edt {
            val row = item("with", "Alpha", "Description")
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, true)

            val picker = components(renderer).filterIsInstance<PickerRow>().single()
            assertEquals(UIUtil.getListBackground(true, true), picker.selectionColor)
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

    fun `test hover alone does not reveal cells on unselected row`() {
        edt {
            val cfg = ActiveListConfig.Equal.copy(hoverActions = true)
            val view = ActiveListView("Empty", cfg) { _, _ -> }
            view.update(listOf(item("with", "Alpha", null, ActiveListCell("edit", "Edit"))))
            layout(view)
            view.list.clearSelection()

            hover(view, center(view.list.getCellBounds(0, 0)))

            assertTrue(renderedCells(view, 0).isEmpty())
        }
    }

    fun `test menu button overlays reserved slot on hover only`() {
        edt {
            val key = DataKey.create<ActiveListItem>("test.activeList.menu")
            val menu = ActiveListMenu(key, DefaultActionGroup(), element = { it })
            val view = ActiveListView("Empty", menu = menu) { _, _ -> }
            view.update(listOf(item("with", "Alpha", null)))
            layout(view)
            view.list.clearSelection()

            // The real spacer holds the column, so the overlay glyph stays hidden until hover.
            assertTrue(renderedCells(view, 0).isEmpty())

            hover(view, center(view.list.getCellBounds(0, 0)))

            assertEquals(-1, view.list.selectedIndex)
            assertEquals(listOf(ACTIVE_LIST_MENU_CELL), renderedCells(view, 0))
            val area = activeListCellBounds(view.list, 0, selected = false).getValue(ACTIVE_LIST_MENU_CELL)
            assertEquals(ACTIVE_LIST_MENU_CELL, activeListCellAt(view.list, 0, center(area), selected = false, menu = true))
        }
    }

    fun `test menu button reserves dedicated east space in the layout`() {
        edt {
            val key = DataKey.create<ActiveListItem>("test.activeList.menu.space")
            val menu = ActiveListMenu(key, DefaultActionGroup(), element = { it })
            val view = ActiveListView("Empty", menu = menu) { _, _ -> }
            view.update(listOf(item("with", "Alpha", null)))
            layout(view)

            hover(view, center(view.list.getCellBounds(0, 0)))
            val area = activeListCellBounds(view.list, 0, selected = true).getValue(ACTIVE_LIST_MENU_CELL)
            val cell = view.list.getCellBounds(0, 0)

            assertTrue(
                "menu list reserves a trailing dropdown column",
                area.width > 0 && area.x > cell.x + cell.width / 2,
            )
        }
    }

    fun `test menu button is tight to trailing content`() {
        edt {
            val key = DataKey.create<ActiveListItem>("test.activeList.menu.edge")
            val menu = ActiveListMenu(key, DefaultActionGroup(), element = { it })
            val view = ActiveListView("Empty", menu = menu) { _, _ -> }
            view.update(listOf(metricsItem("with", "Alpha", ActiveListMetrics(pr = ActiveListBadge("#12")))))
            layout(view)

            hover(view, center(view.list.getCellBounds(0, 0)))
            val cells = activeListCellBounds(view.list, 0, selected = true)
            val pull = cells.getValue(ACTIVE_LIST_PR_CELL)
            val menuArea = cells.getValue(ACTIVE_LIST_MENU_CELL)

            assertEquals("menu glyph should touch trailing row content", pull.x + pull.width, menuArea.x)
        }
    }

    fun `test menu context provides typed element`() {
        edt {
            val key = DataKey.create<ActiveListItem>("test.activeList.menu.context")
            val row = item("with", "Alpha", null)
            val menu = ActiveListMenu(key, DefaultActionGroup(), element = { item -> item.takeIf { it.key == row.key } })
            val view = ActiveListView("Empty", menu = menu) { _, _ -> }

            assertSame(row, key.getData(menu.context(view.list, row)))
        }
    }

    fun `test selection alone does not reveal cells without hover`() {
        edt {
            val cfg = ActiveListConfig.Equal.copy(hoverActions = true)
            val view = ActiveListView("Empty", cfg) { _, _ -> }
            view.update(listOf(item("with", "Alpha", null, ActiveListCell("edit", "Edit"))))
            layout(view)
            view.list.selectedIndex = 0
            exit(view)

            assertTrue(renderedCells(view, 0).isEmpty())
        }
    }

    fun `test hover reveals cells only on the selected hovered row`() {
        edt {
            val cfg = ActiveListConfig.Equal.copy(hoverActions = true)
            val view = ActiveListView("Empty", cfg) { _, _ -> }
            view.update(listOf(
                item("a", "Alpha", null, ActiveListCell("edit", "Edit")),
                item("b", "Beta", null, ActiveListCell("delete", "Delete")),
            ))
            layout(view)
            view.list.selectedIndex = 0

            hover(view, center(view.list.getCellBounds(0, 0)))
            assertEquals(listOf("edit"), renderedCells(view, 0))
            assertTrue(renderedCells(view, 1).isEmpty())

            // Hovering the other, unselected row must not reveal its cells.
            hover(view, center(view.list.getCellBounds(1, 1)))
            assertTrue(renderedCells(view, 0).isEmpty())
            assertTrue(renderedCells(view, 1).isEmpty())

            exit(view)
            assertTrue(renderedCells(view, 0).isEmpty())
        }
    }

    fun `test selecting the hovered row reveals cells immediately`() {
        edt {
            val cfg = ActiveListConfig.Equal.copy(hoverActions = true)
            val view = ActiveListView("Empty", cfg) { _, _ -> }
            view.update(listOf(item("with", "Alpha", null, ActiveListCell("edit", "Edit"))))
            layout(view)
            view.list.clearSelection()
            hover(view, center(view.list.getCellBounds(0, 0)))
            assertTrue(renderedCells(view, 0).isEmpty())

            view.list.selectedIndex = 0

            assertEquals(listOf("edit"), renderedCells(view, 0))
        }
    }

    fun `test hovered selected unfocused row uses unfocused selection background`() {
        edt {
            val cfg = ActiveListConfig.Equal.copy(hoverActions = true)
            val row = item("with", "Alpha", null, ActiveListCell("edit", "Edit"))
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = object : JBList<ActiveListItem>(model), ActiveListActive {
                override fun active(): Boolean = false

                override fun hoveredIndex(): Int = 0
            }
            val renderer = ActiveListRenderer(model, cfg)

            renderer.getListCellRendererComponent(list, row, 0, true, false)

            assertEquals(listOf("edit"), actionCells(renderer).filter { it.isVisible }.map { it.cellId })
            assertEquals(UIUtil.getListBackground(true, false), actionPill(renderer).background)
        }
    }

    fun `test always visible action cells remain visible in hover action list`() {
        edt {
            val cfg = ActiveListConfig.Equal.copy(hoverActions = true)
            val view = ActiveListView("Empty", cfg) { _, _ -> }
            view.update(listOf(item(
                "with",
                "Alpha",
                null,
                ActiveListCell("level", "Allow", alwaysVisible = true),
                ActiveListCell("edit", "Edit"),
            )))
            layout(view)

            assertEquals(listOf("level"), renderedCells(view, 0))
        }
    }

    fun `test renderer reuses action cells across updates`() {
        edt {
            val first = item(
                "first",
                "Alpha",
                null,
                ActiveListCell("edit", "Edit"),
                ActiveListCell("delete", "Delete", enabled = false),
            )
            val second = item(
                "second",
                "Beta",
                null,
                ActiveListCell("connect", "Connect"),
                ActiveListCell("remove", "Remove", enabled = false),
            )
            val model = CollectionListModel<ActiveListItem>(listOf(first, second))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, first, 0, true, true)
            val cells = actionCells(renderer)

            renderer.getListCellRendererComponent(list, second, 1, true, true)
            val updated = actionCells(renderer)

            assertEquals(2, updated.size)
            assertSame(cells[0], updated[0])
            assertSame(cells[1], updated[1])
            assertEquals(listOf("connect", "remove"), updated.map { it.cellId })
            assertEquals(listOf("Connect", "Remove"), updated.map { it.text })
            assertEquals(listOf(true, false), updated.map { it.isEnabled })
        }
    }

    fun `test renderer action component tree stays bounded`() {
        edt {
            val row = item(
                "with",
                "Alpha",
                null,
                ActiveListCell("edit", "Edit"),
                ActiveListCell("delete", "Delete"),
            )
            val model = CollectionListModel<ActiveListItem>(listOf(row))
            val list = JBList(model)
            val renderer = ActiveListRenderer(model, ActiveListConfig.Equal)

            renderer.getListCellRendererComponent(list, row, 0, true, true)
            val count = components(renderer).size
            val cells = actionCells(renderer).size

            repeat(20) { renderer.getListCellRendererComponent(list, row, 0, true, true) }

            assertEquals(count, components(renderer).size)
            assertEquals(cells, actionCells(renderer).size)
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
            assertEquals(UiStyle.Colors.weak(), desc.foreground)
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

    fun `test refresh keeps scroll position after row change`() {
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

            view.update(rows, ActiveListSelection.Preserve)
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

    fun `test list view tracks viewport width`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(listOf(item("long", "Alpha", "A very long description that should wrap instead of scrolling")))

            assertTrue((view as Scrollable).getScrollableTracksViewportWidth())
            assertFalse(view.getScrollableTracksViewportHeight())
            assertEquals(160, view.getScrollableBlockIncrement(java.awt.Rectangle(0, 0, 320, 160), SwingConstants.VERTICAL, 1))
        }
    }

    fun `test per-cell action handler replaces onCell callback`() {
        edt {
            val actionCalls = mutableListOf<String>()
            val onCellCalls = mutableListOf<String>()
            val view = ActiveListView("Empty") { key, id -> onCellCalls += "$key:$id" }
            val row = item("with", "Alpha", null, ActiveListCell("edit", "Edit", action = { actionCalls += "edit" }))
            view.update(listOf(row))
            view.list.size = Dimension(320, 80)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            val area = activeListCellBounds(view.list, 0, selected = true).getValue("edit")
            click(view, center(area))

            assertEquals(listOf("edit"), actionCalls)
            assertTrue(onCellCalls.isEmpty())
        }
    }

    fun `test cell without action still routes through onCell`() {
        edt {
            val onCellCalls = mutableListOf<String>()
            val view = ActiveListView("Empty") { key, id -> onCellCalls += "$key:$id" }
            view.update(listOf(item("with", "Alpha", null, ActiveListCell("edit", "Edit"))))
            view.list.size = Dimension(320, 80)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            val area = activeListCellBounds(view.list, 0, selected = true).getValue("edit")
            click(view, center(area))

            assertEquals(listOf("with:edit"), onCellCalls)
        }
    }

    fun `test hovering a button shows the action cursor and the body keeps the base cursor`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(listOf(item("with", "Alpha", null, ActiveListCell("edit", "Edit", alwaysVisible = true))))
            layout(view)

            val area = activeListCellBounds(view.list, 0, selected = true).getValue("edit")
            hover(view, center(area))
            assertEquals(Cursor.HAND_CURSOR, view.list.cursor.type)

            val bounds = view.list.getCellBounds(0, 0)
            hover(view, Point(bounds.x + 2, bounds.y + bounds.height / 2))
            assertEquals(Cursor.DEFAULT_CURSOR, view.list.cursor.type)
        }
    }

    fun `test cell cursor kind is honored on hover`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(listOf(item("with", "Alpha", null, ActiveListCell("edit", "Edit", alwaysVisible = true, cursor = Cursor.TEXT_CURSOR))))
            layout(view)

            val area = activeListCellBounds(view.list, 0, selected = true).getValue("edit")
            hover(view, center(area))

            assertEquals(Cursor.TEXT_CURSOR, view.list.cursor.type)
        }
    }

    fun `test more menu shows the action cursor on hover`() {
        edt {
            val key = DataKey.create<ActiveListItem>("test.activeList.menu.cursor")
            val menu = ActiveListMenu(key, DefaultActionGroup(), element = { it })
            val view = ActiveListView("Empty", menu = menu) { _, _ -> }
            view.update(listOf(item("with", "Alpha", null)))
            layout(view)
            view.list.clearSelection()

            // Reveal the glyph so its slot resolves, then read and hover it.
            hover(view, center(view.list.getCellBounds(0, 0)))
            val area = activeListCellBounds(view.list, 0, selected = false).getValue(ACTIVE_LIST_MENU_CELL)
            hover(view, center(area))

            assertEquals(Cursor.HAND_CURSOR, view.list.cursor.type)
        }
    }

    fun `test cell tooltip overrides label`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(listOf(item("with", "Alpha", "Desc", ActiveListCell("edit", "Edit", alwaysVisible = true, tooltip = "Custom tip"))))
            layout(view)

            val area = activeListCellBounds(view.list, 0, selected = true).getValue("edit")

            assertEquals("Custom tip", view.list.getToolTipText(event(view.list, center(area))))
        }
    }

    fun `test changes badge is hit tested with cursor tooltip and action`() {
        edt {
            val calls = mutableListOf<String>()
            val onCellCalls = mutableListOf<String>()
            val view = ActiveListView("Empty") { key, id -> onCellCalls += "$key:$id" }
            view.update(listOf(metricsItem("wt", "Alpha", ActiveListMetrics(additions = 3, deletions = 2, onChanges = { calls += "changes" }))))
            view.list.size = Dimension(360, 80)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            val area = activeListCellBounds(view.list, 0, selected = true).getValue(ACTIVE_LIST_CHANGES_CELL)
            assertEquals(KiloBundle.message("worktree.stats.tooltip", 0, 0, 3, 2), view.list.getToolTipText(event(view.list, center(area))))

            hover(view, center(area))
            assertEquals(Cursor.HAND_CURSOR, view.list.cursor.type)

            click(view, center(area))
            assertEquals(listOf("changes"), calls)
            assertTrue(onCellCalls.isEmpty())
        }
    }

    fun `test pr badge is hit tested and invokes its action`() {
        edt {
            val calls = mutableListOf<String>()
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(listOf(metricsItem("wt", "Alpha", ActiveListMetrics(pr = ActiveListBadge("#12"), onPr = { calls += "pr" }))))
            view.list.size = Dimension(360, 80)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            val area = activeListCellBounds(view.list, 0, selected = true).getValue(ACTIVE_LIST_PR_CELL)
            assertEquals("#12", view.list.getToolTipText(event(view.list, center(area))))
            hover(view, center(area))
            assertEquals(Cursor.HAND_CURSOR, view.list.cursor.type)

            click(view, center(area))
            assertEquals(listOf("pr"), calls)
        }
    }

    fun `test pr badge uses custom tooltip when supplied`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(listOf(metricsItem("wt", "Alpha", ActiveListMetrics(pr = ActiveListBadge("#12"), prTooltip = "PR details"))))
            view.list.size = Dimension(360, 80)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            val area = activeListCellBounds(view.list, 0, selected = true).getValue(ACTIVE_LIST_PR_CELL)

            assertEquals("PR details", view.list.getToolTipText(event(view.list, center(area))))
        }
    }

    fun `test inert changes badge is not hit tested`() {
        edt {
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(listOf(metricsItem("wt", "Alpha", ActiveListMetrics(additions = 3, deletions = 2))))
            view.list.size = Dimension(360, 80)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            val area = activeListCellBounds(view.list, 0, selected = true).getValue(ACTIVE_LIST_CHANGES_CELL)

            // The badge still renders, but with no handler it is not an actionable cell.
            assertNull(activeListCellAt(view.list, 0, center(area), selected = true))
            hover(view, center(area))
            assertEquals(Cursor.DEFAULT_CURSOR, view.list.cursor.type)
        }
    }

    fun `test pr badge hit region ignores the metrics of other rows`() {
        edt {
            val calls = mutableListOf<String>()
            val view = ActiveListView("Empty") { _, _ -> }
            view.update(
                listOf(
                    metricsItem(
                        "wide",
                        "Alpha",
                        ActiveListMetrics(
                            additions = 1234,
                            deletions = 987,
                            ahead = 42,
                            behind = 17,
                            pr = ActiveListBadge("#12345"),
                            onPr = { calls += "wide" },
                        ),
                    ),
                    metricsItem("narrow", "Beta", ActiveListMetrics(pr = ActiveListBadge("#7"), onPr = { calls += "narrow" })),
                ),
            )
            view.list.size = Dimension(360, 160)
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()

            val wide = activeListCellBounds(view.list, 0, selected = false).getValue(ACTIVE_LIST_PR_CELL)
            val narrow = activeListCellBounds(view.list, 1, selected = false).getValue(ACTIVE_LIST_PR_CELL)
            // Both badges trail their row, so they share a right edge no matter how wide the changes
            // beside them are.
            assertEquals(wide.x + wide.width, narrow.x + narrow.width)

            // The renderer is one reused stamp: rendering the wide row, or a full paint pass over
            // every row, must not move the narrow row's hit region.
            activeListCellBounds(view.list, 0, selected = false)
            assertEquals(narrow, activeListCellBounds(view.list, 1, selected = false).getValue(ACTIVE_LIST_PR_CELL))
            paint(view.list)
            assertEquals(narrow, activeListCellBounds(view.list, 1, selected = false).getValue(ACTIVE_LIST_PR_CELL))

            click(view, center(narrow))
            click(view, center(wide))
            assertEquals(listOf("narrow", "wide"), calls)
        }
    }

    private fun paint(list: JBList<*>) {
        val image = UIUtil.createImage(list, list.width, list.height, BufferedImage.TYPE_INT_ARGB)
        val g = image.createGraphics()
        try {
            list.paint(g)
        } finally {
            g.dispose()
        }
    }

    private fun item(id: String, name: String, note: String?, vararg cells: ActiveListCell) = object : ActiveListItem {
        override val key = id
        override val title = name
        override val description = note
        override val cells = cells.toList()
    }

    private fun metricsItem(id: String, name: String, data: ActiveListMetrics) = object : ActiveListItem {
        override val key = id
        override val title = name
        override val metrics = data
    }

    private fun sectionItem(id: String, name: String, group: String) = object : ActiveListItem {
        override val key = id
        override val title = name
        override val section = group
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

    private fun renderedCells(view: ActiveListView, idx: Int): List<String> {
        val value = view.list.model.getElementAt(idx)
        val bounds = view.list.getCellBounds(idx, idx)
        val comp = view.list.cellRenderer.getListCellRendererComponent(
            view.list,
            value,
            idx,
            view.list.isSelectedIndex(idx),
            true,
        )
        comp.setBounds(0, 0, view.list.width, bounds.height)
        layout(comp as Container)
        return actionCells(comp).filter { it.isVisible }.map { it.cellId }
    }

    private fun rowPanel(renderer: ActiveListRenderer): JPanel =
        components(renderer).filterIsInstance<LayeredOverlayPanel>().single().content.getComponent(0) as JPanel

    private fun actionPill(root: java.awt.Component): JPanel {
        val cell = actionCells(root).single()
        return cell.parent.parent.parent as JPanel
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

    private fun topY(root: java.awt.Component, child: java.awt.Component): Int =
        SwingUtilities.convertPoint(child.parent, child.location, root).y

    private fun center(rect: java.awt.Rectangle) = Point(rect.x + rect.width / 2, rect.y + rect.height / 2)

    private fun click(view: ActiveListView, point: Point) {
        fire(view.list, mouse(view, MouseEvent.MOUSE_PRESSED, point))
        fire(view.list, mouse(view, MouseEvent.MOUSE_RELEASED, point))
    }

    private fun hover(view: ActiveListView, point: Point) {
        val event = event(view.list, point)
        view.list.mouseMotionListeners.forEach { it.mouseMoved(event) }
    }

    private fun exit(view: ActiveListView) {
        val event = event(view.list, Point(-1, -1), MouseEvent.MOUSE_EXITED)
        view.list.mouseListeners.forEach { it.mouseExited(event) }
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

    private fun event(list: javax.swing.JList<*>, point: Point, id: Int = MouseEvent.MOUSE_MOVED) = MouseEvent(
        list,
        id,
        System.currentTimeMillis(),
        0,
        point.x,
        point.y,
        0,
        false,
    )

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
