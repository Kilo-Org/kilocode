package ai.kilocode.client.ui.diagram

import kotlin.test.assertEquals
import kotlin.test.assertTrue

private const val EPS = 1e-6

internal fun scene(out: Out): Scene {
    assertTrue(out is Out.Ok, "expected Out.Ok but was $out")
    val art = (out as Out.Ok).art
    assertTrue(art is Scene, "expected a Scene but was $art")
    return art as Scene
}

/** Compares the whole scene against a snapshot, mirroring the `assertModel` idiom in session tests. */
internal fun assertScene(expected: String, out: Out) {
    assertEquals(expected.trimIndent().trim(), scene(out).toString().trim())
}

internal fun err(out: Out): Out.Err {
    assertTrue(out is Out.Err, "expected Out.Err but was $out")
    return out as Out.Err
}

/**
 * Every mark must sit inside the reported scene size; a renderer relies on that for scroll bounds.
 *
 * Text marks are checked by glyph extent rather than by anchor, so a label that overflows the
 * reported size fails here instead of silently clipping at paint time.
 */
internal fun assertInBounds(scene: Scene, measure: Measure, spec: Spec) {
    for (mark in flatten(scene.marks)) {
        for (pt in points(mark, measure, spec)) {
            assertTrue(pt.x >= -EPS, "mark left of origin: $mark")
            assertTrue(pt.y >= -EPS, "mark above origin: $mark")
            assertTrue(pt.x <= scene.size.w + EPS, "mark past width ${scene.size.w}: $mark")
            assertTrue(pt.y <= scene.size.h + EPS, "mark past height ${scene.size.h}: $mark")
        }
    }
}

/** Node surfaces must not overlap; this is font-independent so it also holds under real metrics. */
internal fun assertNoOverlap(scene: Scene) {
    val rects = surfaces(scene)
    for (left in rects.indices) {
        for (right in left + 1 until rects.size) {
            assertTrue(apart(rects[left], rects[right]), "overlapping nodes ${rects[left]} ${rects[right]}")
        }
    }
}

/** Flowchart links must start and end on a node outline rather than floating in space. */
internal fun assertEdgesTouchNodes(scene: Scene) {
    if (scene.type != Type.Flowchart) return
    val rects = surfaces(scene)
    for (mark in flatten(scene.marks)) {
        if (mark !is Mark.Edge || mark.role != Role.Line) continue
        val ends = listOf(mark.points.first(), mark.points.last())
        for (pt in ends) {
            assertTrue(rects.any { edgeOf(it, pt) }, "link endpoint $pt is not on a node outline")
        }
    }
}

private fun surfaces(scene: Scene): List<Rect> {
    val out = mutableListOf<Rect>()
    for (mark in flatten(scene.marks)) {
        when (mark) {
            is Mark.Box -> if (mark.fill == Role.Surface) out.add(mark.rect)
            is Mark.Oval -> if (mark.fill == Role.Surface) out.add(mark.rect)
            is Mark.Poly -> if (mark.fill == Role.Surface) out.add(bounds(mark.points))
            else -> Unit
        }
    }
    return out
}

private fun bounds(points: List<Pt>): Rect {
    val x = points.minOf { it.x }
    val y = points.minOf { it.y }
    return Rect(x, y, points.maxOf { it.x } - x, points.maxOf { it.y } - y)
}

private fun apart(left: Rect, right: Rect): Boolean {
    if (left.x + left.w <= right.x + EPS || right.x + right.w <= left.x + EPS) return true
    return left.y + left.h <= right.y + EPS || right.y + right.h <= left.y + EPS
}

private fun edgeOf(rect: Rect, pt: Pt): Boolean {
    val insideX = pt.x >= rect.x - EPS && pt.x <= rect.x + rect.w + EPS
    val insideY = pt.y >= rect.y - EPS && pt.y <= rect.y + rect.h + EPS
    val onVertical = near(pt.x, rect.x) || near(pt.x, rect.x + rect.w)
    val onHorizontal = near(pt.y, rect.y) || near(pt.y, rect.y + rect.h)
    return (onVertical && insideY) || (onHorizontal && insideX)
}

private fun near(left: Double, right: Double) = kotlin.math.abs(left - right) < 1e-3

internal fun flatten(marks: List<Mark>): List<Mark> {
    val out = mutableListOf<Mark>()
    for (mark in marks) {
        if (mark is Mark.Group) {
            out.addAll(flatten(mark.marks))
            continue
        }
        out.add(mark)
    }
    return out
}

private fun points(mark: Mark, measure: Measure, spec: Spec): List<Pt> = when (mark) {
    is Mark.Box -> corners(mark.rect)
    is Mark.Oval -> corners(mark.rect)
    is Mark.Poly -> mark.points
    is Mark.Edge -> mark.points
    is Mark.Text -> span(mark, measure, spec)
    is Mark.Group -> emptyList()
}

private fun span(mark: Mark.Text, measure: Measure, spec: Spec): List<Pt> {
    val room = measure.width(mark.text, spec.font.copy(bold = mark.bold))
    return when (mark.anchor) {
        Anchor.Left, Anchor.TopLeft, Anchor.BottomLeft -> listOf(mark.at, Pt(mark.at.x + room, mark.at.y))
        Anchor.Right, Anchor.TopRight, Anchor.BottomRight -> listOf(Pt(mark.at.x - room, mark.at.y), mark.at)
        else -> listOf(Pt(mark.at.x - room / 2, mark.at.y), Pt(mark.at.x + room / 2, mark.at.y))
    }
}

private fun corners(rect: Rect) = listOf(Pt(rect.x, rect.y), Pt(rect.x + rect.w, rect.y + rect.h))
