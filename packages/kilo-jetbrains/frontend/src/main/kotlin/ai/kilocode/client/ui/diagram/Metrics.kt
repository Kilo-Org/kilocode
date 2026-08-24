package ai.kilocode.client.ui.diagram

import java.awt.Font
import java.awt.FontMetrics
import java.awt.image.BufferedImage

internal class AwtMeasure : Measure {
    private val img = BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB)
    private val g = img.createGraphics()
    private val cache = linkedMapOf<FontSpec, FontMetrics>()

    override fun width(text: String, font: FontSpec) = metrics(font).stringWidth(text).toDouble()
    override fun height(font: FontSpec) = metrics(font).height.toDouble()
    override fun ascent(font: FontSpec) = metrics(font).ascent.toDouble()

    private fun metrics(font: FontSpec): FontMetrics {
        cache[font]?.let { return it }
        val style = if (font.bold) Font.BOLD else Font.PLAIN
        val value = g.getFontMetrics(Font(font.family, style, font.size))
        cache[font] = value
        return value
    }
}
