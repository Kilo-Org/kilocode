package ai.kilocode.client.ui

import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Font
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.font.FontRenderContext
import javax.swing.Icon

internal class FilledBadgeIcon(
    internal val text: String,
    internal val style: UiStyle.Badge.Style,
    private val font: Font = JBFont.small(),
) : Icon {
    override fun getIconWidth(): Int {
        val width = font.getStringBounds(text, FontRenderContext(null, true, true)).width.toInt()
        return width + UiStyle.Gap.lg() * 2
    }

    override fun getIconHeight() = JBUI.scale(16)

    override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.translate(x, y)
            g2.color = style.bg()
            g2.fillRoundRect(0, 0, iconWidth, iconHeight, iconHeight, iconHeight)
            g2.color = style.fg()
            g2.font = font
            val fm = g2.fontMetrics
            val base = (iconHeight + fm.ascent - fm.descent) / 2
            g2.drawString(text, UiStyle.Gap.lg(), base)
        } finally {
            g2.dispose()
        }
    }
}
