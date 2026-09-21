package ai.kilocode.client.ui.layout

import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import java.awt.LayoutManager2
import javax.swing.JComponent
import javax.swing.JPanel

class StackAxis private constructor(val vertical: Boolean) {
    companion object {
        val VERTICAL = StackAxis(true)
        val HORIZONTAL = StackAxis(false)
    }
}

/**
 * A transparent one-dimensional layout panel for rows and columns.
 *
 * Vertical stacks make every child track the available width while preserving
 * each child's bounded preferred height. Horizontal stacks do the opposite.
 * Children are probed with the known cross-axis size before preferred size is
 * read, so wrapping components can report the preferred size for that width or
 * height.
 */
open class Stack(
    private val axis: StackAxis,
    space: Int = 0,
) : JPanel(Layout(axis, space)) {

    init {
        isOpaque = false
    }

    /**
     * Base spacing between adjacent visible children.
     *
     * A layout manager captures its gap once, so a DPI-derived value (e.g. [ai.kilocode.client.ui.UiStyle.Gap])
     * would keep its pre-zoom pixel width forever. Reassign this from `updateUI()` on components whose
     * spacing has to follow the IDE zoom or the active theme.
     */
    var space: Int
        get() = mgr.base
        set(value) {
            if (mgr.base == value) return
            mgr.base = value
            revalidate()
        }

    fun next(child: Component): Stack {
        add(child)
        return this
    }

    fun gap(size: Int = space): Stack {
        mgr.gap(size)
        revalidate()
        return this
    }

    fun fill(size: Int): Stack {
        add(filler(axis, size))
        return this
    }

    override fun removeAll() {
        mgr.clear()
        super.removeAll()
    }

    private val mgr: Layout
        get() = getLayout() as Layout

    internal fun fit(): Stack {
        mgr.fit = true
        revalidate()
        return this
    }

    private class Layout(
        private val axis: StackAxis,
        var base: Int,
    ) : LayoutManager2 {

        var fit = false

        private val entries = mutableListOf<Entry>()

        fun gap(size: Int) {
            entries.add(Entry.Gap(size))
        }

        fun clear() {
            entries.clear()
        }

        override fun addLayoutComponent(comp: Component, constraints: Any?) {
            entries.removeAll { it is Entry.Child && it.comp == comp }
            entries.add(Entry.Child(comp))
        }

        override fun addLayoutComponent(name: String?, comp: Component) {
            addLayoutComponent(comp, null)
        }

        override fun removeLayoutComponent(comp: Component) {
            entries.removeAll { it is Entry.Child && it.comp == comp }
        }

        override fun layoutContainer(parent: Container) {
            val ins = parent.insets
            val w = maxOf(0, parent.width - ins.left - ins.right)
            val h = maxOf(0, parent.height - ins.top - ins.bottom)
            if (!axis.vertical && fit) {
                fit(parent, ins.left, ins.top, w, h)
                return
            }
            var x = ins.left
            var y = ins.top
            var seen = false
            var ready = false
            var pending: Int? = null

            for (entry in entries) {
                when (entry) {
                    is Entry.Gap -> {
                        if (ready) pending = safe(pending ?: 0, entry.size)
                    }
                    is Entry.Child -> {
                        val space = pending
                        pending = null
                        ready = false
                        if (entry.comp.isVisible) {
                            if (seen) {
                                val gap = space ?: base
                                if (axis.vertical) y += gap else x += gap
                            }
                            seen = true
                            ready = true
                            if (axis.vertical) {
                                entry.comp.setSize(w, entry.comp.height.coerceAtLeast(1))
                            } else {
                                entry.comp.setSize(entry.comp.width.coerceAtLeast(1), h)
                            }
                            val pref = entry.comp.preferredSize
                            val min = entry.comp.minimumSize
                            val max = entry.comp.maximumSize
                            val cw = if (axis.vertical) {
                                w
                            } else {
                                bound(pref.width, min.width, max.width)
                            }
                            val ch = if (!axis.vertical) {
                                h
                            } else {
                                bound(pref.height, min.height, max.height)
                            }
                            entry.comp.setBounds(x, y, cw, ch)
                            if (axis.vertical) y += ch else x += cw
                        }
                    }
                }
            }
        }

        private fun fit(parent: Container, left: Int, top: Int, w: Int, h: Int) {
            val items = children(parent, h)
            var x = left
            var rest = w
            items.forEach { item ->
                val gap = minOf(item.gap, rest)
                x += gap
                rest -= gap
                val width = minOf(item.width, rest)
                item.comp.setBounds(x, top, width, h)
                x += width
                rest -= width
            }
        }

        private fun children(parent: Container, h: Int): List<Item> {
            val items = mutableListOf<Item>()
            var seen = false
            var ready = false
            var pending: Int? = null
            for (entry in entries) {
                when (entry) {
                    is Entry.Gap -> if (ready) pending = safe(pending ?: 0, entry.size)
                    is Entry.Child -> {
                        val space = pending
                        pending = null
                        ready = false
                        if (entry.comp.isVisible) {
                            entry.comp.setSize(entry.comp.width.coerceAtLeast(1), h)
                            val pref = entry.comp.preferredSize
                            val min = entry.comp.minimumSize
                            val max = entry.comp.maximumSize
                            items.add(Item(entry.comp, if (seen) space ?: base else 0, bound(pref.width, min.width, max.width)))
                            seen = true
                            ready = true
                        }
                    }
                }
            }
            return items
        }

        override fun minimumLayoutSize(parent: Container) = size(parent, MIN)
        override fun preferredLayoutSize(parent: Container) = size(parent, PREF)
        override fun maximumLayoutSize(target: Container) = size(target, MAX)
        override fun getLayoutAlignmentX(target: Container) = 0.5f
        override fun getLayoutAlignmentY(target: Container) = 0.5f
        override fun invalidateLayout(target: Container) = Unit

        private fun size(parent: Container, kind: Int): Dimension {
            val ins = parent.insets
            var main = 0
            var cross = 0
            var seen = false
            var ready = false
            var pending: Int? = null

            for (entry in entries) {
                when (entry) {
                    is Entry.Gap -> {
                        if (ready) pending = safe(pending ?: 0, entry.size)
                    }
                    is Entry.Child -> {
                        val space = pending
                        pending = null
                        ready = false
                        if (entry.comp.isVisible) {
                            if (seen) main = safe(main, space ?: base)
                            seen = true
                            ready = true
                            val dim = dim(entry.comp, kind)
                            main = safe(main, if (axis.vertical) dim.height else dim.width)
                            cross = maxOf(cross, if (axis.vertical) dim.width else dim.height)
                        }
                    }
                }
            }
            val w = if (axis.vertical) cross else main
            val h = if (axis.vertical) main else cross
            return Dimension(safe(w, ins.left + ins.right), safe(h, ins.top + ins.bottom))
        }

        private fun dim(comp: Component, kind: Int): Dimension {
            val min = comp.minimumSize
            if (kind == MIN) return min
            val max = comp.maximumSize
            val cw = max.width.coerceAtLeast(min.width)
            val ch = max.height.coerceAtLeast(min.height)
            if (kind == MAX) return Dimension(cw, ch)
            val pref = comp.preferredSize
            return Dimension(bound(pref.width, min.width, cw), bound(pref.height, min.height, ch))
        }
    }

    companion object {
        fun vertical(gap: Int = 0) = Stack(StackAxis.VERTICAL, gap)
        fun horizontal(gap: Int = 0) = Stack(StackAxis.HORIZONTAL, gap)
        fun fitHorizontal(gap: Int = 0) = Stack(StackAxis.HORIZONTAL, gap).fit()
        fun verticalFiller(size: Int): Component = filler(StackAxis.VERTICAL, size)
        fun horizontalFiller(size: Int): Component = filler(StackAxis.HORIZONTAL, size)
    }
}

private fun filler(axis: StackAxis, size: Int) = object : JComponent() {
    init {
        isOpaque = false
    }

    override fun getPreferredSize(): Dimension = dim()
    override fun getMinimumSize(): Dimension = dim()
    override fun getMaximumSize(): Dimension {
        if (axis.vertical) return Dimension(Int.MAX_VALUE, size)
        return Dimension(size, Int.MAX_VALUE)
    }

    private fun dim(): Dimension {
        if (axis.vertical) return Dimension(0, size)
        return Dimension(size, 0)
    }
}

private sealed class Entry {
    data class Child(val comp: Component) : Entry()
    data class Gap(val size: Int) : Entry()
}

private data class Item(val comp: Component, val gap: Int, val width: Int)

private const val MIN = 0
private const val PREF = 1
private const val MAX = 2

private fun safe(value: Int, extra: Int): Int {
    val next = value.toLong() + extra.toLong()
    return next.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
}

private fun bound(value: Int, min: Int, max: Int): Int = value.coerceAtLeast(min).coerceAtMost(max)
