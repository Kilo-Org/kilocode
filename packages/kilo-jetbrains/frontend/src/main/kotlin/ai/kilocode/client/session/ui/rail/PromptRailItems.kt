package ai.kilocode.client.session.ui.rail

import ai.kilocode.client.session.model.Compaction
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.Text
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

    /** One item per navigable user turn, in transcript order. */
    fun items(model: SessionModel): List<PromptRailItem> {
        val out = mutableListOf<PromptRailItem>()
        for (turn in model.turns()) {
            val anchor = model.message(turn.id) ?: continue
            if (anchor.info.role != "user") continue
            if (anchor.parts.values.any { it is Compaction }) continue
            if (model.isRevertedMessage(turn.id)) continue
            val prompt = truncate(preview(text(anchor.parts.values)), PROMPT_LIMIT)
            val answer = truncate(preview(answerText(model, turn.messageIds)), ANSWER_LIMIT)
            out.add(
                if (prompt.isEmpty()) {
                    PromptRailItem(turn.id, model.isQueued(turn.id), answer, "")
                } else {
                    PromptRailItem(turn.id, model.isQueued(turn.id), prompt, answer)
                },
            )
        }
        return out
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

    private fun text(parts: Collection<ai.kilocode.client.session.model.Content>): String = parts
        .filterIsInstance<Text>()
        .map { it.content.toString() }
        .filter { it.isNotBlank() }
        .joinToString("\n")

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
    private val INLINE_CODE = Regex("`[^`]*`")
    private val LEADING_MARKER = Regex("^\\s*(#{1,6}\\s+|[-*+>]\\s+)")
    private val WHITESPACE = Regex("\\s+")
}
