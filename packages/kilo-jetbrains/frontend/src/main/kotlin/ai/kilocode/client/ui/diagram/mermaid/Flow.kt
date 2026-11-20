package ai.kilocode.client.ui.diagram.mermaid

import ai.kilocode.client.ui.diagram.Head
import ai.kilocode.client.ui.diagram.Limits
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive

internal enum class Dir { Down, Up, Left, Right }

internal enum class Shape {
    Rect,
    Round,
    Stadium,
    Subroutine,
    Cylinder,
    Circle,
    Doubled,
    Rhombus,
    Hexagon,
    Skew,
    SkewAlt,
    Trapezoid,
    TrapezoidAlt,
    Flag,
}

internal enum class Link { Solid, Dotted, Thick }

internal data class FlowNode(
    val id: String,
    val label: List<String>,
    val shape: Shape,
    val index: Int,
    val cluster: String?,
)

internal data class FlowEdge(
    val from: String,
    val to: String,
    val link: Link,
    val head: Head,
    val tail: Head,
    val label: List<String>,
    val index: Int,
)

internal data class Cluster(val id: String, val label: List<String>, val parent: String?, val index: Int)

internal data class Graph(
    val dir: Dir,
    val nodes: Map<String, FlowNode>,
    val edges: List<FlowEdge>,
    val clusters: Map<String, Cluster>,
)

internal sealed interface FlowOut {
    data class Ok(val graph: Graph) : FlowOut
    data class Err(val message: String, val line: Int) : FlowOut
    data class Over(val message: String) : FlowOut
}

/** Line-oriented flowchart parser. Unknown statements are skipped rather than failing the diagram. */
internal class Flow(private val limits: Limits = Limits()) {
    private val nodes = linkedMapOf<String, FlowNode>()
    private val edges = mutableListOf<FlowEdge>()
    private val clusters = linkedMapOf<String, Cluster>()
    private val stack = ArrayDeque<String>()
    private var dir = Dir.Down

