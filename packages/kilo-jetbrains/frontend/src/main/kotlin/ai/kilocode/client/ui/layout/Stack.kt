package ai.kilocode.client.ui.layout

import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import java.awt.LayoutManager2
import javax.swing.JComponent
import javax.swing.JPanel

enum class StackAxis { VERTICAL, HORIZONTAL }

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
    private val space: Int = 0,
) : JPanel(Layout(axis, space)) {

    init {
        isOpaque = false
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
        private val gap: Int,
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
            if (axis == StackAxis.HORIZONTAL && fit) {
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
                                val gap = space ?: gap
                                if (axis == StackAxis.VERTICAL) y += gap else x += gap
                            }
                            seen = true
                            ready = true
                            if (axis == StackAxis.VERTICAL) {
                                entry.comp.setSize(w, entry.comp.height.coerceAtLeast(1))
                            } else {
                                entry.comp.setSize(entry.comp.width.coerceAtLeast(1), h)
                            }
                            val pref = entry.comp.preferredSize
                            val min = entry.comp.minimumSize
                            val max = entry.comp.maximumSize
                            val cw = if (axis == StackAxis.VERTICAL) {
                                w
                            } else {
                                bound(pref.width, min.width, max.width)
                            }
                            val ch = if (axis == StackAxis.HORIZONTAL) {
                                h
                            } else {
                                bound(pref.height, min.height, max.height)
                            }
                            entry.comp.setBounds(x, y, cw, ch)
                            if (axis == StackAxis.VERTICAL) y += ch else x += cw
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
                            items.add(Item(entry.comp, if (seen) space ?: gap else 0, bound(pref.width, min.width, max.width)))
                            seen = true
                            ready = true
                        }
                    }
                }
            }
            return items
        }

        override fun minimumLayoutSize(parent: Container) = size(parent, Size.MIN)
        override fun preferredLayoutSize(parent: Container) = size(parent, Size.PREF)
        override fun maximumLayoutSize(target: Container) = size(target, Size.MAX)
        override fun getLayoutAlignmentX(target: Container) = 0.5f
        override fun getLayoutAlignmentY(target: Container) = 0.5f
        override fun invalidateLayout(target: Container) = Unit

        private fun size(parent: Container, kind: Size): Dimension {
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
                            if (seen) main = safe(main, space ?: gap)
                            seen = true
                            ready = true
                            val dim = dim(entry.comp, kind, cross(parent))
                            main = safe(main, if (axis == StackAxis.VERTICAL) dim.height else dim.width)
                            cross = maxOf(cross, if (axis == StackAxis.VERTICAL) dim.width else dim.height)
                        }
                    }
                }
            }

            val w = if (axis == StackAxis.VERTICAL) cross else main
            val h = if (axis == StackAxis.VERTICAL) main else cross
            return Dimension(safe(w, ins.left + ins.right), safe(h, ins.top + ins.bottom))
        }

        private fun dim(comp: Component, kind: Size, cross: Int): Dimension {
            if (kind == Size.MIN) return comp.minimumSize
            val min = comp.minimumSize
            if (kind == Size.MAX) {
                val max = comp.maximumSize
                return Dimension(maxOf(min.width, max.width), maxOf(min.height, max.height))
            }
            if (cross > 0) {
                if (axis == StackAxis.VERTICAL) {
                    comp.setSize(cross, comp.height.coerceAtLeast(1))
                } else {
                    comp.setSize(comp.width.coerceAtLeast(1), cross)
                }
            }
            val pref = comp.preferredSize
            val max = comp.maximumSize
            return Dimension(
                bound(pref.width, min.width, max.width),
                bound(pref.height, min.height, max.height),
            )
        }

        private fun cross(parent: Container): Int {
            val ins = parent.insets
            if (axis == StackAxis.VERTICAL) return maxOf(0, parent.width - ins.left - ins.right)
            return maxOf(0, parent.height - ins.top - ins.bottom)
        }

        private sealed interface Entry {
            data class Child(val comp: Component) : Entry
            data class Gap(val size: Int) : Entry
        }

        private data class Item(val comp: Component, val gap: Int, val width: Int)
    }

    private enum class Size { MIN, PREF, MAX }

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

    override fun getMinimumSize() = dim()
    override fun getPreferredSize() = dim()
    override fun getMaximumSize(): Dimension {
        if (axis == StackAxis.VERTICAL) return Dimension(Int.MAX_VALUE, size)
        return Dimension(size, Int.MAX_VALUE)
    }

    private fun dim(): Dimension {
        if (axis == StackAxis.VERTICAL) return Dimension(0, size)
        return Dimension(size, 0)
    }
}

private fun bound(value: Int, min: Int, max: Int) = value.coerceIn(min, maxOf(min, max))

private fun safe(a: Int, b: Int): Int {
    val sum = a.toLong() + b.toLong()
    if (sum > Int.MAX_VALUE) return Int.MAX_VALUE
    if (sum < 0) return 0
    return sum.toInt()
}
