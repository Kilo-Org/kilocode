package ai.kilocode.client.ui.diagram.mermaid

import ai.kilocode.client.ui.diagram.Anchor
import ai.kilocode.client.ui.diagram.Mark
import ai.kilocode.client.ui.diagram.Measure
import ai.kilocode.client.ui.diagram.Pt
import ai.kilocode.client.ui.diagram.Rect
import ai.kilocode.client.ui.diagram.Role
import ai.kilocode.client.ui.diagram.Scene
import ai.kilocode.client.ui.diagram.Size
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.diagram.Type

/**
 * Mark collector shared by the chart engines layered on top of [Flow] and [Seq].
 *
 * Engines draw in absolute coordinates, possibly negative; [scene] normalizes the origin and reports
 * a size that covers every mark including text glyph extents, mirroring the [SeqLayout] behaviour so
 * renderers can rely on [Scene.size] for scroll and clip bounds.
 */
internal class Sheet(private val measure: Measure, private val spec: Spec) {
    val marks = mutableListOf<Mark>()
    val high = measure.height(spec.font)
    val pad = spec.metrics.pad
    val gap = spec.metrics.gap
    val step = spec.metrics.rank
    val arc = spec.metrics.arc
    val font = spec.font
    private val bold = spec.font.copy(bold = true)

    fun add(mark: Mark) {
        marks.add(mark)
    }

    fun width(text: String, bold: Boolean = false) = measure.width(text, if (bold) this.bold else font)

    fun widest(lines: List<String>, bold: Boolean = false) = lines.maxOfOrNull { width(it, bold) } ?: 0.0

    /** Centered multi-line text block below [top]; returns the height consumed. */
    fun texts(lines: List<String>, cx: Double, top: Double, role: Role, bold: Boolean = false): Double {
        lines.forEachIndexed { idx, text ->
            marks.add(Mark.Text(text, Pt(cx, top + high * (idx + 0.5)), Anchor.Center, role, bold))
        }
        return high * lines.size
    }

    /** Centered multi-line text block in the middle of [rect]. */
    fun label(lines: List<String>, rect: Rect, role: Role, bold: Boolean = false) {
        texts(lines, rect.x + rect.w / 2, rect.y + (rect.h - high * lines.size) / 2, role, bold)
    }

    /**
     * Truncates [text] with an ellipsis until it fits into [room]. The first guess is proportional so
     * a long line does not re-measure once per character; empty when not even one character fits.
     */
    fun fit(text: String, room: Double): String {
        val full = width(text)
        if (full <= room) return text
        if (room <= 0.0) return ""
        var keep = minOf(text.length - 1, (text.length * room / full).toInt() + 1)
        while (keep > 0) {
            val cut = text.substring(0, keep).trimEnd() + "…"
            if (width(cut) <= room) return cut
            keep--
        }
        return ""
    }

    /** Greedy word wrap by measured width; a single overlong word stays on its own line. */
    fun wrap(text: String, room: Double): List<String> {
        val words = text.split(' ').filter { it.isNotEmpty() }
        if (words.isEmpty()) return emptyList()
        val out = mutableListOf<String>()
        var line = words.first()
        for (word in words.drop(1)) {
            val next = "$line $word"
            if (width(next) <= room) {
                line = next
                continue
            }
            out.add(line)
            line = word
        }
        out.add(line)
        return out
    }

    fun scene(type: Type): Scene {
        val pts = marks.flatMap(::pts)
        val dx = -minOf(0.0, pts.minOfOrNull { it.x } ?: 0.0) + pad
        val dy = -minOf(0.0, pts.minOfOrNull { it.y } ?: 0.0) + pad
        val moved = marks.map { move(it, dx, dy) }
        val ends = pts.map { Pt(it.x + dx, it.y + dy) }
        val size = Size((ends.maxOfOrNull { it.x } ?: 0.0) + pad, (ends.maxOfOrNull { it.y } ?: 0.0) + pad)
        return Scene(type, moved, size)
    }

    private fun pts(mark: Mark): List<Pt> = when (mark) {
        is Mark.Box -> corners(mark.rect)
        is Mark.Oval -> corners(mark.rect)
        is Mark.Poly -> mark.points
        is Mark.Sector -> listOf(Pt(mark.at.x - mark.r, mark.at.y - mark.r), Pt(mark.at.x + mark.r, mark.at.y + mark.r))
        is Mark.Edge -> mark.points
        is Mark.Text -> span(mark)
        is Mark.Group -> mark.marks.flatMap(::pts)
    }

    private fun span(mark: Mark.Text): List<Pt> {
        val room = width(mark.text, mark.bold)
        return when (mark.anchor) {
            Anchor.Left, Anchor.TopLeft, Anchor.BottomLeft -> listOf(mark.at, Pt(mark.at.x + room, mark.at.y))
            Anchor.Right, Anchor.TopRight, Anchor.BottomRight -> listOf(Pt(mark.at.x - room, mark.at.y), mark.at)
            else -> listOf(Pt(mark.at.x - room / 2, mark.at.y), Pt(mark.at.x + room / 2, mark.at.y))
        }
    }

    private fun corners(rect: Rect) = listOf(Pt(rect.x, rect.y), Pt(rect.x + rect.w, rect.y + rect.h))

    private fun move(mark: Mark, dx: Double, dy: Double) = moved(mark, dx, dy)
}

/** Shifts a mark; used by engines that lay out nested scopes locally and then offset them. */
internal fun moved(mark: Mark, dx: Double, dy: Double): Mark = when (mark) {
    is Mark.Box -> mark.copy(rect = moved(mark.rect, dx, dy))
    is Mark.Oval -> mark.copy(rect = moved(mark.rect, dx, dy))
    is Mark.Poly -> mark.copy(points = mark.points.map { moved(it, dx, dy) })
    is Mark.Sector -> mark.copy(at = moved(mark.at, dx, dy))
    is Mark.Edge -> mark.copy(points = mark.points.map { moved(it, dx, dy) })
    is Mark.Text -> mark.copy(at = moved(mark.at, dx, dy))
    is Mark.Group -> mark.copy(marks = mark.marks.map { moved(it, dx, dy) })
}

internal fun moved(rect: Rect, dx: Double, dy: Double) = Rect(rect.x + dx, rect.y + dy, rect.w, rect.h)

internal fun moved(pt: Pt, dx: Double, dy: Double) = Pt(pt.x + dx, pt.y + dy)
