package ai.kilocode.client.ui.active

import ai.kilocode.client.ui.UiStyle
import com.intellij.util.ui.JBUI
import java.awt.BasicStroke
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Rectangle
import java.awt.RenderingHints

internal fun activePlaceholder(g: Graphics, bounds: Rectangle) {
    val copy = g.create() as Graphics2D
    try {
        copy.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
        val inset = UiStyle.Gap.xs()
        val dash = UiStyle.Gap.sm().toFloat()
        copy.color = JBUI.CurrentTheme.List.Selection.background(true)
        copy.stroke = BasicStroke(JBUI.scale(1).toFloat(), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND,
            0f, floatArrayOf(dash, dash), 0f)
        val arc = UiStyle.Arc.component()
        copy.drawRoundRect(bounds.x + inset, bounds.y + inset,
            (bounds.width - inset * 2 - 1).coerceAtLeast(0),
            (bounds.height - inset * 2 - 1).coerceAtLeast(0), arc, arc)
    } finally {
        copy.dispose()
    }
}
