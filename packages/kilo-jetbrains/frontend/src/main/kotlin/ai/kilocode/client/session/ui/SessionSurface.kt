package ai.kilocode.client.session.ui

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.Shape
import java.awt.geom.Path2D
import java.awt.geom.RoundRectangle2D

/**
 * Shared painting for raised, rounded session code surfaces. Every inner block (tool output, task
 * rows, todo list, code panes) uses the same block arc as the card header hover, so a single helper
 * keeps the fill and the rounded child clip identical everywhere.
 */
internal object SessionSurface {

    fun arc(): Int = JBUI.scale(SessionUiStyle.View.BLOCK_ARC)

    /** Fills the component bounds with [color], rounded to the block arc. */
    fun fill(g: Graphics, width: Int, height: Int, color: Color = SessionUiStyle.Colors.codeBlockBackground()) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.color = color
            val arc = arc()
            g2.fillRoundRect(0, 0, width, height, arc, arc)
        } finally {
            g2.dispose()
        }
    }

    /** Runs [paint] with the graphics clipped to the rounded block, keeping opaque content rounded. */
    inline fun <T> clipped(g: Graphics, width: Int, height: Int, paint: (Graphics) -> T): T {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.clip(outline(width, height))
            return paint(g2)
        } finally {
            g2.dispose()
        }
    }

    /**
     * The rounded block as straight segments. Surfaces nest with shared edges, and intersecting curved
     * clips that overlap makes Java2D's Area math block the EDT for hundreds of milliseconds per paint.
     * Clips are not antialiased, so the flattened outline looks the same.
     */
    fun outline(width: Int, height: Int): Shape {
        val arc = arc().toFloat()
        val round = RoundRectangle2D.Float(0f, 0f, width.toFloat(), height.toFloat(), arc, arc)
        return Path2D.Float().apply { append(round.getPathIterator(null, FLATNESS), false) }
    }

    private const val FLATNESS = 0.05
}
