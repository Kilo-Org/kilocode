package ai.kilocode.client.ui.diagram.mermaid

import ai.kilocode.client.ui.diagram.Anchor
import ai.kilocode.client.ui.diagram.Fault
import ai.kilocode.client.ui.diagram.Head
import ai.kilocode.client.ui.diagram.Mark
import ai.kilocode.client.ui.diagram.Measure
import ai.kilocode.client.ui.diagram.Out
import ai.kilocode.client.ui.diagram.Pt
import ai.kilocode.client.ui.diagram.Rect
import ai.kilocode.client.ui.diagram.Role
import ai.kilocode.client.ui.diagram.Size
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.diagram.Type
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive

/**
 * Entity relationship engine: crow's-foot relations plus entity attribute tables. Cardinality glyph
 * pairs collapse to one head each: many beats optional beats exactly-one.
 */
internal class ErDg(private val measure: Measure, private val spec: Spec) {
    private val entities = linkedMapOf<String, MutableList<Attr>>()
    private val rels = mutableListOf<ERel>()
    private var block: String? = null

    suspend fun draw(clean: Clean): Out {
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                if (text.substringBefore(' ').lowercase() == "erdiagram") continue
            }
            val err = stmt(text)
            if (err != null) return Out.Err(Fault.Syntax, err, line.at)
            if (entities.size > spec.limits.nodes) return Out.Err(Fault.Limit, "er diagram exceeds ${spec.limits.nodes} entities")
            if (rels.size > spec.limits.edges) return Out.Err(Fault.Limit, "er diagram exceeds ${spec.limits.edges} relations")
        }
        if (block != null) return Out.Err(Fault.Syntax, "entity block is missing a closing brace", clean.lines.lastOrNull()?.at ?: 1)
        if (entities.isEmpty()) return Out.Err(Fault.Syntax, "er diagram has no entities", 1)
        return marks()
    }

    private fun stmt(text: String): String? {
        val open = block
        if (open != null) {
            if (text == "}") {
                block = null
                return null
            }
            attr(open, text.removeSuffix("}").trim())
            if (text.endsWith("}")) block = null
            return null
        }
        val match = REL.find(text)
        if (match != null) {
            val from = Source.unquote(match.groupValues[1])
            val to = Source.unquote(match.groupValues[5])
            entities.getOrPut(from) { mutableListOf() }
            entities.getOrPut(to) { mutableListOf() }
            rels.add(
                ERel(
                    from,
                    to,
                    tail = head(match.groupValues[2]),
                    head = head(match.groupValues[4]),
                    dashed = match.groupValues[3].startsWith("."),
                    label = Source.unquote(match.groupValues[6].trim()),
                ),
            )
            return null
        }
        if (text.endsWith("{")) {
            val id = Source.unquote(text.removeSuffix("{").trim())
            if (id.isEmpty()) return "entity needs a name"
            entities.getOrPut(id) { mutableListOf() }
            block = id
            return null
        }
        return null
    }

    /** `type name PK,FK "comment"` rows; keys and the comment are optional. */
    private fun attr(entity: String, text: String) {
        if (text.isEmpty()) return
        val tokens = Lex.tokens(text)
        if (tokens.size < 2) return
        val keys = tokens.drop(2).map { it.text }.filter { !it.startsWith("\"") }.joinToString(" ")
        entities.getValue(entity).add(Attr(tokens[0].text, tokens[1].text, keys))
    }

    private suspend fun marks(): Out.Ok {
        val sheet = Sheet(measure, spec)
        val pad = sheet.pad
        val high = sheet.high
        val sizes = linkedMapOf<String, Size>()
        for (entry in entities) {
            coroutineContext.ensureActive()
            val rows = entry.value
            val typeW = rows.maxOfOrNull { sheet.width(it.type) } ?: 0.0
            val nameW = rows.maxOfOrNull { sheet.width(name(it)) } ?: 0.0
            val wide = maxOf(sheet.width(entry.key, bold = true) + pad * 2, typeW + nameW + pad * 3)
            sizes[entry.key] = Size(wide, high + pad * 2 + rows.size * (high + pad))
        }
        val plan = Layered(spec).run(sizes, rels.map { Rail(it.from, it.to) })
        for (rel in rels) {
            coroutineContext.ensureActive()
            val ends = joint(plan.rects.getValue(rel.from), plan.rects.getValue(rel.to))
            sheet.add(Mark.Edge(listOf(ends.first, ends.second), Role.Line, dash = rel.dashed, head = rel.head, tail = rel.tail))
            if (rel.label.isNotEmpty()) {
                val mid = Pt((ends.first.x + ends.second.x) / 2, (ends.first.y + ends.second.y) / 2)
                sheet.texts(listOf(rel.label), mid.x, mid.y - high, Role.Muted)
            }
        }
        for (entry in entities) {
            coroutineContext.ensureActive()
            table(sheet, entry.key, entry.value, plan.rects.getValue(entry.key))
        }
        return Out.Ok(sheet.scene(Type.Er))
    }

    private fun table(sheet: Sheet, id: String, rows: List<Attr>, rect: Rect) {
        val pad = sheet.pad
        val high = sheet.high
        sheet.add(Mark.Box(rect, 0.0, Role.Surface, Role.Border))
        sheet.texts(listOf(id), rect.x + rect.w / 2, rect.y + pad, Role.Text, bold = true)
        var top = rect.y + high + pad * 2
        val typeW = rows.maxOfOrNull { sheet.width(it.type) } ?: 0.0
        for (row in rows) {
            sheet.add(Mark.Edge(listOf(Pt(rect.x, top), Pt(rect.x + rect.w, top)), Role.Border))
            val mid = top + (high + pad) / 2
            sheet.add(Mark.Text(row.type, Pt(rect.x + pad, mid), Anchor.Left, Role.Muted))
            sheet.add(Mark.Text(name(row), Pt(rect.x + pad * 2 + typeW, mid), Anchor.Left, Role.Text))
            top += high + pad
        }
    }

    private fun name(row: Attr) = if (row.keys.isEmpty()) row.name else "${row.name} ${row.keys}"

    private data class Attr(val type: String, val name: String, val keys: String)

    private data class ERel(
        val from: String,
        val to: String,
        val tail: Head,
        val head: Head,
        val dashed: Boolean,
        val label: String,
    )

    private companion object {
        /** `A ||--o{ B : label` — the crow's-foot glyphs contain braces, so tokenizers cannot split this. */
        val REL = Regex("""^("[^"]*"|\S+)\s+([|o{}]{1,2})(-{2}|\.{2})([|o{}]{1,2})\s+("[^"]*"|\S+)\s*(?::\s*(.+))?$""")

        /** `}o` and friends collapse to the strongest glyph on that side. */
        fun head(glyph: String) = when {
            glyph.contains('{') || glyph.contains('}') -> Head.Crow
            glyph.contains('o') -> Head.CircleOpen
            else -> Head.Bar
        }
    }
}
