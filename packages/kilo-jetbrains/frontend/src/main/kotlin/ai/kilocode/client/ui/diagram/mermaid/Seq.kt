package ai.kilocode.client.ui.diagram.mermaid

import ai.kilocode.client.ui.diagram.Head

internal enum class NoteAt { Left, Right, Over }

internal enum class BlockKind { Loop, Alt, Opt, Par, Critical, Break }

internal data class Actor(val id: String, val label: List<String>, val index: Int)

internal sealed interface Step {
    data class Msg(
        val from: String,
        val to: String,
        val label: List<String>,
        val link: Link,
        val head: Head,
    ) : Step

    data class Note(val at: NoteAt, val actors: List<String>, val label: List<String>) : Step
    data class Open(val kind: BlockKind, val label: List<String>) : Step
    data class Split(val label: List<String>) : Step
    data class Toggle(val actor: String, val on: Boolean) : Step
    data object Close : Step
}

internal data class Script(
    val actors: Map<String, Actor>,
    val steps: List<Step>,
    val title: List<String>,
    val numbered: Boolean,
)

internal sealed interface SeqOut {
    data class Ok(val script: Script) : SeqOut
    data class Err(val message: String, val line: Int) : SeqOut
}

/** Line-oriented sequence diagram parser. Unknown statements are skipped rather than failing. */
internal class Seq {
    private val actors = linkedMapOf<String, Actor>()
    private val steps = mutableListOf<Step>()
    private var title = emptyList<String>()
    private var numbered = false
    private var depth = 0

    fun parse(clean: Clean): SeqOut {
        var first = true
        for (line in clean.lines) {
            val text = line.text.trim()
            if (text.isEmpty()) continue
            if (first) {
                first = false
                if (text.substringBefore(' ').lowercase() == "sequencediagram") continue
            }
            val err = stmt(text, line.at) ?: continue
            return SeqOut.Err(err, line.at)
        }
        if (depth > 0) return SeqOut.Err("block is missing a matching end", clean.lines.lastOrNull()?.at ?: 1)
        return SeqOut.Ok(Script(actors, steps, title, numbered))
    }

    private fun stmt(text: String, at: Int): String? {
        val token = text.substringBefore(' ').lowercase()
        when (token) {
            "autonumber" -> {
                numbered = true
                return null
            }
            "title" -> {
                title = Source.label(text.substringAfter(' ', "").removePrefix(":").trim())
                return null
            }
            "participant", "actor" -> return actor(text)
            "activate", "deactivate" -> {
                val id = text.substringAfter(' ', "").trim()
                if (id.isEmpty()) return "$token needs a participant"
                steps.add(Step.Toggle(name(id), token == "activate"))
                return null
            }
            "end" -> {
                if (depth == 0) return "end without a matching block"
                depth--
                steps.add(Step.Close)
                return null
            }
            "else", "and" -> {
                if (depth == 0) return "$token outside a block"
                steps.add(Step.Split(Source.label(text.substringAfter(' ', "").trim())))
                return null
            }
            in BLOCKS.keys -> {
                depth++
                steps.add(Step.Open(BLOCKS.getValue(token), Source.label(text.substringAfter(' ', "").trim())))
                return null
            }
            else -> Unit
        }
        if (token == "note") return note(text, at)
        if (token in SKIP) return null
        return message(text, at)
    }

    private fun actor(text: String): String? {
        val rest = text.substringAfter(' ', "").trim()
        if (rest.isEmpty()) return "participant needs a name"
        val cut = rest.indexOf(" as ")
        val id = if (cut < 0) rest else rest.substring(0, cut).trim()
        val label = if (cut < 0) rest else rest.substring(cut + 4).trim()
        add(id, Source.label(label))
        return null
    }

    private fun note(text: String, at: Int): String? {
        val match = NOTE.find(text) ?: return null
        val where = match.groupValues[1].lowercase()
        val kind = when {
            where.startsWith("left") -> NoteAt.Left
            where.startsWith("right") -> NoteAt.Right
            else -> NoteAt.Over
        }
        val targets = match.groupValues[2].split(',').map { name(it.trim()) }.filter { it.isNotEmpty() }
        if (targets.isEmpty()) return "note on line $at needs a participant"
        targets.forEach { add(it, listOf(it)) }
        steps.add(Step.Note(kind, targets, Source.label(match.groupValues[3])))
        return null
    }

    private fun message(text: String, at: Int): String? {
        val match = MSG.find(text) ?: return null
        val from = name(match.groupValues[1])
        val arrow = match.groupValues[2]
        val sign = match.groupValues[3]
        val to = name(match.groupValues[4])
        if (from.isEmpty() || to.isEmpty()) return "message on line $at needs both participants"
        add(from, listOf(from))
        add(to, listOf(to))
        if (sign == "+") steps.add(Step.Toggle(to, true))
        steps.add(Step.Msg(from, to, Source.label(match.groupValues[5]), linkOf(arrow), headOf(arrow)))
        if (sign == "-") steps.add(Step.Toggle(from, false))
        return null
    }

    private fun add(id: String, label: List<String>) {
        if (id.isEmpty()) return
        val prior = actors[id]
        if (prior == null) {
            actors[id] = Actor(id, label, actors.size)
            return
        }
        if (label == listOf(id) || prior.label != listOf(id)) return
        actors[id] = prior.copy(label = label)
    }

    private fun name(text: String) = Source.unquote(text.trim()).trim()

    private companion object {
        val BLOCKS = mapOf(
            "loop" to BlockKind.Loop,
            "alt" to BlockKind.Alt,
            "opt" to BlockKind.Opt,
            "par" to BlockKind.Par,
            "critical" to BlockKind.Critical,
            "break" to BlockKind.Break,
        )

        val SKIP = setOf("box", "rect", "link", "links", "accdescr", "acctitle", "create", "destroy", "option")

        val NOTE = Regex("""^[Nn]ote\s+(left of|right of|over)\s+([^:]+):\s*(.*)$""")

        val MSG = Regex("""^(.+?)\s*(--?>>|--?>|--?[x)])\s*([+-]?)\s*(.+?)\s*:\s*(.*)$""")

        fun linkOf(arrow: String) = if (arrow.startsWith("--")) Link.Dotted else Link.Solid

        fun headOf(arrow: String) = when {
            arrow.endsWith(">>") -> Head.Arrow
            arrow.endsWith("x") -> Head.Cross
            arrow.endsWith(")") -> Head.Dot
            else -> Head.Open
        }
    }
}
