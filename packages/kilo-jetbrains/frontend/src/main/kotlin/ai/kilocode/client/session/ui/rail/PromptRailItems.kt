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

    /** Raw characters read per preview before stripping. Comfortably above [ANSWER_LIMIT]. */
    private const val BUDGET = 1200

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
            if (out.isNotEmpty()) out.append('\n')
            val room = BUDGET - out.length
            if (room <= 0) break
            out.append(part.content, 0, minOf(room, part.content.length))
            if (out.length >= BUDGET) break
        }
        return out.toString()
    }

    /** Cheap stand-in for a turn's preview inputs, so an unchanged turn is not previewed again. */
    private fun stamp(model: SessionModel, turn: Turn): Long {
        var hash = if (model.isQueued(turn.id)) 1L else 0L
        for (id in turn.messageIds) {
            val msg = model.message(id) ?: continue
            hash = hash * 31 + id.hashCode()
            for (part in msg.parts.values) {
                // Lengths only: reading a StringBuilder's length does not copy it, so this stays O(parts)
                // no matter how much text has streamed in.
                hash = hash * 31 + part.id.hashCode()
                if (part is Text) hash = hash * 31 + part.content.length
            }
        }
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
