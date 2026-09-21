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
 * C4 engine covering all five headers with one boxes-and-relations renderer. Styling and layout
 * statements (`UpdateElementStyle`, `LAYOUT_*`, ...) are parsed and discarded.
 */
internal class C4Dg(private val measure: Measure, private val spec: Spec) {
    private val scopes = Scopes()
    private val cells = linkedMapOf<String, Cell>()
    private val bounds = linkedMapOf<String, String>()
    private val members = linkedMapOf<String, MutableList<String>>()
    private val rels = linkedMapOf<String, MutableList<CRel>>()
    private val stack = ArrayDeque<String>()
    private var title = ""

    suspend fun draw(clean: Clean): Out {
        members[Scopes.ROOT] = mutableListOf()
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                if (text.substringBefore(' ').trimEnd(':').lowercase().startsWith("c4")) continue
            }
            val err = stmt(text)
            if (err != null) return Out.Err(Fault.Syntax, err, line.at)
            if (cells.size > spec.limits.nodes) return Out.Err(Fault.Limit, "C4 diagram exceeds ${spec.limits.nodes} elements")
            if (rels.values.sumOf { it.size } > spec.limits.edges) {
                return Out.Err(Fault.Limit, "C4 diagram exceeds ${spec.limits.edges} relations")
            }
        }
        if (stack.isNotEmpty()) return Out.Err(Fault.Syntax, "boundary is missing a closing brace", clean.lines.lastOrNull()?.at ?: 1)
        if (cells.isEmpty()) return Out.Err(Fault.Syntax, "C4 diagram has no elements", 1)
        val sheet = Sheet(measure, spec)
        var top = 0.0
        if (title.isNotEmpty()) top = sheet.texts(listOf(title), 0.0, 0.0, Role.Text, bold = true) + sheet.pad
        val part = scope(Scopes.ROOT, sheet)
        for (mark in part.marks) sheet.add(moved(mark, 0.0, top))
        return Out.Ok(sheet.scene(Type.C4))
    }

    private fun stmt(text: String): String? {
        if (text == "}") {
            if (stack.isEmpty()) return "unexpected closing brace"
            stack.removeLast()
            return null
        }
        val word = text.substringBefore('(').substringBefore(' ').trim()
        val lower = word.lowercase()
        if (lower == "title") {
            title = text.substringAfter(' ', "").trim()
            return null
        }
        val body = Lex.call(text.removeSuffix("{").trim())
        if (lower.endsWith("_boundary") || lower == "boundary") {
            if (body == null) return "malformed boundary statement"
            val args = Lex.args(body).map { Source.unquote(it) }
            val id = args.firstOrNull().orEmpty()
            if (id.isEmpty()) return "boundary needs an id"
            // A repeated id would make the boundary a member of itself; the recursive layout below has
            // no cycle check and would fail with a StackOverflowError, which never becomes an Out.Err.
            if (bounds.containsKey(id) || cells.containsKey(id)) return "duplicate boundary id $id"
            val here = stack.lastOrNull() ?: Scopes.ROOT
            if (!scopes.open(id, here)) return "boundary $id cannot be nested inside itself"
            bounds[id] = args.getOrNull(1) ?: id
            members.getValue(here).add(id)
            members.getOrPut(id) { mutableListOf() }
            stack.addLast(id)
            return null
        }
        if (lower.startsWith("rel") || lower.startsWith("birel")) {
            if (body == null) return "malformed relation statement"
            val args = Lex.args(body).map { Source.unquote(it) }
            if (args.size < 2) return "relation needs two elements"
            val back = lower == "rel_back"
            val from = if (back) args[1] else args[0]
            val to = if (back) args[0] else args[1]
            if (!scopes.has(from) || !scopes.has(to)) return null
            val hop = scopes.resolve(from, to)
            rels.getOrPut(hop.scope) { mutableListOf() }
                .add(CRel(hop.from, hop.to, args.getOrNull(2).orEmpty(), args.getOrNull(3).orEmpty(), both = lower.startsWith("birel")))
            return null
        }
        val kind = KINDS[lower] ?: return null
        if (body == null) return "malformed $word statement"
        val args = Lex.args(body).map { Source.unquote(it) }
        val id = args.firstOrNull().orEmpty()
        if (id.isEmpty()) return "$word needs an alias"
        if (cells.containsKey(id) || bounds.containsKey(id)) return "duplicate element id $id"
        val here = stack.lastOrNull() ?: Scopes.ROOT
        val label = args.getOrNull(1) ?: id
        val tech = if (kind.tech) args.getOrNull(2).orEmpty() else ""
        val descr = (if (kind.tech) args.getOrNull(3) else args.getOrNull(2)).orEmpty()
        cells[id] = Cell(id, label, tech, descr, kind)
        scopes.claim(id, here)
        members.getValue(here).add(id)
        return null
    }

    private suspend fun scope(id: String, sheet: Sheet): Part {
        coroutineContext.ensureActive()
        val pad = sheet.pad
        val high = sheet.high
        val parts = linkedMapOf<String, Part>()
        val sizes = linkedMapOf<String, Size>()
        val texts = linkedMapOf<String, List<Mark.Text>>()
        for (node in members.getValue(id)) {
            val cell = cells[node]
            if (cell == null) {
                val inner = scope(node, sheet)
                val label = bounds.getValue(node)
                val wide = maxOf(inner.size.w + pad * 2, sheet.width(label, bold = true) + pad * 2)
                parts[node] = inner
                sizes[node] = Size(wide, inner.size.h + high + pad * 3)
                continue
            }
            val room = maxOf(sheet.width(cell.label, bold = true), high * 12)
            val lines = mutableListOf(Line(cell.label, Role.Text, true))
            if (cell.tech.isNotEmpty()) lines.add(Line("[${cell.tech}]", Role.Muted, false))
            for (row in sheet.wrap(cell.descr, room)) lines.add(Line(row, Role.Muted, false))
            texts[node] = lines.mapIndexed { idx, line ->
                Mark.Text(line.text, Pt(0.0, high * (idx + 0.5)), Anchor.Center, line.role, line.bold)
            }
            val wide = lines.maxOf { sheet.width(it.text, it.bold) } + pad * 2
            val head = if (cell.kind.person) high else 0.0
            sizes[node] = Size(wide, head + high * lines.size + pad * 2)
        }
        val plan = Layered(spec).run(sizes, rels[id].orEmpty().map { Rail(it.from, it.to) })
        val marks = mutableListOf<Mark>()
        for (rel in rels[id].orEmpty()) {
            val ends = joint(plan.rects.getValue(rel.from), plan.rects.getValue(rel.to))
            marks.add(Mark.Edge(listOf(ends.first, ends.second), Role.Line, dash = true, head = Head.Arrow, tail = if (rel.both) Head.Arrow else Head.None))
            val mid = Pt((ends.first.x + ends.second.x) / 2, (ends.first.y + ends.second.y) / 2)
            val lines = listOfNotNull(rel.label.ifEmpty { null }, rel.tech.ifEmpty { null }?.let { "[$it]" })
            lines.forEachIndexed { idx, text ->
                marks.add(Mark.Text(text, Pt(mid.x, mid.y - high * (lines.size - idx - 0.5) - 2), Anchor.Center, Role.Muted))
            }
        }
        for (node in members.getValue(id)) {
            val rect = plan.rects.getValue(node)
            val cell = cells[node]
            if (cell == null) {
                marks.add(Mark.Box(rect, spec.metrics.arc, null, Role.Cluster, dash = true))
                marks.add(Mark.Text(bounds.getValue(node), Pt(rect.x + pad, rect.y + pad + high * 0.5), Anchor.Left, Role.Muted, true))
                val inner = parts.getValue(node)
                val dx = rect.x + (rect.w - inner.size.w) / 2
                for (mark in inner.marks) marks.add(moved(mark, dx, rect.y + high + pad * 2))
                continue
            }
            val head = if (cell.kind.person) high else 0.0
            val body = Rect(rect.x, rect.y + head, rect.w, rect.h - head)
            if (cell.kind.person) {
                // The head touches the body edge exactly; overlapping surfaces would break layout invariants.
                marks.add(Mark.Oval(Rect(rect.x + rect.w / 2 - high / 2, rect.y, high, high), Role.Surface, Role.Border))
            }
            marks.add(Mark.Box(body, spec.metrics.arc * (if (cell.kind.round) 3 else 1), Role.Surface, Role.Border, dash = cell.kind.ext))
            for (text in texts.getValue(node)) {
                marks.add(text.copy(at = Pt(body.x + body.w / 2, body.y + pad + text.at.y)))
            }
        }
        return Part(marks, plan.size)
    }

    private data class Part(val marks: List<Mark>, val size: Size)

    private data class Cell(val id: String, val label: String, val tech: String, val descr: String, val kind: Kind)

    private data class CRel(val from: String, val to: String, val label: String, val tech: String, val both: Boolean)

    private data class Line(val text: String, val role: Role, val bold: Boolean)

    /** [tech] marks kinds whose third argument is a technology rather than a description. */
    private data class Kind(val person: Boolean = false, val ext: Boolean = false, val tech: Boolean = false, val round: Boolean = false)

    private companion object {
        val KINDS = buildMap {
            put("person", Kind(person = true))
            put("person_ext", Kind(person = true, ext = true))
            put("system", Kind())
            put("system_ext", Kind(ext = true))
            put("systemdb", Kind(round = true))
            put("systemdb_ext", Kind(round = true, ext = true))
            put("systemqueue", Kind(round = true))
            put("systemqueue_ext", Kind(round = true, ext = true))
            for (base in listOf("container", "component")) {
                put(base, Kind(tech = true))
                put("${base}_ext", Kind(tech = true, ext = true))
                put("${base}db", Kind(tech = true, round = true))
                put("${base}db_ext", Kind(tech = true, round = true, ext = true))
                put("${base}queue", Kind(tech = true, round = true))
                put("${base}queue_ext", Kind(tech = true, round = true, ext = true))
            }
            put("node", Kind(tech = true))
            put("node_l", Kind(tech = true))
            put("node_r", Kind(tech = true))
            put("deployment_node", Kind(tech = true))
        }
    }
}
