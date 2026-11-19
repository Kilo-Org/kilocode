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
 * State diagram engine. Composite states lay out recursively: an inner scope becomes one node of its
 * parent scope, and transitions crossing a composite boundary re-anchor at the composite frame.
 */
internal class StateDg(private val measure: Measure, private val spec: Spec) {
    private val scopes = Scopes()
    private val labels = linkedMapOf<String, List<String>>()
    private val kinds = linkedMapOf<String, Kind>()
    private val members = linkedMapOf<String, MutableList<String>>()
    private val moves = linkedMapOf<String, MutableList<Move>>()
    private val stack = ArrayDeque<String>()
    private var noting = false
    private var count = 0

    suspend fun draw(clean: Clean): Out {
        members[Scopes.ROOT] = mutableListOf()
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                val token = text.substringBefore(' ').lowercase()
                if (token == "statediagram" || token == "statediagram-v2") continue
            }
            if (noting) {
                if (text.lowercase() == "end note") noting = false
                continue
            }
            val err = stmt(text)
            if (err != null) return Out.Err(Fault.Syntax, err, line.at)
            if (count > spec.limits.nodes) return Out.Err(Fault.Limit, "state diagram exceeds ${spec.limits.nodes} states")
            if (moves.values.sumOf { it.size } > spec.limits.edges) {
                return Out.Err(Fault.Limit, "state diagram exceeds ${spec.limits.edges} transitions")
            }
        }
        if (stack.isNotEmpty()) return Out.Err(Fault.Syntax, "state block is missing a closing brace", clean.lines.lastOrNull()?.at ?: 1)
        if (count == 0) return Out.Err(Fault.Syntax, "state diagram has no states", 1)
        val sheet = Sheet(measure, spec)
        val part = scope(Scopes.ROOT, sheet)
        for (mark in part.marks) sheet.add(mark)
        return Out.Ok(sheet.scene(Type.State))
    }

    private fun stmt(text: String): String? {
        val token = text.substringBefore(' ').lowercase()
        if (token in SKIP) return null
        if (token == "note") {
            if (!text.contains(':')) noting = true
            return null
        }
        if (text == "}") {
            if (stack.isEmpty()) return "unexpected closing brace"
            stack.removeLast()
            return null
        }
        if (token == "state") return define(text)
        val arrow = text.indexOf("-->")
        if (arrow < 0) return null
        val from = claim(text.substring(0, arrow).trim(), source = true) ?: return "transition needs a source state"
        val rest = text.substring(arrow + 3)
        val colon = rest.indexOf(':')
        val target = (if (colon < 0) rest else rest.substring(0, colon)).trim()
        val to = claim(target, source = false) ?: return "transition needs a target state"
        val label = if (colon < 0) emptyList() else Source.label(rest.substring(colon + 1))
        val hop = scopes.resolve(from, to)
        moves.getOrPut(hop.scope) { mutableListOf() }.add(Move(hop.from, hop.to, label))
        return null
    }

    /** `state "long name" as id`, `state Name {`, or a bare `state Name`. */
    private fun define(text: String): String? {
        val rest = text.substringAfter(' ', "").trim()
        if (rest.isEmpty()) return "state needs a name"
        val opens = rest.endsWith("{")
        val body = rest.removeSuffix("{").trim()
        val alias = AS.find(body)
        if (alias != null) {
            val id = body.substring(alias.range.last + 1).trim()
            if (id.isEmpty()) return "state alias needs an id"
            claim(id, source = true)
            labels[id] = Source.label(body.substring(0, alias.range.first))
            return null
        }
        if (body.isEmpty()) return "state needs a name"
        if (!opens) {
            claim(body, source = true)
            return null
        }
        val here = stack.lastOrNull() ?: Scopes.ROOT
        if (!scopes.open(body, here)) return "state $body cannot be nested inside itself"
        if (kinds[body] == null) {
            count++
            members.getValue(here).add(body)
        }
        kinds[body] = Kind.Composite
        labels[body] = Source.label(body)
        members.getOrPut(body) { mutableListOf() }
        stack.addLast(body)
        return null
    }

    /** Registers a plain state on first mention; `[*]` maps to a per-scope start or end marker. */
    private fun claim(name: String, source: Boolean): String? {
        val text = name.trim()
        if (text.isEmpty()) return null
        val here = stack.lastOrNull() ?: Scopes.ROOT
        val id = if (text == "[*]") "$here/${if (source) "#start" else "#end"}" else text
        if (kinds[id] == null && !scopes.has(id)) {
            count++
            kinds[id] = when {
                id.endsWith("#start") -> Kind.Start
                id.endsWith("#end") -> Kind.End
                else -> Kind.Plain
            }
            labels[id] = Source.label(Source.unquote(id))
            scopes.claim(id, here)
            members.getValue(here).add(id)
        }
        return id
    }

    /** Lays out one scope; returned marks are in local coordinates with the origin at the top left. */
    private suspend fun scope(id: String, sheet: Sheet): Part {
        coroutineContext.ensureActive()
        val pad = sheet.pad
        val high = sheet.high
        val dot = pad * 1.5
        val parts = linkedMapOf<String, Part>()
        val sizes = linkedMapOf<String, Size>()
        for (node in members.getValue(id)) {
            when (kinds[node]) {
                Kind.Composite -> {
                    val inner = scope(node, sheet)
                    val title = labels.getValue(node)
                    val wide = maxOf(inner.size.w + pad * 2, sheet.widest(title, bold = true) + pad * 2)
                    parts[node] = inner
                    sizes[node] = Size(wide, inner.size.h + high * title.size + pad * 3)
                }
                Kind.Start, Kind.End -> sizes[node] = Size(dot, dot)
                else -> {
                    val label = labels.getValue(node)
                    sizes[node] = Size(sheet.widest(label) + pad * 2, high * label.size + pad * 2)
                }
            }
        }
        val rails = moves[id].orEmpty().map { Rail(it.from, it.to) }
        val plan = Layered(spec).run(sizes, rails)
        val marks = mutableListOf<Mark>()
        for (move in moves[id].orEmpty()) {
            val ends = joint(plan.rects.getValue(move.from), plan.rects.getValue(move.to))
            marks.add(Mark.Edge(listOf(ends.first, ends.second), Role.Line, head = Head.Arrow))
            if (move.label.isNotEmpty()) {
                val mid = Pt((ends.first.x + ends.second.x) / 2, (ends.first.y + ends.second.y) / 2)
                move.label.forEachIndexed { idx, label ->
                    marks.add(Mark.Text(label, Pt(mid.x + pad, mid.y - high * (move.label.size - idx - 0.5)), Anchor.Left, Role.Muted))
                }
            }
        }
        for (node in members.getValue(id)) {
            val rect = plan.rects.getValue(node)
            when (kinds[node]) {
                Kind.Composite -> {
                    val title = labels.getValue(node)
                    marks.add(Mark.Box(rect, spec.metrics.arc, null, Role.Border))
                    var top = rect.y + pad
                    title.forEachIndexed { idx, text ->
                        marks.add(Mark.Text(text, Pt(rect.x + rect.w / 2, top + high * (idx + 0.5)), Anchor.Center, Role.Text, true))
                    }
                    top += high * title.size + pad
                    marks.add(Mark.Edge(listOf(Pt(rect.x, top), Pt(rect.x + rect.w, top)), Role.Border))
                    val inner = parts.getValue(node)
                    val dx = rect.x + (rect.w - inner.size.w) / 2
                    for (mark in inner.marks) marks.add(moved(mark, dx, top + pad))
                }
                Kind.Start -> marks.add(Mark.Oval(rect, Role.Line, null))
                Kind.End -> {
                    marks.add(Mark.Oval(rect, null, Role.Line))
                    val inset = rect.w / 4
                    marks.add(Mark.Oval(Rect(rect.x + inset, rect.y + inset, rect.w - inset * 2, rect.h - inset * 2), Role.Line, null))
                }
                else -> {
                    marks.add(Mark.Box(rect, spec.metrics.arc * 2, Role.Surface, Role.Border))
                    val label = labels.getValue(node)
                    label.forEachIndexed { idx, text ->
                        val top = rect.y + (rect.h - high * label.size) / 2
                        marks.add(Mark.Text(text, Pt(rect.x + rect.w / 2, top + high * (idx + 0.5)), Anchor.Center, Role.Text))
                    }
                }
            }
        }
        return Part(marks, plan.size)
    }

    private data class Part(val marks: List<Mark>, val size: Size)

    private data class Move(val from: String, val to: String, val label: List<String>)

    private enum class Kind { Plain, Start, End, Composite }

    private companion object {
        val SKIP = setOf("direction", "classdef", "class", "style", "accdescr", "acctitle", "hide", "%%")
        val AS = Regex("""\s+as\s+""", RegexOption.IGNORE_CASE)
    }
}
