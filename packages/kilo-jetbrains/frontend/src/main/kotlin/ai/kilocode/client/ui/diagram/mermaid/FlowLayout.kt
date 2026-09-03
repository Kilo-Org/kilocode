package ai.kilocode.client.ui.diagram.mermaid

import ai.kilocode.client.ui.diagram.Measure
import ai.kilocode.client.ui.diagram.Pt
import ai.kilocode.client.ui.diagram.Rect
import ai.kilocode.client.ui.diagram.Size
import ai.kilocode.client.ui.diagram.Spec
import kotlin.coroutines.coroutineContext
import kotlin.math.abs
import kotlin.math.max
import kotlinx.coroutines.ensureActive

internal data class Slot(val id: String, val rect: Rect, val node: FlowNode?)

internal data class Route(val edge: FlowEdge, val points: List<Pt>)

internal data class Placed(val graph: Graph, val slots: Map<String, Slot>, val routes: List<Route>, val size: Size)

/**
 * Layered flowchart layout. All phases use fixed iteration counts and insertion-ordered maps so the
 * result is byte-stable for a given input and [Measure].
 *
 * Layout always runs in top-down space; `LR`/`RL` swap node extents up front and the finished
 * geometry is transposed once at the end.
 */
internal class FlowLayout(private val measure: Measure, private val spec: Spec) {
    private val gap get() = spec.metrics.gap
    private val step get() = spec.metrics.rank

    suspend fun run(graph: Graph): Placed {
        val flip = graph.dir == Dir.Left || graph.dir == Dir.Right
        val sizes = sizes(graph, flip)
        val links = graph.edges.filter { it.from != it.to && graph.nodes.containsKey(it.to) }
        val backs = backs(graph, links)
        val rank = ranks(graph.nodes.keys.toList(), links, backs)
        coroutineContext.ensureActive()

        val paths = paths(links, rank, sizes)
        val order = order(graph, rank, paths)
        coroutineContext.ensureActive()

        val x = place(order, sizes, pairs(paths))
        val rows = rows(order, sizes)
        val boxes = boxes(graph, order, sizes, x, rows)
        coroutineContext.ensureActive()

        val routes = routes(graph, boxes, paths)
        return finish(graph, boxes, routes, flip)
    }

    private suspend fun sizes(graph: Graph, flip: Boolean): MutableMap<String, Size> {
        val out = linkedMapOf<String, Size>()
        for (node in graph.nodes.values) {
            coroutineContext.ensureActive()
            val size = size(node)
            out[node.id] = if (flip) Size(size.h, size.w) else size
        }
        return out
    }

    private fun size(node: FlowNode): Size {
        val pad = spec.metrics.pad
        val text = node.label.maxOf { measure.width(it, spec.font) }
        val high = measure.height(spec.font) * node.label.size
        return when (node.shape) {
            Shape.Rhombus -> Size(text + pad * 4, high + pad * 4)
            Shape.Circle, Shape.Doubled -> {
                val side = max(text, high) + pad * 3
                Size(side, side)
            }
            Shape.Hexagon, Shape.Skew, Shape.SkewAlt, Shape.Trapezoid, Shape.TrapezoidAlt ->
                Size(text + pad * 4, high + pad * 2)
            else -> Size(text + pad * 2, high + pad * 2)
        }
    }

    /** Edge indices that close a cycle, found by DFS colouring in declaration order. */
    private fun backs(graph: Graph, links: List<FlowEdge>): Set<Int> {
        val adj = linkedMapOf<String, MutableList<Int>>()
        for (id in graph.nodes.keys) adj[id] = mutableListOf()
        links.forEachIndexed { idx, edge -> adj[edge.from]?.add(idx) }
        val state = linkedMapOf<String, Int>()
        val out = linkedSetOf<Int>()

        fun visit(id: String) {
            state[id] = GRAY
            for (idx in adj[id] ?: mutableListOf()) {
                val to = links[idx].to
                when (state[to] ?: WHITE) {
                    GRAY -> out.add(idx)
                    WHITE -> visit(to)
                    else -> Unit
                }
            }
            state[id] = BLACK
        }

        for (id in graph.nodes.keys) {
            if ((state[id] ?: WHITE) == WHITE) visit(id)
        }
        return out
    }

