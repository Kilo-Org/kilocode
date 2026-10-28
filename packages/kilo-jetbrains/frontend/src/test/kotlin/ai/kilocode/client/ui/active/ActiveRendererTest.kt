package ai.kilocode.client.ui.active

import ai.kilocode.client.ui.tree.ActiveEntry
import ai.kilocode.client.ui.tree.ActiveTree
import ai.kilocode.client.ui.tree.ActiveTreeNode
import ai.kilocode.client.ui.tree.ActiveTreeView
import ai.kilocode.client.ui.list.ActiveListRenderer
import ai.kilocode.client.ui.list.ActiveSection
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.CollectionListModel
import com.intellij.ui.components.JBList
import com.intellij.util.ui.UIUtil
import ai.kilocode.client.session.ui.PickerRow
import com.intellij.util.ui.JBUI
import com.intellij.ui.components.JBLabel
import javax.swing.JComponent
import javax.swing.SwingUtilities
import java.awt.AlphaComposite
import java.awt.Point
import java.awt.image.BufferedImage

class ActiveRendererTest : BasePlatformTestCase() {
    private val row = object : ActiveSection {
        override val key = "row"
        override val title = "Complete selected title"
        override val description = "Description below title"
        override val icon = AllIcons.Actions.Edit
        override val section = "Section"
    }

