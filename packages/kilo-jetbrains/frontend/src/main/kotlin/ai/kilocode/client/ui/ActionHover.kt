package ai.kilocode.client.ui

import com.intellij.util.ui.JBUI
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.geom.Path2D

/**
 * Paints the standard rounded action-hover pill. Shared by [HoverArea], the compact changes summary,
 * and the hit-tested cells of list/tree rows, so every clickable element lights up the same way.
 *
 * [roundLeft] is false for a control that is flush against the row content on its left, such as the
 * trailing menu column: its fill keeps square left corners and rounds only the outer right edge.
 */
internal fun paintActionHover(g: Graphics, width: Int, height: Int, roundLeft: Boolean = true) {
    if (width <= 0 || height <= 0) return
    val canvas = g.create() as Graphics2D
    try {
        canvas.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
        canvas.color = UiStyle.Colors.actionHoverBackground()
        val arc = JBUI.scale(JBUI.getInt("Button.arc", 6)).coerceAtMost(minOf(width, height))
        if (roundLeft) {
            canvas.fillRoundRect(0, 0, width, height, arc, arc)
        } else {
            val radius = arc.toFloat()
            val path = Path2D.Float()
            path.moveTo(0f, 0f)
            path.lineTo(width - radius, 0f)
            path.quadTo(width.toFloat(), 0f, width.toFloat(), radius)
            path.lineTo(width.toFloat(), height - radius)
            path.quadTo(width.toFloat(), height.toFloat(), width - radius, height.toFloat())
            path.lineTo(0f, height.toFloat())
            path.closePath()
            canvas.fill(path)
        }
    } finally {
        canvas.dispose()
    }
}
