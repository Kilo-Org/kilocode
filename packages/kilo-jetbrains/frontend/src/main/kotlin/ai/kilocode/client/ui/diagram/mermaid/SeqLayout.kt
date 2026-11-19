package ai.kilocode.client.ui.diagram.mermaid

import ai.kilocode.client.ui.diagram.Anchor
import ai.kilocode.client.ui.diagram.Mark
import ai.kilocode.client.ui.diagram.Measure
import ai.kilocode.client.ui.diagram.Pt
import ai.kilocode.client.ui.diagram.Rect
import ai.kilocode.client.ui.diagram.Role
import ai.kilocode.client.ui.diagram.Scene
import ai.kilocode.client.ui.diagram.Size
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.diagram.Type
import kotlin.coroutines.coroutineContext
import kotlin.math.max
import kotlinx.coroutines.ensureActive

/**
 * Sequence diagram geometry. Participants form columns, steps advance a single cursor downwards, so
 * the layout is deterministic without any graph work.
 */
internal class SeqLayout(private val measure: Measure, private val spec: Spec) {
    private val pad get() = spec.metrics.pad
    private val gap get() = spec.metrics.gap
    private val step get() = spec.metrics.rank
    private val bold get() = spec.font.copy(bold = true)

    private val marks = mutableListOf<Mark>()
    private val heads = linkedMapOf<String, Rect>()
    private val live = linkedMapOf<String, MutableList<Double>>()
    private val blocks = ArrayDeque<Frame>()
    private var cursor = 0.0
    private var count = 0
    private var wide = 0.0

    suspend fun run(script: Script): Scene {
        val high = measure.height(spec.font)
        cursor = pad + title(script, high)
        columns(script, high)
        cursor += pad + step
        for (item in script.steps) {
            coroutineContext.ensureActive()
            when (item) {
                is Step.Msg -> message(item, script.numbered, high)
                is Step.Note -> note(item, high)
                is Step.Open -> open(item, high)
                is Step.Split -> split(item, high)
                is Step.Toggle -> toggle(item)
                Step.Close -> close()
            }
        }
        drain()
        return scene(lines() + marks)
    }

    /**
     * `A->>+B: hi` without a matching deactivate is normal mermaid, so any activation still open at
     * the end of the script is closed at the cursor instead of being dropped without a bar.
     */
    private fun drain() {
        for (entry in live.entries.toList()) {
            while (entry.value.isNotEmpty()) toggle(Step.Toggle(entry.key, false))
        }
    }

    private fun title(script: Script, high: Double): Double {
        if (script.title.isEmpty()) return 0.0
        script.title.forEachIndexed { idx, text ->
            marks.add(Mark.Text(text, Pt(pad, pad + high * (idx + HALF)), Anchor.Left, Role.Text, true))
        }
        return high * script.title.size + pad
    }

    private suspend fun columns(script: Script, high: Double) {
        var cursorX = pad
        for (actor in script.actors.values) {
            coroutineContext.ensureActive()
            val text = actor.label.maxOf { measure.width(it, spec.font) }
            val box = Rect(cursorX, cursor, text + pad * 4, high * actor.label.size + pad * 2)
            heads[actor.id] = box
            marks.add(Mark.Box(box, spec.metrics.arc, Role.Surface, Role.Border))
            actor.label.forEachIndexed { idx, label ->
                val at = Pt(box.x + box.w / 2, box.y + pad + high * (idx + HALF))
                marks.add(Mark.Text(label, at, Anchor.Center, Role.Text, true))
            }
            cursorX = box.x + box.w + gap * 2
            wide = max(wide, box.x + box.w)
        }
        cursor += heads.values.maxOfOrNull { it.h } ?: 0.0
    }

    private fun message(item: Step.Msg, numbered: Boolean, high: Double) {
        val from = center(item.from) ?: return
        val to = center(item.to) ?: return
        count++
        val label = if (numbered) prefix(item.label) else item.label
        if (item.from == item.to) {
            self(item, from, label, high)
            return
        }
        cursor += high * label.size + pad
        val fromX = edge(item.from, from, to > from)
        val toX = edge(item.to, to, from > to)
        marks.add(line(listOf(Pt(fromX, cursor), Pt(toX, cursor)), item))
        val top = cursor - high * label.size - pad / 2
        label.forEachIndexed { idx, text ->
            val at = Pt((fromX + toX) / 2, top + high * (idx + HALF))
            marks.add(Mark.Text(text, at, Anchor.Center, Role.Muted))
        }
        cursor += step
    }

