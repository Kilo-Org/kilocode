package ai.kilocode.client.session

import ai.kilocode.client.ui.UiStyle
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.geom.Ellipse2D
import javax.swing.Icon

internal class ActivityIcon private constructor(
    private val kind: SessionActivityKind,
) : Icon {
    override fun getIconWidth() = JBUI.scale(16)

    override fun getIconHeight() = JBUI.scale(16)

    override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.translate(x, y)
            g2.color = kind.style().bg()
            val inset = JBUI.scale(1).toFloat()
            val size = iconWidth - inset * 2
            g2.fill(Ellipse2D.Float(inset, inset, size, size))
            g2.color = kind.style().fg()
            when (kind) {
                SessionActivityKind.RUNNING -> paintDots(g2)
                SessionActivityKind.ERROR -> paintText(g2, "!")
                SessionActivityKind.LOGIN_REQUIRED,
                SessionActivityKind.PERMISSION,
                SessionActivityKind.PLAN,
                SessionActivityKind.QUESTION -> paintText(g2, "?")
            }
        } finally {
            g2.dispose()
        }
    }

    private fun paintDots(g2: Graphics2D) {
        val dot = JBUI.scale(2.4f)
        val y = iconHeight / 2f - dot / 2f
        for (x in listOf(4.8f, 8f, 11.2f).map { JBUI.scale(it) - dot / 2f }) {
            g2.fill(Ellipse2D.Float(x, y, dot, dot))
        }
    }

    private fun paintText(g2: Graphics2D, text: String) {
        g2.font = JBFont.small().asBold()
        val fm = g2.fontMetrics
        val width = fm.stringWidth(text)
        val base = (iconHeight + fm.ascent - fm.descent) / 2
        g2.drawString(text, (iconWidth - width) / 2, base)
    }

    companion object {
        private val icons = SessionActivityKind.entries.associateWith { ActivityIcon(it) }

        fun of(kind: SessionActivityKind): Icon = icons.getValue(kind)
    }
}
