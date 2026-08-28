package ai.kilocode.client.ui.diagram

import java.awt.BasicStroke
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.geom.Ellipse2D
import java.awt.geom.Line2D
import java.awt.geom.Path2D
import java.awt.geom.RoundRectangle2D
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

internal object ScenePainter : Painter {
    private const val THIN = 1.5f
    private const val THICK = 3.0f
    private const val DASH = 6.0f
    private const val HEAD = 10.0
    private const val DOT = 4.0
    private const val CROSS = 5.0

    override fun accepts(art: Art) = art is Scene

    override fun size(art: Art) = (art as Scene).size

    override fun paint(g: Graphics2D, art: Art, palette: Palette) {
        val old = g.renderingHints.clone() as RenderingHints
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON)
        try {
            for (mark in (art as Scene).marks) draw(g, mark, palette)
        } finally {
            g.setRenderingHints(old)
        }
    }

    private fun draw(g: Graphics2D, mark: Mark, palette: Palette) {
        when (mark) {
            is Mark.Box -> box(g, mark, palette)
            is Mark.Oval -> oval(g, mark, palette)
            is Mark.Poly -> poly(g, mark, palette)
            is Mark.Edge -> edge(g, mark, palette)
            is Mark.Text -> text(g, mark, palette)
            is Mark.Group -> mark.marks.forEach { draw(g, it, palette) }
        }
    }

    private fun box(g: Graphics2D, mark: Mark.Box, palette: Palette) {
        val rect = mark.rect
        val shape = RoundRectangle2D.Double(rect.x, rect.y, rect.w, rect.h, mark.arc, mark.arc)
        mark.fill?.let {
            g.color = palette.color(it)
            g.fill(shape)
        }
        mark.line?.let {
            g.color = palette.color(it)
            g.stroke = stroke(mark.dash)
            g.draw(shape)
        }
    }

    private fun oval(g: Graphics2D, mark: Mark.Oval, palette: Palette) {
        val rect = mark.rect
        val shape = Ellipse2D.Double(rect.x, rect.y, rect.w, rect.h)
        mark.fill?.let {
            g.color = palette.color(it)
            g.fill(shape)
        }
        mark.line?.let {
            g.color = palette.color(it)
            g.stroke = stroke()
            g.draw(shape)
        }
    }

    private fun poly(g: Graphics2D, mark: Mark.Poly, palette: Palette) {
        val shape = path(mark.points, true)
        mark.fill?.let {
            g.color = palette.color(it)
            g.fill(shape)
        }
        mark.line?.let {
            g.color = palette.color(it)
            g.stroke = stroke()
            g.draw(shape)
        }
    }

    private fun edge(g: Graphics2D, mark: Mark.Edge, palette: Palette) {
        if (mark.points.size < 2) return
        g.color = palette.color(mark.role)
        g.stroke = stroke(mark.dash, mark.thick)
        g.draw(path(mark.points, false))
        head(g, mark.points[mark.points.lastIndex - 1], mark.points.last(), mark.head)
        head(g, mark.points[1], mark.points.first(), mark.tail)
    }

    private fun text(g: Graphics2D, mark: Mark.Text, palette: Palette) {
        g.font = if (mark.bold) palette.bold else palette.font
        g.color = palette.color(mark.role)
        val fm = g.fontMetrics
        val width = fm.stringWidth(mark.text).toDouble()
        val height = fm.height.toDouble()
        val x = when (mark.anchor) {
            Anchor.TopLeft, Anchor.Left, Anchor.BottomLeft -> mark.at.x
            Anchor.Top, Anchor.Center, Anchor.Bottom -> mark.at.x - width / 2.0
            Anchor.TopRight, Anchor.Right, Anchor.BottomRight -> mark.at.x - width
        }
        val y = when (mark.anchor) {
            Anchor.TopLeft, Anchor.Top, Anchor.TopRight -> mark.at.y + fm.ascent
            Anchor.Left, Anchor.Center, Anchor.Right -> mark.at.y - height / 2.0 + fm.ascent
            Anchor.BottomLeft, Anchor.Bottom, Anchor.BottomRight -> mark.at.y - fm.descent
        }
        g.drawString(mark.text, x.toFloat(), y.toFloat())
    }

    private fun head(g: Graphics2D, from: Pt, to: Pt, head: Head) {
        if (head == Head.None) return
        val angle = atan2(to.y - from.y, to.x - from.x)
        when (head) {
            Head.Arrow -> {
                val p = arrow(to, angle)
                g.fill(p)
            }
            Head.Open -> g.draw(arrow(to, angle))
            Head.Cross -> cross(g, to, angle)
            Head.Dot -> g.fill(Ellipse2D.Double(to.x - DOT, to.y - DOT, DOT * 2, DOT * 2))
            Head.None -> Unit
        }
    }

    private fun arrow(to: Pt, angle: Double): Path2D {
        val left = point(to, angle + PI * 0.82, HEAD)
        val right = point(to, angle - PI * 0.82, HEAD)
        return Path2D.Double().apply {
            moveTo(to.x, to.y)
            lineTo(left.x, left.y)
            lineTo(right.x, right.y)
            closePath()
        }
    }

    private fun cross(g: Graphics2D, to: Pt, angle: Double) {
        val a = point(to, angle + PI / 4.0, CROSS)
        val b = point(to, angle + PI + PI / 4.0, CROSS)
        val c = point(to, angle - PI / 4.0, CROSS)
        val d = point(to, angle + PI - PI / 4.0, CROSS)
        g.draw(Line2D.Double(a.x, a.y, b.x, b.y))
        g.draw(Line2D.Double(c.x, c.y, d.x, d.y))
    }

    private fun point(pt: Pt, angle: Double, len: Double) = Pt(pt.x + cos(angle) * len, pt.y + sin(angle) * len)

    private fun path(points: List<Pt>, close: Boolean): Path2D {
        val path = Path2D.Double()
        val first = points.firstOrNull() ?: return path
        path.moveTo(first.x, first.y)
        points.drop(1).forEach { path.lineTo(it.x, it.y) }
        if (close) path.closePath()
        return path
    }

    private fun stroke(dash: Boolean = false, thick: Boolean = false): BasicStroke {
        val width = if (thick) THICK else THIN
        if (!dash) return BasicStroke(width, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
        return BasicStroke(width, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND, max(DASH, width), floatArrayOf(DASH, DASH), 0f)
    }
}
