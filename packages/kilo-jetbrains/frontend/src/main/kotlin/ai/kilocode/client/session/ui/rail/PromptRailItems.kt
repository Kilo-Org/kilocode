package ai.kilocode.client.session.ui.rail

import ai.kilocode.client.session.model.Compaction
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.model.Turn
import kotlin.math.floor

/** One navigable prompt: a user turn, its preview text, and the start of its response, if any. */
data class PromptRailItem(
    val id: String,
    val queued: Boolean,
    val prompt: String,
    val answer: String,
)

/** One rail tick: a navigable prompt, or a placeholder standing in for a run of hidden prompts. */
sealed class PromptRailEntry {
    data class Prompt(val index: Int) : PromptRailEntry()
    data class Overflow(val hidden: IntRange) : PromptRailEntry()
}

/**
 * Pure logic for the prompt navigator: which turns are navigable, their preview text, how many ticks
 * fit a given rail height, and which ticks are kept when there are more prompts than fit.
 *
 * Mirrors `packages/kilo-vscode/webview-ui/src/components/chat/prompt-rail.ts` for JetBrains, without
 * lazy history paging — the JetBrains transcript always loads full history up front.
 */
object PromptRailItems {
    const val PROMPT_LIMIT = 160
    const val ANSWER_LIMIT = 220

    /** Prose characters read per preview before stripping. Comfortably above [ANSWER_LIMIT]. */
    private const val BUDGET = 1200

    /** Length of a fence marker. */
    private const val MARK = 3

    /**
     * Characters scanned looking for a fence's closing marker. Sized past any realistic code block, so
     * a block is normally stepped over in full; beyond it the preview keeps the prose before the fence
     * and stops, which bounds the work without ever spilling code into the output.
     */
    private const val SCAN = BUDGET * 16

    /** Leading characters folded into a turn's cache stamp. */
    private const val PROBE = 256

    /**
     * Per-turn preview cache. Rebuilds are driven by streamed content, so without this every delta
     * re-previews every turn in the transcript; with it only the turn that changed is recomputed.
     *
     * Keyed by turn id, holding the [stamp] the entry was built from. EDT-only, like the model it reads.
     */
    class Cache {
        internal val entries = HashMap<String, Pair<Long, PromptRailItem>>()

        internal fun take(id: String, mark: Long): PromptRailItem? =
            entries[id]?.takeIf { it.first == mark }?.second

        internal fun put(id: String, mark: Long, item: PromptRailItem) {
            entries[id] = mark to item
        }

        /** Drops turns that are no longer in the transcript, so a cleared session does not linger. */
        internal fun retain(ids: Set<String>) {
            if (entries.size != ids.size) entries.keys.retainAll(ids)
        }

        fun size(): Int = entries.size
    }

    /** One item per navigable user turn, in transcript order. */
    fun items(model: SessionModel, cache: Cache? = null): List<PromptRailItem> {
        val out = mutableListOf<PromptRailItem>()
        val seen = mutableSetOf<String>()
        for (turn in model.turns()) {
            val anchor = model.message(turn.id) ?: continue
            if (anchor.info.role != "user") continue
            if (anchor.parts.values.any { it is Compaction }) continue
            if (model.isRevertedMessage(turn.id)) continue
            if (!prompted(anchor)) continue
            seen.add(turn.id)
            val mark = if (cache == null) 0L else stamp(model, turn)
            cache?.take(turn.id, mark)?.let {
                out.add(it)
                continue
            }
            val prompt = truncate(preview(text(anchor.parts.values)), PROMPT_LIMIT)
            val answer = truncate(preview(answerText(model, turn.messageIds)), ANSWER_LIMIT)
            val item = if (prompt.isEmpty()) {
                // Promoted to the title, so it takes the title's limit rather than keeping the longer
                // answer one.
                PromptRailItem(turn.id, model.isQueued(turn.id), truncate(answer, PROMPT_LIMIT), "")
            } else {
                PromptRailItem(turn.id, model.isQueued(turn.id), prompt, answer)
            }
            cache?.put(turn.id, mark, item)
            out.add(item)
        }
        cache?.retain(seen)
        return out
    }

    /**
     * Whether [anchor] carries something the user actually supplied: text they typed, or an attachment.
     *
     * The CLI injects user-role messages of its own — compaction replays earlier assistant content this
     * way, and task summaries and resumed tool results do the same — marking the text `synthetic`.
     * [SessionModel] strips those parts, so such a turn reaches here with no user content at all. It has
     * to be skipped rather than treated as a prompt with empty text: the attachment-only branch would
     * otherwise promote the assistant's reply into the title and list a response as if it were typed.
     */
    private fun prompted(anchor: Message): Boolean = anchor.parts.values.any {
        (it is Text && it.content.isNotBlank()) || it is FileAttachment
    }