    /** Longest-path ranking by bounded relaxation over the acyclic orientation. */
    private fun ranks(ids: List<String>, links: List<FlowEdge>, backs: Set<Int>): Map<String, Int> {
        val out = linkedMapOf<String, Int>()
        for (id in ids) out[id] = 0
        val dag = links.mapIndexed { idx, edge ->
            if (idx in backs) edge.to to edge.from else edge.from to edge.to
        }
        repeat(ids.size) {
            var moved = false
            for ((from, to) in dag) {
                val next = (out[from] ?: 0) + 1
                if ((out[to] ?: 0) >= next) continue
                out[to] = next
                moved = true
            }
            if (!moved) return out
        }
        return out
    }

    /**
     * Expands each edge into the chain of ranks it crosses, adding a virtual slot per crossed rank.
     *
     * This is the one phase whose output is not bounded by [Limits] directly: a long edge contributes a
     * slot per rank it spans, so within the node and edge caps it can still mint six figures of virtual
     * slots. Hence the per-edge cancellation check rather than one at the phase boundary.
     */
    private suspend fun paths(links: List<FlowEdge>, rank: Map<String, Int>, sizes: MutableMap<String, Size>): List<Path> {
        val out = mutableListOf<Path>()
        for (edge in links) {
            coroutineContext.ensureActive()
            val from = rank[edge.from] ?: 0
            val to = rank[edge.to] ?: 0
            val ids = mutableListOf(edge.from)
            val dir = if (to >= from) 1 else -1
            var at = from + dir
            while (at != to && from != to) {
                val id = "~${edge.index}@$at"
                sizes[id] = Size(spec.metrics.line, 0.0)
                ids.add(id)
                at += dir
            }
            ids.add(edge.to)
            out.add(Path(edge, ids, from, to))
        }
        return out
    }

    private suspend fun order(
        graph: Graph,
        rank: Map<String, Int>,
        paths: List<Path>,
    ): List<MutableList<String>> {
        val depth = (rank.values.maxOrNull() ?: 0) + 1
        val out = List(depth) { mutableListOf<String>() }
        for (node in graph.nodes.values) out[rank[node.id] ?: 0].add(node.id)
        for (path in paths) {
            val dir = if (path.to >= path.from) 1 else -1
            path.ids.drop(1).dropLast(1).forEachIndexed { idx, id ->
                val at = path.from + dir * (idx + 1)
                if (at in out.indices) out[at].add(id)
            }
        }
        sweep(graph, out, pairs(paths))
        return out
    }

    private suspend fun sweep(
        graph: Graph,
        order: List<MutableList<String>>,
        pairs: List<Pair<String, String>>,
    ) {
        val adj = adjacency(pairs)
        val index = linkedMapOf<String, Int>()
        order.forEach { ids -> ids.forEach { index[it] = index.size } }
        repeat(SWEEPS) { pass ->
            val down = pass % 2 == 0
            val ranks = if (down) order.indices.drop(1) else order.indices.reversed().drop(1)
            for (at in ranks) {
                coroutineContext.ensureActive()
                val other = order[at + if (down) -1 else 1]
                val slot = linkedMapOf<String, Double>()
                other.forEachIndexed { idx, id -> slot[id] = idx.toDouble() }
                val group = order[at].associateWith { key(graph, it) }
                // Both keys are resolved once per id: a comparator that recomputed the median would
                // re-sort a node's neighbour positions on every comparison.
                val want = order[at].associateWith { median(adj[it]?.mapNotNull { peer -> slot[peer] } ?: emptyList()) }
                order[at].sortWith(
                    compareBy(
                        { group[it] },
                        { want[it] ?: Double.MAX_VALUE },
                        { index[it] ?: 0 },
                    ),
                )
            }
        }
    }

    /** Keeps subgraph members adjacent inside a rank; ungrouped nodes sort first. */
    private fun key(graph: Graph, id: String): Int {
        val node = graph.nodes[id] ?: return -1
        val cluster = node.cluster ?: return -1
        return graph.clusters[cluster]?.index ?: -1
    }

    private fun pairs(paths: List<Path>): List<Pair<String, String>> {
        val out = mutableListOf<Pair<String, String>>()
        for (path in paths) {
            path.ids.zipWithNext().forEach { out.add(it) }
        }
        return out
    }

    private fun adjacency(pairs: List<Pair<String, String>>): Map<String, MutableList<String>> {
        val out = linkedMapOf<String, MutableList<String>>()
        for ((from, to) in pairs) {
            out.getOrPut(from) { mutableListOf() }.add(to)
            out.getOrPut(to) { mutableListOf() }.add(from)
        }
        return out
    }

