package ai.kilocode.client.ui.diagram

import java.awt.Font
import java.awt.font.FontRenderContext

internal class AwtMeasure : Measure {
    private val ctx = FontRenderContext(null, true, true)
    private val cache = linkedMapOf<FontSpec, Font>()

    override fun width(text: String, font: FontSpec) = font(font).getStringBounds(text, ctx).width
    override fun height(font: FontSpec) = font(font).getLineMetrics("Ag", ctx).height.toDouble()
    override fun ascent(font: FontSpec) = font(font).getLineMetrics("Ag", ctx).ascent.toDouble()

    private fun font(font: FontSpec): Font {
        cache[font]?.let { return it }
        val style = if (font.bold) Font.BOLD else Font.PLAIN
        val value = Font(font.family, style, font.size)
        cache[font] = value
        return value
    }
}
