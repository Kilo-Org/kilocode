package ai.kilocode.client.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import java.awt.Color
import java.awt.Dimension
import java.awt.Font
import java.awt.Graphics
import java.awt.image.BufferedImage
import java.text.AttributedCharacterIterator
import javax.swing.JPanel
import javax.swing.plaf.basic.BasicHTML

class PlainLabelTest : BasePlatformTestCase() {
    fun `test html looking text stays literal and never builds an html view`() {
        val label = PlainLabel("<html><b>bold</b></html>")

        assertEquals("<html><b>bold</b></html>", label.text)
        assertNull(label.getClientProperty(BasicHTML.propertyKey))

        label.text = "<html><u>link</u></html>"

        assertNull(label.getClientProperty(BasicHTML.propertyKey))
    }

    fun `test moving between containers never builds an html view`() {
        // A regular HTML label is the control: it owns an HTML view that Swing rebuilds on every re-attach.
        val html = JBLabel("<html>text</html>")
        val label = PlainLabel("<html>text</html>")
        val first = JPanel()
        val second = JPanel()
        assertNotNull(html.getClientProperty(BasicHTML.propertyKey))

        first.add(label)
        first.remove(label)
        second.add(label)

        assertNull(label.getClientProperty(BasicHTML.propertyKey))
    }

    fun `test underline paints a line without changing the assigned font or size`() {
        val label = PlainLabel("Underlined")
        val font = label.font
        val size = label.preferredSize
        val plain = render(label)

        label.underline = true

        assertSame(font, label.font)
        assertEquals(size, label.preferredSize)
        assertFalse("underline should change the painted pixels", plain.contentEquals(render(label)))
    }

    fun `test strike paints differently from underline and plain text`() {
        val label = PlainLabel("Struck")
        val plain = render(label)
        label.underline = true
        val under = render(label)

        label.underline = false
        label.strike = true
        val strike = render(label)

        assertFalse(plain.contentEquals(strike))
        assertFalse(under.contentEquals(strike))
    }

    fun `test decoration follows a later font change`() {
        val label = PlainLabel("Resized").apply { underline = true }
        render(label)

        label.font = label.font.deriveFont(label.font.size2D * 2)
        val big = render(label)
        label.underline = false

        assertFalse("underline should be applied to the new font", big.contentEquals(render(label)))
    }

    fun `test decoration follows a font that resolves a new size in place`() {
        // Mirrors JBFont: one Font instance whose size/style resolve dynamically off the current IDE zoom
        // (JBFont.refreshScaledFont mutates its own protected size/pointSize fields rather than becoming a new
        // instance). A decoration cache keyed on Font identity alone would keep painting the pre-zoom size
        // forever, so this inspects the actual font handed to the paint Graphics rather than pixel output —
        // Swing's own font-metrics caching makes preferred-size/pixel assertions too environment-dependent here.
        val dynamic = DynamicSizeFont(12f)
        val label = ProbePlainLabel("Zoomed").apply {
            font = dynamic
            underline = true
            size = Dimension(200, 60)
        }
        paint(label)
        assertEquals(12, label.paintedFontSizes.last())

        dynamic.resolved = 40f
        paint(label)

        assertEquals("painting should use the font's current resolved size, not the size it first decorated at", 40, label.paintedFontSizes.last())
    }

    fun `test one line collapses blank lines and trims each line`() {
        assertEquals("first second third", oneLine("  first\n\n second \r\nthird  "))
        assertEquals("", oneLine(" \n \n"))
    }

    private fun render(label: PlainLabel): IntArray {
        label.foreground = Color.BLACK
        label.size = label.preferredSize
        val image = BufferedImage(label.width, label.height, BufferedImage.TYPE_INT_ARGB)
        val g = image.createGraphics()
        try {
            label.paint(g)
        } finally {
            g.dispose()
        }
        return image.getRGB(0, 0, image.width, image.height, null, 0, image.width)
    }

    /** Paints [label] onto a throwaway image at its already-assigned size, ignoring the resulting pixels. */
    private fun paint(label: PlainLabel) {
        val image = BufferedImage(label.width, label.height, BufferedImage.TYPE_INT_ARGB)
        val g = image.createGraphics()
        try {
            label.paint(g)
        } finally {
            g.dispose()
        }
    }

    /** Records the size of the font PlainLabel hands the paint [Graphics], without changing production code. */
    private class ProbePlainLabel(text: String) : PlainLabel(text) {
        val paintedFontSizes = mutableListOf<Int>()

        override fun getComponentGraphics(g: Graphics): Graphics {
            val out = super.getComponentGraphics(g)
            paintedFontSizes += out.font.size
            return out
        }
    }

    /**
     * A single [Font] instance that resolves a new size in place, the same shape as `JBFont.refreshScaledFont`:
     * same object identity, but [resolved] pushes the change straight into the protected `size`/`pointSize`
     * fields `Font.equals`/`hashCode`/`getFontMetrics` read, not just through an overridden getter. A getter-only
     * override would leave the JDK's own font-metrics cache keyed on the pre-resize `equals`/`hashCode`, which
     * would mask the bug this test exists to catch.
     */
    private class DynamicSizeFont(resolved: Float) : Font("Dialog", PLAIN, resolved.toInt()) {
        var resolved: Float = resolved
            set(value) {
                field = value
                size = value.toInt()
                pointSize = value
            }

        override fun deriveFont(attributes: MutableMap<out AttributedCharacterIterator.Attribute, *>): Font =
            super.deriveFont(attributes).deriveFont(resolved)
    }
}
