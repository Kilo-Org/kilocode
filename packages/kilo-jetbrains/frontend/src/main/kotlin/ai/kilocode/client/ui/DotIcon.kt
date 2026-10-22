package ai.kilocode.client.ui

import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.geom.Ellipse2D
import javax.swing.Icon

/**
 * A filled circle in a badge style's own fill color, for a status that needs a mark rather than a glyph.
 *
 * [glyph] draws the same dot into a standard 16px icon box instead of a box its own size. That is what a dot
 * needs to sit in a column of SVG glyphs: an icon narrower than the ones above it pulls its label left and
 * leaves the column ragged.
 */
internal class DotIcon(private val style: UiStyle.Badge.Style, private val glyph: Boolean = false) : Icon {
    override fun getIconWidth() = JBUI.scale(if (glyph) GLYPH else DOT)

    override fun getIconHeight() = iconWidth

    override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.translate(x, y)
            g2.color = style.bg()
            val size = JBUI.scale(DOT).toFloat()
            val offset = (iconWidth - size) / 2
            g2.fill(Ellipse2D.Float(offset, offset, size, size))
        } finally {
            g2.dispose()
        }
    }

    private companion object {
        const val DOT = 8
        const val GLYPH = 16
    }
}

/** The tool window's unread mark, and the reason [DotIcon] exists. */
internal val AttentionDotIcon = DotIcon(UiStyle.Badge.ActivityAttention)

/** The mark a merge conflict gets wherever it is named in words rather than drawn behind a badge. */
internal val ConflictDotIcon = DotIcon(UiStyle.Badge.ActivityError, glyph = true)
