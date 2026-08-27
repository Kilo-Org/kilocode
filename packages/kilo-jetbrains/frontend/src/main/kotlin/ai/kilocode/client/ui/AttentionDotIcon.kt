package ai.kilocode.client.ui

import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.geom.Ellipse2D
import javax.swing.Icon

internal object AttentionDotIcon : Icon {
    override fun getIconWidth() = JBUI.scale(8)

    override fun getIconHeight() = JBUI.scale(8)

    override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.translate(x, y)
            g2.color = UiStyle.Badge.ActivityAttention.bg()
            g2.fill(Ellipse2D.Float(0f, 0f, iconWidth.toFloat(), iconHeight.toFloat()))
        } finally {
            g2.dispose()
        }
    }
}
