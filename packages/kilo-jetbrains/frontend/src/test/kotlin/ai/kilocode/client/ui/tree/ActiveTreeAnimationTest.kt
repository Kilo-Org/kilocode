package ai.kilocode.client.ui.tree

import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.ui.AnimationIcon
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.activeLayout
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.tree.ui.DefaultTreeUI
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Rectangle
import java.awt.image.BufferedImage
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.RepaintManager
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

    fun `test overlay paint does not install the renderer in a cell renderer pane`() {
        val tree = ActiveTree("")
        tree.update(listOf(ActiveTreeNode(Row("row"))))
        val view = attach(tree)
        val entry = view.hierarchy.entries.getValue("row")
        view.selectionModel.selectionPath = TreePath(entry.path)
        val before = view.componentCount
        val image = BufferedImage(maxOf(view.width, 1), maxOf(view.height, 1), BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            view.regions.paint(graphics)
        } finally {
            graphics.dispose()
        }
        assertEquals(before, view.componentCount)
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
