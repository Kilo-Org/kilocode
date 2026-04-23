package ai.kilocode.client.session.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import javax.swing.JLabel
import javax.swing.JPanel

/**
 * Tests for [SessionLayout].
 *
 * Uses a plain [JPanel] as container to test the layout manager in isolation.
 * Components are sized manually since there is no real screen / Swing event loop
 * involved during tests.
 */
@Suppress("UnstableApiUsage")
class SessionLayoutTest : BasePlatformTestCase() {

    private fun panel(gap: Int = 0, width: Int = 400): JPanel {
        return JPanel(SessionLayout(gap)).apply {
            setSize(width, 2000)
        }
    }

    // ---- basic stacking ------

    fun `test single component is placed at the top`() {
        val p = panel(width = 300)
        val child = label(height = 20)
        p.add(child)
        p.doLayout()

        assertEquals(0, child.y)
        assertEquals(300, child.width)
        assertEquals(20, child.height)
    }

    fun `test two components are stacked with gap`() {
        val p = panel(gap = 8, width = 300)
        val c1 = label(height = 20)
        val c2 = label(height = 30)
        p.add(c1)
        p.add(c2)
        p.doLayout()

        assertEquals(0, c1.y)
        assertEquals(20 + 8, c2.y)
    }

    fun `test three components stack correctly with gap`() {
        val p = panel(gap = 4, width = 300)
        val c1 = label(height = 10)
        val c2 = label(height = 15)
        val c3 = label(height = 20)
        p.add(c1)
        p.add(c2)
        p.add(c3)
        p.doLayout()

        assertEquals(0, c1.y)
        assertEquals(14, c2.y)   // 10 + 4
        assertEquals(33, c3.y)   // 10 + 4 + 15 + 4
    }

    fun `test all children receive full available width`() {
        val p = panel(width = 500)
        val c1 = label(height = 20)
        val c2 = label(height = 20)
        p.add(c1)
        p.add(c2)
        p.doLayout()

        assertEquals(500, c1.width)
        assertEquals(500, c2.width)
    }

    // ---- invisible children ------

    fun `test invisible child is skipped in layout`() {
        val p = panel(gap = 8, width = 300)
        val c1 = label(height = 20)
        val c2 = label(height = 30).also { it.isVisible = false }
        val c3 = label(height = 25)
        p.add(c1)
        p.add(c2)
        p.add(c3)
        p.doLayout()

        assertEquals(0, c1.y)
        // c2 is invisible — no gap before c3
        assertEquals(20 + 8, c3.y)
    }

    fun `test only invisible children produce zero height`() {
        val p = panel(gap = 8, width = 300)
        val c = label(height = 20).also { it.isVisible = false }
        p.add(c)
        p.doLayout()

        val size = p.layout.preferredLayoutSize(p)
        assertEquals(0, size.height)
    }

    // ---- preferred size ------

    fun `test preferredLayoutSize returns sum of child heights plus gaps`() {
        val p = panel(gap = 4, width = 300)
        p.add(label(height = 10))
        p.add(label(height = 15))
        p.add(label(height = 20))
        p.doLayout()

        val size = p.layout.preferredLayoutSize(p)
        assertEquals(10 + 4 + 15 + 4 + 20, size.height)
    }

    fun `test preferredLayoutSize with no children is zero`() {
        val p = panel(width = 300)
        val size = p.layout.preferredLayoutSize(p)
        assertEquals(0, size.height)
    }

    // ---- helpers ------

    /** A fixed-height JLabel. The width is reported as 0 until layout sets it. */
    private fun label(height: Int) = object : JLabel("test") {
        override fun getPreferredSize(): Dimension = Dimension(0, height)
    }
}
