@file:Suppress("ReturnCount", "MagicNumber")

package ai.kilocode.client.session.ui.search

import com.intellij.find.FindModel
import com.intellij.openapi.util.TextRange

internal data class TranscriptMatchOptions(
    val query: String,
    val caseSensitive: Boolean = false,
    val wholeWords: Boolean = false,
    val regex: Boolean = false,
)

internal sealed interface TranscriptMatchResult {
    data class Matches(val ranges: List<TextRange>) : TranscriptMatchResult
    data object InvalidRegex : TranscriptMatchResult
    data object TimedOut : TranscriptMatchResult
    data object Cancelled : TranscriptMatchResult
    data object Failed : TranscriptMatchResult
}

/**
 * Frontend-local Find matching.
 *
 * Text-only and deliberately independent of `FindManager`: the matcher must work in split-mode
 * frontends without a project search service, and it must never log the query. Regex compilation is
 * the platform's own [FindModel.compileRegExp] so option semantics stay familiar.
 */
internal object TranscriptMatcher {
    const val BUDGET_MS = 3_000L
    private const val CHECK_INTERVAL_MASK = 0xFF

    fun matches(
        text: String,
        options: TranscriptMatchOptions,
        deadline: Long,
        cancelled: () -> Boolean,
    ): TranscriptMatchResult {
        if (options.query.isEmpty()) return TranscriptMatchResult.Matches(emptyList())
        val guard = Guard(text, deadline, cancelled)
        return try {
            guard.check(force = true)
            if (options.regex) regex(text, options, guard) else literal(text, options, guard)
        } catch (abort: Abort) {
            if (abort.timeout) TranscriptMatchResult.TimedOut else TranscriptMatchResult.Cancelled
        }
    }

    private fun literal(text: String, options: TranscriptMatchOptions, guard: Guard): TranscriptMatchResult {
        val query = options.query
        val out = ArrayList<TextRange>()
        var from = 0
        while (from <= text.length - query.length) {
            guard.check(force = true)
            val start = text.indexOf(query, from, ignoreCase = !options.caseSensitive)
            if (start < 0) break
            val end = start + query.length
            if (!options.wholeWords || isWholeWord(text, start, end)) out.add(TextRange(start, end))
            from = if (end > start) end else start + 1
        }
        return TranscriptMatchResult.Matches(out)
    }

    private fun regex(text: String, options: TranscriptMatchOptions, guard: Guard): TranscriptMatchResult {
        val model = FindModel().apply {
            stringToFind = options.query
            isCaseSensitive = options.caseSensitive
            isRegularExpressions = true
            isWholeWordsOnly = false
        }
        val pattern = try {
            model.compileRegExp()
        } catch (_: StackOverflowError) {
            return TranscriptMatchResult.Failed
        } ?: return TranscriptMatchResult.InvalidRegex
        val out = ArrayList<TextRange>()
        return try {
            val matcher = pattern.matcher(guard.wrap(text))
            var from = 0
            while (from <= text.length) {
                guard.check(force = true)
                if (!matcher.find(from)) break
                val start = matcher.start()
                val end = matcher.end()
                val valid = !options.wholeWords || isWholeWord(text, start, end)
                if (valid) out.add(TextRange(start, end))
                from = if (end > start) end else start + 1
            }
            TranscriptMatchResult.Matches(out)
        } catch (_: StackOverflowError) {
            TranscriptMatchResult.Failed
        }
    }

    /**
     * Mirrors the platform's whole-word boundary rules: identifier characters use
     * [Character.isJavaIdentifierPart], and repeated punctuation is treated as one token.
     */
    private fun isWholeWord(text: String, start: Int, end: Int): Boolean {
        if (start != 0) {
            val prevIdentifier = Character.isJavaIdentifierPart(text[start - 1]) &&
                (start <= 1 || text[start - 2] != '\\')
            val prevSame = start < text.length && text[start - 1] == text[start]
            val firstIdentifier = start < text.length && Character.isJavaIdentifierPart(text[start])
            if (if (firstIdentifier) prevIdentifier else prevSame) return false
        }
        if (end != text.length) {
            val nextIdentifier = Character.isJavaIdentifierPart(text[end])
            val nextSame = end > 0 && text[end] == text[end - 1]
            val lastIdentifier = end > 0 && Character.isJavaIdentifierPart(text[end - 1])
            if (if (lastIdentifier) nextIdentifier else nextSame) return false
        }
        return true
    }

    private class Abort(val timeout: Boolean) : RuntimeException()

    private class Guard(
        private val text: String,
        private val deadline: Long,
        private val cancelled: () -> Boolean,
    ) {
        private var ticks = 0

        fun check(force: Boolean = false) {
            if (!force && (++ticks and CHECK_INTERVAL_MASK) != 0) return
            if (cancelled()) throw Abort(false)
            if (System.nanoTime() >= deadline) throw Abort(true)
        }

        fun wrap(value: String): CharSequence = Sequence(value, this)

        private class Sequence(
            private val value: String,
            private val guard: Guard,
        ) : CharSequence {
            override val length: Int get() = value.length

            override fun get(index: Int): Char {
                guard.check()
                return value[index]
            }

            override fun subSequence(startIndex: Int, endIndex: Int): CharSequence {
                val from = startIndex.coerceIn(0, value.length)
                val to = endIndex.coerceIn(from, value.length)
                return Sequence(value.substring(from, to), guard)
            }

            override fun toString(): String {
                guard.check(force = true)
                return value
            }
        }
    }
}
