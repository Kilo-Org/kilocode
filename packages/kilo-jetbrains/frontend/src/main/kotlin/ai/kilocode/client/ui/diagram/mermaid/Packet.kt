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

/** Packet diagram engine: bit fields on a 32-bit grid; fields crossing a row boundary split. */
internal class Packet(private val measure: Measure, private val spec: Spec) {
    suspend fun draw(clean: Clean): Out {
        val fields = mutableListOf<Field>()
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                val token = text.substringBefore(' ').lowercase()
                if (token == "packet-beta" || token == "packet") continue
            }
            if (text.substringBefore(' ').lowercase() in setOf("title", "accdescr", "acctitle")) continue
            val match = ROW.find(text) ?: return Out.Err(Fault.Syntax, "malformed packet field", line.at)
            // Bit indexes are bounded before any row math: an unbounded end would both overflow the
            // row arithmetic below and expand into millions of marks in a phase with no suspend point.
            val start = match.groupValues[1].toIntOrNull()
            val end = match.groupValues[2].ifEmpty { match.groupValues[1] }.toIntOrNull()
            if (start == null || end == null || start > CAP || end > CAP) {
                return Out.Err(Fault.Limit, "packet bit indexes must stay under $CAP", line.at)
            }
            if (end < start) return Out.Err(Fault.Syntax, "packet field ends before it starts", line.at)
            fields.add(Field(start, end, Source.unquote(match.groupValues[3].trim())))
            if (fields.size > spec.limits.nodes) return Out.Err(Fault.Limit, "packet exceeds ${spec.limits.nodes} fields")
        }
        if (fields.isEmpty()) return Out.Err(Fault.Syntax, "packet has no fields", 1)
        return Out.Ok(marks(fields.sortedBy { it.start }))
    }

    private suspend fun marks(fields: List<Field>): Scene {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val pad = sheet.pad
        val unit = maxOf(high * 1.8, sheet.width("000") + pad)
        val tall = high + pad * 2
        val lead = high
        for (field in fields) {
            var start = field.start
            while (start <= field.end) {
                coroutineContext.ensureActive()
                val row = start / BITS
                val stop = minOf(field.end, (row + 1) * BITS - 1)
                val rect = Rect(
                    (start % BITS) * unit,
                    lead + row * (tall + lead),
                    (stop - start + 1) * unit,
                    tall,
                )
                sheet.add(Mark.Box(rect, 0.0, Role.Surface, Role.Border))
                sheet.label(listOf(sheet.fit(field.label, rect.w - pad)), rect, Role.Text)
                sheet.add(Mark.Text("$start", Pt(rect.x + 1, rect.y - 1), Anchor.BottomLeft, Role.Muted))
                if (stop > start) {
                    sheet.add(Mark.Text("$stop", Pt(rect.x + rect.w - 1, rect.y - 1), Anchor.BottomRight, Role.Muted))
                }
                start = stop + 1
            }
        }
        return sheet.scene(Type.Packet)
    }

    private data class Field(val start: Int, val end: Int, val label: String)

    private companion object {
        const val BITS = 32

        /** Highest bit index accepted; keeps row arithmetic inside `Int` and mark counts bounded. */
        const val CAP = BITS * 64

        val ROW = Regex("""^\+?(\d+)(?:-(\d+))?\s*:\s*(.+)$""")
    }
}
