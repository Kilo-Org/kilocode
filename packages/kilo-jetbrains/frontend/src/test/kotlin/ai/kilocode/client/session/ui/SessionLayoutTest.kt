package ai.kilocode.client.session.ui

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Dimension
import java.awt.Insets
import javax.swing.JPanel
import javax.swing.JLabel

/**
 * Tests for [SessionLayout].
 *
 * Uses a plain [BorderLayoutPanel] as container to test the layout manager in isolation.
 * Components are sized manually since there is no real screen / Swing event loop
 * involved during tests.
 */
@Suppress("UnstableApiUsage")
class SessionLayoutTest : BasePlatformTestCase() {

    private fun panel(
        gap: Int = 0,
        width: Int = 400,
        pad: Insets = JBUI.emptyInsets(),
    ): BorderLayoutPanel {
        return BorderLayoutPanel().apply {
            layout = SessionLayout(gap, pad)
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

    fun `test user prompt after first component uses prompt gap`() {
        val p = panel(gap = 4, width = 300)
        val c1 = label(height = 20)
        val c2 = view(height = 30, kind = SessionView.Kind.UserPrompt)
        p.add(c1)
        p.add(c2)
        p.doLayout()

        assertEquals(20 + JBUI.scale(SessionUiStyle.SessionLayout.USER_PROMPT_GAP), c2.y)
    }

    fun `test first user prompt uses standard gap`() {
        val p = panel(gap = 4, width = 300)
        val c1 = view(height = 20, kind = SessionView.Kind.UserPrompt)
        val c2 = label(height = 30)
        p.add(c1)
        p.add(c2)
        p.doLayout()

        assertEquals(0, c1.y)
        assertEquals(20 + 4, c2.y)
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

    fun `test layout padding offsets children and reduces available width`() {
        val p = panel(
            width = 500,
            pad = Insets(6, 12, 8, 16),
        )
        val child = label(height = 20)
        p.add(child)
        p.doLayout()

        assertEquals(JBUI.scale(12), child.x)
        assertEquals(JBUI.scale(6), child.y)
        assertEquals(500 - JBUI.scale(12) - JBUI.scale(16), child.width)
        assertEquals(20, child.height)
    }

    fun `test layout padding applies around stacked children`() {
        val p = panel(
            gap = 8,
            width = 300,
            pad = Insets(5, 10, 7, 11),
        )
        val c1 = label(height = 20)
        val c2 = label(height = 30)
        p.add(c1)
        p.add(c2)
        p.doLayout()

        assertEquals(JBUI.scale(10), c1.x)
        assertEquals(JBUI.scale(5), c1.y)
        assertEquals(JBUI.scale(10), c2.x)
        assertEquals(JBUI.scale(5) + 20 + JBUI.scale(8), c2.y)
        assertEquals(300 - JBUI.scale(10) - JBUI.scale(11), c1.width)
        assertEquals(300 - JBUI.scale(10) - JBUI.scale(11), c2.width)
    }

    fun `test user prompt is inset from left when enough width remains`() {
        val p = panel(width = 300)
        val child = view(height = 20, kind = SessionView.Kind.UserPrompt)
        p.add(child)
        p.doLayout()

        assertEquals(100, child.x)
        assertEquals(200, child.width)
        assertEquals(20, child.height)
    }

    fun `test user prompt is not inset when it would be too narrow`() {
        val p = panel(width = 199)
        val child = view(height = 20, kind = SessionView.Kind.UserPrompt)
        p.add(child)
        p.doLayout()

        assertEquals(0, child.x)
        assertEquals(199, child.width)
        assertEquals(20, child.height)
    }

    fun `test user prompt inset composes with layout padding`() {
        val p = panel(width = 350, pad = Insets(0, 12, 0, 18))
        val child = view(height = 20, kind = SessionView.Kind.UserPrompt)
        p.add(child)
        p.doLayout()

        assertEquals(JBUI.scale(12) + JBUI.scale(100), child.x)
        assertEquals(350 - JBUI.scale(12) - JBUI.scale(18) - JBUI.scale(100), child.width)
        assertEquals(20, child.height)
    }

    fun `test default session view is not inset`() {
        val p = panel(width = 300)
        val child = view(height = 20, kind = SessionView.Kind.Default)
        p.add(child)
        p.doLayout()

        assertEquals(0, child.x)
        assertEquals(300, child.width)
        assertEquals(20, child.height)
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

    fun `test only invisible children produce padding height`() {
        val p = panel(gap = 8, width = 300, pad = Insets(5, 0, 7, 0))
        val c = label(height = 20).also { it.isVisible = false }
        p.add(c)
        p.doLayout()

        val size = p.layout.preferredLayoutSize(p)
        assertEquals(JBUI.scale(5) + JBUI.scale(7), size.height)
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

    fun `test preferredLayoutSize uses prompt gap before non-first user prompt`() {
        val p = panel(gap = 4, width = 300)
        p.add(label(height = 10))
        p.add(view(height = 15, kind = SessionView.Kind.UserPrompt))
        p.doLayout()

        val size = p.layout.preferredLayoutSize(p)
        assertEquals(10 + JBUI.scale(SessionUiStyle.SessionLayout.USER_PROMPT_GAP) + 15, size.height)
    }

    fun `test preferredLayoutSize with no children is zero`() {
        val p = panel(width = 300)
        val size = p.layout.preferredLayoutSize(p)
        assertEquals(0, size.height)
    }

    fun `test preferredLayoutSize includes layout padding`() {
        val p = panel(gap = 4, width = 300, pad = Insets(5, 10, 7, 11))
        p.add(label(height = 10))
        p.add(label(height = 15))
        p.doLayout()

        val size = p.layout.preferredLayoutSize(p)
        assertEquals(300, size.width)
        assertEquals(JBUI.scale(5) + 10 + JBUI.scale(4) + 15 + JBUI.scale(7), size.height)
    }

    fun `test preferredLayoutSize is not double-scaled by user scale factor`() {
        // IDE zoom raises the JBUI user scale factor. Child heights and gaps are already
        // scaled px, so the transcript preferred height must not be scaled a second time.
        val original = JBUIScale.scale(1f)
        try {
            JBUIScale.setUserScaleFactorForTest(2f)
            val p = panel(gap = 4, width = 300)
            p.add(label(height = 10))
            p.add(label(height = 15))
            p.add(label(height = 20))
            p.doLayout()

            val size = p.layout.preferredLayoutSize(p)
            assertEquals(10 + JBUI.scale(4) + 15 + JBUI.scale(4) + 20, size.height)
        } finally {
            JBUIScale.setUserScaleFactorForTest(original)
        }
    }

    fun `test layout scales base gap at layout time`() {
        val p = panel(gap = 8, width = 300)
        val c1 = label(height = 20)
        val c2 = label(height = 30)
        p.add(c1)
        p.add(c2)
        p.doLayout()

        assertEquals(20 + JBUI.scale(8), c2.y)
    }

    fun `test valid child reuses cached preferred height`() {
        val p = panel(width = 300)
        val child = probe(height = 20)
        p.add(child)
        p.doLayout()
        child.markValid()
        val count = child.count

        p.doLayout()

        assertEquals(count, child.count)
        assertEquals(20, child.height)
    }

    fun `test invalid child is measured again`() {
        val p = panel(width = 300)
        val child = probe(height = 20)
        p.add(child)
        p.doLayout()
        child.markValid()
        val count = child.count

        child.invalidate()
        p.doLayout()

        assertEquals(count + 1, child.count)
    }

    fun `test width change forces cached child remeasure`() {
        val p = panel(width = 300)
        val child = probe(height = 20)
        p.add(child)
        p.doLayout()
        child.markValid()
        val count = child.count

        p.setSize(320, 2000)
        p.doLayout()

        assertEquals(count + 1, child.count)
        assertEquals(320, child.width)
    }

    fun `test forget re-measures a valid child`() {
        val p = panel(width = 300)
        val child = probe(height = 20)
        p.add(child)
        p.doLayout()
        child.markValid()
        val count = child.count

        // A settled turn is its own validate root, so it can be re-validated independently and its
        // isValid flag flips back to true even after its content (and height) changed. forget()
        // drops the stale cached height so the next layout pass re-measures the child.
        (p.layout as SessionLayout).forget(child)
        p.doLayout()

        assertEquals(count + 1, child.count)
    }

    // ---- helpers ------

    /** A fixed-height JLabel. The width is reported as 0 until layout sets it. */
    private fun label(height: Int) = object : JLabel("test") {
        override fun getPreferredSize(): Dimension = Dimension(0, height)
    }

    private fun view(height: Int, kind: SessionView.Kind) = object : JLabel("test"), SessionView {
        override val sessionViewKind = kind

        override fun getPreferredSize(): Dimension = Dimension(0, height)
    }

    private fun probe(height: Int) = object : JPanel() {
        var count = 0
        private var valid = false

        override fun isValid() = valid

        override fun invalidate() {
            valid = false
            super.invalidate()
        }

        fun markValid() {
            valid = true
        }

        override fun getPreferredSize(): Dimension {
            count++
            return Dimension(0, height)
        }
    }
}
