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
import ai.kilocode.client.ui.diagram.Scene
import ai.kilocode.client.ui.diagram.Size
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.diagram.Type
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive

/**
 * Class diagram engine: `class X { members }` compartment boxes plus UML relations. Unknown
 * statements are skipped, matching [Flow] and [Seq].
 */
internal class ClassDg(private val measure: Measure, private val spec: Spec) {
    private val classes = linkedMapOf<String, Cls>()
    private val rels = mutableListOf<CRel>()
    private var block: String? = null

    suspend fun draw(clean: Clean): Out {
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                val token = text.substringBefore(' ').lowercase()
                if (token == "classdiagram" || token == "classdiagram-v2") continue
            }
            val err = stmt(text)
            if (err != null) return Out.Err(Fault.Syntax, err, line.at)
            if (classes.size > spec.limits.nodes) return Out.Err(Fault.Limit, "class diagram exceeds ${spec.limits.nodes} classes")
            if (rels.size > spec.limits.edges) return Out.Err(Fault.Limit, "class diagram exceeds ${spec.limits.edges} relations")
        }
        if (block != null) return Out.Err(Fault.Syntax, "class block is missing a closing brace", clean.lines.lastOrNull()?.at ?: 1)
        if (classes.isEmpty()) return Out.Err(Fault.Syntax, "class diagram has no classes", 1)
        return Out.Ok(marks())
    }

    private fun stmt(text: String): String? {
        val open = block
        if (open != null) {
            if (text == "}") {
                block = null
                return null
            }
            member(open, text.removeSuffix("}").trim())
            if (text.endsWith("}")) block = null
            return null
        }
        val token = text.substringBefore(' ').lowercase()
        if (token in SKIP) return null
        if (token == "class") return define(text)
        relation(text)?.let {
            rels.add(it)
            return null
        }
        // `Name : +member` assigns one member outside a block.
        val colon = text.indexOf(':')
        if (colon > 0 && !text.startsWith("<<")) {
            val id = text.substring(0, colon).trim()
            if (id.isNotEmpty() && id.none { it.isWhitespace() }) {
                member(claim(id).id, text.substring(colon + 1).trim())
            }
        }
        return null
    }

    private fun define(text: String): String? {
        val rest = text.substringAfter(' ', "").trim()
        if (rest.isEmpty()) return "class needs a name"
        val body = rest.removeSuffix("{").trim()
        val tag = Lex.tagged(body) ?: return "malformed class name $body"
        val cls = claim(tag.first)
        if (tag.second != tag.first) classes[cls.id] = cls.copy(label = tag.second)
        if (rest.endsWith("{")) block = tag.first
        return null
    }

    private fun member(id: String, text: String) {
        if (text.isEmpty()) return
        val cls = claim(id)
        if (text.startsWith("<<") && text.endsWith(">>")) {
            classes[id] = cls.copy(note = text.removeSurrounding("<<", ">>").trim())
            return
        }
        if (text.contains('(')) {
            cls.ops.add(text)
            return
        }
        cls.attrs.add(text)
    }

    private fun claim(id: String): Cls = classes.getOrPut(id) { Cls(id, id, null, mutableListOf(), mutableListOf()) }

    private fun relation(text: String): CRel? {
        val tokens = Lex.tokens(text)
        val op = tokens.withIndex().firstOrNull { REL.matches(it.value.text) } ?: return null
        val idx = op.index
        if (idx == 0 || idx == tokens.lastIndex) return null
        val match = REL.find(op.value.text) ?: return null
        val fromCard = if (idx >= 2 && tokens[idx - 1].text.startsWith("\"")) Source.unquote(tokens[idx - 1].text) else ""
        val from = tokens[0].text
        val next = tokens[idx + 1].text
        val toCard = if (next.startsWith("\"")) Source.unquote(next) else ""
        val toTok = if (toCard.isEmpty()) tokens[idx + 1] else tokens.getOrNull(idx + 2) ?: return null
        val to = toTok.text.substringBefore(':')
        if (to.isEmpty()) return null
        val colon = text.indexOf(':', toTok.at)
        val label = if (colon < 0) emptyList() else Source.label(text.substring(colon + 1))
        claim(from)
        claim(to)
        return CRel(
            from,
            to,
            tail = mark(match.groupValues[1]),
            head = mark(match.groupValues[3]),
            dashed = match.groupValues[2].startsWith("."),
            fromCard = fromCard,
            toCard = toCard,
            label = label,
        )
    }

    private suspend fun marks(): Scene {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val pad = sheet.pad
        val sizes = linkedMapOf<String, Size>()
        for (cls in classes.values) {
            coroutineContext.ensureActive()
            val wide = maxOf(
                sheet.width(cls.label, bold = true),
                cls.note?.let { sheet.width("«$it»") } ?: 0.0,
                sheet.widest(cls.attrs),
                sheet.widest(cls.ops),
            ) + pad * 2
            val title = high * (if (cls.note == null) 1 else 2) + pad * 2
            val attrs = if (cls.attrs.isEmpty() && cls.ops.isEmpty()) 0.0 else high * cls.attrs.size + pad
            val ops = if (cls.attrs.isEmpty() && cls.ops.isEmpty()) 0.0 else high * cls.ops.size + pad
            sizes[cls.id] = Size(wide, title + attrs + ops)
        }
        val rails = rels.map { rail(it) }
        val plan = Layered(spec).run(sizes, rails)

        for (rel in rels) {
            coroutineContext.ensureActive()
            val ends = joint(plan.rects.getValue(rel.from), plan.rects.getValue(rel.to))
            sheet.add(Mark.Edge(listOf(ends.first, ends.second), Role.Line, dash = rel.dashed, head = rel.head, tail = rel.tail))
            cards(sheet, rel, ends.first, ends.second)
            if (rel.label.isNotEmpty()) {
                val mid = Pt((ends.first.x + ends.second.x) / 2, (ends.first.y + ends.second.y) / 2)
                sheet.texts(rel.label, mid.x, mid.y - high * rel.label.size - 2, Role.Muted)
            }
        }
        for (cls in classes.values) {
            coroutineContext.ensureActive()
            box(sheet, cls, plan.rects.getValue(cls.id))
        }
        return sheet.scene(Type.Class)
    }

    /** For ranking, the parent side of a triangle or diamond goes on top. */
    private fun rail(rel: CRel): Rail {
        if (rel.head == Head.Triangle || rel.head == Head.Diamond || rel.head == Head.DiamondFilled) {
            return Rail(rel.to, rel.from)
        }
        return Rail(rel.from, rel.to)
    }

    private fun cards(sheet: Sheet, rel: CRel, from: Pt, to: Pt) {
        if (rel.fromCard.isNotEmpty()) card(sheet, rel.fromCard, from, to)
        if (rel.toCard.isNotEmpty()) card(sheet, rel.toCard, to, from)
    }

    private fun card(sheet: Sheet, text: String, near: Pt, far: Pt) {
        val at = Pt(near.x + (far.x - near.x) * 0.18, near.y + (far.y - near.y) * 0.18)
        sheet.add(Mark.Text(text, Pt(at.x + sheet.pad, at.y), Anchor.Left, Role.Muted))
    }

    private fun box(sheet: Sheet, cls: Cls, rect: Rect) {
        val high = sheet.high
        val pad = sheet.pad
        sheet.add(Mark.Box(rect, spec.metrics.arc, Role.Surface, Role.Border))
        var top = rect.y + pad
        cls.note?.let { top += sheet.texts(listOf("«$it»"), rect.x + rect.w / 2, top, Role.Muted) }
        top += sheet.texts(listOf(cls.label), rect.x + rect.w / 2, top, Role.Text, bold = true)
        top += pad
        if (cls.attrs.isEmpty() && cls.ops.isEmpty()) return
        sheet.add(Mark.Edge(listOf(Pt(rect.x, top), Pt(rect.x + rect.w, top)), Role.Border))
        top += pad / 2
        for (attr in cls.attrs) {
            sheet.add(Mark.Text(attr, Pt(rect.x + pad, top + high * 0.5), Anchor.Left, Role.Text))
            top += high
        }
        top += pad / 2
        sheet.add(Mark.Edge(listOf(Pt(rect.x, top), Pt(rect.x + rect.w, top)), Role.Border))
        top += pad / 2
        for (op in cls.ops) {
            sheet.add(Mark.Text(op, Pt(rect.x + pad, top + high * 0.5), Anchor.Left, Role.Text))
            top += high
        }
    }

    private data class Cls(
        val id: String,
        val label: String,
        val note: String?,
        val attrs: MutableList<String>,
        val ops: MutableList<String>,
    )

    private data class CRel(
        val from: String,
        val to: String,
        val tail: Head,
        val head: Head,
        val dashed: Boolean,
        val fromCard: String,
        val toCard: String,
        val label: List<String>,
    )

    private companion object {
        val SKIP = setOf("direction", "note", "style", "classdef", "cssclass", "click", "callback", "link", "namespace", "accdescr", "acctitle")

        val REL = Regex("""^(<\||o|\*|<)?(-{2,}|\.{2,})(\|>|o|\*|>)?$""")

        fun mark(glyph: String) = when (glyph) {
            "<|", "|>" -> Head.Triangle
            "o" -> Head.Diamond
            "*" -> Head.DiamondFilled
            "<", ">" -> Head.Arrow
            else -> Head.None
        }
    }
}
