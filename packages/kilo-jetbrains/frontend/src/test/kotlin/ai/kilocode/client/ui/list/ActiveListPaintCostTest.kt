package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.active.activeInvalidate
import ai.kilocode.client.ui.active.activeLayout
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveBadge
import ai.kilocode.client.ui.LiveBadgeIcon
import ai.kilocode.client.ui.AnimationIcon
import ai.kilocode.client.ui.layout.LayoutPass
import ai.kilocode.client.testing.TestUiTimers
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.CollectionListModel
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBList
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Container
import java.awt.Graphics
import java.awt.Rectangle
import java.awt.image.BufferedImage
import javax.swing.CellRendererPane
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.RepaintManager

/**
 * The Agent Manager list repaints on every spinner frame and re-lays out its renderer stamp for every row it
 * paints or hit-tests, so both the number of rows a frame repaints and the cost of one row layout matter.
 */
class ActiveListPaintCostTest : BasePlatformTestCase() {
    private var reads = 0

    fun `test a row layout pass measures each nested container once`() {
        val glyph = counting()
        val row = row("a", glyph)
        val model = CollectionListModel<ActiveItem>(listOf(row))
        val list = JBList(model).apply { setSize(400, 600) }
        val stamp = ActiveListRenderer(model).getListCellRendererComponent(list, row, 0, false, false)
        stamp.setBounds(0, 0, 400, 80)

        activeInvalidate(stamp)
        reads = 0
        plain(stamp)
        val before = reads

        activeInvalidate(stamp)
        reads = 0
        activeLayout(stamp)
        val after = reads

        assertTrue("a measured pass should read the row glyphs far less often: plain=$before pass=$after", after * 3 <= before)
    }

    fun `test native renderer painting keeps the scoped measurement pass`() {
        val row = row("a", counting())
        val model = CollectionListModel<ActiveItem>(listOf(row))
        val list = JBList(model).apply { setSize(400, 600) }
        val renderer = ActiveListRenderer(model)
        val pane = CellRendererPane()
        list.add(pane)
        val host = JPanel().apply {
            add(list)
            addNotify()
        }
        val image = BufferedImage(400, 80, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            val first = renderer.getListCellRendererComponent(list, row, 0, false, false)
            pane.paintComponent(graphics, first, list, 0, 0, image.width, image.height, true)
            repeat(3) {
                val stamp = renderer.getListCellRendererComponent(list, row, 0, false, false)
                reads = 0
                LayoutPass.measure { pane.paintComponent(graphics, stamp, list, 0, 0, image.width, image.height, true) }
                val expected = reads
                assertTrue("Native validation requires an attached renderer", stamp.isDisplayable)
                assertTrue("The paint must measure row glyphs", expected > 0)

                renderer.getListCellRendererComponent(list, row, 0, false, false)
                reads = 0
                pane.paintComponent(graphics, stamp, list, 0, 0, image.width, image.height, true)

                assertEquals("Native painting must cache the same measurements as an enclosing pass", expected, reads)
            }
        } finally {
            graphics.dispose()
            host.removeNotify()
        }
    }

    fun `test an animation frame repaints only rows that show an animated glyph`() {
        val timers = TestUiTimers()
        val spinner = AnimationIcon.Cycle(100, EmptyIcon.ICON_16, EmptyIcon.ICON_16)
        val view = ActiveListView("", timers = timers) { _, _ -> }
        view.update(listOf(
            row("still", EmptyIcon.ICON_16),
            row("spin", spinner),
            row("badge", LiveBadgeIcon(spinner, JBColor.GREEN)),
            row("still2", EmptyIcon.ICON_16),
        ))
        layout(view)
        val dirty = dirty(view.list) { timers.advanceBy(100) }

        val rows = listOf(1, 2).map { view.list.getCellBounds(it, it) }
        assertEquals(rows, dirty)
    }

    fun `test the shared clock survives a detach and re-attach without native icon jobs`() {
        val timers = TestUiTimers()
        val spinner = AnimationIcon.Cycle(100, EmptyIcon.ICON_16, EmptyIcon.ICON_16)
        val view = ActiveListView("", timers = timers) { _, _ -> }
        view.update(listOf(row("spin", spinner)))
        val host = layout(view)
        assertEquals(1, timers.pending)
        assertEquals(false, view.list.getClientProperty(AnimatedIcon.ANIMATION_IN_RENDERER_ALLOWED))
        assertNull(view.list.getClientProperty(AnimatedIcon.REFRESH_DELEGATE))

        host.removeNotify()
        assertEquals(0, timers.pending)

        host.addNotify()

        assertEquals(1, timers.pending)
        assertEquals(listOf(view.list.getCellBounds(0, 0)), dirty(view.list) { timers.advanceBy(100) })
    }

    fun `test an animation frame repaints nothing when no row animates`() {
        val timers = TestUiTimers()
        val view = ActiveListView("", timers = timers) { _, _ -> }
        view.update(listOf(row("a", EmptyIcon.ICON_16), row("b", EmptyIcon.ICON_16)))
        layout(view)
        assertEquals(0, timers.pending)
        assertEquals(emptyList<Rectangle>(), dirty(view.list) { timers.advanceBy(1000) })
    }

    fun `test filtering out the last animated row stops the clock and clearing the filter restarts it`() {
        val timers = TestUiTimers()
        val view = ActiveListView("", timers = timers) { _, _ -> }
        view.update(listOf(
            row("still", EmptyIcon.ICON_16),
            row("spin", AnimationIcon.Cycle(100, EmptyIcon.ICON_16, EmptyIcon.ICON_16)),
        ))
        layout(view)
        assertEquals(1, timers.pending)
        view.filter("still")
        assertEquals(0, timers.pending)
        view.filter("")
        assertEquals(1, timers.pending)
    }

    private fun plain(component: Component) {
        if (component !is Container) return
        component.doLayout()
        component.components.forEach(::plain)
    }

    /** The regions repainted on [target] while [block] runs; empty regions are no-ops for Swing and skipped. */
    private fun dirty(target: JComponent, block: () -> Unit): List<Rectangle> {
        val out = mutableListOf<Rectangle>()
        val old = RepaintManager.currentManager(null)
        RepaintManager.setCurrentManager(object : RepaintManager() {
            override fun addDirtyRegion(c: JComponent, x: Int, y: Int, w: Int, h: Int) {
                if (c === target && w > 0 && h > 0) out.add(Rectangle(x, y, w, h))
            }
        })
        try {
            block()
        } finally {
            RepaintManager.setCurrentManager(old)
        }
        return out
    }

    private fun layout(view: ActiveListView): JPanel {
        val pane = JPanel()
        pane.add(view)
        pane.setSize(400, 600)
        view.setSize(400, 600)
        view.list.setSize(400, 600)
        pane.addNotify()
        Disposer.register(testRootDisposable) { pane.removeNotify() }
        view.list.doLayout()
        UIUtil.dispatchAllInvocationEvents()
        return pane
    }

    private fun counting() = object : Icon {
        override fun paintIcon(c: Component?, g: Graphics?, x: Int, y: Int) = Unit

        override fun getIconWidth(): Int {
            reads++
            return 16
        }

        override fun getIconHeight(): Int {
            reads++
            return 16
        }
    }

    private fun row(key: String, glyph: Icon): ActiveItem = object : ActiveItem {
        override val key = key
        override val title = key
        override val search = key
        override val description = "$key description"
        override val icon = glyph
        override val badges = listOf(ActiveBadge("PR", icon = glyph))
        override val secondaryBadges = listOf(ActiveBadge("1", icon = glyph))
    }
}
