package ai.kilocode.client.ui.layout

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.Dimension

@Suppress("UnstableApiUsage")
class AlignTest : BasePlatformTestCase() {

    // ------ structure ------

    fun `test wrapper is non-opaque`() {
        assertFalse(Align(JBLabel("x"), HAlign.FIT, VAlign.FIT).isOpaque)
    }

    fun `test wrapper contains exactly the wrapped child`() {
        val child = JBLabel("x")
        val wrap = Align(child, HAlign.FIT, VAlign.FIT)
        assertEquals(1, wrap.componentCount)
        assertSame(child, wrap.getComponent(0))
    }

    // ------ FIT / FIT basic fill ------

    fun `test FIT FIT fills assigned inner bounds`() {
        val child = child(pref = 40 x 20)
        val wrap = Align(child, HAlign.FIT, VAlign.FIT)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(0, 0, 200, 100, child)
    }

    fun `test FIT FIT respects insets`() {
        val child = child(pref = 40 x 20)
        val wrap = Align(child, HAlign.FIT, VAlign.FIT)
        wrap.border = JBUI.Borders.empty(5, 10, 5, 10)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(10, 5, 180, 90, child)
    }

    // ------ FIT respects max ------

    fun `test FIT FIT caps at maximum size`() {
        val child = child(pref = 40 x 20, max = 60 x 30)
        val wrap = Align(child, HAlign.FIT, VAlign.FIT)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        // available > max → capped at max, placed at top-left
        assertBounds(0, 0, 60, 30, child)
    }

    fun `test FIT FIT expands to minimum when available between min and pref`() {
        val child = child(min = 30 x 15, pref = 80 x 40, max = 200 x 100)
        val wrap = Align(child, HAlign.FIT, VAlign.FIT)
        wrap.setBounds(0, 0, 50, 25)
        wrap.doLayout()
        // available (50x25) is within [min, max], so child gets exactly available
        assertBounds(0, 0, 50, 25, child)
    }

    fun `test FIT FIT shrinks to available when available below minimum`() {
        val child = child(min = 80 x 40, pref = 80 x 40)
        val wrap = Align(child, HAlign.FIT, VAlign.FIT)
        wrap.setBounds(0, 0, 30, 10)
        wrap.doLayout()
        // cannot respect min when space is smaller
        assertBounds(0, 0, 30, 10, child)
    }

    // ------ CENTER / CENTER ------

    fun `test CENTER CENTER centers at preferred size when space sufficient`() {
        val child = child(pref = 40 x 20)
        val wrap = Align(child, HAlign.CENTER, VAlign.CENTER)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(80, 40, 40, 20, child)
    }

    fun `test CENTER CENTER coerces preferred up to minimum`() {
        val child = child(min = 60 x 30, pref = 40 x 20)
        val wrap = Align(child, HAlign.CENTER, VAlign.CENTER)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        // preferred < min → use min (60x30), centered
        assertBounds(70, 35, 60, 30, child)
    }

    fun `test CENTER CENTER caps preferred at maximum`() {
        val child = child(pref = 100 x 60, max = 40 x 20)
        val wrap = Align(child, HAlign.CENTER, VAlign.CENTER)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        // preferred > max → use max (40x20), centered
        assertBounds(80, 40, 40, 20, child)
    }

    fun `test CENTER CENTER fits when bounded preferred exceeds available`() {
        val child = child(pref = 300 x 200)
        val wrap = Align(child, HAlign.CENTER, VAlign.CENTER)
        wrap.setBounds(0, 0, 100, 80)
        wrap.doLayout()
        assertBounds(0, 0, 100, 80, child)
    }

    fun `test CENTER CENTER shrinks to available when available below minimum`() {
        val child = child(min = 150 x 90, pref = 150 x 90)
        val wrap = Align(child, HAlign.CENTER, VAlign.CENTER)
        wrap.setBounds(0, 0, 100, 60)
        wrap.doLayout()
        assertBounds(0, 0, 100, 60, child)
    }

    // ------ LEFT / TOP ------

    fun `test LEFT TOP positions at top-left with bounded preferred`() {
        val child = child(pref = 40 x 20)
        val wrap = Align(child, HAlign.LEFT, VAlign.TOP)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(0, 0, 40, 20, child)
    }

    fun `test LEFT TOP respects max`() {
        val child = child(pref = 100 x 60, max = 40 x 20)
        val wrap = Align(child, HAlign.LEFT, VAlign.TOP)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(0, 0, 40, 20, child)
    }

    fun `test LEFT TOP shrinks to available`() {
        val child = child(pref = 300 x 200)
        val wrap = Align(child, HAlign.LEFT, VAlign.TOP)
        wrap.setBounds(0, 0, 100, 80)
        wrap.doLayout()
        assertBounds(0, 0, 100, 80, child)
    }

    // ------ RIGHT / BOTTOM ------