    fun `test shared menu hit and glyph fit inside native tree selection`() {
        val menu = ActiveMenu(DataKey.create<String>("renderer.test"), DefaultActionGroup(), { it.key })
        val tree = ActiveTree("", menu = menu)
        tree.update(listOf(ActiveTreeNode(row)))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 200)
        tree.select(row.key, false)
        val entry = view.getPathForRow(0).lastPathComponent as ActiveEntry
        val bounds = view.bounds(entry) ?: error("Missing native bounds")
        val renderer = ActiveRenderer(menu = menu)
        renderer.render(view.state(entry, true, false, bounds.width).copy(menuVisible = true))
        renderer.setSize(bounds.size)
        activeLayout(renderer)
        val hit = activeHitCells(renderer, bounds.x, bounds.y).single { it.id == ACTIVE_MENU_CELL }
        val image = BufferedImage(view.width, view.height, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            view.paint(graphics)
        } finally {
            graphics.dispose()
        }
        val y = bounds.y + bounds.height / 2
        val color = image.getRGB(hit.bounds.x, y)
        assertTrue("Menu must be on selection, not tree background", color != view.background.rgb)
        assertEquals(color, image.getRGB(hit.bounds.x + hit.bounds.width - 1, y))
        assertTrue(bounds.contains(hit.bounds))
    }

    fun `test shared content stays fixed when hover reveals menu`() {
        val menu = ActiveMenu(DataKey.create<String>("renderer.hover"), DefaultActionGroup(), { it.key })
        val tree = ActiveTree("", menu = menu)
        tree.update(listOf(ActiveTreeNode(row)))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 200)
        val entry = view.getPathForRow(0).lastPathComponent as ActiveEntry
        val renderer = ActiveRenderer(menu = menu)
        val state = view.state(entry, false, false, 400)
        val positions = mutableListOf<List<java.awt.Rectangle>>()
        for (hovered in listOf(false, true, false, true)) {
            renderer.render(state.copy(hovered = hovered, menuVisible = hovered))
            renderer.setSize(400, renderer.preferredSize.height)
            activeLayout(renderer)
            positions += content(renderer).map { SwingUtilities.convertRectangle(it.parent, it.bounds, renderer) }
        }
        for (position in positions.drop(1)) assertEquals(positions.first(), position)
    }

    fun `test tree surface repaint restores content after hit testing reuses stamp`() {
        val menu = ActiveMenu(DataKey.create<String>("renderer.hover.paint"), DefaultActionGroup(), { it.key })
        val tree = ActiveTree("", menu = menu)
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
        tree.update(listOf(ActiveTreeNode(object : ActiveItem {
            override val key = "group"
            override val title = "Local"
        }, listOf(ActiveTreeNode(row)))))
        view.setSize(400, 200)
        tree.select(row.key, false)
        val entry = view.getPathForRow(1).lastPathComponent as ActiveEntry
        val cell = view.regions.cell(entry)
        val stamp = view.cellRenderer.getTreeCellRendererComponent(view, entry, true, false, true, 1, false) as JComponent
        stamp.setSize(cell.size)
        activeLayout(stamp)
        val positions = content(stamp).map { SwingUtilities.convertRectangle(it.parent, it.bounds, stamp) }
        view.regions.hits(entry)
        val image = BufferedImage(view.width, view.height, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            view.regions.paint(graphics)
        } finally {
            graphics.dispose()
        }
        assertEquals(positions, content(stamp).map { SwingUtilities.convertRectangle(it.parent, it.bounds, stamp) })
    }

    fun `test native painted frames include top level gutter and one compact indent for leaves`() {
        val menu = ActiveMenu(DataKey.create<String>("renderer.depth"), DefaultActionGroup(), { it.key })
        val tree = ActiveTree("", menu = menu)
        (tree.preferredFocus() as ActiveTreeView).setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
        fun item(key: String) = object : ActiveItem {
            override val key = key
            override val title = key
            override val icon = AllIcons.Actions.Edit
        }
        tree.update(listOf(ActiveTreeNode(item("main")), ActiveTreeNode(item("group"), listOf(
            ActiveTreeNode(item("leaf")),
        ))))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 300)
        assertEquals(view.background, com.intellij.ui.render.RenderingUtil.getSelectionBackground(view))
        assertTrue(com.intellij.ui.render.RenderingUtil.isHoverPaintingDisabled(view))
        val renderer = ActiveRenderer(menu = menu)
        val positions = mutableListOf<Int>()
        for (index in 0 until view.rowCount) {
            val entry = view.getPathForRow(index).lastPathComponent as ActiveEntry
            tree.select(entry.key, false)
            val bounds = view.bounds(entry) ?: error("Missing bounds")
            val surface = view.regions.frame(entry) ?: error("Missing frame")
            positions += surface.x
            renderer.render(view.state(entry, true, false, bounds.width).copy(menuVisible = true))
            renderer.setSize(bounds.size)
            activeLayout(renderer)
            symmetric(renderer)
            val image = BufferedImage(view.width, view.height, BufferedImage.TYPE_INT_ARGB)
            val graphics = image.createGraphics()
            try {
                view.paint(graphics)
            } finally {
                graphics.dispose()
            }
            val y = bounds.y + bounds.height / 2
            val frame = PickerRow().apply { update(view.background, UIUtil.getTreeBackground(true, false), true, true) }
            val left = surface.x + frame.selectionInsets.left
            assertEquals("Native paint includes the selection cap at row $index", UIUtil.getTreeBackground(true, false).rgb,
                image.getRGB(left + frame.selectionArc / 2, y))
            assertEquals("Frame remains selected behind trailing content", UIUtil.getTreeBackground(true, false).rgb,
                image.getRGB(surface.x + surface.width - JBUI.CurrentTheme.ActionsList.cellPadding().right, y))
            assertTrue("Top-level frame starts inside the tree's own gutter", surface.x >= view.insets.left)
            assertEquals("Frame runs to the tree's trailing inset", surface.x + surface.width,
                view.width - view.insets.right)
            assertSame(entry, view.regions.entry(Point(left + 1, y)))
        }
        assertEquals(positions.first(), positions[1])
        val control = com.intellij.ui.tree.ui.DefaultControl()
        val indent = com.intellij.ui.tree.ui.Control.Painter.COMPACT.getRendererOffset(control, 2, true) -
            com.intellij.ui.tree.ui.Control.Painter.COMPACT.getRendererOffset(control, 1, true)
        assertEquals("Leaf body indents one compact step", positions[2], positions[1] + indent)
        val group = view.getPathForRow(1).lastPathComponent as ActiveEntry
        val bounds = view.regions.frame(group) ?: error("Missing group frame")
        view.clearSelection()
        view.dispatchEvent(java.awt.event.MouseEvent(view, java.awt.event.MouseEvent.MOUSE_PRESSED, 0, 0,
            bounds.x + bounds.width - 1, bounds.y + bounds.height / 2, 1, false, java.awt.event.MouseEvent.BUTTON1))
        assertEquals("group", tree.selected()?.key)
    }

    fun `test tree icons and disclosure use list lead and native levels across theme and zoom`() {
        val scale = com.intellij.ui.scale.JBUIScale.scale(1f)
        val keys = listOf("ActionsList.cellBorderInsets", "Popup.Selection.innerInsets", "Popup.Selection.leftRightInset",
            "Tree.leftChildIndent")
        val previous = keys.associateWith { javax.swing.UIManager.get(it) }
        val tree = ActiveTree("")
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
        val group = object : ActiveItem {
            override val key = "group"
            override val title = "Local worktrees"
        }
        val child = object : ActiveItem {
            override val key = "child"
            override val title = "Child"
            override val icon = row.icon
        }
        tree.update(listOf(ActiveTreeNode(row), ActiveTreeNode(group, listOf(
            ActiveTreeNode(child), ActiveTreeNode(object : ActiveItem {
                override val key = "nested"
                override val title = "Nested"
            }, listOf(ActiveTreeNode(object : ActiveItem {
                override val key = "deep"
                override val title = "Deep"
                override val icon = row.icon
            }))),
        ))))
        val menu = ActiveMenu(DataKey.create<String>("renderer.lead"), DefaultActionGroup(), { it.key })
        val model = CollectionListModel<ActiveItem>(listOf(child))
        val list = JBList(model)
        val renderer = ActiveListRenderer(model, menu = menu)
        try {
            for (factor in listOf(1f, 2f)) {
                com.intellij.ui.scale.JBUIScale.setUserScaleFactorForTest(scale * factor)
                javax.swing.UIManager.put(keys[0], JBUI.insets(2, 6))
                javax.swing.UIManager.put(keys[1], JBUI.insets(0, 5))
                javax.swing.UIManager.put(keys[2], 7)
                javax.swing.UIManager.put(keys[3], JBUI.scale(18))
                view.updateUI()
                view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
                view.setSize(JBUI.scale(400), JBUI.scale(300))
                val stamp = renderer.getListCellRendererComponent(list, child, 0, true, false)
                val body = stamp.components.filterIsInstance<ActiveRenderer>().single()
                body.updateUI()
                stamp.setSize(view.width, stamp.preferredSize.height)
                activeLayout(stamp)
                val icon = content(body).filterIsInstance<JBLabel>().single()
                val lead = SwingUtilities.convertPoint(icon, 0, 0, body).x
                for (key in listOf(row.key, "child", "deep")) {
                    val entry = view.hierarchy.entries.getValue(key)
                    val cell = view.cellRenderer.getTreeCellRendererComponent(view, entry, false, false, true,
                        view.getRowForPath(javax.swing.tree.TreePath(entry.path)), false) as JComponent
                    cell.setSize(view.regions.cell(entry).size)
                    activeLayout(cell)
                    val mark = content(cell).filterIsInstance<JBLabel>().single()
                    assertEquals("Row body starts its mark on the list lead for $key at $factor",
                        lead, SwingUtilities.convertPoint(mark, 0, 0, cell).x)
                }
                for (key in listOf("group", "nested")) {
                    val entry = view.hierarchy.entries.getValue(key)
                    val frame = view.regions.frame(entry) ?: error("Missing frame")
                    val body = view.regions.cell(entry)
                    val arrow = view.regions.control(entry) ?: error("Missing arrow")
                    assertTrue("Disclosure sits inside its own selection", frame.contains(arrow))
                    val cell = view.cellRenderer.getTreeCellRendererComponent(view, entry, false, true, false,
                        view.getRowForPath(javax.swing.tree.TreePath(entry.path)), false) as JComponent
                    cell.setSize(view.regions.cell(entry).size)
                    activeLayout(cell)
                    val title = content(cell).filterIsInstance<ai.kilocode.client.ui.FadeText>().first()
                    assertTrue("Body starts after the disclosure column", body.x >= arrow.x + arrow.width)
                    assertTrue("Title follows the disclosure column",
                        SwingUtilities.convertPoint(title, 0, 0, cell).x >= arrow.x - body.x + arrow.width)
                }
            }
        } finally {
            com.intellij.ui.scale.JBUIScale.setUserScaleFactorForTest(scale)
            previous.forEach { (key, value) -> javax.swing.UIManager.put(key, value) }
            view.updateUI()
        }
    }

    fun `test list and drag use shared symmetric padding`() {
        val menu = ActiveMenu(DataKey.create<String>("renderer.list.padding"), DefaultActionGroup(), { it.key })
        val model = CollectionListModel<ActiveItem>(listOf(row))
        val list = JBList(model)
        list.setSize(400, 200)
        val renderer = ActiveListRenderer(model, menu = menu)
        val stamp = renderer.getListCellRendererComponent(list, row, 0, true, true)
        val body = stamp.components.filterIsInstance<ActiveRenderer>().single()
        stamp.setSize(400, stamp.preferredSize.height)
        activeLayout(stamp)
        symmetric(body)
        val (image, _) = renderer.rowImage(list, row, 0, 400) ?: error("Missing image")
        symmetric(body)
        complete(body, image)
    }

    fun `test shared padding follows current platform theme after updateUI`() {
        val key = "ActionsList.cellBorderInsets"
        val previous = javax.swing.UIManager.get(key)
        val menu = ActiveMenu(DataKey.create<String>("renderer.theme"), DefaultActionGroup(), { it.key })
        val model = CollectionListModel<ActiveItem>(listOf(row))
        val list = JBList(model)
        val renderer = ActiveListRenderer(model, menu = menu)
        val stamp = renderer.getListCellRendererComponent(list, row, 0, true, true)
        val body = stamp.components.filterIsInstance<ActiveRenderer>().single()
        try {
            javax.swing.UIManager.put(key, JBUI.insets(2, 6))
            body.updateUI()
            stamp.setSize(400, stamp.preferredSize.height)
            activeLayout(stamp)
            symmetric(body)
        } finally {
            javax.swing.UIManager.put(key, previous)
            body.updateUI()
        }
    }

    private fun symmetric(renderer: ActiveRenderer) {
        fun labels(component: JComponent): List<JBLabel> = component.components.filterIsInstance<JComponent>()
            .flatMap { labels(it) } + listOfNotNull(component as? JBLabel)
        val menu = labels(renderer).filterIsInstance<ActiveActionCell>().single { it.cellId == ACTIVE_MENU_CELL }
        menu.isVisible = true
        activeLayout(renderer)
        val icon = labels(renderer).single { it.icon === AllIcons.Actions.Edit }
        val left = SwingUtilities.convertPoint(icon, 0, 0, renderer).x
        val right = SwingUtilities.convertPoint(menu, menu.width, 0, renderer).x
        val frame = renderer.body() as PickerRow
        val leftGap = left
        val rightGap = renderer.width - right
        assertEquals("Row content is symmetric inside the selection", leftGap, rightGap)
        assertEquals(ai.kilocode.client.ui.UiStyle.Gap.SM, leftGap - frame.insets.left)
    }

    fun `test tree drag paints complete selected body after stale overlay layout`() {
        val tree = ActiveTree("")
        tree.update(listOf(ActiveTreeNode(object : ActiveItem {
            override val key = "group"
            override val title = "Group"
        }, listOf(ActiveTreeNode(row)))))
        val view = tree.preferredFocus() as ActiveTreeView
        view.setSize(400, 200)
        val entry = view.getPathForRow(1).lastPathComponent as ActiveEntry
        val bounds = view.bounds(entry) ?: error("Missing indented bounds")
        assertTrue((view.regions.frame(entry) ?: error("Missing frame")).x >
            (view.regions.frame(view.getPathForRow(0).lastPathComponent as ActiveEntry) ?: error("Missing group frame")).x)
        val renderer = ActiveRenderer()
        val width = view.width - bounds.x
        val state = view.state(entry, true, true, width)
        renderer.render(state)
        val height = renderer.preferredSize.height
        renderer.setSize(800, 300)
        activeLayout(renderer)
        val (image, origin) = renderer.rowImage(state, width) ?: error("Missing image")
        assertEquals(Point(0, 0), origin)
        assertEquals(height, image.height)
        assertEquals(width, image.width)
        complete(renderer, image)
    }

    fun `test list drag excludes section band and resets placeholder dimensions`() {
        val model = CollectionListModel<ActiveItem>(listOf(row))
        val list = JBList(model)
        list.setSize(400, 200)
        val renderer = ActiveListRenderer(model)
        val stamp = renderer.getListCellRendererComponent(list, row, 0, true, true)
        stamp.setSize(400, stamp.preferredSize.height)
        activeLayout(stamp)
        val (image, origin) = renderer.rowImage(list, row, 0, 400) ?: error("Missing image")
        assertTrue(origin.y > 0)
        val body = stamp.components.filterIsInstance<ActiveRenderer>().single()
        assertEquals(stamp.height - origin.y, image.height)
        complete(body, image)
        renderer.getListCellRendererComponent(list, ai.kilocode.client.ui.list.ActiveGap(row, 250), 0, false, false)
        val next = renderer.rowImage(list, row, 0, 400) ?: error("Missing subsequent image")
        assertEquals(image.height, next.first.height)
        complete(body, next.first)
    }

    private fun content(component: JComponent): List<JComponent> = component.components.filterIsInstance<JComponent>()
        .flatMap { content(it) } + listOfNotNull(component.takeIf {
            it is ai.kilocode.client.ui.FadeText || it is JBLabel && it.icon === AllIcons.Actions.Edit
        })

    private fun complete(renderer: ActiveRenderer, image: BufferedImage) {
        val expected = UIUtil.createImage(renderer, image.width, image.height, BufferedImage.TYPE_INT_ARGB)
        val graphics = expected.createGraphics()
        try {
            graphics.composite = AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.9f)
            renderer.body().paint(graphics)
        } finally {
            graphics.dispose()
        }
        for (y in 0 until image.height) {
            for (x in 0 until image.width) assertEquals("Pixel $x,$y", expected.getRGB(x, y), image.getRGB(x, y))
        }
        val center = image.getRGB(image.width / 2, image.height / 2)
        assertTrue("Selection must be painted", center ushr 24 > 0)
        val halves = listOf(0 until image.height / 2, image.height / 2 until image.height)
        for (range in halves) {
            assertTrue("Both title/icon and description must paint inside ${image.width}x${image.height} image", range.any { y ->
                (20 until image.width / 2).any { x -> image.getRGB(x, y) != center && image.getRGB(x, y) ushr 24 > 0 }
            })
        }
    }
    fun `test tree and list top level selection share outer insets and menu gap`() {
        val menu = ActiveMenu(DataKey.create<String>("renderer.insets"), DefaultActionGroup(), { it.key })
        val tree = ActiveTree("", menu = menu)
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(com.intellij.ui.tree.ui.DefaultTreeUI())
        tree.update(listOf(ActiveTreeNode(row)))
        view.isVisible = true
        view.setSize(400, 120)
        view.validate()
        tree.select(row.key, false)
        val entry = view.getPathForRow(0).lastPathComponent as ActiveEntry
        val frame = view.regions.frame(entry) ?: error("Missing frame")
        val body = view.regions.cell(entry)

        val selection = UIUtil.getTreeBackground(true, false)
        val image = BufferedImage(view.width, view.height, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            graphics.color = view.background
            graphics.fillRect(0, 0, image.width, image.height)
            view.paint(graphics)
        } finally {
            graphics.dispose()
        }
        val y = frame.y + frame.height / 2
        val painted = (0 until view.width).filter { x -> close(image.getRGB(x, y), selection.rgb) }
        // Rounded corners leave transparent pixels at this scanline, so compare the edges from the
        // geometry and confirm the surface is actually inked inside them.
        assertTrue("Top-level selection must be painted", painted.isNotEmpty())
        assertTrue("Painted surface stays inside the frame",
            painted.first() >= frame.x && painted.last() < frame.x + frame.width)
        // The selection starts at the tree content edge; its body and content keep the list grid.
        assertEquals("Selection starts at the tree content edge", view.insets.left, frame.x)
        assertEquals("Selection ends at the tree's trailing edge", view.width - view.insets.right,
            frame.x + frame.width)
        assertEquals("Body and selection share the cell", frame, body)

        // The row body supplies the same small cell padding as the list, so the trailing menu keeps a
        // list-sized gutter to the selection edge rather than hugging it.
        val renderer = ActiveRenderer(menu = menu)
        renderer.render(view.state(entry, true, false, body.width).copy(menuVisible = true))
        renderer.setSize(body.width, renderer.preferredSize.height)
        activeLayout(renderer)
        val cell = renderer.components.flatMap(::descendants).filterIsInstance<ActiveActionCell>()
            .single { it.cellId == ACTIVE_MENU_CELL }
        val right = SwingUtilities.convertPoint(cell, cell.width, 0, renderer).x
        assertEquals("Menu keeps the shared trailing inset", renderer.width, body.width)
        assertTrue("Menu glyph stays inside the selection", body.x + right <= frame.x + frame.width)
        assertEquals("Menu keeps the list-sized trailing gap",
            ai.kilocode.client.ui.UiStyle.Gap.SM, frame.x + frame.width - (body.x + right))
    }

    private fun descendants(component: java.awt.Component): List<java.awt.Component> =
        listOf(component) + (component as? java.awt.Container)?.components?.flatMap(::descendants).orEmpty()

    private fun close(actual: Int, expected: Int): Boolean {
        val a = java.awt.Color(actual, true)
        val b = java.awt.Color(expected, true)
        return kotlin.math.abs(a.red - b.red) <= 2 && kotlin.math.abs(a.green - b.green) <= 2 &&
            kotlin.math.abs(a.blue - b.blue) <= 2
    }
}