    /** Joined, non-blank [Text] parts of the first assistant message in [messageIds] that has any. */
    private fun answerText(model: SessionModel, messageIds: List<String>): String {
        for (id in messageIds.drop(1)) {
            val msg = model.message(id) ?: continue
            if (msg.info.role != "assistant") continue
            val joined = text(msg.parts.values)
            if (joined.isNotBlank()) return joined
        }
        return ""
    }

    /**
     * Joined [Text] parts, cut to [BUDGET] characters before any markdown stripping runs.
     *
     * The previews are at most a couple of hundred characters, but an assistant answer can be tens of
     * kilobytes and this is reached from every streamed delta. Copying and running the preview regexes
     * over the whole answer was the cost; the budget leaves ample slack for stripping to shorten the
     * text and still reach the limit.
     */
    private fun text(parts: Collection<Content>): String {
        val out = StringBuilder()
        for (part in parts) {
            if (part !is Text) continue
            if (part.content.isBlank()) continue
            if (out.length >= BUDGET) break
            if (out.isNotEmpty()) out.append('\n')
            prose(out, part.content)
        }
        return out.toString()
    }

    /**
     * Appends the non-code text of [src] until the budget is reached, stepping over fenced blocks.
     *
     * The budget counts prose rather than raw characters precisely so a fence is never cut in half:
     * [preview] only strips a *closed* fence, so a budget landing inside one would leave the opening
     * marker and a slice of code in the preview, where reading the whole text dropped the block. Fences
     * are found by scanning for the marker instead of by regex, so stepping over a large code block
     * stays a cheap linear walk that allocates nothing.
     *
     * An unclosed fence is kept as text, which is what [preview]'s closed-pair regex does with it too.
     */
    internal fun prose(out: StringBuilder, src: CharSequence) {
        var at = 0
        while (at < src.length && out.length < BUDGET) {
            val room = BUDGET - out.length
            // The opening search stops at the remaining budget. A fence that opens beyond it cannot
            // affect the output, because the prose in front of it already fills the preview, so a
            // fence-free answer costs the budget rather than its own length. That matters because a
            // streamed delta re-previews its turn, which would otherwise make the stream quadratic.
            val open = mark(src, at, at + room)
            if (open < 0) return take(out, src, at, at + room)
            // The closing search is bounded too, but by its own cap rather than the budget: the block
            // has to be measured to be stepped over, so this cannot stop at the budget the way the
            // opening search does. [SCAN] is sized past any realistic code block, which keeps a fenced
            // answer bounded per call instead of rescanning the block on every streamed delta.
            val reach = open + MARK + SCAN
            val close = mark(src, open + MARK, minOf(src.length, reach))
            if (close < 0) {
                // Whole part scanned, so the fence really is unclosed: keep it as text, which is what
                // [preview]'s closed-pair regex does with it.
                if (reach >= src.length) return take(out, src, at, src.length)
                // Cap reached first, so the block may well close further on. Emit the prose in front of
                // it and stop; keeping the remainder as text here is what spills code into the preview.
                return take(out, src, at, open)
            }
            take(out, src, at, open)
            if (out.length < BUDGET) out.append(' ')
            at = close + MARK
        }
    }

    /** Index of the first fence marker starting in `[from, until)`, or -1. Reads [src] in place. */
    private fun mark(src: CharSequence, from: Int, until: Int): Int {
        var i = from.coerceAtLeast(0)
        val last = minOf(until, src.length - MARK + 1)
        while (i < last) {
            if (src[i] == '`' && src[i + 1] == '`' && src[i + 2] == '`') return i
            i++
        }
        return -1
    }

    private fun take(out: StringBuilder, src: CharSequence, from: Int, to: Int) {
        val room = BUDGET - out.length
        if (room <= 0) return
        val end = minOf(to, from + room, src.length)
        if (end > from) out.append(src, from, end)
    }

    /**
     * Cheap stand-in for a turn's preview inputs, so an unchanged turn is not previewed again.
     *
     * Bounded on purpose: this runs for every turn on every streamed delta, so it folds in the role
     * [answerText] selects on, each part's id and length, and a hash of a [PROBE]-character prefix
     * rather than hashing the whole text. Length alone would miss an in-place edit that replaces text
     * with a different string of the same length; the prefix catches those, and the remaining blind
     * spot is an equal-length edit entirely beyond the probe, which streaming never produces because it
     * only appends.
     */
    private fun stamp(model: SessionModel, turn: Turn): Long {
        var hash = if (model.isQueued(turn.id)) 1L else 0L
        for (id in turn.messageIds) {
            val msg = model.message(id) ?: continue
            hash = hash * 31 + id.hashCode()
            hash = hash * 31 + msg.info.role.hashCode()
            for (part in msg.parts.values) {
                hash = hash * 31 + part.id.hashCode()
                if (part !is Text) continue
                hash = hash * 31 + part.content.length
                hash = hash * 31 + head(part.content)
            }
        }
        return hash
    }

