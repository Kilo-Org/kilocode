package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.LiveBadgeIcon
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
        val model = CollectionListModel<ActiveListItem>(listOf(row))
        val list = JBList(model).apply { setSize(400, 600) }
        val stamp = ActiveListRenderer(model).getListCellRendererComponent(list, row, 0, false, false)
        stamp.setBounds(0, 0, 400, 80)

        activeListInvalidate(stamp)
        reads = 0
        plain(stamp)
        val before = reads

        activeListInvalidate(stamp)
        reads = 0
        activeListLayout(stamp)
        val after = reads

        assertTrue("a measured pass should read the row glyphs far less often: plain=$before pass=$after", after * 3 <= before)
    }

    fun `test an animation frame repaints only rows that show an animated glyph`() {
        val spinner = AnimatedIcon(100, EmptyIcon.ICON_16, EmptyIcon.ICON_16)
        val view = ActiveListView("") { _, _ -> }
        view.update(listOf(
            row("still", EmptyIcon.ICON_16),
            row("spin", spinner),
            row("badge", LiveBadgeIcon(spinner, JBColor.GREEN)),
            row("still2", EmptyIcon.ICON_16),
        ))
        layout(view)
        val delegate = view.list.getClientProperty(AnimatedIcon.REFRESH_DELEGATE) as Runnable

        val dirty = dirty(view.list) { delegate.run() }

        val rows = listOf(1, 2).map { view.list.getCellBounds(it, it) }
        assertEquals(rows, dirty)
    }

    fun `test an animation frame repaints nothing when no row animates`() {
        val view = ActiveListView("") { _, _ -> }
        view.update(listOf(row("a", EmptyIcon.ICON_16), row("b", EmptyIcon.ICON_16)))
        layout(view)
        val delegate = view.list.getClientProperty(AnimatedIcon.REFRESH_DELEGATE) as Runnable

        assertEquals(emptyList<Rectangle>(), dirty(view.list) { delegate.run() })
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

    private fun layout(view: ActiveListView) {
        val pane = JPanel()
        pane.add(view)
        pane.setSize(400, 600)
        view.setSize(400, 600)
        view.list.setSize(400, 600)
        view.list.doLayout()
        UIUtil.dispatchAllInvocationEvents()
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

    private fun row(key: String, glyph: Icon): ActiveListItem = object : ActiveListItem {
        override val key = key
        override val title = key
        override val search = key
        override val description = "$key description"
        override val icon = glyph
        override val badges = listOf(ActiveListBadge("PR", icon = glyph))
        override val secondaryBadges = listOf(ActiveListBadge("1", icon = glyph))
    }
}
