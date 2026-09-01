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

/** Quadrant chart engine: four soft-tone quadrants, axis captions, and labeled points in unit space. */
internal class Quadrant(private val measure: Measure, private val spec: Spec) {
    suspend fun draw(clean: Clean): Out {
        var title = ""
        val axisX = arrayOf("", "")
        val axisY = arrayOf("", "")
        val names = arrayOfNulls<String>(4)
        val points = mutableListOf<Point>()
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                if (text.lowercase() == "quadrantchart") continue
            }
            val token = text.substringBefore(' ').lowercase()
            val rest = text.substringAfter(' ', "").trim()
            when {
                token == "title" -> title = rest
                token == "x-axis" -> split(rest, axisX)
                token == "y-axis" -> split(rest, axisY)
                token.startsWith("quadrant-") -> {
                    val slot = token.removePrefix("quadrant-").toIntOrNull()
                        ?: return Out.Err(Fault.Syntax, "malformed quadrant label", line.at)
                    if (slot !in 1..4) return Out.Err(Fault.Syntax, "quadrant index must be 1-4", line.at)
                    names[slot - 1] = rest
                }
                token == "accdescr" || token == "acctitle" || token == "classdef" -> Unit
                else -> {
                    val match = POINT.find(text) ?: continue
                    val x = match.groupValues[2].toDoubleOrNull()
                    val y = match.groupValues[3].toDoubleOrNull()
                    if (x == null || y == null) return Out.Err(Fault.Syntax, "point needs [x, y]", line.at)
                    points.add(Point(match.groupValues[1].trim(), x.coerceIn(0.0, 1.0), y.coerceIn(0.0, 1.0)))
                    if (points.size > spec.limits.nodes) return Out.Err(Fault.Limit, "chart exceeds ${spec.limits.nodes} points")
                }
            }
        }
        if (names.all { it == null } && points.isEmpty()) return Out.Err(Fault.Syntax, "quadrant chart has no content", 1)
        return Out.Ok(marks(title, axisX, axisY, names, points))
    }

    /** `Low Reach --> High Reach` — either side may be missing. */
    private fun split(text: String, into: Array<String>) {
        val cut = text.indexOf("-->")
        if (cut < 0) {
            into[0] = text
            return
        }
        into[0] = text.substring(0, cut).trim()
        into[1] = text.substring(cut + 3).trim()
    }

    private fun marks(title: String, axisX: Array<String>, axisY: Array<String>, names: Array<String?>, points: List<Point>): Scene {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val pad = sheet.pad
        val side = high * 18
        val plot = Rect(0.0, 0.0, side, side)
        var top = -pad
        if (title.isNotEmpty()) sheet.texts(listOf(title), side / 2, -high - pad * 2, Role.Text, bold = true)

        val zones = listOf(
            Rect(plot.x + side / 2, plot.y, side / 2, side / 2),
            Rect(plot.x, plot.y, side / 2, side / 2),
            Rect(plot.x, plot.y + side / 2, side / 2, side / 2),
            Rect(plot.x + side / 2, plot.y + side / 2, side / 2, side / 2),
        )
        zones.forEachIndexed { idx, zone ->
            sheet.add(Mark.Box(zone, 0.0, null, Role.Cluster, tone = idx, soft = true))
            names[idx]?.let { sheet.label(listOf(it), zone, Role.Muted, bold = true) }
        }
        for (point in points) {
            val at = Pt(plot.x + point.x * side, plot.y + (1.0 - point.y) * side)
            sheet.add(Mark.Oval(Rect(at.x - 3.0, at.y - 3.0, 6.0, 6.0), Role.Accent, null))
            sheet.add(Mark.Text(point.label, Pt(at.x, at.y - pad), Anchor.Bottom, Role.Text))
        }
        if (axisX[0].isNotEmpty()) sheet.add(Mark.Text(axisX[0], Pt(plot.x, plot.y + side + pad + high / 2), Anchor.Left, Role.Muted))
        if (axisX[1].isNotEmpty()) sheet.add(Mark.Text(axisX[1], Pt(plot.x + side, plot.y + side + pad + high / 2), Anchor.Right, Role.Muted))
        if (axisY[0].isNotEmpty()) sheet.add(Mark.Text(axisY[0], Pt(plot.x - pad, plot.y + side - high / 2), Anchor.Right, Role.Muted))
        if (axisY[1].isNotEmpty()) sheet.add(Mark.Text(axisY[1], Pt(plot.x - pad, plot.y + high / 2), Anchor.Right, Role.Muted))
        return sheet.scene(Type.Quadrant)
    }

    private data class Point(val label: String, val x: Double, val y: Double)

    private companion object {
        val POINT = Regex("""^(.+?):\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*]$""")
    }
}