    private suspend fun place(
        order: List<List<String>>,
        sizes: Map<String, Size>,
        pairs: List<Pair<String, String>>,
    ): MutableMap<String, Double> {
        val x = linkedMapOf<String, Double>()
        for (ids in order) {
            var cursor = 0.0
            for (id in ids) {
                x[id] = cursor
                cursor += width(sizes, id) + gap
            }
        }
        val adj = adjacency(pairs)
        repeat(PASSES) { pass -> align(order, sizes, adj, x, pass % 2 == 0) }
        return x
    }

    private suspend fun align(
        order: List<List<String>>,
        sizes: Map<String, Size>,
        adj: Map<String, MutableList<String>>,
        x: MutableMap<String, Double>,
        down: Boolean,
    ) {
        val ranks = if (down) order.indices.drop(1) else order.indices.reversed().drop(1)
        for (at in ranks) {
            coroutineContext.ensureActive()
            val other = order[at + if (down) -1 else 1]
            val centers = linkedMapOf<String, Double>()
            for (id in other) centers[id] = (x[id] ?: 0.0) + width(sizes, id) / 2
            var min = 0.0
            for (id in order[at]) {
                val want = median(adj[id]?.mapNotNull { centers[it] } ?: emptyList())
                val wide = width(sizes, id)
                val left = if (want == null) x.getValue(id) else want - wide / 2
                val at2 = max(min, left)
                x[id] = at2
                min = at2 + wide + gap
            }
        }
    }

    private fun rows(order: List<List<String>>, sizes: Map<String, Size>): List<Double> {
        var cursor = 0.0
        return order.map { ids ->
            val top = cursor
            cursor += (ids.maxOfOrNull { height(sizes, it) } ?: 0.0) + step
            top
        }
    }

    private fun boxes(
        graph: Graph,
        order: List<List<String>>,
        sizes: Map<String, Size>,
        x: Map<String, Double>,
        rows: List<Double>,
    ): MutableMap<String, Slot> {
        val out = linkedMapOf<String, Slot>()
        order.forEachIndexed { at, ids ->
            val tall = ids.maxOfOrNull { height(sizes, it) } ?: 0.0
            for (id in ids) {
                val wide = width(sizes, id)
                val high = height(sizes, id)
                val top = rows[at] + (tall - high) / 2
                out[id] = Slot(id, Rect(x[id] ?: 0.0, top, wide, high), graph.nodes[id])
            }
        }
        return out
    }

    private suspend fun routes(graph: Graph, boxes: Map<String, Slot>, paths: List<Path>): List<Route> {
        val out = mutableListOf<Route>()
        val seen = linkedMapOf<String, Int>()
        val chains = paths.associateBy { it.edge.index }
        for (edge in graph.edges) {
            coroutineContext.ensureActive()
            val from = boxes[edge.from] ?: continue
            if (edge.from == edge.to) {
                out.add(Route(edge, loop(from.rect)))
                continue
            }
            val to = boxes[edge.to] ?: continue
            val path = chains[edge.index] ?: continue
            val lane = seen.getOrDefault(lane(edge), 0)
            seen[lane(edge)] = lane + 1
            out.add(Route(edge, trace(path, boxes, from.rect, to.rect, lane)))
        }
        return out
    }

    private fun lane(edge: FlowEdge) = if (edge.from <= edge.to) "${edge.from}>${edge.to}" else "${edge.to}>${edge.from}"

    private fun trace(path: Path, boxes: Map<String, Slot>, from: Rect, to: Rect, lane: Int): List<Pt> {
        val mid = path.ids.drop(1).dropLast(1).mapNotNull { boxes[it]?.rect }.map { Pt(it.x + it.w / 2, it.y) }
        val bend = if (mid.isNotEmpty() || lane == 0) mid else listOf(bend(from, to, lane))
        val head = bend.firstOrNull() ?: Pt(to.x + to.w / 2, to.y + to.h / 2)
        val tail = bend.lastOrNull() ?: Pt(from.x + from.w / 2, from.y + from.h / 2)
        return listOf(exit(from, head)) + bend + listOf(exit(to, tail))
    }

    private fun bend(from: Rect, to: Rect, lane: Int): Pt {
        val cx = (from.x + from.w / 2 + to.x + to.w / 2) / 2
        val cy = (from.y + from.h / 2 + to.y + to.h / 2) / 2
        return Pt(cx + lane * gap / 2, cy)
    }

