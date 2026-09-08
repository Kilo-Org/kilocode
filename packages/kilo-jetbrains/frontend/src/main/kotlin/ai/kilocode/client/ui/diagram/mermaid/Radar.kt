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
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlinx.coroutines.ensureActive

/** Radar chart engine: axes on a circular or polygonal graticule with soft-filled curves. */
internal class Radar(private val measure: Measure, private val spec: Spec) {
    private val axes = linkedMapOf<String, String>()
    private val curves = mutableListOf<Curve>()
    private var legend = true
    private var polygon = false
    private var ticks = 5
    private var min = 0.0
    private var max: Double? = null
    private var title = ""

    suspend fun draw(clean: Clean): Out {
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                val token = text.substringBefore(' ').lowercase()
                if (token == "radar-beta" || token == "radar") continue
            }
            val err = stmt(text)
            if (err != null) return Out.Err(Fault.Syntax, err, line.at)
            if (axes.size > spec.limits.nodes) return Out.Err(Fault.Limit, "radar exceeds ${spec.limits.nodes} axes")
            if (curves.size > spec.limits.nodes) return Out.Err(Fault.Limit, "radar exceeds ${spec.limits.nodes} curves")
        }
        if (axes.isEmpty()) return Out.Err(Fault.Syntax, "radar has no axes", 1)
        if (curves.isEmpty()) return Out.Err(Fault.Syntax, "radar has no curves", 1)
        return Out.Ok(marks())
    }

    private fun stmt(text: String): String? {
        val token = text.substringBefore(' ').lowercase()
        val rest = text.substringAfter(' ', "").trim()
        when (token) {
            "title" -> {
                title = rest
                return null
            }
            "showlegend" -> {
                legend = rest.isEmpty() || rest.lowercase() == "true"
                return null
            }
            "graticule" -> {
                polygon = rest.lowercase() == "polygon"
                return null
            }
            "ticks" -> {
                ticks = rest.toIntOrNull()?.coerceIn(1, 20) ?: return "ticks needs a number"
                return null
            }
            "max" -> {
                max = Lex.num(rest) ?: return "max needs a number"
                return null
            }
            "min" -> {
                min = Lex.num(rest) ?: return "min needs a number"
                return null
            }
            "axis" -> {
                for (part in Lex.args(rest)) {
                    val tag = Lex.tagged(part) ?: return "malformed axis $part"
                    axes[tag.first] = tag.second
                }
                return null
            }
            "curve" -> return curve(rest)
            "accdescr", "acctitle" -> return null
            else -> return null
        }
    }

    /** `alice["Alice"]{85, 90}` — one or more per line; values positional or `axis: value` pairs. */
    private fun curve(text: String): String? {
        var rest = text.trim()
        while (rest.isNotEmpty()) {
            val open = rest.indexOf('{')
            if (open <= 0) return "malformed curve"
            val close = rest.indexOf('}', open)
            if (close < 0) return "curve is missing a closing brace"
            val tag = Lex.tagged(rest.substring(0, open).trim().removeSuffix(",").trim()) ?: return "malformed curve"
            val cells = Lex.args(rest.substring(open + 1, close))
            val byKey = cells.all { it.contains(':') }
            val values = if (byKey) {
                val map = cells.associate { cell ->
                    val key = cell.substringBefore(':').trim()
                    val value = Lex.num(cell.substringAfter(':')) ?: return "curve values must be numbers"
                    key to value
                }
                axes.keys.map { map[it] ?: min }
            } else {
                cells.map { Lex.num(it) ?: return "curve values must be numbers" }
            }
            curves.add(Curve(tag.second, values))
            rest = rest.substring(close + 1).trim().removePrefix(",").trim()
        }
        return null
    }

    private fun marks(): Scene {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val pad = sheet.pad
        val r = high * 9
        val at = Pt(0.0, 0.0)
        // `min` defaults to 0, so all-negative data (or an inverted explicit min/max) would otherwise
        // hand coerceIn an empty range and throw.
        val top = max ?: curves.maxOf { it.values.maxOrNull() ?: 0.0 }
        val floor = minOf(min, top)
        val roof = maxOf(min, top)
        val span = (roof - floor).takeIf { it > 0 } ?: 1.0
        val count = axes.size

        if (title.isNotEmpty()) sheet.texts(listOf(title), at.x, at.y - r - high * 2 - pad, Role.Text, bold = true)
        fun spoke(idx: Int, radius: Double): Pt {
            val angle = Math.PI / 2 - 2 * Math.PI * idx / count
            return Pt(at.x + cos(angle) * radius, at.y - sin(angle) * radius)
        }
        for (ring in 1..ticks) {
            val radius = r * ring / ticks
            if (polygon) {
                sheet.add(Mark.Poly(List(count) { spoke(it, radius) }, null, Role.Cluster))
                continue
            }
            sheet.add(Mark.Oval(Rect(at.x - radius, at.y - radius, radius * 2, radius * 2), null, Role.Cluster))
        }
        axes.values.forEachIndexed { idx, label ->
            val end = spoke(idx, r)
            sheet.add(Mark.Edge(listOf(at, end), Role.Cluster))
            val tip = spoke(idx, r * 1.08)
            val anchor = when {
                abs(tip.x - at.x) < r * 0.3 -> if (tip.y < at.y) Anchor.Bottom else Anchor.Top
                tip.x > at.x -> Anchor.Left
                else -> Anchor.Right
            }
            sheet.add(Mark.Text(label, tip, anchor, Role.Muted))
        }
        curves.forEachIndexed { tone, curve ->
            val points = List(count) { idx ->
                val value = (curve.values.getOrNull(idx) ?: floor).coerceIn(floor, roof)
                spoke(idx, r * (value - floor) / span)
            }
            sheet.add(Mark.Poly(points, null, null, tone = tone, soft = true))
            sheet.add(Mark.Edge(points + points.first(), Role.Line, thick = true, tone = tone))
        }
        if (legend) {
            var row = at.y - r
            curves.forEachIndexed { tone, curve ->
                val swatch = Rect(at.x + r * 1.3, row, high * 0.8, high * 0.8)
                sheet.add(Mark.Box(swatch, 0.0, null, null, tone = tone))
                sheet.add(Mark.Text(curve.label, Pt(swatch.x + swatch.w + pad, swatch.y + swatch.h / 2), Anchor.Left, Role.Text))
                row += high
            }
        }
        return sheet.scene(Type.Radar)
    }

    private data class Curve(val label: String, val values: List<Double>)
}
