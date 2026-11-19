package ai.kilocode.client.ui

import java.awt.Component
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Paint
import java.awt.Rectangle
import java.awt.RenderingHints
import java.awt.geom.Ellipse2D
import java.awt.geom.Path2D
import javax.swing.Icon

/**
 * [icon] wearing a small colored dot in the top-right corner — the live-run pairing
 * `ExecutionUtil.withLiveIndicator` and the Run tool window stripe show for a live process on New UI.
 *
 * Reimplemented instead of using `com.intellij.ui.BadgeIcon`/`BadgeDotProvider` because both (and
 * their `HoledIcon` base) are `@ApiStatus.Internal` on the platform version this plugin targets —
 * they were only promoted to stable in a later platform release.
 *
 * The platform's own default dot geometry is tuned for a 20px stripe icon (dot radius 3.5/20, border
 * 1.5/20) and pushes the badge past a 16px base's edge; the platform's `HoledIcon` sizes itself to
 * the union of glyph and badge, so a 16px base would report ~18px and widen a row's icon column for
 * running rows alone. [X]/[Y] pull the badge center in by the border width so it lands flush with the
 * top-right corner instead, and [getIconWidth]/[getIconHeight] report the base icon's own size rather
 * than a union, so the badge never grows the icon.
 */
internal class LiveBadgeIcon(val icon: Icon, val paint: Paint) : Icon {
    override fun getIconWidth(): Int = icon.iconWidth

    override fun getIconHeight(): Int = icon.iconHeight

    /**
     * The badge's clip-out area, including its border margin, in a [size]x[size] canvas. This is the
     * shape that has to stay inside the canvas for the badge to keep the base icon's own reported
     * size — see the class doc for why the fractions are pulled in from the platform's own geometry.
     */
    fun holeBounds(size: Int): Ellipse2D = circle(size, HOLE_RADIUS)

    override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
        val size = minOf(iconWidth, iconHeight)
        val hole = holeBounds(size)

        // The base glyph, clipped to exclude the badge (plus its border margin) entirely, so the
        // glyph's own pixels never touch the badge color.
        val base = g.create() as Graphics2D
        try {
            base.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            base.translate(x, y)
            val outside = Path2D.Double(Path2D.WIND_EVEN_ODD)
            outside.append(base.clip ?: Rectangle(0, 0, iconWidth, iconHeight), false)
            outside.append(hole, false)
            base.clip = outside
            icon.paintIcon(c, base, 0, 0)
        } finally {
            base.dispose()
        }

        // The badge dot itself, smaller than the hole so the border margin above shows through as a
        // transparent ring separating it from the glyph.
        val dot = g.create() as Graphics2D
        try {
            dot.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            dot.translate(x, y)
            dot.paint = paint
            dot.fill(circle(size, DOT_RADIUS))
        } finally {
            dot.dispose()
        }
    }

    private fun circle(size: Int, radius: Double): Ellipse2D {
        val r = size * radius
        return Ellipse2D.Double(size * X - r, size * Y - r, r * 2, r * 2)
    }

    private companion object {
        const val X = 0.75
        const val Y = 0.25
        const val DOT_RADIUS = 0.175
        const val HOLE_RADIUS = DOT_RADIUS + 0.075
    }
}
