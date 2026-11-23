package ai.kilocode.client.ui.tree

import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.ui.AnimationIcon
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveSurface
import ai.kilocode.client.ui.active.activeLayout
import com.intellij.ide.IdeEventQueue
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.SystemInfo
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.render.RenderingUtil
import com.intellij.ui.tree.ui.DefaultTreeUI
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Graphics
import java.awt.Point
import java.awt.Rectangle
import java.awt.event.ActionEvent
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
import javax.swing.CellRendererPane
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.RepaintManager
import javax.swing.SwingUtilities
import javax.swing.tree.TreePath

class ActiveTreeAnimationTest : BasePlatformTestCase() {
    private data class Row(override val key: String, override val icon: Icon? = null) : ActiveItem {
        override val title = key
    }

    fun `test idle pointer still repaints only animated rows on one shared clock`() {
        val timers = TestUiTimers()
        var reads = 0
        val still = object : ActiveItem {
            override val key = "still"
            override val title = key
            override fun animation(time: Long, actions: Boolean): Int? {
                reads++
                return null
            }
        }
        val tree = ActiveTree("", timers = timers)
        tree.update(listOf(ActiveTreeNode(still), ActiveTreeNode(Row("spin", spinner()))))
        val view = attach(tree)
        val before = reads
        assertEquals(1, timers.pending)
        assertEquals(false, view.getClientProperty(AnimatedIcon.ANIMATION_IN_RENDERER_ALLOWED))
        assertNull(view.getClientProperty(AnimatedIcon.REFRESH_DELEGATE))
        repeat(3) {
            val cell = view.getRowBounds(1)
            assertEquals(listOf(Rectangle(0, cell.y, view.width, cell.height)), dirty(view) { timers.advanceBy(100) })
            assertEquals(1, timers.pending)
            assertEquals("Static rows must not be inspected every frame", before, reads)
        }
    }

    fun `test collapsed descendants stop animating and expansion and model refresh restart the clock`() {
        val timers = TestUiTimers()
        val tree = ActiveTree("", timers = timers)
        val nodes = listOf(ActiveTreeNode(Row("group"), listOf(ActiveTreeNode(Row("spin", spinner())))))
        tree.update(nodes)
        val view = attach(tree)
        val path = TreePath(view.hierarchy.entries.getValue("group").path)
        assertEquals(1, timers.pending)
        view.collapsePath(path)
        UIUtil.dispatchAllInvocationEvents()
        assertEquals(0, timers.pending)
        assertEmpty(dirty(view) { timers.advanceBy(1000) })
        view.expandPath(path)
        UIUtil.dispatchAllInvocationEvents()
        assertEquals(1, timers.pending)
        tree.update(listOf(ActiveTreeNode(Row("group"), listOf(ActiveTreeNode(Row("spin"))))))
        assertEquals(0, timers.pending)
        tree.update(nodes)
        assertEquals(1, timers.pending)
    }

    fun `test tree paints each row once in an owned renderer pane and releases it`() {
        val panes = mutableListOf<CellRendererPane?>()
        val icon = object : Icon {
            override fun getIconWidth() = 16
            override fun getIconHeight() = 16
            override fun paintIcon(component: Component, graphics: Graphics, x: Int, y: Int) {
                panes += generateSequence(component) { it.parent }.filterIsInstance<CellRendererPane>().firstOrNull()
            }
        }
        val tree = ActiveTree("")
        tree.update(listOf(ActiveTreeNode(Row("row", icon))))
        val view = attach(tree)
        val entry = view.hierarchy.entries.getValue("row")
        view.selectionModel.selectionPath = TreePath(entry.path)
        val before = view.componentCount
        val image = BufferedImage(maxOf(view.width, 1), maxOf(view.height, 1), BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            repeat(3) { view.paint(graphics) }
        } finally {
            graphics.dispose()
        }
        assertEquals(3, panes.size)
        panes.forEach { pane ->
            assertNotNull("A detached renderer re-enters Swing's double-buffered paint manager", pane)
            assertSame(view, pane!!.parent)
            assertEquals("No renderer stamps may be retained after a paint", 0, pane.componentCount)
        }
        assertNull((view.cellRenderer as Component).parent)
        assertEquals(before, view.componentCount)
    }

    fun `test changing one row does not remeasure or rebuild bounds for unchanged rows`() {
        var reads = 0
        fun node(key: String, text: String = key) = ActiveTreeNode(object : ActiveItem {
            override val key = key
            override val title: String get() {
                reads++
                return text
            }
        })
        val nodes = (0 until 200).map { node(it.toString()) }
        val tree = ActiveTree("")
        tree.update(nodes)
        val view = attach(tree)
        repeat(view.rowCount) { view.getRowBounds(it) }
        reads = 0

        tree.update(nodes.dropLast(1) + node("199", "Updated"))

        assertTrue("Only the changed row needs measuring, not all 200 leaves: $reads title reads", reads < 20)
        assertEquals(200, view.rowCount)
    }

