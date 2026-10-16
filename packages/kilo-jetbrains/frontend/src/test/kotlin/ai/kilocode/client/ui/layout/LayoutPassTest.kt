package ai.kilocode.client.ui.layout

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Dimension
import javax.swing.JComponent

class LayoutPassTest : BasePlatformTestCase() {
    fun `test a pass measures a nested invalid tree once per container`() {
        val leaf = Probe()
        val tree = Stack.vertical().next(Stack.horizontal().next(leaf.align(HAlign.CENTER, VAlign.CENTER)))

        tree.preferredSize
        val plain = leaf.reads
        leaf.reads = 0

        val pass = LayoutPass.measure {
            tree.preferredSize
            val first = leaf.reads
            tree.preferredSize
            tree.minimumSize
            tree.maximumSize
            assertEquals("repeated reads inside a pass should reuse the answers", first, leaf.reads)
            first
        }

        assertTrue("a pass should measure the leaf fewer times: plain=$plain pass=$pass", pass < plain)
    }

    fun `test nothing is cached once the pass ends`() {
        val leaf = Probe()
        val tree = Stack.vertical().next(leaf)
        LayoutPass.measure { tree.preferredSize }

        leaf.pref = Dimension(40, 30)

        assertEquals(Dimension(40, 30), tree.preferredSize)
    }

    fun `test resizing a probing container inside a pass drops its answer`() {
        val wrap = object : JComponent() {
            override fun getPreferredSize() = Dimension(100, if (width in 1..49) 40 else 20)
        }
        val align = wrap.align(HAlign.FIT, VAlign.TOP)

        LayoutPass.measure {
            align.setSize(200, 10)
            assertEquals(20, align.preferredSize.height)

            align.setSize(30, 10)
            assertEquals(40, align.preferredSize.height)
        }
    }

    fun `test nested passes share the outer memo`() {
        val leaf = Probe()
        val tree = Stack.vertical().next(Stack.vertical().next(leaf))

        LayoutPass.measure {
            tree.preferredSize
            val reads = leaf.reads
            LayoutPass.measure { tree.preferredSize }
            assertEquals(reads, leaf.reads)
        }
    }

    /**
     * A leaf measured like a label: minimum and maximum are derived from the preferred size, so every size
     * question costs one measurement. Counts those measurements.
     */
    private class Probe : JComponent() {
        var reads = 0
        var pref = Dimension(10, 10)

        override fun getPreferredSize(): Dimension = measure()

        override fun getMinimumSize(): Dimension = measure()

        override fun getMaximumSize(): Dimension = measure()

        private fun measure(): Dimension {
            reads++
            return Dimension(pref)
        }
    }
}
