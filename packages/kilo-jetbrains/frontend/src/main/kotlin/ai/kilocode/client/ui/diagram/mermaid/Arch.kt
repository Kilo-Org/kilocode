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
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.diagram.Type
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive

/**
 * Architecture engine. Services land on an integer grid: the first service anchors at the origin and
 * every edge's side pair (`db:L -- R:server`) pulls its unplaced peer next to a placed one. Icons are
 * simple glyphs drawn from existing primitives.
 */
internal class Arch(private val measure: Measure, private val spec: Spec) {
    private val services = linkedMapOf<String, Service>()
    private val groups = linkedMapOf<String, Group>()
    private val edges = mutableListOf<Edge>()

    suspend fun draw(clean: Clean): Out {
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                val token = text.substringBefore(' ').lowercase()
                if (token == "architecture-beta" || token == "architecture") continue
            }
            val err = stmt(text)
            if (err != null) return Out.Err(Fault.Syntax, err, line.at)
            if (services.size > spec.limits.nodes) return Out.Err(Fault.Limit, "architecture exceeds ${spec.limits.nodes} services")
            if (edges.size > spec.limits.edges) return Out.Err(Fault.Limit, "architecture exceeds ${spec.limits.edges} edges")
        }
        if (services.isEmpty()) return Out.Err(Fault.Syntax, "architecture has no services", 1)
        return Out.Ok(marks())
    }

    private fun stmt(text: String): String? {
        val token = text.substringBefore(' ').lowercase()
        val rest = text.substringAfter(' ', "").trim()
        when (token) {
            "group" -> {
                val part = part(rest) ?: return "malformed group"
                groups[part.id] = Group(part.id, part.label, member(rest))
                return null
            }
            "service" -> {
                val part = part(rest) ?: return "malformed service"
                services[part.id] = Service(part.id, part.label, part.icon, member(rest))
                return null
            }
            "junction" -> {
                val id = rest.substringBefore(' ').trim()
                if (id.isEmpty()) return "junction needs an id"
                services[id] = Service(id, "", "", member(rest))
                return null
            }
            "accdescr", "acctitle" -> return null
            else -> {
                val match = EDGE.find(text) ?: return null
                if (!services.containsKey(match.groupValues[1]) || !services.containsKey(match.groupValues[6])) {
                    return "edge references an unknown service"
                }
                edges.add(
                    Edge(
                        match.groupValues[1],
                        match.groupValues[6],
                        side(match.groupValues[2]),
                        side(match.groupValues[5]),
                        into = match.groupValues[4].isNotEmpty(),
                        back = match.groupValues[3].isNotEmpty(),
                    ),
                )
                return null
            }
        }
    }

    /** `id(icon)[Label]` — icon and label both optional. */
    private fun part(text: String): Part? {
        val head = text.substringBefore(" in ").trim()
        val icon = Regex("""^(\w+)\(([\w-]+)\)""").find(head)
        val id = icon?.groupValues?.get(1) ?: Regex("""^(\w+)""").find(head)?.groupValues?.get(1) ?: return null
        val label = Regex("""\[(.*)]""").find(head)?.groupValues?.get(1)?.let { Source.unquote(it) } ?: id
        return Part(id, icon?.groupValues?.get(2).orEmpty(), label)
    }

    private fun member(text: String): String {
        val at = text.indexOf(" in ")
        if (at < 0) return ""
        return text.substring(at + 4).trim().substringBefore(' ')
    }

    private fun side(text: String) = when (text.uppercase()) {
        "L" -> Side.Left
        "R" -> Side.Right
        "T" -> Side.Top
        else -> Side.Bottom
    }

    private suspend fun marks(): Scene {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val pad = sheet.pad
        val spots = linkedMapOf<String, Pair<Int, Int>>()
        val taken = mutableSetOf<Pair<Int, Int>>()

        fun place(id: String, spot: Pair<Int, Int>) {
            var at = spot
            while (at in taken) at = at.first + 1 to at.second
            spots[id] = at
            taken.add(at)
        }

        place(services.keys.first(), 0 to 0)
        var pass = 0
        while (pass++ < services.size) {
            var moved = false
            for (edge in edges) {
                val from = spots[edge.from]
                val to = spots[edge.to]
                if (from != null && to == null) {
                    place(edge.to, from.shift(edge.fromSide))
                    moved = true
                }
                if (from == null && to != null) {
                    place(edge.from, to.shift(edge.toSide))
                    moved = true
                }
            }
            if (!moved) break
        }
        coroutineContext.ensureActive()
        for (id in services.keys) {
            if (spots.containsKey(id)) continue
            place(id, (taken.maxOfOrNull { it.first } ?: 0) + 1 to 0)
        }

        val cellW = services.values.maxOf { maxOf(sheet.width(it.label), high * 3) } + sheet.gap * 2
        val cellH = high * 4 + sheet.gap * 2
        val rects = linkedMapOf<String, Rect>()
        for ((id, spot) in spots) {
            val service = services.getValue(id)
            val junction = service.label.isEmpty() && service.icon.isEmpty()
            val wide = if (junction) pad else maxOf(sheet.width(service.label) + pad * 2, high * 3)
            val tall = if (junction) pad else high * 3.5
            rects[id] = Rect(
                spot.first * cellW + (cellW - wide) / 2,
                spot.second * cellH + (cellH - tall) / 2,
                wide,
                tall,
            )
        }
        for (edge in edges) {
            val from = anchor(rects.getValue(edge.from), edge.fromSide)
            val to = anchor(rects.getValue(edge.to), edge.toSide)
            sheet.add(
                Mark.Edge(
                    listOf(from, to),
                    Role.Line,
                    head = if (edge.into) Head.Arrow else Head.None,
                    tail = if (edge.back) Head.Arrow else Head.None,
                ),
            )
        }
        for ((id, rect) in rects) {
            val service = services.getValue(id)
            if (service.label.isEmpty() && service.icon.isEmpty()) {
                sheet.add(Mark.Oval(rect, Role.Border, null))
                continue
            }
            sheet.add(Mark.Box(rect, spec.metrics.arc, Role.Surface, Role.Border))
            icon(sheet, service.icon, Rect(rect.x + rect.w / 2 - high, rect.y + pad / 2, high * 2, high * 2))
            sheet.texts(listOf(service.label), rect.x + rect.w / 2, rect.y + rect.h - high - pad / 2, Role.Text)
        }
        for (group in groups.values) {
            val members = rects.filterKeys { services.getValue(it).group == group.id }.values
            if (members.isEmpty()) continue
            val x = members.minOf { it.x } - sheet.gap
            val y = members.minOf { it.y } - sheet.gap - high
            val w = members.maxOf { it.x + it.w } + sheet.gap - x
            val h = members.maxOf { it.y + it.h } + sheet.gap - y
            sheet.add(Mark.Box(Rect(x, y, w, h), spec.metrics.arc, null, Role.Cluster, dash = true))
            sheet.add(Mark.Text(group.label, Pt(x + pad, y + pad + high / 2), Anchor.Left, Role.Muted, bold = true))
        }
        return sheet.scene(Type.Architecture)
    }

    /** A small icon glyph built from primitives; unknown icons fall back to a plain box. */
    private fun icon(sheet: Sheet, name: String, rect: Rect) {
        when (name.lowercase()) {
            "database", "db" -> {
                sheet.add(Mark.Box(Rect(rect.x, rect.y + rect.h * 0.2, rect.w, rect.h * 0.6), 0.0, null, Role.Muted))
                sheet.add(Mark.Oval(Rect(rect.x, rect.y, rect.w, rect.h * 0.4), null, Role.Muted))
                sheet.add(Mark.Oval(Rect(rect.x, rect.y + rect.h * 0.6, rect.w, rect.h * 0.4), null, Role.Muted))
            }
            "disk", "storage" -> {
                sheet.add(Mark.Box(rect, 2.0, null, Role.Muted))
                sheet.add(Mark.Oval(Rect(rect.x + rect.w * 0.3, rect.y + rect.h * 0.3, rect.w * 0.4, rect.h * 0.4), null, Role.Muted))
            }
            "cloud", "internet" -> {
                sheet.add(Mark.Oval(Rect(rect.x, rect.y + rect.h * 0.3, rect.w * 0.6, rect.h * 0.6), null, Role.Muted))
                sheet.add(Mark.Oval(Rect(rect.x + rect.w * 0.4, rect.y + rect.h * 0.1, rect.w * 0.6, rect.h * 0.7), null, Role.Muted))
            }
            "server" -> {
                sheet.add(Mark.Box(Rect(rect.x, rect.y, rect.w, rect.h * 0.45), 2.0, null, Role.Muted))
                sheet.add(Mark.Box(Rect(rect.x, rect.y + rect.h * 0.55, rect.w, rect.h * 0.45), 2.0, null, Role.Muted))
            }
            else -> if (name.isNotEmpty()) sheet.add(Mark.Box(rect, 2.0, null, Role.Muted))
        }
    }

    private fun Pair<Int, Int>.shift(side: Side) = when (side) {
        Side.Left -> first - 1 to second
        Side.Right -> first + 1 to second
        Side.Top -> first to second - 1
        Side.Bottom -> first to second + 1
    }

    private fun anchor(rect: Rect, side: Side) = when (side) {
        Side.Left -> Pt(rect.x, rect.y + rect.h / 2)
        Side.Right -> Pt(rect.x + rect.w, rect.y + rect.h / 2)
        Side.Top -> Pt(rect.x + rect.w / 2, rect.y)
        Side.Bottom -> Pt(rect.x + rect.w / 2, rect.y + rect.h)
    }

    private enum class Side { Left, Right, Top, Bottom }

    private data class Part(val id: String, val icon: String, val label: String)

    private data class Service(val id: String, val label: String, val icon: String, val group: String)

    private data class Group(val id: String, val label: String, val parent: String)

    private data class Edge(
        val from: String,
        val to: String,
        val fromSide: Side,
        val toSide: Side,
        val into: Boolean,
        val back: Boolean,
    )

    private companion object {
        /** `db:L -- R:server`, optional `<`/`>` arrows on either side of the rails. */
        val EDGE = Regex("""^(\w+):([LRTB])\s*(<)?--(>)?\s*([LRTB]):(\w+)$""")
    }
}
