package ai.kilocode.client.ui.editor

import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.editor.markup.HighlighterLayer
import com.intellij.openapi.editor.markup.HighlighterTargetArea

internal data class BashRange(val start: Int, val end: Int, val key: TextAttributesKey)

internal data class BashDisplay(val text: String, val ranges: List<BashRange>)

internal object BashCommandHighlighter {
    private val cmd = Regex("(?m)(^\\s*(?:\\$\\s*)?|[|&;]\\s*)([A-Za-z_./~][A-Za-z0-9_./~+-]*)")
    private val flag = Regex("(?<!\\S)-{1,2}[A-Za-z0-9][A-Za-z0-9_-]*(?:=[^\\s'\"]+)?")
    private val string = Regex("'[^']*'|\"(?:\\\\.|[^\"\\\\])*\"")
    private val env = Regex("(?m)(^|\\s)([A-Za-z_][A-Za-z0-9_]*)(?==)")
    private val prompt = Regex("(?m)^\\s*\\$\\s+")

    fun display(text: String) = BashDisplay(text, ranges(text))

    fun apply(editor: EditorEx, text: String) = apply(editor, display(text))

    fun apply(editor: EditorEx, display: BashDisplay) {
        editor.markupModel.removeAllHighlighters()
        val size = editor.document.textLength
        for (range in display.ranges) {
            val start = range.start.coerceAtMost(size)
            val end = range.end.coerceAtMost(size)
            if (start >= end) continue
            editor.markupModel.addRangeHighlighter(
                range.key,
                start,
                end,
                HighlighterLayer.SYNTAX + 1,
                HighlighterTargetArea.EXACT_RANGE,
            )
        }
    }

    fun ranges(text: String): List<BashRange> = buildList {
        val spans = spans(text)
        cmd.findAll(text).forEach { match ->
            val group = match.groups[2] ?: return@forEach
            if (!contains(spans, group.range.first, group.range.last + 1)) return@forEach
            add(BashRange(group.range.first, group.range.last + 1, DefaultLanguageHighlighterColors.KEYWORD))
        }
        flag.findAll(text).forEach { match ->
            if (!contains(spans, match.range.first, match.range.last + 1)) return@forEach
            add(BashRange(match.range.first, match.range.last + 1, DefaultLanguageHighlighterColors.KEYWORD))
        }
        string.findAll(text).forEach { match ->
            if (!contains(spans, match.range.first, match.range.last + 1)) return@forEach
            add(BashRange(match.range.first, match.range.last + 1, DefaultLanguageHighlighterColors.STRING))
        }
        env.findAll(text).forEach { match ->
            val group = match.groups[2] ?: return@forEach
            if (!contains(spans, group.range.first, group.range.last + 1)) return@forEach
            add(BashRange(group.range.first, group.range.last + 1, DefaultLanguageHighlighterColors.STATIC_FIELD))
        }
    }

    private fun spans(text: String): List<IntRange> {
        val prompts = prompt.findAll(text).toList()
        if (prompts.isEmpty()) return listOf(0 until text.length)
        return prompts.map { match ->
            val end = text.indexOf('\n', match.range.last + 1).let { if (it == -1) text.length else it }
            (match.range.last + 1) until end
        }
    }

    private fun contains(spans: List<IntRange>, start: Int, end: Int): Boolean {
        return spans.any { start >= it.first && end <= it.last + 1 }
    }
}