    suspend fun parse(clean: Clean): FlowOut {
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                if (header(text)) continue
            }
            val err = stmt(text, line.at)
            if (err != null) return FlowOut.Err(err, line.at)
            over()?.let { return it }
        }
        if (stack.isNotEmpty()) {
            return FlowOut.Err("subgraph is missing a matching end", clean.lines.lastOrNull()?.at ?: 1)
        }
        return FlowOut.Ok(Graph(dir, nodes, edges, clusters))
    }

    /**
     * Caps are checked per statement, and [add] / [chain] stop one item past the cap, so a single
     * pathological line cannot build an unbounded model before the refusal is reported.
     */
    private fun over(): FlowOut.Over? {
        if (nodes.size > limits.nodes) return FlowOut.Over("flowchart exceeds ${limits.nodes} nodes")
        if (edges.size > limits.edges) return FlowOut.Over("flowchart exceeds ${limits.edges} links")
        return null
    }

    private fun header(text: String): Boolean {
        val token = text.substringBefore(' ').lowercase()
        if (token != "graph" && token != "flowchart") return false
        dir = dirOf(text.substringAfter(' ', "").trim())
        return true
    }

    private fun stmt(text: String, at: Int): String? {
        val token = text.substringBefore(' ').substringBefore('[').lowercase()
        if (token in SKIP) return null
        if (token == "end") {
            if (stack.isEmpty()) return "end without a matching subgraph"
            stack.removeLast()
            return null
        }
        if (token == "subgraph") return group(text)
        return chain(text, at)
    }

    private fun group(text: String): String? {
        val rest = text.substringAfter("subgraph").trim()
        val open = rest.indexOf('[')
        val id = when {
            rest.isEmpty() -> "sub${clusters.size + 1}"
            open > 0 && rest.endsWith("]") -> rest.substring(0, open).trim()
            else -> rest
        }
        val label = when {
            rest.isEmpty() -> listOf(id)
            open > 0 && rest.endsWith("]") -> Source.label(rest.substring(open + 1, rest.length - 1))
            else -> Source.label(rest)
        }
        if (clusters.containsKey(id)) return "duplicate subgraph id $id"
        clusters[id] = Cluster(id, label, stack.lastOrNull(), clusters.size)
        stack.addLast(id)
        return null
    }

    private fun chain(text: String, at: Int): String? {
        val hits = hits(text)
        if (hits.isEmpty()) {
            refs(text) ?: return null
            return null
        }
        val segs = split(text, hits)
        val labels = pipes(segs, hits.size)
        val groups = segs.map { refs(it) ?: return "expected a node on both sides of the link" }
        for (idx in hits.indices) {
            val hit = hits[idx]
            val label = labels[idx] ?: hit.label
            for (from in groups[idx]) {
                for (to in groups[idx + 1]) {
                    if (edges.size > limits.edges) return null
                    edges.add(FlowEdge(from, to, hit.link, hit.head, hit.tail, label, edges.size))
                }
            }
        }
        return null
    }

    private fun split(text: String, hits: List<Hit>): MutableList<String> {
        val segs = mutableListOf<String>()
        var cursor = 0
        for (hit in hits) {
            segs.add(text.substring(cursor, hit.start))
            cursor = hit.end
        }
        segs.add(text.substring(cursor))
        return segs
    }

    /** Pulls `|label|` off the front of each right-hand segment, attaching it to the preceding link. */
    private fun pipes(segs: MutableList<String>, count: Int): Array<List<String>?> {
        val out = arrayOfNulls<List<String>>(count)
        for (idx in 1 until segs.size) {
            val trimmed = segs[idx].trimStart()
            if (!trimmed.startsWith("|")) continue
            val close = trimmed.indexOf('|', 1)
            if (close < 0) continue
            out[idx - 1] = Source.label(trimmed.substring(1, close))
            segs[idx] = trimmed.substring(close + 1)
        }
        return out
    }

    private fun refs(segment: String): List<String>? {
        val out = mutableListOf<String>()
        for (token in parts(segment)) {
            val id = ref(token) ?: continue
            out.add(id)
        }
        return out.ifEmpty { null }
    }

    /** Splits `A & B` groups at bracket depth zero. */
    private fun parts(segment: String): List<String> {
        val out = mutableListOf<String>()
        val mask = Source.opens(segment)
        var start = 0
        for (idx in segment.indices) {
            if (segment[idx] != '&') continue
            if (!mask[idx]) continue
            out.add(segment.substring(start, idx))
            start = idx + 1
        }
        out.add(segment.substring(start))
        return out
    }

    private fun ref(token: String): String? {
        val text = classes(token.trim())
        if (text.isEmpty()) return null
        val wrap = WRAPS.firstOrNull { fits(text, it) }
        if (wrap == null) {
            add(text, listOf(text), Shape.Rect)
            return text
        }
        val open = text.indexOf(wrap.open)
        val id = text.substring(0, open)
        val body = text.substring(open + wrap.open.length, text.length - wrap.close.length)
        add(id, Source.label(body), wrap.shape)
        return id
    }

    private fun fits(text: String, wrap: Wrap): Boolean {
        val open = text.indexOf(wrap.open)
        if (open <= 0) return false
        if (!text.endsWith(wrap.close)) return false
        return text.length >= open + wrap.open.length + wrap.close.length
    }

    /** Drops a trailing `:::class` assignment; class styling is not modelled. */
    private fun classes(text: String): String {
        val cut = text.lastIndexOf(":::")
        if (cut <= 0) return text
        val tail = text.substring(cut + 3)
        if (tail.isEmpty() || !tail.all { it.isLetterOrDigit() || it == '_' || it == '-' }) return text
        return text.substring(0, cut)
    }

    /**
     * A node first mentioned outside a subgraph still joins the first subgraph that mentions it,
     * which is how mermaid reads `Client --> Gateway` followed by `subgraph core` / `Gateway --> Auth`.
     */
    private fun add(id: String, label: List<String>, shape: Shape) {
        val prior = nodes[id]
        if (prior == null) {
            if (nodes.size > limits.nodes) return
            nodes[id] = FlowNode(id, label, shape, nodes.size, stack.lastOrNull())
            return
        }
        val cluster = prior.cluster ?: stack.lastOrNull()
        val implicit = prior.label == listOf(prior.id) && prior.shape == Shape.Rect
        if (!implicit || label == listOf(id)) {
            if (cluster != prior.cluster) nodes[id] = prior.copy(cluster = cluster)
            return
        }
        nodes[id] = prior.copy(label = label, shape = shape, cluster = cluster)
    }

    private fun hits(text: String): List<Hit> {
        val out = mutableListOf<Hit>()
        val mask = Source.opens(text)
        var idx = 0
        while (idx < text.length) {
            if (!mask[idx]) {
                idx++
                continue
            }
            val hit = edge(text, idx)
            if (hit == null) {
                idx++
                continue
            }
            val back = hit.start > 0 && text[hit.start - 1] == '<'
            out.add(if (back) hit.copy(start = hit.start - 1, tail = Head.Arrow) else hit)
            idx = hit.end
        }
        return out
    }

    private fun edge(text: String, at: Int): Hit? {
        if (text[at] != '-' && text[at] != '=') return null
        var idx = at
        while (idx < text.length && Source.rail(text[idx])) idx++
        val rail = text.substring(at, idx)
        if (rail.length < 2) return null
        val head = headOf(text.getOrNull(idx))
        if (head != Head.None) idx++
        if (head != Head.None || rail.length >= 3) {
            return Hit(at, idx, linkOf(rail), head, Head.None, emptyList())
        }
        val rest = text.substring(idx)
        val match = RAIL.find(rest) ?: return Hit(at, idx, linkOf(rail), Head.None, Head.None, emptyList())
        val end = idx + match.range.last + 1
        val label = Source.label(rest.substring(0, match.range.first))
        return Hit(at, end, linkOf(rail + match.value), headOf(match.value.last()), Head.None, label)
    }

    private data class Hit(
        val start: Int,
        val end: Int,
        val link: Link,
        val head: Head,
        val tail: Head,
        val label: List<String>,
    )

    private data class Wrap(val open: String, val close: String, val shape: Shape)

    private companion object {
        val SKIP = setOf("classdef", "class", "click", "style", "linkstyle", "direction", "acctitle", "accdescr")

        val RAIL = Regex("""[-.=]{2,}[>ox]?""")

        val WRAPS = listOf(
            Wrap("[[", "]]", Shape.Subroutine),
            Wrap("[(", ")]", Shape.Cylinder),
            Wrap("([", "])", Shape.Stadium),
            Wrap("(((", ")))", Shape.Doubled),
            Wrap("((", "))", Shape.Circle),
            Wrap("[/", "/]", Shape.Skew),
            Wrap("[\\", "\\]", Shape.SkewAlt),
            Wrap("[/", "\\]", Shape.Trapezoid),
            Wrap("[\\", "/]", Shape.TrapezoidAlt),
            Wrap("{{", "}}", Shape.Hexagon),
            Wrap("{", "}", Shape.Rhombus),
            Wrap("(", ")", Shape.Round),
            Wrap("[", "]", Shape.Rect),
            Wrap(">", "]", Shape.Flag),
        )

        fun dirOf(text: String) = when (text.trim().uppercase()) {
            "BT" -> Dir.Up
            "LR" -> Dir.Right
            "RL" -> Dir.Left
            else -> Dir.Down
        }

        fun headOf(char: Char?) = when (char) {
            '>' -> Head.Arrow
            'o' -> Head.Dot
            'x' -> Head.Cross
            else -> Head.None
        }

        fun linkOf(rail: String) = when {
            rail.contains('.') -> Link.Dotted
            rail.contains('=') -> Link.Thick
            else -> Link.Solid
        }
    }
}