    private fun loop(rect: Rect): List<Pt> {
        val right = rect.x + rect.w
        val out = right + gap / 2
        val top = rect.y + rect.h / 4
        val low = rect.y + rect.h * 3 / 4
        return listOf(Pt(right, top), Pt(out, top), Pt(out, low), Pt(right, low))
    }

    /** Point where the straight line from the rect centre towards [to] leaves the rect. */
    private fun exit(rect: Rect, to: Pt): Pt {
        val cx = rect.x + rect.w / 2
        val cy = rect.y + rect.h / 2
        val dx = to.x - cx
        val dy = to.y - cy
        if (dx == 0.0 && dy == 0.0) return Pt(cx, cy)
        val tx = if (dx == 0.0) Double.MAX_VALUE else rect.w / 2 / abs(dx)
        val ty = if (dy == 0.0) Double.MAX_VALUE else rect.h / 2 / abs(dy)
        val t = minOf(tx, ty)
        return Pt(cx + dx * t, cy + dy * t)
    }

    private fun finish(graph: Graph, boxes: Map<String, Slot>, routes: List<Route>, flip: Boolean): Placed {
        val real = boxes.values.filter { it.node != null }
        val minX = real.minOfOrNull { it.rect.x } ?: 0.0
        val minY = real.minOfOrNull { it.rect.y } ?: 0.0
        val pad = spec.metrics.pad
        val shifted = boxes.values.map { slot ->
            slot.copy(rect = Rect(slot.rect.x - minX + pad, slot.rect.y - minY + pad, slot.rect.w, slot.rect.h))
        }
        val moved = routes.map { route ->
            route.copy(points = route.points.map { Pt(it.x - minX + pad, it.y - minY + pad) })
        }
        val turned = Turn(graph.dir, flip, span(shifted, moved, pad))
        val slots = linkedMapOf<String, Slot>()
        for (slot in shifted) slots[slot.id] = slot.copy(rect = turned.rect(slot.rect))
        val out = moved.map { route -> route.copy(points = route.points.map { turned.point(it) }) }
        return Placed(graph, slots, out, turned.size())
    }

    private fun span(slots: List<Slot>, routes: List<Route>, pad: Double): Size {
        val xs = slots.map { it.rect.x + it.rect.w } + routes.flatMap { route -> route.points.map { it.x } }
        val ys = slots.map { it.rect.y + it.rect.h } + routes.flatMap { route -> route.points.map { it.y } }
        return Size((xs.maxOrNull() ?: 0.0) + pad, (ys.maxOrNull() ?: 0.0) + pad)
    }

    private fun width(sizes: Map<String, Size>, id: String) = sizes[id]?.w ?: 0.0

    private fun height(sizes: Map<String, Size>, id: String) = sizes[id]?.h ?: 0.0

    private fun median(values: List<Double>): Double? {
        if (values.isEmpty()) return null
        val sorted = values.sorted()
        val mid = sorted.size / 2
        if (sorted.size % 2 == 1) return sorted[mid]
        return (sorted[mid - 1] + sorted[mid]) / 2
    }

    private data class Path(val edge: FlowEdge, val ids: List<String>, val from: Int, val to: Int)

    /** Single geometry transform applied after layout, so only top-down space is ever computed. */
    private class Turn(private val dir: Dir, private val flip: Boolean, private val bounds: Size) {
        fun rect(rect: Rect): Rect = when (dir) {
            Dir.Down -> rect
            Dir.Up -> Rect(rect.x, bounds.h - rect.y - rect.h, rect.w, rect.h)
            Dir.Right -> Rect(rect.y, rect.x, rect.h, rect.w)
            Dir.Left -> Rect(bounds.h - rect.y - rect.h, rect.x, rect.h, rect.w)
        }

        fun point(pt: Pt): Pt = when (dir) {
            Dir.Down -> pt
            Dir.Up -> Pt(pt.x, bounds.h - pt.y)
            Dir.Right -> Pt(pt.y, pt.x)
            Dir.Left -> Pt(bounds.h - pt.y, pt.x)
        }

        fun size(): Size {
            if (!flip) return bounds
            return Size(bounds.h, bounds.w)
        }
    }

    private companion object {
        const val WHITE = 0
        const val GRAY = 1
        const val BLACK = 2
        const val SWEEPS = 4
        const val PASSES = 2
    }
}
