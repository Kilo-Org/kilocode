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
import kotlin.math.cos
import kotlin.math.sin
import kotlinx.coroutines.ensureActive

/** Pie chart engine. Slices sort by value descending and run clockwise from 12 o'clock, like mermaid. */
internal class Pie(private val measure: Measure, private val spec: Spec) {
    suspend fun draw(clean: Clean): Out {
        var title = ""
        var data = false
        val slices = mutableListOf<Slice>()
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            var text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                if (text.substringBefore(' ').lowercase() == "pie") {
                    text = text.substringAfter(' ', "").trim()
                    if (text.substringBefore(' ').lowercase() == "showdata") {
                        data = true
                        text = text.substringAfter(' ', "").trim()
                    }
                    if (text.isEmpty()) continue
                }
            }
            val token = text.substringBefore(' ').lowercase()
            if (token == "title") {
                title = text.substringAfter(' ', "").trim()
                continue
            }
            if (token == "showdata") {
                data = true
                continue
            }
            if (token == "accdescr" || token == "acctitle") continue
            val colon = colon(text) ?: continue
            val label = Source.unquote(text.substring(0, colon).trim())
            val value = Lex.num(text.substring(colon + 1))
                ?: return Out.Err(Fault.Syntax, "pie value must be a number", line.at)
            if (value < 0) return Out.Err(Fault.Syntax, "pie value must not be negative", line.at)
            slices.add(Slice(label, value))
            if (slices.size > spec.limits.nodes) return Out.Err(Fault.Limit, "pie exceeds ${spec.limits.nodes} slices")
        }
        if (slices.isEmpty()) return Out.Err(Fault.Syntax, "pie has no data", 1)
        val total = slices.sumOf { it.value }
        if (total <= 0.0) return Out.Err(Fault.Syntax, "pie values sum to zero", 1)
        return Out.Ok(marks(title, data, slices.sortedByDescending { it.value }, total))
    }

    private fun colon(text: String): Int? {
        val mask = Source.opens(text)
        for (idx in text.indices) if (text[idx] == ':' && mask[idx]) return idx
        return null
    }

    private fun marks(title: String, data: Boolean, slices: List<Slice>, total: Double): Scene {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val pad = sheet.pad
        val r = high * 6
        var top = 0.0
        if (title.isNotEmpty()) top = sheet.texts(listOf(title), r, 0.0, Role.Text, bold = true) + pad
        val at = Pt(r, top + r)
        var angle = 90.0
        slices.forEachIndexed { idx, slice ->
            val sweep = -360.0 * slice.value / total
            sheet.add(Mark.Sector(at, r, angle, sweep, null, Role.Border, tone = idx))
            val frac = slice.value / total
            if (frac >= 0.04) {
                val mid = Math.toRadians(angle + sweep / 2)
                val spot = Pt(at.x + cos(mid) * r * 0.62, at.y - sin(mid) * r * 0.62)
                sheet.add(Mark.Text("${Math.round(frac * 100)}%", spot, Anchor.Center, Role.Text))
            }
            angle += sweep
        }
        var row = top
        slices.forEachIndexed { idx, slice ->
            val swatch = Rect(r * 2 + sheet.gap, row, high * 0.8, high * 0.8)
            sheet.add(Mark.Box(swatch, 0.0, null, Role.Border, tone = idx))
            val text = if (data) "${slice.label} [${Axis.label(slice.value)}]" else slice.label
            sheet.add(Mark.Text(text, Pt(swatch.x + swatch.w + pad, swatch.y + swatch.h / 2), Anchor.Left, Role.Text))
            row += high
        }
        return sheet.scene(Type.Pie)
    }

    private data class Slice(val label: String, val value: Double)
}