    private fun self(item: Step.Msg, at: Double, label: List<String>, high: Double) {
        val out = at + gap * 2
        val top = cursor + pad
        val low = top + max(step, high * label.size + pad)
        val from = edge(item.from, at, true)
        marks.add(line(listOf(Pt(from, top), Pt(out, top), Pt(out, low), Pt(from, low)), item))
        label.forEachIndexed { idx, text ->
            marks.add(Mark.Text(text, Pt(out + pad, top + high * (idx + HALF)), Anchor.Left, Role.Muted))
        }
        wide = max(wide, out + pad + label.maxOf { measure.width(it, spec.font) })
        cursor = low + step
    }

    private fun note(item: Step.Note, high: Double) {
        val rects = item.actors.mapNotNull { heads[it] }
        if (rects.isEmpty()) return
        val text = item.label.maxOfOrNull { measure.width(it, spec.font) } ?: 0.0
        val body = text + pad * 4
        val tall = high * item.label.size + pad * 2
        val anchor = rects.first()
        val rect = when (item.at) {
            NoteAt.Left -> Rect(anchor.x + anchor.w / 2 - gap - body, cursor, body, tall)
            NoteAt.Right -> Rect(anchor.x + anchor.w / 2 + gap, cursor, body, tall)
            NoteAt.Over -> over(rects, body, tall)
        }
        marks.add(Mark.Box(rect, spec.metrics.arc, Role.Note, Role.Border))
        item.label.forEachIndexed { idx, label ->
            val at = Pt(rect.x + rect.w / 2, rect.y + pad + high * (idx + HALF))
            marks.add(Mark.Text(label, at, Anchor.Center, Role.Text))
        }
        wide = max(wide, rect.x + rect.w)
        cursor = rect.y + rect.h + step
    }

    private fun over(rects: List<Rect>, body: Double, tall: Double): Rect {
        val left = rects.minOf { it.x + it.w / 2 }
        val right = rects.maxOf { it.x + it.w / 2 }
        val span = max(body, right - left + body / 2)
        return Rect((left + right) / 2 - span / 2, cursor, span, tall)
    }

    private fun open(item: Step.Open, high: Double) {
        val label = kind(item.kind) + item.label.firstOrNull().orEmpty()
        blocks.addLast(Frame(cursor, label))
        cursor += high + pad * 2
    }

    private fun split(item: Step.Split, high: Double) {
        if (blocks.isEmpty()) return
        val inset = pad * blocks.size
        marks.add(
            Mark.Edge(listOf(Pt(inset, cursor), Pt(max(inset, wide - inset), cursor)), Role.Cluster, dash = true),
        )
        val text = item.label.firstOrNull().orEmpty()
        if (text.isNotEmpty()) marks.add(Mark.Text(text, Pt(inset + pad, cursor + high * HALF), Anchor.Left, Role.Muted))
        cursor += high + pad
    }

    private fun close() {
        val frame = blocks.removeLastOrNull() ?: return
        val inset = pad * (blocks.size + 1)
        val rect = Rect(inset, frame.top, max(pad, wide - inset * 2), cursor - frame.top)
        val high = measure.height(spec.font)
        val tab = Rect(rect.x, rect.y, measure.width(frame.text, spec.font) + pad * 2, high + pad)
        marks.add(Mark.Box(rect, spec.metrics.arc, null, Role.Cluster, dash = true))
        marks.add(Mark.Box(tab, spec.metrics.arc, Role.Note, Role.Cluster))
        marks.add(Mark.Text(frame.text, Pt(tab.x + pad, tab.y + tab.h / 2), Anchor.Left, Role.Muted, true))
        cursor += pad
    }

    private fun toggle(item: Step.Toggle) {
        val stack = live.getOrPut(item.actor) { mutableListOf() }
        if (item.on) {
            stack.add(cursor)
            return
        }
        val start = stack.removeLastOrNull() ?: return
        val at = center(item.actor) ?: return
        val width = pad
        val rect = Rect(at - width / 2 + stack.size * width, start, width, max(step / 2, cursor - start))
        marks.add(Mark.Box(rect, 0.0, Role.Accent, Role.Border))
    }

    /** Lifelines are emitted first so messages and boxes paint on top of them. */
    private fun lines(): List<Mark> = heads.values.map { rect ->
        val at = rect.x + rect.w / 2
        Mark.Edge(listOf(Pt(at, rect.y + rect.h), Pt(at, cursor + step / 2)), Role.Muted, dash = true)
    }

