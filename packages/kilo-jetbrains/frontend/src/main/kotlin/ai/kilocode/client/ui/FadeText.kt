package ai.kilocode.client.ui

import com.intellij.ui.ColorUtil
import com.intellij.ui.SimpleColoredComponent
import java.awt.Color
import java.awt.GradientPaint
import java.awt.Graphics
import java.awt.Graphics2D

/**
 * A [SimpleColoredComponent] whose text dissolves into [backdrop] where it runs out of room, instead of
 * ending in an ellipsis.
 *
 * [SimpleColoredComponent] cuts text at the component edge, mid-glyph, which on its own reads as the name
 * of the thing rather than a truncation of it. The fade is what turns that cut into a truncation: the last
 * glyph or two ramp into the color behind them, so the line trails off instead of hitting a wall. This is
 * how the platform truncates an editor tab title — see `TabLabel.paintFadeout`, which paints the same
 * transparent-to-background gradient over the trailing edge of its own [SimpleColoredComponent] label.
 *
 * [backdrop] is what the row actually painted behind this component, and the caller has to supply it: the
 * gradient blends toward that color, so it only disappears on a flat surface of exactly that color. A null
 * backdrop paints nothing and leaves the bare cut, which is also the opt-out.
 */
internal class FadeText : SimpleColoredComponent() {
    /** The flat color painted behind this component, or null to leave a clipped line bare. */
    var backdrop: Color? = null

    override fun paintComponent(g: Graphics) {
        super.paintComponent(g)
        val color = backdrop ?: return
        // Nothing was cut, so a band of background over the last glyphs would only eat text that fits.
        if (width >= preferredSize.width) return
        // A zero-width band would ask GradientPaint for a gradient between one point and itself.
        val band = UiStyle.Fade.width().coerceAtMost(width)
        if (band <= 0) return
        val g2 = g.create() as Graphics2D
        try {
            g2.paint = GradientPaint(
                (width - band).toFloat(),
                0f,
                ColorUtil.toAlpha(color, 0),
                width.toFloat(),
                0f,
                color,
            )
            g2.fillRect(width - band, 0, band, height)
        } finally {
            g2.dispose()
        }
    }
}
