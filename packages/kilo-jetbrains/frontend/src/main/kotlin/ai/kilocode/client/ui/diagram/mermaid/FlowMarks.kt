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
import kotlin.coroutines.coroutineContext
import kotlin.math.max
import kotlinx.coroutines.ensureActive

/** Turns laid-out flowchart geometry into marks. Cluster frames are emitted first so they paint behind. */
internal class FlowMarks(private val measure: Measure, private val spec: Spec) {
    private val pad get() = spec.metrics.pad

    suspend fun run(placed: Placed): Scene {
        val frames = frames(placed)
        val dx = -minOf(0.0, frames.minOfOrNull { it.rect.x } ?: 0.0)
        val dy = -minOf(0.0, frames.minOfOrNull { it.rect.y } ?: 0.0)
        val marks = mutableListOf<Mark>()
        for (frame in frames) marks.add(group(frame, dx, dy))
        for (route in placed.routes) {
            coroutineContext.ensureActive()
            marks.add(line(route, dx, dy))
            marks.addAll(tag(route, dx, dy))
        }
        for (slot in placed.slots.values) {
            coroutineContext.ensureActive()
            val node = slot.node ?: continue
            val rect = move(slot.rect, dx, dy)
            marks.addAll(shape(node, rect))
            marks.addAll(label(node.label, rect, Role.Text))
        }
        return Scene(Type.Flowchart, marks, size(placed, frames, dx, dy))
    }

    private fun size(placed: Placed, frames: List<Frame>, dx: Double, dy: Double): Size {
        val wide = max(placed.size.w + dx, frames.maxOfOrNull { it.rect.x + it.rect.w + dx } ?: 0.0)
        val high = max(placed.size.h + dy, frames.maxOfOrNull { it.rect.y + it.rect.h + dy } ?: 0.0)
        return Size(wide, high)
    }

    /**
     * A frame spans the member nodes of its subgraph and of every subgraph nested inside it, padded by
     * one step per nesting level so an outer frame reserves room for the inner ones.
     *
     * Both the member set and the nesting depth are resolved in one reverse pass instead of a recursive
     * walk per cluster. A cluster's parent is always declared before it, so visiting declaration order
     * backwards visits children first, and each cluster only merges the bounds its children already
     * resolved. Recursing per cluster instead rescans every node for every cluster, which is quadratic
     * on deeply nested subgraphs and, since this phase is not the one holding the layout, was also the
     * only phase with no cancellation point at all.
     */
    private suspend fun frames(placed: Placed): List<Frame> {
        val kids = linkedMapOf<String, MutableList<String>>()
        for (cluster in placed.graph.clusters.values) {
            if (cluster.parent == null) continue
            kids.getOrPut(cluster.parent) { mutableListOf() }.add(cluster.id)
        }
        val owned = linkedMapOf<String, MutableList<Rect>>()
        for (node in placed.graph.nodes.values) {
            val id = node.cluster ?: continue
            val rect = placed.slots[node.id]?.rect ?: continue
            owned.getOrPut(id) { mutableListOf() }.add(rect)
        }

        val reach = linkedMapOf<String, Span>()
        val deep = linkedMapOf<String, Int>()
        for (cluster in placed.graph.clusters.values.reversed()) {
            coroutineContext.ensureActive()
            val below = kids[cluster.id].orEmpty()
            val bounds = owned[cluster.id].orEmpty().map(::span) + below.mapNotNull { reach[it] }
            val merged = bounds.reduceOrNull(::merge)
            if (merged != null) reach[cluster.id] = merged
            deep[cluster.id] = below.maxOfOrNull { 1 + (deep[it] ?: 0) } ?: 0
        }

        val out = mutableListOf<Frame>()
        for (cluster in placed.graph.clusters.values) {
            val bounds = reach[cluster.id] ?: continue
            val room = pad * 2 * (1 + (deep[cluster.id] ?: 0))
            val title = measure.height(spec.font) * cluster.label.size
            val x = bounds.minX - room
            val y = bounds.minY - room - title
            out.add(Frame(cluster, Rect(x, y, bounds.maxX + room - x, bounds.maxY + room - y)))
        }
        return out
    }