    private fun line(points: List<Pt>, item: Step.Msg) = Mark.Edge(
        points,
        Role.Line,
        dash = item.link == Link.Dotted,
        head = item.head,
    )

    /** Shifts an endpoint clear of any activation bar currently open on that participant. */
    private fun edge(actor: String, at: Double, rightward: Boolean): Double {
        val open = live[actor]?.size ?: 0
        if (open == 0) return at
        val shift = pad / 2 + (open - 1) * pad
        return if (rightward) at + shift else at - shift
    }

    private fun center(actor: String): Double? {
        val rect = heads[actor] ?: return null
        return rect.x + rect.w / 2
    }

    private fun prefix(label: List<String>): List<String> {
        if (label.isEmpty()) return listOf("$count")
        return listOf("$count. ${label.first()}") + label.drop(1)
    }

    private fun scene(source: List<Mark>): Scene {
        val pts = source.flatMap(::pts)
        val minX = pts.minOfOrNull { it.x } ?: 0.0
        val minY = pts.minOfOrNull { it.y } ?: 0.0
        val dx = -minOf(0.0, minX)
        val dy = -minOf(0.0, minY)
        val marks = source.map { move(it, dx, dy) }
        val moved = pts.map { Pt(it.x + dx, it.y + dy) }
        val size = Size((moved.maxOfOrNull { it.x } ?: 0.0) + pad, (moved.maxOfOrNull { it.y } ?: 0.0) + pad)
        return Scene(Type.Sequence, marks, size)
    }

    private fun pts(mark: Mark): List<Pt> = when (mark) {
        is Mark.Box -> corners(mark.rect)
        is Mark.Oval -> corners(mark.rect)
        is Mark.Poly -> mark.points
        is Mark.Sector -> listOf(Pt(mark.at.x - mark.r, mark.at.y - mark.r), Pt(mark.at.x + mark.r, mark.at.y + mark.r))
        is Mark.Edge -> mark.points
        is Mark.Text -> span(mark)
        is Mark.Group -> mark.marks.flatMap(::pts)
    }

    /**
     * A text mark contributes its glyph extent, not just its anchor. Renderers use [Scene.size] for
     * scroll and clip bounds, so a left-anchored self-message label would otherwise be clipped.
     */
    private fun span(mark: Mark.Text): List<Pt> {
        val room = measure.width(mark.text, if (mark.bold) bold else spec.font)
        return when (mark.anchor) {
            Anchor.Left, Anchor.TopLeft, Anchor.BottomLeft -> listOf(mark.at, Pt(mark.at.x + room, mark.at.y))
            Anchor.Right, Anchor.TopRight, Anchor.BottomRight -> listOf(Pt(mark.at.x - room, mark.at.y), mark.at)
            else -> listOf(Pt(mark.at.x - room / 2, mark.at.y), Pt(mark.at.x + room / 2, mark.at.y))
        }
    }

    private fun corners(rect: Rect) = listOf(Pt(rect.x, rect.y), Pt(rect.x + rect.w, rect.y + rect.h))

    private fun move(mark: Mark, dx: Double, dy: Double): Mark = when (mark) {
        is Mark.Box -> mark.copy(rect = move(mark.rect, dx, dy))
        is Mark.Oval -> mark.copy(rect = move(mark.rect, dx, dy))
        is Mark.Poly -> mark.copy(points = mark.points.map { move(it, dx, dy) })
        is Mark.Sector -> mark.copy(at = move(mark.at, dx, dy))
        is Mark.Edge -> mark.copy(points = mark.points.map { move(it, dx, dy) })
        is Mark.Text -> mark.copy(at = move(mark.at, dx, dy))
        is Mark.Group -> mark.copy(marks = mark.marks.map { move(it, dx, dy) })
    }

    private fun move(rect: Rect, dx: Double, dy: Double) = Rect(rect.x + dx, rect.y + dy, rect.w, rect.h)

    private fun move(pt: Pt, dx: Double, dy: Double) = Pt(pt.x + dx, pt.y + dy)

    private data class Frame(val top: Double, val text: String)

    private companion object {
        const val HALF = 0.5

        fun kind(kind: BlockKind) = when (kind) {
            BlockKind.Loop -> "loop "
            BlockKind.Alt -> "alt "
            BlockKind.Opt -> "opt "
            BlockKind.Par -> "par "
            BlockKind.Critical -> "critical "
            BlockKind.Break -> "break "
        }
    }
}
