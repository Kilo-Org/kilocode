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
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive

/**
 * Gantt engine: sections as lanes, ISO dates, `after id` chaining, `Nd`/`Nw`/`Nh` durations, and
 * milestone diamonds. Date math is pinned to ISO/[Locale.ROOT] so layout is deterministic.
 */
internal class Gantt(private val measure: Measure, private val spec: Spec) {
    private val tasks = mutableListOf<Task>()
    private val ends = linkedMapOf<String, LocalDate>()
    private var title = ""
    private var section = ""

    suspend fun draw(clean: Clean): Out {
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                if (text.lowercase() == "gantt") continue
            }
            val token = text.substringBefore(' ').lowercase()
            if (token in SKIP) continue
            if (token == "title") {
                title = text.substringAfter(' ', "").trim()
                continue
            }
            if (token == "section") {
                section = text.substringAfter(' ', "").trim()
                continue
            }
            val colon = text.indexOf(':')
            if (colon <= 0) continue
            val err = task(text.substring(0, colon).trim(), text.substring(colon + 1).trim())
            if (err != null) return Out.Err(Fault.Syntax, err, line.at)
            if (tasks.size > spec.limits.nodes) return Out.Err(Fault.Limit, "gantt exceeds ${spec.limits.nodes} tasks")
        }
        if (tasks.isEmpty()) return Out.Err(Fault.Syntax, "gantt has no tasks", 1)
        return Out.Ok(marks())
    }

    private fun task(label: String, body: String): String? {
        val cells = ArrayDeque(body.split(',').map { it.trim() }.filter { it.isNotEmpty() })
        if (cells.isEmpty()) return "task needs a start"
        var milestone = false
        while (cells.isNotEmpty() && cells.first().lowercase() in TAGS) {
            if (cells.removeFirst().lowercase() == "milestone") milestone = true
        }
        // An id cell is anything left in front of the cell that resolves to a start.
        val id = if (cells.size >= 2 && date(cells.first()) == null && !cells.first().lowercase().startsWith("after")) {
            cells.removeFirst()
        } else {
            ""
        }
        if (cells.isEmpty()) return "task needs a start"
        val begin = start(cells.removeFirst()) ?: return "task needs a date or `after id`"
        val stop = when {
            cells.isEmpty() -> begin.plusDays(1)
            else -> finish(begin, cells.removeFirst()) ?: return "task needs a duration or end date"
        }
        if (id.isNotEmpty()) ends[id] = stop
        tasks.add(Task(label, section, begin, stop, milestone))
        return null
    }

    private fun start(cell: String): LocalDate? {
        if (cell.lowercase().startsWith("after")) {
            val ids = cell.substringAfter(' ', "").trim().split(' ').filter { it.isNotEmpty() }
            val dates = ids.mapNotNull { ends[it] }
            return dates.maxOrNull() ?: tasks.lastOrNull()?.stop
        }
        return date(cell)
    }

    private fun finish(begin: LocalDate, cell: String): LocalDate? {
        date(cell)?.let { return it }
        val match = SPAN.find(cell.lowercase()) ?: return null
        val count = match.groupValues[1].toLong()
        return when (match.groupValues[2]) {
            "w" -> begin.plusWeeks(count)
            "h" -> begin.plusDays((count + 23) / 24)
            else -> begin.plusDays(count)
        }
    }

    private fun date(cell: String): LocalDate? {
        return runCatching { LocalDate.parse(cell, ISO) }.getOrNull()
    }

    private fun marks(): Scene {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val pad = sheet.pad
        val open = tasks.minOf { it.begin }
        val shut = tasks.maxOf { it.stop }
        val days = maxOf(1L, java.time.temporal.ChronoUnit.DAYS.between(open, shut))
        val sections = tasks.map { it.section }.distinct()
        val left = (sections.maxOfOrNull { sheet.width(it, bold = true) } ?: 0.0) + pad * 2
        val plot = Rect(left, 0.0, (days * 6.0).coerceIn(high * 28, high * 60), tasks.size * (high + pad * 2))
        val day = plot.w / days
        fun x(date: LocalDate) = plot.x + java.time.temporal.ChronoUnit.DAYS.between(open, date) * day

        if (title.isNotEmpty()) {
            sheet.texts(listOf(title), plot.x + plot.w / 2, -high * 2 - pad, Role.Text, bold = true)
        }
        var tick = open
        while (!tick.isAfter(shut)) {
            val at = x(tick)
            sheet.add(Mark.Edge(listOf(Pt(at, plot.y), Pt(at, plot.y + plot.h)), Role.Cluster, dash = true))
            sheet.add(Mark.Text(tick.format(DAY), Pt(at, plot.y + plot.h + pad), Anchor.Top, Role.Muted))
            tick = tick.plusDays(maxOf(1L, days / 6))
        }
        tasks.forEachIndexed { idx, task ->
            val top = plot.y + idx * (high + pad * 2) + pad
            val tone = sections.indexOf(task.section)
            if (task.milestone) {
                val cx = x(task.begin)
                val cy = top + high / 2
                val r = high * 0.6
                sheet.add(Mark.Poly(listOf(Pt(cx, cy - r), Pt(cx + r, cy), Pt(cx, cy + r), Pt(cx - r, cy)), null, Role.Border, tone = tone))
                sheet.add(Mark.Text(task.label, Pt(cx + r + pad, cy), Anchor.Left, Role.Text))
            } else {
                val rect = Rect(x(task.begin), top, maxOf(day / 2, x(task.stop) - x(task.begin)), high)
                sheet.add(Mark.Box(rect, spec.metrics.arc, null, Role.Border, tone = tone))
                if (sheet.width(task.label) <= rect.w - pad) {
                    sheet.label(listOf(task.label), rect, Role.Text)
                } else {
                    sheet.add(Mark.Text(task.label, Pt(rect.x + rect.w + pad, rect.y + rect.h / 2), Anchor.Left, Role.Text))
                }
            }
        }
        var lane = 0
        for (name in sections) {
            val rows = tasks.count { it.section == name }
            val top = plot.y + lane * (high + pad * 2)
            if (name.isNotEmpty()) {
                sheet.add(Mark.Text(name, Pt(0.0, top + pad + high / 2), Anchor.Left, Role.Muted, bold = true))
            }
            lane += rows
        }
        return sheet.scene(Type.Gantt)
    }

    private data class Task(val label: String, val section: String, val begin: LocalDate, val stop: LocalDate, val milestone: Boolean)

    private companion object {
        val SKIP = setOf("dateformat", "axisformat", "excludes", "includes", "todaymarker", "tickinterval", "weekday", "accdescr", "acctitle", "inclusiveenddates")
        val TAGS = setOf("active", "done", "crit", "milestone")
        val SPAN = Regex("""^(\d+)([dwh])$""")
        val ISO: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT)
        val DAY: DateTimeFormatter = DateTimeFormatter.ofPattern("MM-dd", Locale.ROOT)
    }
}