    private fun span(rect: Rect) = Span(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h)

    private fun merge(a: Span, b: Span) = Span(
        minOf(a.minX, b.minX),
        minOf(a.minY, b.minY),
        max(a.maxX, b.maxX),
        max(a.maxY, b.maxY),
    )

    private fun group(frame: Frame, dx: Double, dy: Double): Mark {
        val rect = move(frame.rect, dx, dy)
        val box = Mark.Box(rect, spec.metrics.arc, null, Role.Cluster, dash = true)
        val high = measure.height(spec.font)
        val title = frame.cluster.label.mapIndexed { idx, text ->
            Mark.Text(text, Pt(rect.x + rect.w / 2, rect.y + pad + high * (idx + HALF)), Anchor.Center, Role.Muted, true)
        }
        return Mark.Group(frame.cluster.id, listOf(box) + title)
    }

    private fun line(route: Route, dx: Double, dy: Double): Mark {
        val points = route.points.map { Pt(it.x + dx, it.y + dy) }
        return Mark.Edge(
            points,
            Role.Line,
            dash = route.edge.link == Link.Dotted,
            thick = route.edge.link == Link.Thick,
            head = route.edge.head,
            tail = route.edge.tail,
        )
    }

    private fun tag(route: Route, dx: Double, dy: Double): List<Mark> {
        if (route.edge.label.isEmpty()) return emptyList()
        val at = mid(route.points)
        val high = measure.height(spec.font)
        val top = at.y + dy - high * route.edge.label.size / 2
        return route.edge.label.mapIndexed { idx, text ->
            Mark.Text(text, Pt(at.x + dx, top + high * (idx + HALF)), Anchor.Center, Role.Muted)
        }
    }

    private fun mid(points: List<Pt>): Pt {
        if (points.isEmpty()) return Pt(0.0, 0.0)
        if (points.size % 2 == 1) return points[points.size / 2]
        val left = points[points.size / 2 - 1]
        val right = points[points.size / 2]
        return Pt((left.x + right.x) / 2, (left.y + right.y) / 2)
    }

    private fun label(lines: List<String>, rect: Rect, role: Role): List<Mark> {
        val high = measure.height(spec.font)
        val top = rect.y + (rect.h - high * lines.size) / 2
        return lines.mapIndexed { idx, text ->
            Mark.Text(text, Pt(rect.x + rect.w / 2, top + high * (idx + HALF)), Anchor.Center, role)
        }
    }

    private fun shape(node: FlowNode, rect: Rect): List<Mark> = when (node.shape) {
        Shape.Rect -> listOf(box(rect, 0.0))
        Shape.Round, Shape.Cylinder -> listOf(box(rect, spec.metrics.arc * 2))
        Shape.Stadium -> listOf(box(rect, rect.h / 2))
        Shape.Subroutine -> listOf(box(rect, 0.0)) + bars(rect)
        Shape.Circle -> listOf(Mark.Oval(rect, Role.Surface, Role.Border))
        Shape.Doubled -> listOf(Mark.Oval(rect, Role.Surface, Role.Border), Mark.Oval(inset(rect), null, Role.Border))
        Shape.Rhombus -> listOf(poly(diamond(rect)))
        Shape.Hexagon -> listOf(poly(hexagon(rect)))
        Shape.Skew -> listOf(poly(skew(rect, false)))
        Shape.SkewAlt -> listOf(poly(skew(rect, true)))
        Shape.Trapezoid -> listOf(poly(trapezoid(rect, false)))
        Shape.TrapezoidAlt -> listOf(poly(trapezoid(rect, true)))
        Shape.Flag -> listOf(poly(flag(rect)))
    }