    fun `test keyboard deselection retains the native lead focus indicator`() {
        val tree = ActiveTree("", surface = ActiveSurface.ToolWindow)
        tree.update(listOf(ActiveTreeNode(Row("row"))))
        val view = attach(tree)
        view.setSelectionRow(0)
        view.actionMap.get("toggleAndAnchor").actionPerformed(ActionEvent(view, ActionEvent.ACTION_PERFORMED, ""))
        assertTrue(tree.selectedKeys().isEmpty())
        assertEquals(0, view.leadSelectionRow)

        val frame = view.regions.frame(view.getPathForRow(0).lastPathComponent as ActiveEntry)!!
        val image = BufferedImage(view.width, view.height, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            view.putClientProperty(RenderingUtil.ALWAYS_PAINT_SELECTION_AS_FOCUSED, true)
            view.paint(graphics)

            val color = if (SystemInfo.isMac) view.background else RenderingUtil.getSelectionBackground(view)
            assertEquals(color.rgb, image.getRGB(frame.x + frame.width / 2, frame.y))
        } finally {
            graphics.dispose()
        }
    }

    fun `test hover recovers on movement within the same row after a payload refresh`() {
        val hovered = mutableListOf<String?>()
        val tree = ActiveTree("", actions = ActiveTreeActions(hover = { hovered += it?.key }))
        tree.update(listOf(ActiveTreeNode(Row("row"))))
        val view = attach(tree)
        val bounds = view.getRowBounds(0)
        fun move(offset: Int) {
            val point = Point(bounds.x + 20 + offset, bounds.y + bounds.height / 2)
            val screen = Point(point)
            SwingUtilities.convertPointToScreen(screen, view)
            IdeEventQueue.getInstance().dispatchEvent(MouseEvent(view, MouseEvent.MOUSE_MOVED, 0, 0,
                point.x, point.y, screen.x, screen.y, 0, false, MouseEvent.NOBUTTON))
        }

        move(0)
        assertNotNull(tree.hoveredBounds(view))
        tree.update(listOf(ActiveTreeNode(Row("row", EmptyIcon.ICON_16))))
        assertNull(tree.hoveredBounds(view))
        move(1)

        assertEquals(listOf("row", null, "row"), hovered)
        assertNotNull(tree.hoveredBounds(view))
    }

    fun `test overlay releases renderer stamps when painting fails`() {
        val icon = object : Icon {
            override fun getIconWidth() = 16
            override fun getIconHeight() = 16
            override fun paintIcon(component: Component, graphics: Graphics, x: Int, y: Int) {
                error("Renderer failed")
            }
        }
        val tree = ActiveTree("")
        tree.update(listOf(ActiveTreeNode(Row("row", icon))))
        val view = attach(tree)
        val stamp = view.cellRenderer as JComponent
        val buffered = stamp.isDoubleBuffered
        val image = BufferedImage(view.width, view.height, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            val error = runCatching { view.regions.paint(graphics) }.exceptionOrNull()
            assertTrue(error is IllegalStateException)
            assertEquals("Renderer failed", error?.message)
            assertNull(stamp.parent)
            assertEquals(buffered, stamp.isDoubleBuffered)
            view.components.filterIsInstance<CellRendererPane>().forEach { assertEquals(0, it.componentCount) }
        } finally {
            graphics.dispose()
        }
    }

    fun `test clipped tree overlay never visits unrelated rows`() {
        val reads = mutableSetOf<Int>()
        val tree = ActiveTree("")
        tree.update((0 until 200).map { index ->
            ActiveTreeNode(object : ActiveItem {
                override val key = index.toString()
                override val title: String get() {
                    reads += index
                    return key
                }
            })
        })
        val view = attach(tree)
        repeat(view.rowCount) { view.getRowBounds(it) }
        val cell = view.getRowBounds(1)
        val image = BufferedImage(view.width, view.height, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            graphics.clip = Rectangle(0, cell.y, view.width, cell.height)
            reads.clear()
            view.regions.paint(graphics)
            assertEquals(setOf(1), reads)
        } finally {
            graphics.dispose()
        }
    }

    private fun spinner() = AnimationIcon.Cycle(100, EmptyIcon.ICON_16, EmptyIcon.ICON_16)

    private fun attach(tree: ActiveTree): ActiveTreeView {
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(DefaultTreeUI())
        val host = JPanel(BorderLayout())
        host.add(tree)
        host.setSize(400, 300)
        host.addNotify()
        Disposer.register(testRootDisposable) { host.removeNotify() }
        activeLayout(host)
        UIUtil.dispatchAllInvocationEvents()
        return view
    }

    private fun dirty(target: JComponent, block: () -> Unit): List<Rectangle> {
        val regions = mutableListOf<Rectangle>()
        val old = RepaintManager.currentManager(target)
        RepaintManager.setCurrentManager(object : RepaintManager() {
            override fun addDirtyRegion(c: JComponent, x: Int, y: Int, width: Int, height: Int) {
                if (c === target && width > 0 && height > 0) regions += Rectangle(x, y, width, height)
            }
        })
        try {
            block()
        } finally {
            RepaintManager.setCurrentManager(old)
        }
        return regions
    }
}
