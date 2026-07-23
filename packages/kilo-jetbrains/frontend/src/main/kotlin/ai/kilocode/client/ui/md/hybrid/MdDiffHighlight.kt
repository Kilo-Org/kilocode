package ai.kilocode.client.ui.md.hybrid

import com.intellij.openapi.diff.DiffColors
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.editor.markup.HighlighterLayer
import com.intellij.openapi.editor.markup.HighlighterTargetArea

/**
 * Overlays unified-diff coloring on a plain-text code editor: added lines get the theme's diff
 * "inserted" background, removed lines the "deleted" background, hunk headers a keyword color, and
 * file/index headers a dimmed comment color. Colors come from the active scheme via [DiffColors]
 * and [DefaultLanguageHighlighterColors], so the result tracks the IDE theme like the diff viewer.
 */
internal object MdDiffHighlight {
    data class Span(val key: TextAttributesKey, val area: HighlighterTargetArea)
    data class Display(val text: String, val spans: List<Range>)
    data class Range(val start: Int, val end: Int, val span: Span)

    fun apply(editor: EditorEx, text: String) {
        editor.markupModel.removeAllHighlighters()
        val doc = editor.document
        val size = doc.textLength
        for (n in 0 until doc.lineCount) {
            val start = doc.getLineStartOffset(n).coerceAtMost(size)
            val end = doc.getLineEndOffset(n).coerceAtMost(size)
            if (start >= end) continue
            val span = classify(doc.charsSequence.subSequence(start, end).toString()) ?: continue
            editor.markupModel.addRangeHighlighter(span.key, start, end, HighlighterLayer.SYNTAX + 1, span.area)
        }
    }

    fun applyPure(editor: EditorEx, text: String) {
        editor.markupModel.removeAllHighlighters()
        val doc = editor.document
        for (range in display(text).spans) {
            val start = range.start.coerceAtMost(doc.textLength)
            val end = range.end.coerceAtMost(doc.textLength)
            if (start >= end) continue
            editor.markupModel.addRangeHighlighter(range.span.key, start, end, HighlighterLayer.SYNTAX + 1, range.span.area)
        }
    }

    fun display(text: String): Display {
        val out = StringBuilder()
        val ranges = mutableListOf<Range>()
        text.lineSequence().forEachIndexed { i, line ->
            if (i > 0) out.append('\n')
            val span = classify(line)
            val body = when {
                line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") -> line.drop(1)
                else -> line
            }
            val start = out.length
            out.append(body)
            if (span != null) ranges.add(Range(start, out.length, span))
        }
        return Display(out.toString(), ranges)
    }

    private fun classify(line: String): Span? = when {
        fileHeader(line) || meta(line) -> comment
        line.startsWith("@@") -> hunk
        line.startsWith("+") -> inserted
        line.startsWith("-") -> deleted
        else -> null
    }

    // Unified-diff file headers are the marker followed by a space (or the bare marker), e.g. "+++ b/f".
    // Guarding on that shape keeps content lines like "++x;" (an inserted "+x;") from being dimmed.
    private fun fileHeader(line: String): Boolean =
        (line.startsWith("+++") || line.startsWith("---")) &&
            (line.length == 3 || line[3] == ' ' || line[3] == '\t')

    private fun meta(line: String): Boolean = line.startsWith("diff ") ||
        line.startsWith("index ") ||
        line.startsWith("Index:") ||
        line.startsWith("===") ||
        line.startsWith("new file") ||
        line.startsWith("deleted file") ||
        line.startsWith("rename ") ||
        line.startsWith("similarity ") ||
        line.startsWith("\\ No newline")

    private val inserted = Span(DiffColors.DIFF_INSERTED, HighlighterTargetArea.LINES_IN_RANGE)
    private val deleted = Span(DiffColors.DIFF_DELETED, HighlighterTargetArea.LINES_IN_RANGE)
    private val hunk = Span(DefaultLanguageHighlighterColors.KEYWORD, HighlighterTargetArea.EXACT_RANGE)
    private val comment = Span(DefaultLanguageHighlighterColors.LINE_COMMENT, HighlighterTargetArea.EXACT_RANGE)
}
