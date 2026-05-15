package ai.kilocode.client.session.ui.header

import java.awt.Component
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.geom.AffineTransform
import javax.swing.Icon

internal class RotatedIcon(private val base: Icon) : Icon {
    override fun getIconWidth(): Int = base.iconWidth

    override fun getIconHeight(): Int = base.iconHeight

    override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
        val g2 = g.create() as Graphics2D
        try {
            val tx = AffineTransform()
            tx.translate((x + iconWidth / 2.0), (y + iconHeight / 2.0))
            tx.rotate(Math.PI)
            tx.translate((-iconWidth / 2.0), (-iconHeight / 2.0))
            g2.transform(tx)
            base.paintIcon(c, g2, 0, 0)
        } finally {
            g2.dispose()
        }
    }
}