    fun `test RIGHT BOTTOM positions at bottom-right with bounded preferred`() {
        val child = child(pref = 40 x 20)
        val wrap = Align(child, HAlign.RIGHT, VAlign.BOTTOM)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(160, 80, 40, 20, child)
    }

    fun `test RIGHT BOTTOM respects max`() {
        val child = child(pref = 100 x 60, max = 40 x 20)
        val wrap = Align(child, HAlign.RIGHT, VAlign.BOTTOM)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(160, 80, 40, 20, child)
    }

    fun `test RIGHT BOTTOM shrinks to available`() {
        val child = child(pref = 300 x 200)
        val wrap = Align(child, HAlign.RIGHT, VAlign.BOTTOM)
        wrap.setBounds(0, 0, 100, 80)
        wrap.doLayout()
        assertBounds(0, 0, 100, 80, child)
    }

    // ------ insets with edge modes ------

    fun `test CENTER CENTER insets honored`() {
        val child = child(pref = 40 x 20)
        val wrap = Align(child, HAlign.CENTER, VAlign.CENTER)
        wrap.border = JBUI.Borders.empty(10, 20, 10, 20)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        val ins = wrap.insets  // 10,20,10,20
        // inner: 160x80; child 40x20
        assertBounds(ins.left + 60, ins.top + 30, 40, 20, child)
    }

    fun `test RIGHT BOTTOM insets honored`() {
        val child = child(pref = 40 x 20)
        val wrap = Align(child, HAlign.RIGHT, VAlign.BOTTOM)
        wrap.border = JBUI.Borders.empty(5, 5, 5, 5)
        wrap.setBounds(0, 0, 100, 80)
        wrap.doLayout()
        val ins = wrap.insets
        // inner: 90x70; child 40x20
        assertBounds(ins.left + 50, ins.top + 50, 40, 20, child)
    }

    // ------ wrapper preferred/min/max sizes (non-TRACK) ------

    fun `test preferredSize equals bounded child pref plus insets`() {
        val child = child(min = 30 x 15, pref = 80 x 40, max = 60 x 30)
        val wrap = Align(child, HAlign.CENTER, VAlign.CENTER)
        wrap.border = JBUI.Borders.empty(4, 6, 4, 6)
        val ins = wrap.insets
        // pref(80) coerced into [30,60] = 60; pref(40) coerced into [15,30] = 30
        val ps = wrap.preferredSize
        assertEquals(60 + ins.left + ins.right, ps.width)
        assertEquals(30 + ins.top + ins.bottom, ps.height)
    }

    fun `test minimumSize equals child min plus insets`() {
        val child = child(min = 30 x 15, pref = 80 x 40)
        val wrap = Align(child, HAlign.LEFT, VAlign.TOP)
        wrap.border = JBUI.Borders.empty(4, 6, 4, 6)
        val ins = wrap.insets
        val ms = wrap.minimumSize
        assertEquals(30 + ins.left + ins.right, ms.width)
        assertEquals(15 + ins.top + ins.bottom, ms.height)
    }

    fun `test maximumSize equals effective child max plus insets`() {
        val child = child(min = 30 x 15, pref = 80 x 40, max = 60 x 30)
        val wrap = Align(child, HAlign.LEFT, VAlign.TOP)
        wrap.border = JBUI.Borders.empty(4, 6, 4, 6)
        val ins = wrap.insets
        val xs = wrap.maximumSize
        assertEquals(60 + ins.left + ins.right, xs.width)
        assertEquals(30 + ins.top + ins.bottom, xs.height)
    }

    fun `test maximumSize uses min when max is smaller than min`() {
        // max < min → effective max should be at least min
        val child = child(min = 50 x 30, pref = 50 x 30, max = 10 x 5)
        val wrap = Align(child, HAlign.LEFT, VAlign.TOP)
        val ins = wrap.insets
        val xs = wrap.maximumSize
        assertEquals(50 + ins.left + ins.right, xs.width)
        assertEquals(30 + ins.top + ins.bottom, xs.height)
    }

    // ------ CenterShrinkPanel parity ------

    fun `test CENTER CENTER matches old CenterShrinkPanel center-and-shrink behavior`() {
        // child pref is larger than max → should center at max size, not overflow
        val child = child(pref = 100 x 60, max = 40 x 20)
        val wrap = Align(child, HAlign.CENTER, VAlign.CENTER)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        // expected: max(40x20), centered → x=(200-40)/2=80, y=(100-20)/2=40
        assertBounds(80, 40, 40, 20, child)
    }

    // ------ TRACK / TRACK ------

    fun `test TRACK TRACK fills all available regardless of child constraints`() {
        val child = child(min = 10 x 5, pref = 40 x 20, max = 60 x 30)
        val wrap = Align(child, HAlign.TRACK, VAlign.TRACK)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(0, 0, 200, 100, child)
    }

