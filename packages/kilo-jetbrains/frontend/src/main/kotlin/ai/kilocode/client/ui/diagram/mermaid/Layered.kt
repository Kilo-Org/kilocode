package ai.kilocode.client.ui.diagram.mermaid

import ai.kilocode.client.ui.diagram.Pt
import ai.kilocode.client.ui.diagram.Rect
import ai.kilocode.client.ui.diagram.Size
import ai.kilocode.client.ui.diagram.Spec
import kotlin.coroutines.coroutineContext
import kotlin.math.abs
import kotlinx.coroutines.ensureActive

internal data class Rail(val from: String, val to: String)

internal data class Plan(val rects: Map<String, Rect>, val size: Size)

/**
 * Small layered layout shared by the graph-family engines (class, state, er, requirement, C4).
 *
 * Deliberately simpler than [FlowLayout]: longest-path ranks over cycle-free rails, one barycenter
 * sweep in each direction, centered rows. All phases iterate insertion-ordered collections a fixed
 * number of times so the result is byte-stable for a given input.
 */
internal class Layered(private val spec: Spec) {
    suspend fun run(sizes: Map<String, Size>, rails: List<Rail>): Plan {
        // An empty scope is valid mermaid (`state Empty { }`), so it lays out as an empty frame rather
        // than throwing out of the row aggregations below.
        if (sizes.isEmpty()) return Plan(emptyMap(), Size(0.0, 0.0))
        val gap = spec.metrics.gap
        val step = spec.metrics.rank
        val links = rails.filter { it.from != it.to && sizes.containsKey(it.from) && sizes.containsKey(it.to) }
        val ids = sizes.keys.toList()
        val keep = drop(ids, links)
        val rank = ranks(ids, keep)
        coroutineContext.ensureActive()

        val rows = linkedMapOf<Int, MutableList<String>>()
        for (id in ids) rows.getOrPut(rank.getValue(id)) { mutableListOf() }.add(id)
        order(rows, keep)
        coroutineContext.ensureActive()

        val wide = rows.values.maxOf { row -> row.sumOf { sizes.getValue(it).w } + gap * (row.size - 1) }
        val rects = linkedMapOf<String, Rect>()
        var top = 0.0
        // Rows are keyed by rank but filled in declaration order, so layout has to sort them the way
        // order() does. Otherwise the first-declared rank paints at the top and a parent-on-top
        // relation like `Circle --|> Shape` comes out upside down.
        for (key in rows.keys.sorted()) {
            val row = rows.getValue(key)
            val tall = row.maxOf { sizes.getValue(it).h }
            var x = (wide - (row.sumOf { sizes.getValue(it).w } + gap * (row.size - 1))) / 2
            for (id in row) {
                val size = sizes.getValue(id)
                rects[id] = Rect(x, top + (tall - size.h) / 2, size.w, size.h)
                x += size.w + gap
            }
            top += tall + step
        }
        return Plan(rects, Size(wide, top - step))
    }

    /** Rails surviving a DFS cycle check in declaration order; back edges do not shape ranks. */
    private fun drop(ids: List<String>, links: List<Rail>): List<Rail> {
        val adj = linkedMapOf<String, MutableList<Int>>()
        for (id in ids) adj[id] = mutableListOf()
        links.forEachIndexed { idx, rail -> adj[rail.from]?.add(idx) }
        val state = linkedMapOf<String, Int>()
        val backs = linkedSetOf<Int>()

        fun visit(id: String) {
            state[id] = GRAY
            for (idx in adj[id] ?: mutableListOf()) {
                val to = links[idx].to
                when (state[to] ?: WHITE) {
                    GRAY -> backs.add(idx)
                    WHITE -> visit(to)
                    else -> Unit
                }
            }
            state[id] = BLACK
        }

        for (id in ids) if ((state[id] ?: WHITE) == WHITE) visit(id)
        return links.filterIndexed { idx, _ -> idx !in backs }
    }

    /** Longest-path ranks; the rail set is a DAG so passes converge within the node count. */
    private fun ranks(ids: List<String>, links: List<Rail>): Map<String, Int> {
        val rank = linkedMapOf<String, Int>()
        for (id in ids) rank[id] = 0
        repeat(ids.size) {
            var moved = false
            for (link in links) {
                val want = rank.getValue(link.from) + 1
                if (rank.getValue(link.to) < want) {
                    rank[link.to] = want
                    moved = true
                }
            }
            if (!moved) return rank
        }
        return rank
    }

    /** One barycenter sweep down then up; stable sort keeps declaration order for ties. */
    private fun order(rows: LinkedHashMap<Int, MutableList<String>>, links: List<Rail>) {
        val keys = rows.keys.sorted()
        val at = linkedMapOf<String, Int>()
        for (row in rows.values) row.forEachIndexed { idx, id -> at[id] = idx }
        for (key in keys.drop(1)) sweep(rows.getValue(key), links, at, up = false)
        for (key in keys.dropLast(1).reversed()) sweep(rows.getValue(key), links, at, up = true)
    }

    private fun sweep(row: MutableList<String>, links: List<Rail>, at: MutableMap<String, Int>, up: Boolean) {
        val score = linkedMapOf<String, Double>()
        row.forEachIndexed { idx, id ->
            val peers = links.mapNotNull {
                if (up && it.from == id) at[it.to] else if (!up && it.to == id) at[it.from] else null
            }
            score[id] = if (peers.isEmpty()) idx.toDouble() else peers.average()
        }
        row.sortWith(compareBy { score.getValue(it) })
        row.forEachIndexed { idx, id -> at[id] = idx }
    }

    private companion object {
        const val WHITE = 0
        const val GRAY = 1
        const val BLACK = 2
    }
}

/**
 * Border anchor points for a straight connector between two rects: vertical faces when the centers
 * are stacked, horizontal faces when they sit side by side.
 */
internal fun joint(a: Rect, b: Rect): Pair<Pt, Pt> {
    val ax = a.x + a.w / 2
    val ay = a.y + a.h / 2
    val bx = b.x + b.w / 2
    val by = b.y + b.h / 2
    if (abs(by - ay) >= abs(bx - ax)) {
        if (by >= ay) return Pt(ax, a.y + a.h) to Pt(bx, b.y)
        return Pt(ax, a.y) to Pt(bx, b.y + b.h)
    }
    if (bx >= ax) return Pt(a.x + a.w, ay) to Pt(b.x, by)
    return Pt(a.x, ay) to Pt(b.x + b.w, by)
}
