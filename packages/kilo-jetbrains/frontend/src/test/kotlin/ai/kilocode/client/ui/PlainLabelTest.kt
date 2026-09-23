package ai.kilocode.client.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import java.awt.Color
import java.awt.image.BufferedImage
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
}