    private fun box(rect: Rect, arc: Double) = Mark.Box(rect, arc, Role.Surface, Role.Border)

    private fun poly(points: List<Pt>) = Mark.Poly(points, Role.Surface, Role.Border)

    private fun bars(rect: Rect): List<Mark> {
        val left = rect.x + pad
        val right = rect.x + rect.w - pad
        val top = rect.y
        val low = rect.y + rect.h
        return listOf(
            Mark.Edge(listOf(Pt(left, top), Pt(left, low)), Role.Border),
            Mark.Edge(listOf(Pt(right, top), Pt(right, low)), Role.Border),
        )
    }

    private fun inset(rect: Rect): Rect {
        val room = pad / 2
        return Rect(rect.x + room, rect.y + room, rect.w - room * 2, rect.h - room * 2)
    }

    private fun diamond(rect: Rect) = listOf(
        Pt(rect.x + rect.w / 2, rect.y),
        Pt(rect.x + rect.w, rect.y + rect.h / 2),
        Pt(rect.x + rect.w / 2, rect.y + rect.h),
        Pt(rect.x, rect.y + rect.h / 2),
    )

    private fun hexagon(rect: Rect): List<Pt> {
        val cut = minOf(pad * 2, rect.w / 3)
        return listOf(
            Pt(rect.x + cut, rect.y),
            Pt(rect.x + rect.w - cut, rect.y),
            Pt(rect.x + rect.w, rect.y + rect.h / 2),
            Pt(rect.x + rect.w - cut, rect.y + rect.h),
            Pt(rect.x + cut, rect.y + rect.h),
            Pt(rect.x, rect.y + rect.h / 2),
        )
    }

    private fun skew(rect: Rect, back: Boolean): List<Pt> {
        val cut = minOf(pad * 2, rect.w / 4)
        val lean = if (back) -cut else cut
        return listOf(
            Pt(rect.x + max(0.0, lean), rect.y),
            Pt(rect.x + rect.w + minOf(0.0, lean), rect.y),
            Pt(rect.x + rect.w - max(0.0, lean), rect.y + rect.h),
            Pt(rect.x - minOf(0.0, lean), rect.y + rect.h),
        )
    }

    private fun trapezoid(rect: Rect, flip: Boolean): List<Pt> {
        val cut = minOf(pad * 2, rect.w / 4)
        if (flip) {
            return listOf(
                Pt(rect.x, rect.y),
                Pt(rect.x + rect.w, rect.y),
                Pt(rect.x + rect.w - cut, rect.y + rect.h),
                Pt(rect.x + cut, rect.y + rect.h),
            )
        }
        return listOf(
            Pt(rect.x + cut, rect.y),
            Pt(rect.x + rect.w - cut, rect.y),
            Pt(rect.x + rect.w, rect.y + rect.h),
            Pt(rect.x, rect.y + rect.h),
        )
    }

    private fun flag(rect: Rect): List<Pt> {
        val cut = minOf(pad * 2, rect.w / 5)
        return listOf(
            Pt(rect.x, rect.y),
            Pt(rect.x + rect.w - cut, rect.y),
            Pt(rect.x + rect.w, rect.y + rect.h / 2),
            Pt(rect.x + rect.w - cut, rect.y + rect.h),
            Pt(rect.x, rect.y + rect.h),
            Pt(rect.x + cut, rect.y + rect.h / 2),
        )
    }

    private fun move(rect: Rect, dx: Double, dy: Double) = Rect(rect.x + dx, rect.y + dy, rect.w, rect.h)

    private data class Frame(val cluster: Cluster, val rect: Rect)

    /** Bounding box of the nodes a subgraph reaches, kept separate from the padded [Frame] rect. */
    private data class Span(val minX: Double, val minY: Double, val maxX: Double, val maxY: Double)

    private companion object {
        const val HALF = 0.5
    }
}
