package ai.kilocode.client.session

import com.intellij.util.ui.JBUI
import com.intellij.util.ui.NamedColorUtil
import java.awt.Component
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.geom.Ellipse2D
import javax.swing.Icon

/**
 * Idle-status glyph: a small muted dot centered in the same 16x16 bounds the running and
 * question icons use. Keeping the bounds identical stops the row title from shifting when a
 * session goes active or idle, while the deliberately smaller dot reads as quieter than the
 * larger running/question glyphs that fill the icon.
 */
internal object IdleIcon : Icon {
    override fun getIconWidth() = JBUI.scale(16)

    override fun getIconHeight() = JBUI.scale(16)

    override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.translate(x, y)
            g2.color = NamedColorUtil.getInactiveTextColor()
            val dot = JBUI.scale(6).toFloat()
            val origin = (iconWidth - dot) / 2f
            g2.fill(Ellipse2D.Float(origin, origin, dot, dot))
        } finally {
            g2.dispose()
        }
    }
}
