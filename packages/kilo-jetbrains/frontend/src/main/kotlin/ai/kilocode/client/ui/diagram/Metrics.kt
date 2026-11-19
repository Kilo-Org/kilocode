package ai.kilocode.client.ui.diagram

import java.awt.Font
import java.awt.font.FontRenderContext
import java.util.concurrent.ConcurrentHashMap

/**
 * AWT text measurement. Holds no native Java2D state, so there is nothing to dispose.
 *
 * A single instance is shared by every [Engine.draw] call, and those run off the EDT on the default
 * dispatcher, so the font cache must tolerate concurrent access. [FontRenderContext] and [Font] are
 * both immutable for these queries.
 */
internal class AwtMeasure : Measure {
    private val ctx = FontRenderContext(null, true, true)
    private val cache = ConcurrentHashMap<FontSpec, Font>()

    override fun width(text: String, font: FontSpec) = font(font).getStringBounds(text, ctx).width
    override fun height(font: FontSpec) = font(font).getLineMetrics("Ag", ctx).height.toDouble()
    override fun ascent(font: FontSpec) = font(font).getLineMetrics("Ag", ctx).ascent.toDouble()

    private fun font(spec: FontSpec): Font = cache.computeIfAbsent(spec) {
        Font(it.family, if (it.bold) Font.BOLD else Font.PLAIN, it.size)
    }
}
