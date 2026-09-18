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

/** Requirement diagram engine: requirement/element blocks with key-value fields plus labeled relations. */
internal class ReqDg(private val measure: Measure, private val spec: Spec) {
    private val boxes = linkedMapOf<String, Req>()
    private val rels = mutableListOf<RRel>()
    private var block: String? = null

    suspend fun draw(clean: Clean): Out {
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                if (text.substringBefore(' ').lowercase() == "requirementdiagram") continue
            }
            val err = stmt(text)
            if (err != null) return Out.Err(Fault.Syntax, err, line.at)
            if (boxes.size > spec.limits.nodes) return Out.Err(Fault.Limit, "requirement diagram exceeds ${spec.limits.nodes} nodes")
            if (rels.size > spec.limits.edges) return Out.Err(Fault.Limit, "requirement diagram exceeds ${spec.limits.edges} relations")
        }
        if (block != null) return Out.Err(Fault.Syntax, "block is missing a closing brace", clean.lines.lastOrNull()?.at ?: 1)
        if (boxes.isEmpty()) return Out.Err(Fault.Syntax, "requirement diagram has no requirements", 1)
        return marks()
    }

    private fun stmt(text: String): String? {
        val open = block
        if (open != null) {
            if (text == "}") {
                block = null
                return null
            }
            field(open, text.removeSuffix("}").trim())
            if (text.endsWith("}")) block = null
            return null
        }
        val token = text.substringBefore(' ')
        val kind = KINDS[token.lowercase()]
        if (kind != null) {
            val rest = text.substringAfter(' ', "").trim()
            val id = rest.removeSuffix("{").trim()
            if (id.isEmpty()) return "$token needs a name"
            boxes[id] = Req(id, kind, linkedMapOf())
            if (rest.endsWith("{")) block = id
            return null
        }
        val match = REL.find(text) ?: return null
        val back = match.groupValues[2] == "<-"
        val from = if (back) match.groupValues[5] else match.groupValues[1]
        val to = if (back) match.groupValues[1] else match.groupValues[5]
        boxes.getOrPut(from) { Req(from, "element", linkedMapOf()) }
        boxes.getOrPut(to) { Req(to, "element", linkedMapOf()) }
        rels.add(RRel(from, to, match.groupValues[3]))
        return null
    }

    private fun field(id: String, text: String) {
        if (text.isEmpty()) return
        val colon = text.indexOf(':')
        if (colon <= 0) return
        val key = text.substring(0, colon).trim().lowercase()
        boxes.getValue(id).fields[key] = Source.unquote(text.substring(colon + 1).trim())
    }

    private suspend fun marks(): Out.Ok {
        val sheet = Sheet(measure, spec)
        val pad = sheet.pad
        val high = sheet.high
        val sizes = linkedMapOf<String, Size>()
        val lines = linkedMapOf<String, List<String>>()
        for (req in boxes.values) {
            coroutineContext.ensureActive()
            val room = maxOf(sheet.width(req.id, bold = true), high * 18)
            val rows = req.fields.flatMap { (key, value) -> sheet.wrap("$key: $value", room) }
            lines[req.id] = rows
            val wide = maxOf(
                sheet.width("«${req.kind}»"),
                sheet.width(req.id, bold = true),
                rows.maxOfOrNull { sheet.width(it) } ?: 0.0,
            ) + pad * 2
            val tall = high * (2 + rows.size) + pad * 3 + (if (rows.isEmpty()) 0.0 else pad)
            sizes[req.id] = Size(wide, tall)
        }
        val plan = Layered(spec).run(sizes, rels.map { Rail(it.from, it.to) })
        for (rel in rels) {
            coroutineContext.ensureActive()
            val ends = joint(plan.rects.getValue(rel.from), plan.rects.getValue(rel.to))
            sheet.add(Mark.Edge(listOf(ends.first, ends.second), Role.Line, dash = true, head = Head.Arrow))
            val mid = Pt((ends.first.x + ends.second.x) / 2, (ends.first.y + ends.second.y) / 2)
            sheet.texts(listOf("«${rel.label}»"), mid.x, mid.y - high, Role.Muted)
        }
        for (req in boxes.values) {
            coroutineContext.ensureActive()
            val rect = plan.rects.getValue(req.id)
            sheet.add(Mark.Box(rect, spec.metrics.arc, Role.Surface, Role.Border))
            var top = rect.y + pad
            top += sheet.texts(listOf("«${req.kind}»"), rect.x + rect.w / 2, top, Role.Muted)
            top += sheet.texts(listOf(req.id), rect.x + rect.w / 2, top, Role.Text, bold = true)
            val rows = lines.getValue(req.id)
            if (rows.isEmpty()) continue
            top += pad
            sheet.add(Mark.Edge(listOf(Pt(rect.x, top), Pt(rect.x + rect.w, top)), Role.Border))
            top += pad
            for (row in rows) {
                sheet.add(Mark.Text(row, Pt(rect.x + pad, top + high * 0.5), Anchor.Left, Role.Text))
                top += high
            }
        }
        return Out.Ok(sheet.scene(Type.Requirement))
    }

    private data class Req(val id: String, val kind: String, val fields: LinkedHashMap<String, String>)

    private data class RRel(val from: String, val to: String, val label: String)

    private companion object {
        val KINDS = mapOf(
            "requirement" to "requirement",
            "functionalrequirement" to "functionalRequirement",
            "interfacerequirement" to "interfaceRequirement",
            "performancerequirement" to "performanceRequirement",
            "physicalrequirement" to "physicalRequirement",
            "designconstraint" to "designConstraint",
            "element" to "element",
        )

        /** `a - satisfies -> b` and the reversed `a <- satisfies - b`. */
        val REL = Regex("""^(\S+)\s+(<-|-)\s*(\w+)\s*(->|-)\s+(\S+)$""")
    }
}
