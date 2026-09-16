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
 * Kanban engine: indentation makes the first level columns and deeper levels cards. Trailing
 * `@{ ... }` metadata is parsed and discarded.
 */
internal class Kanban(private val measure: Measure, private val spec: Spec) {
    suspend fun draw(clean: Clean): Out {
        val columns = mutableListOf<Column>()
        var indent = -1
        var first = true
        var count = 0
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            if (line.text.isBlank()) continue
            val depth = line.text.takeWhile { it == ' ' }.length
            val text = strip(line.text.trim())
            if (text.isEmpty()) continue
            if (first) {
                first = false
                if (text.lowercase() == "kanban") continue
            }
            val label = Lex.tagged(text)?.second ?: text
            count++
            if (count > spec.limits.nodes) return Out.Err(Fault.Limit, "kanban exceeds ${spec.limits.nodes} items")
            if (indent < 0 || depth <= indent) {
                indent = if (indent < 0) depth else indent
                if (depth <= indent) {
                    columns.add(Column(label, mutableListOf()))
                    continue
                }
            }
            val column = columns.lastOrNull() ?: return Out.Err(Fault.Syntax, "card before any column", line.at)
            column.cards.add(label)
        }
        if (columns.isEmpty()) return Out.Err(Fault.Syntax, "kanban has no columns", 1)
        return Out.Ok(marks(columns))
    }

    /** Drops one trailing `@{ ... }` metadata block. */
    private fun strip(text: String): String {
        val at = text.lastIndexOf("@{")
        if (at < 0 || !text.trimEnd().endsWith("}")) return text
        return text.substring(0, at).trim()
    }

    private fun marks(columns: List<Column>): Scene {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val pad = sheet.pad
        var x = 0.0
        val tall = columns.maxOf { it.cards.size } * (high + pad * 3) + high + pad * 3
        columns.forEachIndexed { idx, column ->
            val wide = maxOf(
                sheet.width(column.label, bold = true),
                column.cards.maxOfOrNull { sheet.width(it) } ?: 0.0,
                high * 8,
            ) + pad * 4
            val frame = Rect(x, 0.0, wide, tall)
            sheet.add(Mark.Box(frame, spec.metrics.arc, null, Role.Cluster))
            sheet.add(Mark.Box(Rect(x, 0.0, wide, high + pad * 2), spec.metrics.arc, null, null, tone = idx, soft = true))
            sheet.texts(listOf(column.label), x + wide / 2, pad, Role.Text, bold = true)
            var y = high + pad * 3
            for (card in column.cards) {
                val rect = Rect(x + pad, y, wide - pad * 2, high + pad * 2)
                sheet.add(Mark.Box(rect, spec.metrics.arc, Role.Surface, Role.Border))
                sheet.add(Mark.Text(card, Pt(rect.x + pad, rect.y + rect.h / 2), Anchor.Left, Role.Text))
                y += rect.h + pad
            }
            x += wide + sheet.gap
        }
        return sheet.scene(Type.Kanban)
    }

    private data class Column(val label: String, val cards: MutableList<String>)
}
