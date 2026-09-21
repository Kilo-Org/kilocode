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

/** Timeline engine. Periods form columns; `: event` continuation lines stack under the last period. */
internal class Timeline(private val measure: Measure, private val spec: Spec) {
    suspend fun draw(clean: Clean): Out {
        var title = ""
        val periods = mutableListOf<Period>()
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                if (text.lowercase() == "timeline") continue
            }
            val token = text.substringBefore(' ').lowercase()
            if (token == "title") {
                title = text.substringAfter(' ', "").trim()
                continue
            }
            if (token == "section" || token == "accdescr" || token == "acctitle") continue
            if (text.startsWith(":")) {
                val period = periods.lastOrNull() ?: return Out.Err(Fault.Syntax, "event before any period", line.at)
                for (event in text.split(':').map { it.trim() }.filter { it.isNotEmpty() }) period.events.add(event)
                continue
            }
            val colon = text.indexOf(':')
            val period = Period((if (colon < 0) text else text.substring(0, colon)).trim(), mutableListOf())
            if (colon >= 0) {
                for (event in text.substring(colon + 1).split(':').map { it.trim() }.filter { it.isNotEmpty() }) {
                    period.events.add(event)
                }
            }
            periods.add(period)
            if (periods.size > spec.limits.nodes) return Out.Err(Fault.Limit, "timeline exceeds ${spec.limits.nodes} periods")
        }
        if (periods.isEmpty()) return Out.Err(Fault.Syntax, "timeline has no periods", 1)
        return Out.Ok(marks(title, periods))
    }

    private fun marks(title: String, periods: List<Period>): Scene {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val pad = sheet.pad
        val widths = periods.map {
            maxOf(sheet.width(it.label, bold = true), it.events.maxOfOrNull { event -> sheet.width(event) } ?: 0.0) + pad * 4
        }
        var top = 0.0
        if (title.isNotEmpty()) {
            val wide = widths.sum() + sheet.gap * (periods.size - 1)
            top = sheet.texts(listOf(title), wide / 2, 0.0, Role.Text, bold = true) + pad
        }
        var x = 0.0
        periods.forEachIndexed { idx, period ->
            val wide = widths[idx]
            val head = Rect(x, top, wide, high + pad * 2)
            sheet.add(Mark.Box(head, spec.metrics.arc, null, Role.Border, tone = idx, soft = true))
            sheet.label(listOf(period.label), head, Role.Text, bold = true)
            var y = head.y + head.h + pad
            for (event in period.events) {
                val card = Rect(x + pad, y, wide - pad * 2, high + pad)
                sheet.add(Mark.Edge(listOf(Pt(x + wide / 2, y - pad), Pt(x + wide / 2, y)), Role.Muted))
                sheet.add(Mark.Box(card, spec.metrics.arc, Role.Note, Role.Border))
                sheet.label(listOf(event), card, Role.Text)
                y += card.h + pad
            }
            x += wide + sheet.gap
        }
        return sheet.scene(Type.Timeline)
    }

    private data class Period(val label: String, val events: MutableList<String>)
}
