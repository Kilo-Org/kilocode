package ai.kilocode.client.ui.diagram.mermaid

import ai.kilocode.client.ui.diagram.Fault
import ai.kilocode.client.ui.diagram.Head
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
 * Block diagram engine: cells flow row-major into `columns N` slots; `space` and `space:N` skip
 * slots; `A --> B` lines connect placed blocks.
 */
internal class BlockDg(private val measure: Measure, private val spec: Spec) {
    suspend fun draw(clean: Clean): Out {
        var columns = 0
        val cells = mutableListOf<Cell?>()
        val links = mutableListOf<Link>()
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                val token = text.substringBefore(' ').lowercase()
                if (token == "block-beta" || token == "block") continue
            }
            val token = text.substringBefore(' ').lowercase()
            if (token == "columns") {
                columns = Lex.num(text.substringAfter(' ', ""))?.toInt()
                    ?: return Out.Err(Fault.Syntax, "columns needs a number", line.at)
                continue
            }
            if (token == "accdescr" || token == "acctitle" || token == "classdef" || token == "class" || token == "style") continue
            val arrow = text.indexOf("-->")
            if (arrow > 0) {
                val from = text.substring(0, arrow).trim()
                val to = text.substring(arrow + 3).trim()
                if (from.isEmpty() || to.isEmpty()) return Out.Err(Fault.Syntax, "block link needs both ends", line.at)
                links.add(Link(from, to))
                if (links.size > spec.limits.edges) return Out.Err(Fault.Limit, "block diagram exceeds ${spec.limits.edges} links")
                continue
            }
            for (tok in Lex.tokens(text)) {
                val lower = tok.text.lowercase()
                if (lower == "space") {
                    cells.add(null)
                    continue
                }
                if (lower.startsWith("space:")) {
                    val skip = lower.substringAfter(':').toIntOrNull() ?: 1
                    repeat(skip.coerceIn(1, BITSLOTS)) { cells.add(null) }
                    continue
                }
                cells.add(cell(tok.text))
                if (cells.size > spec.limits.nodes) return Out.Err(Fault.Limit, "block diagram exceeds ${spec.limits.nodes} blocks")
            }
        }
        val named = cells.filterNotNull()
        if (named.isEmpty()) return Out.Err(Fault.Syntax, "block diagram has no blocks", 1)
        return Out.Ok(marks(if (columns > 0) columns else cells.size.coerceAtLeast(1), cells, links))
    }

    private fun cell(text: String): Cell {
        for (wrap in WRAPS) {
            val open = text.indexOf(wrap.open)
            if (open <= 0 || !text.endsWith(wrap.close)) continue
            if (text.length < open + wrap.open.length + wrap.close.length) continue
            val id = text.substring(0, open)
            val label = Source.unquote(text.substring(open + wrap.open.length, text.length - wrap.close.length))
            return Cell(id, label, wrap.kind)
        }
        return Cell(text, text, KIND_RECT)
    }

    private fun marks(columns: Int, cells: List<Cell?>, links: List<Link>): Scene {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val pad = sheet.pad
        val named = cells.filterNotNull()
        val wide = named.maxOf { sheet.width(it.label) } + pad * 4
        val tall = high + pad * 2
        val rects = linkedMapOf<String, Rect>()
        cells.forEachIndexed { idx, cell ->
            if (cell == null) return@forEachIndexed
            val col = idx % columns
            val row = idx / columns
            rects[cell.id] = Rect(col * (wide + sheet.gap), row * (tall + sheet.gap), wide, tall)
        }
        for (link in links) {
            val from = rects[link.from] ?: continue
            val to = rects[link.to] ?: continue
            val ends = joint(from, to)
            sheet.add(Mark.Edge(listOf(ends.first, ends.second), Role.Line, head = Head.Arrow))
        }
        for (cell in named) {
            val rect = rects.getValue(cell.id)
            when (cell.kind) {
                KIND_CIRCLE -> sheet.add(Mark.Oval(rect, Role.Surface, Role.Border))
                KIND_CYL -> sheet.add(Mark.Box(rect, spec.metrics.arc * 3, Role.Surface, Role.Border))
                KIND_ROUND -> sheet.add(Mark.Box(rect, spec.metrics.arc * 2, Role.Surface, Role.Border))
                KIND_STADIUM -> sheet.add(Mark.Box(rect, rect.h / 2, Role.Surface, Role.Border))
                else -> sheet.add(Mark.Box(rect, 0.0, Role.Surface, Role.Border))
            }
            sheet.label(listOf(cell.label), rect, Role.Text)
        }
        return sheet.scene(Type.Block)
    }

    private data class Cell(val id: String, val label: String, val kind: Int)

    private data class Link(val from: String, val to: String)

    private data class Wrap(val open: String, val close: String, val kind: Int)

    private companion object {
        const val KIND_RECT = 0
        const val KIND_ROUND = 1
        const val KIND_STADIUM = 2
        const val KIND_CYL = 3
        const val KIND_CIRCLE = 4
        const val BITSLOTS = 64

        val WRAPS = listOf(
            Wrap("[(", ")]", KIND_CYL),
            Wrap("([", "])", KIND_STADIUM),
            Wrap("((", "))", KIND_CIRCLE),
            Wrap("[", "]", KIND_RECT),
            Wrap("(", ")", KIND_ROUND),
        )
    }
}
