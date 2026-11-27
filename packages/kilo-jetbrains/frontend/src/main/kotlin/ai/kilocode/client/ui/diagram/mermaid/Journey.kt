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

/**
 * User journey engine. Tasks form columns with a section band above and a five-step score strip: the
 * dot sits at the score height and consecutive dots are linked, mirroring mermaid's mood curve.
 */
internal class Journey(private val measure: Measure, private val spec: Spec) {
    suspend fun draw(clean: Clean): Out {
        var title = ""
        val tasks = mutableListOf<Task>()
        var section = ""
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                if (text.lowercase() == "journey") continue
            }
            val token = text.substringBefore(' ').lowercase()
            if (token == "title") {
                title = text.substringAfter(' ', "").trim()
                continue
            }
            if (token == "section") {
                section = text.substringAfter(' ', "").trim()
                continue
            }
            if (token == "accdescr" || token == "acctitle") continue
            val parts = text.split(':')
            if (parts.size < 2) continue
            val score = Lex.num(parts[1]) ?: return Out.Err(Fault.Syntax, "journey score must be a number", line.at)
            val actors = parts.getOrNull(2)?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }.orEmpty()
            tasks.add(Task(parts[0].trim(), score.coerceIn(1.0, 5.0), actors, section))
            if (tasks.size > spec.limits.nodes) return Out.Err(Fault.Limit, "journey exceeds ${spec.limits.nodes} tasks")
        }
        if (tasks.isEmpty()) return Out.Err(Fault.Syntax, "journey has no tasks", 1)
        return Out.Ok(marks(title, tasks))
    }

    private fun marks(title: String, tasks: List<Task>): Scene {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val pad = sheet.pad
        val strip = high * 5
        val sections = tasks.map { it.section }.distinct()
        val widths = tasks.map { maxOf(sheet.width(it.label), sheet.width(it.actors.joinToString(", ")), high * 4) + sheet.gap }

        var top = 0.0
        if (title.isNotEmpty()) {
            val wide = widths.sum()
            top = sheet.texts(listOf(title), wide / 2, 0.0, Role.Text, bold = true) + pad
        }
        val band = top
        val lift = band + high + pad * 2
        val dots = mutableListOf<Pt>()
        var x = 0.0
        tasks.forEachIndexed { idx, task ->
            val wide = widths[idx]
            val cx = x + wide / 2
            val cy = lift + (5.0 - task.score) / 4.0 * (strip - high) + high / 2
            dots.add(Pt(cx, cy))
            x += wide
        }
        sheet.add(Mark.Edge(dots, Role.Muted, dash = true))
        x = 0.0
        tasks.forEachIndexed { idx, task ->
            val wide = widths[idx]
            val tone = sections.indexOf(task.section)
            val dot = dots[idx]
            val r = high * 0.7
            sheet.add(Mark.Oval(Rect(dot.x - r, dot.y - r, r * 2, r * 2), null, Role.Border, tone = tone))
            sheet.add(Mark.Text(Axis.label(task.score), dot, Anchor.Center, Role.Text))
            sheet.texts(listOf(task.label), dot.x, lift + strip + pad, Role.Text)
            if (task.actors.isNotEmpty()) {
                sheet.texts(listOf(task.actors.joinToString(", ")), dot.x, lift + strip + pad + high, Role.Muted)
            }
            x += wide
        }
        var left = 0.0
        for (section in sections) {
            if (section.isEmpty()) {
                left += tasks.indices.filter { tasks[it].section.isEmpty() }.sumOf { widths[it] }
                continue
            }
            val span = tasks.indices.filter { tasks[it].section == section }.sumOf { widths[it] }
            val rect = Rect(left, band, span - pad / 2, high + pad)
            sheet.add(Mark.Box(rect, spec.metrics.arc, null, null, tone = sections.indexOf(section), soft = true))
            sheet.label(listOf(section), rect, Role.Text, bold = true)
            left += span
        }
        return sheet.scene(Type.Journey)
    }

    private data class Task(val label: String, val score: Double, val actors: List<String>, val section: String)
}