    /** Hash of at most [PROBE] leading characters. Reads [src] in place, copying nothing. */
    private fun head(src: CharSequence): Int {
        var hash = 0
        val end = minOf(src.length, PROBE)
        for (i in 0 until end) hash = hash * 31 + src[i].code
        return hash
    }

    /**
     * Plain-text preview of markdown [text]: fenced code blocks, inline code and images are dropped,
     * links keep only their label, leading heading/list/quote markers are stripped, and whitespace is
     * collapsed to single spaces.
     */
    fun preview(text: String): String {
        var out = text
        out = out.replace(FENCE, " ")
        out = out.replace(IMAGE, " ")
        out = out.replace(LINK) { it.groupValues[1] }
        out = out.replace(INLINE_CODE, " ")
        out = out.lineSequence()
            .map { it.replace(LEADING_MARKER, "") }
            .joinToString("\n")
        return out.replace(WHITESPACE, " ").trim()
    }

    /** [text] cut to [limit] characters, with a trailing ellipsis when it was cut. */
    fun truncate(text: String, limit: Int): String {
        if (text.length <= limit) return text
        return text.take((limit - 1).coerceAtLeast(0)).trimEnd() + "…"
    }

    /** Ticks that fit a rail of [height] px, spaced no closer than [stepMin] and no wider than [stepMax]. */
    fun capacity(height: Int, stepMin: Int, pad: Int): Int {
        val usable = height - 2 * pad
        if (usable <= 0) return 0
        return floor(usable.toDouble() / stepMin.toDouble()).toInt()
    }

    /**
     * Which [items] to show as ticks when only [capacity] fit: the first prompt, one overflow tick for
     * everything hidden in between, and the most recent prompts. Below capacity 2 there is no overflow
     * tick — see the branches below.
     */
    fun entries(items: List<PromptRailItem>, capacity: Int): List<PromptRailEntry> {
        if (items.isEmpty() || capacity <= 0) return emptyList()
        if (capacity == 1 || items.size <= capacity) {
            return if (capacity == 1) {
                listOf(PromptRailEntry.Prompt(items.lastIndex))
            } else {
                items.indices.map { PromptRailEntry.Prompt(it) }
            }
        }
        if (capacity == 2) {
            return listOf(PromptRailEntry.Prompt(0), PromptRailEntry.Prompt(items.lastIndex))
        }
        val tailCount = capacity - 2
        val tailStart = items.size - tailCount
        return buildList {
            add(PromptRailEntry.Prompt(0))
            add(PromptRailEntry.Overflow(1 until tailStart))
            for (i in tailStart until items.size) add(PromptRailEntry.Prompt(i))
        }
    }

    /**
     * Index into [items] that should read as active: the last prompt when the transcript cannot scroll,
     * the first prompt when the viewport sits at the very top, otherwise the last prompt whose top is at
     * or above [viewTop].
     */
    fun active(tops: List<Int>, viewTop: Int, scrollable: Boolean, atTop: Boolean): Int? {
        if (tops.isEmpty()) return null
        if (!scrollable) return tops.lastIndex
        if (atTop) return 0
        var lo = 0
        var hi = tops.lastIndex
        var found = -1
        while (lo <= hi) {
            val mid = (lo + hi) / 2
            if (tops[mid] <= viewTop) {
                found = mid
                lo = mid + 1
            } else {
                hi = mid - 1
            }
        }
        return if (found < 0) 0 else found
    }

    private val FENCE = Regex("```[\\s\\S]*?```")
    private val IMAGE = Regex("!\\[[^\\]]*]\\([^)]*\\)")
    private val LINK = Regex("\\[([^\\]]*)]\\([^)]*\\)")
    // Bounded to a single line, like the fenced form above handles multi-line spans. A class that
    // also matched newlines would let two unrelated backticks on different lines swallow everything
    // between them, which can empty a prompt outright.
    private val INLINE_CODE = Regex("`[^`\\n]*`")
    private val LEADING_MARKER = Regex("^\\s*(#{1,6}\\s+|[-*+>]\\s+)")
    private val WHITESPACE = Regex("\\s+")
}
