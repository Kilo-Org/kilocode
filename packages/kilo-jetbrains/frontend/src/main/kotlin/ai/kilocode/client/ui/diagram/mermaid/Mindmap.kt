package ai.kilocode.client.ui.diagram.mermaid

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
 * Mindmap engine. A tidy right-growing tree instead of mermaid's radial layout — a deliberate core
 * simplification. Branch tones follow the top-level child.
 */
internal class Mindmap(private val measure: Measure, private val spec: Spec) {
    suspend fun draw(clean: Clean): Out {
        var root: Node? = null
        val stack = ArrayDeque<Pair<Int, Node>>()
        var first = true
        var count = 0
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            if (line.text.isBlank()) continue
            val depth = line.text.takeWhile { it == ' ' }.length
            var text = line.text.trim()
            if (first) {
                first = false
                if (text.lowercase() == "mindmap") continue
            }
            if (text.startsWith("::icon")) continue
            if (text.startsWith("%%")) continue
            val icon = text.indexOf("::icon")
            if (icon > 0) text = text.substring(0, icon).trim()
            val node = node(text)
            count++
            if (count > spec.limits.nodes) return Out.Err(Fault.Limit, "mindmap exceeds ${spec.limits.nodes} nodes")
            while (stack.isNotEmpty() && stack.last().first >= depth) stack.removeLast()
            val parent = stack.lastOrNull()?.second
            if (parent == null) {
                if (root != null) return Out.Err(Fault.Syntax, "mindmap has more than one root", line.at)
                root = node
            } else {
                parent.kids.add(node)
            }
            stack.addLast(depth to node)
        }
        val tree = root ?: return Out.Err(Fault.Syntax, "mindmap has no nodes", 1)
        return Out.Ok(marks(tree))
    }

    private fun node(text: String): Node {
        for (wrap in WRAPS) {
            val open = text.indexOf(wrap.first)
            if (open < 0 || !text.endsWith(wrap.second)) continue
            if (text.length < open + wrap.first.length + wrap.second.length) continue
            return Node(text.substring(open + wrap.first.length, text.length - wrap.second.length).trim(), mutableListOf())
        }
        return Node(text, mutableListOf())
    }

    private suspend fun marks(root: Node): Scene {
        val sheet = Sheet(measure, spec)
        rows(root)
        widths(sheet, root, 0)
        place(sheet, root, 0, 0.0, 0.0, -1)
        return sheet.scene(Type.Mindmap)
    }

    /** Rows a subtree needs: leaves take one row each. */
    private fun rows(node: Node): Int {
        node.rows = if (node.kids.isEmpty()) 1 else node.kids.sumOf { rows(it) }
        return node.rows
    }

    private val cols = mutableListOf<Double>()

    private fun widths(sheet: Sheet, node: Node, depth: Int) {
        if (cols.size <= depth) cols.add(0.0)
        cols[depth] = maxOf(cols[depth], sheet.width(node.label, bold = depth == 0) + sheet.pad * 2)
        for (kid in node.kids) widths(sheet, kid, depth + 1)
    }

    private suspend fun place(sheet: Sheet, node: Node, depth: Int, x: Double, top: Double, tone: Int): Rect {
        coroutineContext.ensureActive()
        val high = sheet.high
        val pad = sheet.pad
        val row = high + pad * 2 + sheet.gap
        val tall = high + pad * 2
        val wide = cols[depth]
        val my = top + (node.rows * row - tall) / 2
        val rect = Rect(x, my, wide, tall)
        when {
            depth == 0 -> {
                sheet.add(Mark.Oval(Rect(rect.x, rect.y - pad, rect.w, rect.h + pad * 2), Role.Surface, Role.Border))
                sheet.label(listOf(node.label), rect, Role.Text, bold = true)
            }
            else -> {
                sheet.add(Mark.Box(rect, rect.h / 2, null, Role.Border, tone = tone, soft = true))
                sheet.label(listOf(node.label), rect, Role.Text)
            }
        }
        var y = top
        node.kids.forEachIndexed { idx, kid ->
            val hue = if (depth == 0) idx else tone
            val child = place(sheet, kid, depth + 1, x + wide + sheet.gap * 2, y, hue)
            sheet.add(
                Mark.Edge(
                    listOf(
                        Pt(rect.x + rect.w, rect.y + rect.h / 2),
                        Pt(rect.x + rect.w + sheet.gap, rect.y + rect.h / 2),
                        Pt(child.x - sheet.gap, child.y + child.h / 2),
                        Pt(child.x, child.y + child.h / 2),
                    ),
                    Role.Muted,
                ),
            )
            y += kid.rows * row
        }
        return rect
    }

    private data class Node(val label: String, val kids: MutableList<Node>, var rows: Int = 1)

    private companion object {
        val WRAPS = listOf(
            "((" to "))",
            "([" to "])",
            "[(" to ")]",
            "{{" to "}}",
            "[" to "]",
            "(" to ")",
        )
    }
}
