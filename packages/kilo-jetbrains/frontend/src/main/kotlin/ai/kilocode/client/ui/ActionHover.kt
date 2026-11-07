package ai.kilocode.client.ui

import com.intellij.util.ui.JBUI
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints

/**
 * Paints the standard rounded action-hover pill. Shared by [HoverArea], the compact changes summary,
 * and the hit-tested cells of list/tree rows, so every clickable element lights up the same way.
 */
internal fun paintActionHover(g: Graphics, width: Int, height: Int) {
    if (width <= 0 || height <= 0) return
    val canvas = g.create() as Graphics2D
    try {
        canvas.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
        canvas.color = UiStyle.Colors.actionHoverBackground()
        val arc = JBUI.scale(JBUI.getInt("Button.arc", 6)).coerceAtMost(minOf(width, height))
        canvas.fillRoundRect(0, 0, width, height, arc, arc)
    } finally {
        canvas.dispose()
    }
}
