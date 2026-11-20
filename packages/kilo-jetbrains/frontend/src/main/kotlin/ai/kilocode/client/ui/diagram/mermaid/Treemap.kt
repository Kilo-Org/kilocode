package ai.kilocode.client.ui.diagram.mermaid

import ai.kilocode.client.ui.diagram.Fault
import ai.kilocode.client.ui.diagram.Mark
import ai.kilocode.client.ui.diagram.Measure
import ai.kilocode.client.ui.diagram.Out
import ai.kilocode.client.ui.diagram.Rect
import ai.kilocode.client.ui.diagram.Role
import ai.kilocode.client.ui.diagram.Scene
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.diagram.Type
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive

/**
 * Treemap engine. Alternating slice/dice layout: deterministic and simple, at the cost of the
 * squarified aspect ratios mermaid produces. Leaf tones follow the top-level branch.
 */
internal class Treemap(private val measure: Measure, private val spec: Spec) {
    suspend fun draw(clean: Clean): Out {
        val roots = mutableListOf<Node>()
        val stack = ArrayDeque<Pair<Int, Node>>()
        var first = true
        var count = 0
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            if (line.text.isBlank()) continue
            val depth = line.text.takeWhile { it == ' ' }.length
            val text = line.text.trim()
            if (first) {
                first = false
                val token = text.substringBefore(' ').lowercase()
                if (token == "treemap-beta" || token == "treemap") continue
            }
            if (text.substringBefore(' ').lowercase() in setOf("title", "accdescr", "acctitle")) continue
            val colon = split(text)
            val label = Source.unquote((if (colon < 0) text else text.substring(0, colon)).trim())
            val value = if (colon < 0) null else Lex.num(text.substring(colon + 1))
            if (colon >= 0 && value == null) return Out.Err(Fault.Syntax, "treemap value must be a number", line.at)
            val node = Node(label, value ?: 0.0, mutableListOf())
            count++
            if (count > spec.limits.nodes) return Out.Err(Fault.Limit, "treemap exceeds ${spec.limits.nodes} nodes")
            while (stack.isNotEmpty() && stack.last().first >= depth) stack.removeLast()
            val parent = stack.lastOrNull()?.second
            if (parent == null) roots.add(node) else parent.kids.add(node)
            stack.addLast(depth to node)
        }
        if (roots.isEmpty()) return Out.Err(Fault.Syntax, "treemap has no nodes", 1)
        for (root in roots) sum(root)
        if (roots.sumOf { it.value } <= 0.0) return Out.Err(Fault.Syntax, "treemap values sum to zero", 1)
        return Out.Ok(marks(roots))
    }

    /** The colon separating a leaf value sits after the quoted name, outside quotes. */
    private fun split(text: String): Int {
        val mask = Source.opens(text)
        for (idx in text.indices) if (text[idx] == ':' && mask[idx]) return idx
        return -1
    }

    private fun sum(node: Node): Double {
        if (node.kids.isEmpty()) return node.value
        node.value = node.kids.sumOf { sum(it) }
        return node.value
    }

    private suspend fun marks(roots: List<Node>): Scene {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val area = Rect(0.0, 0.0, high * 36, high * 24)
        place(sheet, roots, area, 0, -1)
        return sheet.scene(Type.Treemap)
    }

    private suspend fun place(sheet: Sheet, nodes: List<Node>, rect: Rect, depth: Int, tone: Int) {
        coroutineContext.ensureActive()
        val pad = sheet.pad
        val high = sheet.high
        val total = nodes.sumOf { it.value }
        if (total <= 0.0) return
        var offset = 0.0
        nodes.forEachIndexed { idx, node ->
            val frac = node.value / total
            val cell = if (depth % 2 == 0) {
                Rect(rect.x + offset, rect.y, rect.w * frac, rect.h).also { offset += rect.w * frac }
            } else {
                Rect(rect.x, rect.y + offset, rect.w, rect.h * frac).also { offset += rect.h * frac }
            }
            val hue = if (tone < 0) idx else tone
            if (node.kids.isEmpty()) {
                sheet.add(Mark.Box(cell, 0.0, null, Role.Border, tone = hue, soft = true))
                val label = sheet.fit(node.label, cell.w - pad)
                if (label.isNotEmpty() && cell.h >= high * 2) {
                    sheet.label(listOf(label, Axis.label(node.value)), cell, Role.Text)
                }
                return@forEachIndexed
            }
            sheet.add(Mark.Box(cell, 0.0, null, Role.Cluster))
            val title = sheet.fit(node.label, cell.w - pad)
            if (title.isNotEmpty() && cell.h >= high * 2) {
                sheet.texts(listOf(title), cell.x + cell.w / 2, cell.y + pad / 2, Role.Muted, bold = true)
            }
            val head = if (cell.h >= high * 2) high + pad else 0.0
            val inner = Rect(cell.x + pad / 2, cell.y + head, (cell.w - pad).coerceAtLeast(1.0), (cell.h - head - pad / 2).coerceAtLeast(1.0))
            place(sheet, node.kids, inner, depth + 1, hue)
        }
    }

    private data class Node(val label: String, var value: Double, val kids: MutableList<Node>)
}
