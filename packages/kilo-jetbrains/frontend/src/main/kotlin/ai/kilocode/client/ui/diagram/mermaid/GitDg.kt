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

/** Git graph engine: branch lanes as rows, commits as tone dots in sequence order, merge links. */
internal class GitDg(private val measure: Measure, private val spec: Spec) {
    private val lanes = linkedMapOf<String, Int>()
    private val commits = mutableListOf<Commit>()
    private val heads = linkedMapOf<String, Int>()
    private var branch = MAIN

    suspend fun draw(clean: Clean): Out {
        lanes[MAIN] = 0
        var first = true
        for (line in clean.lines) {
            coroutineContext.ensureActive()
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                if (text.substringBefore(' ').trimEnd(':').lowercase() == "gitgraph") continue
            }
            val err = stmt(text)
            if (err != null) return Out.Err(Fault.Syntax, err, line.at)
            if (commits.size > spec.limits.nodes) return Out.Err(Fault.Limit, "git graph exceeds ${spec.limits.nodes} commits")
            if (lanes.size > spec.limits.nodes) return Out.Err(Fault.Limit, "git graph exceeds ${spec.limits.nodes} branches")
        }
        if (commits.isEmpty()) return Out.Err(Fault.Syntax, "git graph has no commits", 1)
        return Out.Ok(marks())
    }

    private fun stmt(text: String): String? {
        val token = text.substringBefore(' ').lowercase()
        val rest = text.substringAfter(' ', "").trim()
        when (token) {
            "commit" -> {
                commit(rest, from = heads[branch])
                return null
            }
            "branch" -> {
                val name = rest.substringBefore(' ').trim()
                if (name.isEmpty()) return "branch needs a name"
                lanes.getOrPut(name) { lanes.size }
                heads[name] = heads[branch] ?: -1
                branch = name
                return null
            }
            "checkout", "switch" -> {
                val name = rest.substringBefore(' ').trim()
                if (!lanes.containsKey(name)) return "unknown branch $name"
                branch = name
                return null
            }
            "merge" -> {
                val name = rest.substringBefore(' ').trim()
                if (!lanes.containsKey(name)) return "unknown branch $name"
                commit(rest.substringAfter(' ', "").trim(), from = heads[branch], other = heads[name], fallback = "merge $name")
                return null
            }
            "accdescr", "acctitle", "%%" -> return null
            else -> return null
        }
    }

    private fun commit(args: String, from: Int?, other: Int? = null, fallback: String = "") {
        val id = pick(args, "id") ?: fallback.ifEmpty { "${commits.size}" }
        val tag = pick(args, "tag").orEmpty()
        commits.add(Commit(id, tag, branch, from, other))
        heads[branch] = commits.lastIndex
    }

    /** Pulls `key: "value"` out of a commit argument list. */
    private fun pick(args: String, key: String): String? {
        val match = Regex("""$key:\s*("[^"]*"|\S+)""").find(args) ?: return null
        return Source.unquote(match.groupValues[1])
    }

    private fun marks(): Scene {
        val sheet = Sheet(measure, spec)
        val high = sheet.high
        val pad = sheet.pad
        val stride = maxOf(high * 3, commits.maxOf { sheet.width(it.id) } / 2 + pad * 2)
        val row = high * 3
        val left = lanes.keys.maxOf { sheet.width(it, bold = true) } + pad * 3
        fun at(idx: Int): Pt {
            val commit = commits[idx]
            return Pt(left + stride * (idx + 1), lanes.getValue(commit.branch) * row + row / 2)
        }
        lanes.forEach { (name, lane) ->
            val y = lane * row + row / 2
            sheet.add(Mark.Text(name, Pt(0.0, y), Anchor.Left, Role.Muted, bold = true))
        }
        commits.forEachIndexed { idx, commit ->
            for (parent in listOfNotNull(commit.from, commit.other)) {
                if (parent < 0) continue
                sheet.add(Mark.Edge(listOf(at(parent), at(idx)), Role.Line, tone = lanes.getValue(commits[idx].branch)))
            }
        }
        commits.forEachIndexed { idx, commit ->
            val spot = at(idx)
            val r = high * 0.55
            sheet.add(Mark.Oval(Rect(spot.x - r, spot.y - r, r * 2, r * 2), null, Role.Border, tone = lanes.getValue(commit.branch)))
            sheet.add(Mark.Text(commit.id, Pt(spot.x, spot.y + r + pad), Anchor.Top, Role.Muted))
            if (commit.tag.isNotEmpty()) {
                val wide = sheet.width(commit.tag) + pad * 2
                val box = Rect(spot.x - wide / 2, spot.y - r - pad - high, wide, high)
                sheet.add(Mark.Box(box, spec.metrics.arc, Role.Note, Role.Border))
                sheet.label(listOf(commit.tag), box, Role.Text)
            }
        }
        return sheet.scene(Type.Git)
    }

    private data class Commit(val id: String, val tag: String, val branch: String, val from: Int?, val other: Int?)

    private companion object {
        const val MAIN = "main"
    }
}
