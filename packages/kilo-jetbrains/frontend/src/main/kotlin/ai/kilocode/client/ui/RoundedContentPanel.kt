package ai.kilocode.client.ui

import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Color
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints

open class RoundedContentPanel(
    top: Int,
    left: Int,
    bottom: Int = top,
    right: Int = left,
) : BorderLayoutPanel() {

    init {
        isOpaque = false
        background = contentColor()
        border = JBUI.Borders.empty(top, left, bottom, right)
    }

    override fun updateUI() {
        super.updateUI()
        isOpaque = false
        background = contentColor()
    }

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(
                RenderingHints.KEY_ANTIALIASING,
                RenderingHints.VALUE_ANTIALIAS_ON,
            )
            val arc = cornerArc()
            g2.color = contentColor()
            g2.fillRoundRect(0, 0, width, height, arc, arc)
            val line = outlineColor()
            if (line != null) {
                g2.color = line
                for (idx in 0 until outlineWidth()) {
                    val w = width - idx * 2 - 1
                    val h = height - idx * 2 - 1
                    if (w > 0 && h > 0) g2.drawRoundRect(idx, idx, w, h, arc, arc)
                }
            }
        } finally {
            g2.dispose()
        }
        super.paintComponent(g)
    }

    protected open fun contentColor(): Color = UiStyle.Colors.contentBackground()

    protected open fun outlineColor(): Color? = UiStyle.Colors.contentBorder()

    protected open fun outlineWidth(): Int = JBUI.scale(1)

    protected open fun cornerArc(): Int = UiStyle.Arc.component()
}