    fun `test TRACK TRACK preferred and min size are just insets`() {
        val child = child(min = 50 x 30, pref = 80 x 40, max = 100 x 60)
        val wrap = Align(child, HAlign.TRACK, VAlign.TRACK)
        wrap.border = JBUI.Borders.empty(4, 6, 4, 6)
        val ins = wrap.insets
        val ps = wrap.preferredSize
        val ms = wrap.minimumSize
        assertEquals(ins.left + ins.right, ps.width)
        assertEquals(ins.top + ins.bottom, ps.height)
        assertEquals(ins.left + ins.right, ms.width)
        assertEquals(ins.top + ins.bottom, ms.height)
    }

    fun `test TRACK TRACK max size is not capped by child max`() {
        val child = child(pref = 40 x 20, max = 60 x 30)
        val wrap = Align(child, HAlign.TRACK, VAlign.TRACK)
        val xs = wrap.maximumSize
        // wrapper max must be larger than child max since TRACK should allow any size
        assertTrue("wrapper maxW ${xs.width} should exceed child maxW 60", xs.width > 60)
        assertTrue("wrapper maxH ${xs.height} should exceed child maxH 30", xs.height > 30)
    }

    // ------ mixed TRACK + non-TRACK ------

    fun `test TRACK H FIT V fills width ignores child constraints on H only`() {
        val child = child(min = 30 x 15, pref = 40 x 20, max = 60 x 30)
        val wrap = Align(child, HAlign.TRACK, VAlign.FIT)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        // H=TRACK → width=200; V=FIT → height clamped to [15,30]=30
        assertBounds(0, 0, 200, 30, child)
    }

    fun `test TRACK H preferred is inset-only on H axis with child bounded pref on V axis`() {
        val child = child(min = 30 x 15, pref = 80 x 40, max = 60 x 30)
        val wrap = Align(child, HAlign.TRACK, VAlign.CENTER)
        val ins = wrap.insets
        val ps = wrap.preferredSize
        // H=TRACK → horizontal contribution = 0
        assertEquals(ins.left + ins.right, ps.width)
        // V=CENTER → bounded pref height = clamp(40,[15,30]) = 30
        assertEquals(30 + ins.top + ins.bottom, ps.height)
    }

    // ------ align() factory ------

    fun `test align extension returns Align wrapping child`() {
        val child = JBLabel("x")
        assertSame(child, child.align(HAlign.LEFT, VAlign.TOP).getComponent(0))
    }

    fun `test align CENTER CENTER produces centered layout`() {
        val child = child(pref = 40 x 20)
        val wrap = child.align(HAlign.CENTER, VAlign.CENTER)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(80, 40, 40, 20, child)
    }

    fun `test align RIGHT TOP positions at top-right`() {
        val child = child(pref = 40 x 20)
        val wrap = child.align(HAlign.RIGHT, VAlign.TOP)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(160, 0, 40, 20, child)
    }

    fun `test align LEFT FIT fills height`() {
        val child = child(pref = 40 x 20)
        val wrap = child.align(HAlign.LEFT, VAlign.FIT)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(0, 0, 40, 100, child)
    }

    fun `test align CENTER TOP centers horizontally and pins to top`() {
        val child = child(pref = 40 x 20)
        val wrap = child.align(HAlign.CENTER, VAlign.TOP)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(80, 0, 40, 20, child)
    }

    fun `test align FIT BOTTOM fills width and pins to bottom`() {
        val child = child(pref = 40 x 20)
        val wrap = child.align(HAlign.FIT, VAlign.BOTTOM)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(0, 80, 200, 20, child)
    }

    fun `test align TRACK TRACK fills all space and wrapper preferred is inset-only`() {
        val child = child(pref = 40 x 20, max = 60 x 30)
        val wrap = child.align(HAlign.TRACK, VAlign.TRACK)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(0, 0, 200, 100, child)
        val ins = wrap.insets
        assertEquals(ins.left + ins.right, wrap.preferredSize.width)
        assertEquals(ins.top + ins.bottom, wrap.preferredSize.height)
    }

    fun `test align TRACK TOP fills width only, V respects preferred`() {
        val child = child(pref = 40 x 20)
        val wrap = child.align(HAlign.TRACK, VAlign.TOP)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(0, 0, 200, 20, child)
    }

    fun `test align CENTER TRACK fills height only, H respects preferred`() {
        val child = child(pref = 40 x 20)
        val wrap = child.align(HAlign.CENTER, VAlign.TRACK)
        wrap.setBounds(0, 0, 200, 100)
        wrap.doLayout()
        assertBounds(80, 0, 40, 100, child)
    }

    // ------ helpers ------

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

    private fun assertBounds(x: Int, y: Int, w: Int, h: Int, c: java.awt.Component) {
        val b = c.bounds
        assertEquals("x", x, b.x)
        assertEquals("y", y, b.y)
        assertEquals("width", w, b.width)
        assertEquals("height", h, b.height)
    }
}
