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

/** XY chart engine: category or numeric x axis, bar and line series with per-series tones. */
internal class XyChart(private val measure: Measure, private val spec: Spec) {
    suspend fun draw(clean: Clean): Out {
        var title = ""
        var xlabel = ""
        var ylabel = ""
        var cats = emptyList<String>()
        var min: Double? = null
        var max: Double? = null
        val series = mutableListOf<Run>()
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                if (text.substringBefore(' ').lowercase().startsWith("xychart")) continue
            }
            val token = text.substringBefore(' ').lowercase()
            val rest = text.substringAfter(' ', "").trim()
            when (token) {
                "title" -> title = Source.unquote(rest)
                "x-axis" -> {
                    val open = rest.indexOf('[')
                    if (open >= 0 && rest.endsWith("]")) {
                        xlabel = Source.unquote(rest.substring(0, open).trim())
                        cats = Lex.args(rest.substring(open + 1, rest.length - 1)).map { Source.unquote(it) }
                    } else {
                        val range = RANGE.find(rest)
                        if (range != null) {
                            xlabel = Source.unquote(rest.substring(0, range.range.first).trim())
                            cats = listOf(range.groupValues[1], range.groupValues[2])
                        } else {
                            xlabel = Source.unquote(rest)
                        }
                    }
                }
                "y-axis" -> {
                    val range = RANGE.find(rest)
                    if (range != null) {
                        ylabel = Source.unquote(rest.substring(0, range.range.first).trim())
                        min = range.groupValues[1].toDouble()
                        max = range.groupValues[2].toDouble()
                    } else {
                        ylabel = Source.unquote(rest)
                    }
                }
                "bar", "line" -> {
                    val open = text.indexOf('[')
                    if (open < 0 || !text.endsWith("]")) return Out.Err(Fault.Syntax, "$token needs [values]", line.at)
                    val values = Lex.args(text.substring(open + 1, text.length - 1)).map {
                        Lex.num(it) ?: return Out.Err(Fault.Syntax, "$token values must be numbers", line.at)
                    }
                    series.add(Run(token == "bar", values))
                    if (series.size > spec.limits.nodes) return Out.Err(Fault.Limit, "chart exceeds ${spec.limits.nodes} series")
                }
                else -> Unit
            }
        }
        if (series.isEmpty() || series.all { it.values.isEmpty() }) return Out.Err(Fault.Syntax, "chart has no data", 1)
        val count = series.maxOf { it.values.size }
        val labels = if (cats.size >= count) cats.take(count) else List(count) { idx -> cats.getOrNull(idx) ?: "${idx + 1}" }
        val lo = min ?: minOf(0.0, series.minOf { run -> run.values.minOrNull() ?: 0.0 })
        val hi = max ?: series.maxOf { run -> run.values.maxOrNull() ?: 0.0 }
        return Out.Ok(marks(title, xlabel, ylabel, labels, lo, hi, series))
    }

    private fun marks(
        title: String,
        xlabel: String,
        ylabel: String,
        cats: List<String>,
        lo: Double,
        hi: Double,
        series: List<Run>,
    ): Scene {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val pad = sheet.pad
        val ticks = Axis.ticks(lo, hi)
        val floor = ticks.first()
        val ceil = ticks.last()
        val band = maxOf(cats.maxOf { sheet.width(it) } + pad * 2, high * 4)
        val plot = Rect(0.0, 0.0, band * cats.size, high * 14)
        fun y(value: Double) = plot.y + plot.h - (value - floor) / (ceil - floor) * plot.h

        var head = 0.0
        if (title.isNotEmpty()) head += sheet.texts(listOf(title), plot.w / 2, -high * 2 - pad, Role.Text, bold = true)
        if (ylabel.isNotEmpty()) sheet.add(Mark.Text(ylabel, Pt(plot.x, plot.y - high), Anchor.BottomLeft, Role.Muted))
        for (tick in ticks) {
            val at = y(tick)
            sheet.add(Mark.Edge(listOf(Pt(plot.x, at), Pt(plot.x + plot.w, at)), Role.Cluster, dash = true))
            sheet.add(Mark.Text(Axis.label(tick), Pt(plot.x - pad, at), Anchor.Right, Role.Muted))
        }
        val bars = series.count { it.bar }
        var slot = 0
        for (run in series.filter { it.bar }) {
            val wide = band * 0.7 / bars
            run.values.forEachIndexed { idx, value ->
                val cx = plot.x + band * idx + band * 0.15 + wide * slot
                val tone = series.indexOf(run)
                sheet.add(Mark.Box(Rect(cx, y(value), wide, plot.y + plot.h - y(value)), 0.0, null, Role.Border, tone = tone))
            }
            slot++
        }
        for (run in series.filter { !it.bar }) {
            val tone = series.indexOf(run)
            val points = run.values.mapIndexed { idx, value -> Pt(plot.x + band * (idx + 0.5), y(value)) }
            sheet.add(Mark.Edge(points, Role.Line, thick = true, tone = tone))
            for (point in points) {
                sheet.add(Mark.Oval(Rect(point.x - 3.0, point.y - 3.0, 6.0, 6.0), null, null, tone = tone))
            }
        }
        sheet.add(Mark.Edge(listOf(Pt(plot.x, plot.y), Pt(plot.x, plot.y + plot.h)), Role.Border))
        sheet.add(Mark.Edge(listOf(Pt(plot.x, plot.y + plot.h), Pt(plot.x + plot.w, plot.y + plot.h)), Role.Border))
        cats.forEachIndexed { idx, cat ->
            sheet.texts(listOf(cat), plot.x + band * (idx + 0.5), plot.y + plot.h + pad, Role.Muted)
        }
        if (xlabel.isNotEmpty()) sheet.texts(listOf(xlabel), plot.x + plot.w / 2, plot.y + plot.h + pad + high, Role.Muted)
        return sheet.scene(Type.XyChart)
    }

    private data class Run(val bar: Boolean, val values: List<Double>)

    private companion object {
        val RANGE = Regex("""(-?[\d.]+)\s*-->\s*(-?[\d.]+)\s*$""")
    }
}
