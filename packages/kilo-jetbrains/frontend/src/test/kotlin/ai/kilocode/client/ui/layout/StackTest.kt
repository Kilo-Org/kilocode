package ai.kilocode.client.ui.layout

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Dimension

@Suppress("UnstableApiUsage")
class StackTest : BasePlatformTestCase() {

    fun `test vertical stack is non-opaque`() {
        assertFalse(Stack.vertical().isOpaque)
    }

    fun `test horizontal stack is non-opaque`() {
        assertFalse(Stack.horizontal().isOpaque)
    }

    fun `test next adds direct children in order and returns stack`() {
        val a = child(pref = 10 x 5)
        val b = child(pref = 20 x 7)
        val stack = Stack.vertical()

        assertSame(stack, stack.next(a))
        stack.next(b)

        assertEquals(2, stack.componentCount)
        assertSame(a, stack.getComponent(0))
        assertSame(b, stack.getComponent(1))
    }

    fun `test vertical stacks children with default gap`() {
        val a = child(pref = 10 x 5)
        val b = child(pref = 20 x 7)
        val stack = Stack.vertical(gap = 3).apply {
            next(a)
            next(b)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(0, 0, 100, 5, a)
        assertBounds(0, 8, 100, 7, b)
    }

    fun `test vertical skips invisible child and its gap`() {
        val a = child(pref = 10 x 5)
        val b = child(pref = 20 x 7).apply { isVisible = false }
        val c = child(pref = 30 x 9)
        val stack = Stack.vertical(gap = 3).apply {
            next(a)
            next(b)
            next(c)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(0, 0, 100, 5, a)
        assertBounds(0, 8, 100, 9, c)
    }

    fun `test vertical explicit gap overrides default next gap`() {
        val a = child(pref = 10 x 5)
        val b = child(pref = 20 x 7)
        val stack = Stack.vertical(gap = 3).apply {
            next(a)
            gap(11)
            next(b)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(0, 0, 100, 5, a)
        assertBounds(0, 16, 100, 7, b)
    }

    fun `test vertical explicit gap is ignored across invisible child`() {
        val a = child(pref = 10 x 5)
        val b = child(pref = 20 x 7).apply { isVisible = false }
        val c = child(pref = 30 x 9)
        val stack = Stack.vertical(gap = 3).apply {
            next(a)
            gap(11)
            next(b)
            gap(13)
            next(c)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(0, 0, 100, 5, a)
        assertBounds(0, 8, 100, 9, c)
    }

    fun `test vertical trailing gap is ignored`() {
        val a = child(pref = 10 x 5)
        val stack = Stack.vertical().apply {
            next(a)
            gap(11)
        }

        assertEquals(10 x 5, stack.preferredSize)
    }

    fun `test removeAll clears explicit gaps`() {
        val a = child(pref = 10 x 5)
        val b = child(pref = 20 x 7)
        val stack = Stack.vertical().apply {
            next(a)
            gap(11)
            removeAll()
            next(b)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(0, 0, 100, 7, b)
    }

    fun `test vertical filler contributes fixed height and tracks width`() {
        val a = child(pref = 10 x 5)
        val b = child(pref = 20 x 7)
        val stack = Stack.vertical().apply {
            next(a)
            fill(11)
            next(b)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        val filler = stack.getComponent(1)
        assertEquals(20 x 23, stack.preferredSize)
        assertBounds(0, 0, 100, 5, a)
        assertBounds(0, 5, 100, 11, filler)
        assertBounds(0, 16, 100, 7, b)
    }

    fun `test vertical fills width ignoring child width constraints`() {
        val a = child(min = 30 x 4, pref = 40 x 5, max = 50 x 6)
        val stack = Stack.vertical().apply { next(a) }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(0, 0, 100, 5, a)
    }

    fun `test vertical bounds child preferred height`() {
        val a = child(min = 10 x 8, pref = 20 x 3, max = 30 x 12)
        val b = child(min = 10 x 2, pref = 20 x 20, max = 30 x 7)
        val stack = Stack.vertical().apply {
            next(a)
            next(b)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(0, 0, 100, 8, a)
        assertBounds(0, 8, 100, 7, b)
    }

    fun `test vertical respects insets`() {
        val a = child(pref = 10 x 5)
        val stack = Stack.vertical().apply {
            border = JBUI.Borders.empty(2, 3, 4, 5)
            next(a)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(3, 2, 92, 5, a)
    }

    fun `test horizontal stacks children with default gap`() {
        val a = child(pref = 10 x 5)
        val b = child(pref = 20 x 7)
        val stack = Stack.horizontal(gap = 3).apply {
            next(a)
            next(b)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(0, 0, 10, 50, a)
        assertBounds(13, 0, 20, 50, b)
    }

    fun `test horizontal skips invisible child and its gap`() {
        val a = child(pref = 10 x 5)
        val b = child(pref = 20 x 7).apply { isVisible = false }
        val c = child(pref = 30 x 9)
        val stack = Stack.horizontal(gap = 3).apply {
            next(a)
            next(b)
            next(c)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(0, 0, 10, 50, a)
        assertBounds(13, 0, 30, 50, c)
    }

    fun `test horizontal explicit gap overrides default next gap`() {
        val a = child(pref = 10 x 5)
        val b = child(pref = 20 x 7)
        val stack = Stack.horizontal(gap = 3).apply {
            next(a)
            gap(11)
            next(b)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(0, 0, 10, 50, a)
        assertBounds(21, 0, 20, 50, b)
    }

    fun `test horizontal explicit gap is ignored across invisible child`() {
        val a = child(pref = 10 x 5)
        val b = child(pref = 20 x 7).apply { isVisible = false }
        val c = child(pref = 30 x 9)
        val stack = Stack.horizontal(gap = 3).apply {
            next(a)
            gap(11)
            next(b)
            gap(13)
            next(c)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(0, 0, 10, 50, a)
        assertBounds(13, 0, 30, 50, c)
    }

    fun `test horizontal trailing gap is ignored`() {
        val a = child(pref = 10 x 5)
        val stack = Stack.horizontal().apply {
            next(a)
            gap(11)
        }

        assertEquals(10 x 5, stack.preferredSize)
    }

    fun `test horizontal filler contributes fixed width and tracks height`() {
        val a = child(pref = 10 x 5)
        val b = child(pref = 20 x 7)
        val stack = Stack.horizontal().apply {
            next(a)
            fill(11)
            next(b)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        val filler = stack.getComponent(1)
        assertEquals(41 x 7, stack.preferredSize)
        assertBounds(0, 0, 10, 50, a)
        assertBounds(10, 0, 11, 50, filler)
        assertBounds(21, 0, 20, 50, b)
    }

    fun `test horizontal fills height ignoring child height constraints`() {
        val a = child(min = 4 x 10, pref = 5 x 20, max = 6 x 30)
        val stack = Stack.horizontal().apply { next(a) }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(0, 0, 5, 50, a)
    }

    fun `test horizontal bounds child preferred width`() {
        val a = child(min = 8 x 10, pref = 3 x 20, max = 12 x 30)
        val b = child(min = 2 x 10, pref = 20 x 20, max = 7 x 30)
        val stack = Stack.horizontal().apply {
            next(a)
            next(b)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()
        assertBounds(0, 0, 8, 50, a)
        assertBounds(8, 0, 7, 50, b)
    }

    fun `test horizontal respects insets`() {
        val a = child(pref = 10 x 5)
        val stack = Stack.horizontal().apply {
            border = JBUI.Borders.empty(2, 3, 4, 5)
            next(a)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(3, 2, 10, 44, a)
    }

    fun `test fit horizontal preserves preferred widths when there is space`() {
        val a = child(pref = 10 x 5)
        val b = child(pref = 20 x 7)
        val stack = Stack.fitHorizontal(gap = 3).apply {
            next(a)
            next(b)
        }

        stack.setBounds(0, 0, 100, 50)
        stack.doLayout()

        assertBounds(0, 0, 10, 50, a)
        assertBounds(13, 0, 20, 50, b)
    }

    fun `test fit horizontal allocates tight space from the left`() {
        val a = child(pref = 20 x 5)
        val b = child(pref = 20 x 7)
        val c = child(pref = 20 x 9)
        val stack = Stack.fitHorizontal(gap = 3).apply {
            next(a)
            next(b)
            next(c)
        }

        stack.setBounds(0, 0, 45, 50)
        stack.doLayout()

        assertBounds(0, 0, 20, 50, a)
        assertBounds(23, 0, 20, 50, b)
        assertBounds(45, 0, 0, 50, c)
    }

    fun `test vertical measures preferred height after width probe`() {
        val a = object : JBLabel("x") {
            override fun getMinimumSize() = Dimension(0, 0)
            override fun getPreferredSize() = Dimension(20, if (width == 100) 12 else 60)
            override fun getMaximumSize() = Dimension(Int.MAX_VALUE, Int.MAX_VALUE)
        }
        val stack = Stack.vertical().apply { next(a) }

        stack.setBounds(0, 0, 100, 80)
        stack.doLayout()

        assertBounds(0, 0, 100, 12, a)
    }

    fun `test horizontal measures preferred width after height probe`() {
        val a = object : JBLabel("x") {
            override fun getMinimumSize() = Dimension(0, 0)
            override fun getPreferredSize() = Dimension(if (height == 80) 17 else 70, 20)
            override fun getMaximumSize() = Dimension(Int.MAX_VALUE, Int.MAX_VALUE)
        }
        val stack = Stack.horizontal().apply { next(a) }

        stack.setBounds(0, 0, 100, 80)
        stack.doLayout()

        assertBounds(0, 0, 17, 80, a)
    }

    fun `test vertical preferred size sums height and maxes width`() {
        val a = child(min = 5 x 2, pref = 10 x 4, max = 20 x 8)
        val b = child(min = 6 x 3, pref = 30 x 5, max = 25 x 9)
        val stack = Stack.vertical(gap = 7).apply {
            border = JBUI.Borders.empty(1, 2, 3, 4)
            next(a)
            next(b)
        }

        val size = stack.preferredSize

        assertEquals(25 + 2 + 4, size.width)
        assertEquals(4 + 7 + 5 + 1 + 3, size.height)
    }

    fun `test horizontal preferred size sums width and maxes height`() {
        val a = child(min = 5 x 2, pref = 10 x 4, max = 20 x 8)
        val b = child(min = 6 x 3, pref = 30 x 5, max = 25 x 9)
        val stack = Stack.horizontal(gap = 7).apply {
            border = JBUI.Borders.empty(1, 2, 3, 4)
            next(a)
            next(b)
        }

        val size = stack.preferredSize

        assertEquals(10 + 7 + 25 + 2 + 4, size.width)
        assertEquals(5 + 1 + 3, size.height)
    }

    fun `test minimum size uses child minimum sizes`() {
        val a = child(min = 5 x 2, pref = 10 x 4)
        val b = child(min = 6 x 3, pref = 30 x 5)
        val vertical = Stack.vertical(gap = 7).apply {
            next(a)
            next(b)
        }
        val c = child(min = 5 x 2, pref = 10 x 4)
        val d = child(min = 6 x 3, pref = 30 x 5)
        val horizontal = Stack.horizontal(gap = 7).apply {
            next(c)
            next(d)
        }

        assertEquals(6 x 12, vertical.minimumSize)
        assertEquals(18 x 3, horizontal.minimumSize)
    }

    fun `test maximum size uses effective maximum sizes`() {
        val a = child(min = 5 x 6, pref = 10 x 7, max = 1 x 2)
        val b = child(min = 6 x 3, pref = 30 x 5, max = 20 x 9)
        val vertical = Stack.vertical(gap = 7).apply {
            next(a)
            next(b)
        }
        val c = child(min = 5 x 6, pref = 10 x 7, max = 1 x 2)
        val d = child(min = 6 x 3, pref = 30 x 5, max = 20 x 9)
        val horizontal = Stack.horizontal(gap = 7).apply {
            next(c)
            next(d)
        }

        assertEquals(20 x 22, vertical.maximumSize)
        assertEquals(32 x 9, horizontal.maximumSize)
    }

    private infix fun Int.x(h: Int) = Dimension(this, h)

    private fun child(
        min: Dimension = Dimension(0, 0),
        pref: Dimension,
        max: Dimension = Dimension(Int.MAX_VALUE, Int.MAX_VALUE),
    ) = object : JBLabel("x") {
        override fun getMinimumSize() = min
        override fun getPreferredSize() = pref
        override fun getMaximumSize() = max
    }

    private fun assertBounds(x: Int, y: Int, w: Int, h: Int, c: Component) {
        val b = c.bounds
        assertEquals("x", x, b.x)
        assertEquals("y", y, b.y)
        assertEquals("width", w, b.width)
        assertEquals("height", h, b.height)
    }
}
