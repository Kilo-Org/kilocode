package ai.kilocode.client.ui

import com.intellij.util.ui.JBUI
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JButton

class HoverIcon(private val fill: Boolean = false) : JButton() {
    private var over = false

    init {
        iconButton(this)
        addMouseListener(object : MouseAdapter() {
            override fun mouseEntered(e: MouseEvent) {
                sync(true)
            }

            override fun mouseExited(e: MouseEvent) {
                sync(false)
            }
        })
    }

    override fun getPreferredSize(): Dimension = JBUI.size(24, 24)

    override fun getMinimumSize(): Dimension = preferredSize

    override fun getMaximumSize(): Dimension = preferredSize

    override fun paintComponent(g: Graphics) {
        if (isEnabled && (over || fill)) paintHover(g)
        super.paintComponent(g)
    }

    private fun paintHover(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            val base = UiStyle.Colors.bg()
            val hover = UiStyle.Colors.actionHoverBackground()
            g2.color = when {
                over && fill -> UiStyle.Colors.blend(base, hover, hover.alpha / 255f)
                over -> hover
                else -> base
            }
            val arc = JBUI.scale(JBUI.getInt("Button.arc", 6))
            g2.fillRoundRect(0, 0, width, height, arc, arc)
            if (fill) {
                g2.color = UiStyle.Colors.contentBorder()
                g2.drawRoundRect(0, 0, width - 1, height - 1, arc, arc)
            }
        } finally {
            g2.dispose()
        }
    }

    private fun sync(value: Boolean) {
        if (over == value) return
        over = value
        repaint()
    }
}

fun iconButton(button: JButton) {
    button.isFocusable = false
    button.setRequestFocusEnabled(false)
    button.isContentAreaFilled = false
    button.isBorderPainted = false
    button.isOpaque = false
    button.border = JBUI.Borders.empty()
}
