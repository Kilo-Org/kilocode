package ai.kilocode.client.ui

import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Font
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.font.FontRenderContext
import java.awt.geom.Area
import java.awt.geom.Rectangle2D
import java.awt.geom.RoundRectangle2D
import javax.swing.Icon
import kotlin.math.ceil

/**
 * One or more joined filled pills drawn as an icon so they can sit inside a label or a list-cell renderer.
 *
 * Owners keep an instance for as long as its text and style hold, so it has to stay correct across an
 * IDE zoom. The geometry is measured per call, and [JBFont] re-derives its size from "Label.font" on
 * read, so the pill and its text grow together.
 */
internal class FilledBadgeIcon(
    internal val segments: List<Segment>,
    private val font: Font = JBFont.small(),
) : Icon {

    internal data class Segment(
        val text: String,
        val style: UiStyle.Badge.Style,
    )

    constructor(
        text: String,
        style: UiStyle.Badge.Style,
        font: Font = JBFont.small(),
    ) : this(listOf(Segment(text, style)), font)

    internal val text get() = segments.joinToString("|") { it.text }
    internal val style get() = segments.first().style

    init {
        require(segments.isNotEmpty())
    }

    override fun getIconWidth() = widths().sum()

    override fun getIconHeight() = JBUI.scale(16)

    override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.translate(x, y)
            g2.font = font
            val fm = g2.fontMetrics
            val base = (iconHeight + fm.ascent - fm.descent) / 2
            val widths = widths()
            val pill = Area(
                RoundRectangle2D.Double(
                    0.0,
                    0.0,
                    iconWidth.toDouble(),
                    iconHeight.toDouble(),
                    iconHeight.toDouble(),
                    iconHeight.toDouble(),
                ),
            )
            var left = 0
            segments.zip(widths).forEach { pair ->
                val segment = pair.first
                val width = pair.second
                val shape = Area(pill)
                shape.intersect(
                    Area(Rectangle2D.Double(left.toDouble(), 0.0, width.toDouble(), iconHeight.toDouble())),
                )
                g2.color = segment.style.bg()
                g2.fill(shape)
                g2.color = segment.style.fg()
                g2.drawString(segment.text, left + UiStyle.Gap.lg(), base)
                left += width
            }
        } finally {
            g2.dispose()
        }
    }

    private fun widths(): List<Int> = segments.map { segment ->
        ceil(font.getStringBounds(segment.text, FontRenderContext(null, true, true)).width).toInt() +
            UiStyle.Gap.lg() * 2
    }
}
