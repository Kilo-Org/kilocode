package ai.kilocode.client.ui.diagram.mermaid

import ai.kilocode.client.ui.diagram.Anchor
import ai.kilocode.client.ui.diagram.Fault
import ai.kilocode.client.ui.diagram.Mark
import ai.kilocode.client.ui.diagram.Measure
import ai.kilocode.client.ui.diagram.Out
import ai.kilocode.client.ui.diagram.Pt
import ai.kilocode.client.ui.diagram.Rect
import ai.kilocode.client.ui.diagram.Role
import ai.kilocode.client.ui.diagram.Scene
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.diagram.Type
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive

/**
 * Sankey engine. Nodes column by longest path from a source; links are filled bands sampled from a
 * smoothstep curve so no curve primitive is needed in the mark model.
 */
internal class Sankey(private val measure: Measure, private val spec: Spec) {
    suspend fun draw(clean: Clean): Out {
        val flows = mutableListOf<Flow>()
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                val token = text.substringBefore(' ').lowercase()
                if (token == "sankey-beta" || token == "sankey") continue
            }
            val cells = csv(text)
            if (cells.size != 3) return Out.Err(Fault.Syntax, "sankey rows are source,target,value", line.at)
            val value = Lex.num(cells[2]) ?: return Out.Err(Fault.Syntax, "sankey value must be a number", line.at)
            if (value < 0) return Out.Err(Fault.Syntax, "sankey value must not be negative", line.at)
            flows.add(Flow(cells[0], cells[1], value))
            if (flows.size > spec.limits.edges) return Out.Err(Fault.Limit, "sankey exceeds ${spec.limits.edges} links")
        }
        if (flows.isEmpty()) return Out.Err(Fault.Syntax, "sankey has no links", 1)
        return marks(flows)
    }

    /** Minimal CSV: double quotes may wrap a cell to protect commas. */
    private fun csv(text: String): List<String> {
        val out = mutableListOf<String>()
        val cell = StringBuilder()
        var quote = false
        for (char in text) {
            when {
                char == '"' -> quote = !quote
                char == ',' && !quote -> {
                    out.add(cell.toString().trim())
                    cell.setLength(0)
                }
                else -> cell.append(char)
            }
        }
        out.add(cell.toString().trim())
        return out
    }

    private suspend fun marks(flows: List<Flow>): Out {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val pad = sheet.pad
        val nodes = linkedMapOf<String, Node>()
        for (flow in flows) {
            nodes.getOrPut(flow.from) { Node(flow.from, nodes.size) }
            nodes.getOrPut(flow.to) { Node(flow.to, nodes.size) }
        }
        if (nodes.size > spec.limits.nodes) return Out.Err(Fault.Limit, "sankey exceeds ${spec.limits.nodes} nodes")
        // Longest-path depth; passes converge for a DAG, and the node-count bound tames cycles.
        var pass = 0
        while (pass++ < nodes.size) {
            var moved = false
            for (flow in flows) {
                val from = nodes.getValue(flow.from)
                val to = nodes.getValue(flow.to)
                if (to.depth < from.depth + 1 && from.depth + 1 < nodes.size) {
                    to.depth = from.depth + 1
                    moved = true
                }
            }
            if (!moved) break
        }
        coroutineContext.ensureActive()
        for (flow in flows) {
            nodes.getValue(flow.from).out += flow.value
            nodes.getValue(flow.to).into += flow.value
        }
        val cols = nodes.values.groupBy { it.depth }.toSortedMap()
        val scale = high * 10 / (cols.values.maxOf { col -> col.sumOf { it.size() } })
        val stride = high * 12
        val bar = pad * 1.5
        for ((depth, col) in cols) {
            var y = 0.0
            for (node in col) {
                node.rect = Rect(depth * stride, y, bar, node.size() * scale)
                y += node.size() * scale + high * 1.5
            }
        }
        for (flow in flows) {
            coroutineContext.ensureActive()
            val from = nodes.getValue(flow.from)
            val to = nodes.getValue(flow.to)
            sheet.add(Mark.Poly(band(from, to, flow.value, scale), null, null, tone = from.index, soft = true))
        }
        for (node in nodes.values) {
            val rect = node.rect
            sheet.add(Mark.Box(rect, 0.0, null, null, tone = node.index))
            val last = node.out <= 0.0
            val at = if (last) Pt(rect.x - pad, rect.y + rect.h / 2) else Pt(rect.x + rect.w + pad, rect.y + rect.h / 2)
            sheet.add(Mark.Text(node.id, at, if (last) Anchor.Right else Anchor.Left, Role.Text))
        }
        return Out.Ok(sheet.scene(Type.Sankey))
    }

    /** Band polygon: smoothstep top edge out, straight caps, smoothstep bottom edge back. */
    private fun band(from: Node, to: Node, value: Double, scale: Double): List<Pt> {
        val tall = value * scale
        val a = Pt(from.rect.x + from.rect.w, from.rect.y + from.sent * scale)
        val b = Pt(to.rect.x, to.rect.y + to.got * scale)
        from.sent += value
        to.got += value
        val top = curve(a, b)
        val bottom = curve(Pt(a.x, a.y + tall), Pt(b.x, b.y + tall)).reversed()
        return top + bottom
    }

    private fun curve(a: Pt, b: Pt): List<Pt> = List(SAMPLES + 1) { idx ->
        val t = idx.toDouble() / SAMPLES
        val ease = t * t * (3 - 2 * t)
        Pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * ease)
    }

    private data class Flow(val from: String, val to: String, val value: Double)

    private class Node(val id: String, val index: Int) {
        var depth = 0
        var into = 0.0
        var out = 0.0
        var sent = 0.0
        var got = 0.0
        var rect = Rect(0.0, 0.0, 0.0, 0.0)
        fun size() = maxOf(into, out, 0.1)
    }

    private companion object {
        const val SAMPLES = 16
    }
}
