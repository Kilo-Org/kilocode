package ai.kilocode.client.diff

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.TextAnnotationGutterProvider
import com.intellij.openapi.editor.colors.ColorKey
import com.intellij.openapi.editor.colors.EditorFontType
import com.intellij.ui.EditorTextField
import java.awt.Color

object DiffLineNumbers {
    data class Row(val old: Int?, val new: Int?)

    private val HUNK = Regex("^@@ -(\\d+)(?:,\\d+)? \\+(\\d+)(?:,\\d+)? @@")

    fun rows(patch: String): List<Row> {
        val rows = mutableListOf<Pair<String, Row>>()
        var old = 0
        var new = 0
        var hunk = false
        patch.lineSequence().forEach { line ->
            // Hunk headers (and any pre-hunk file/VCS headers) are the only lines stripped, matching
            // pureDiff's hunk-aware body. In-hunk lines are kept verbatim even when they look like a
            // header (e.g. a deleted "-- " comment renders as "--- ..."), so the counters stay aligned.
            if (line.startsWith("@@")) {
                HUNK.find(line)?.let { match ->
                    old = match.groupValues[1].toInt()
                    new = match.groupValues[2].toInt()
                }
                hunk = true
                return@forEach
            }
            if (!hunk) return@forEach
            when {
                line.startsWith("+") -> rows.add(line to Row(null, new++))
                line.startsWith("-") -> rows.add(line to Row(old++, null))
                line.startsWith("\\") -> rows.add(line to Row(null, null))
                else -> rows.add(line to Row(old++, new++))
            }
        }
        return rows.trimBlankEdges().map { it.second }
    }

    private fun List<Pair<String, Row>>.trimBlankEdges(): List<Pair<String, Row>> {
        // isNotEmpty (not isNotBlank) mirrors pureDiff's trim('\n'): a blank context line renders as
        // a single space that survives the body trim, so an empty-string edge is the only one dropped.
        val start = indexOfFirst { it.first.isNotEmpty() }
        if (start < 0) return emptyList()
        val end = indexOfLast { it.first.isNotEmpty() }
        return subList(start, end + 1)
    }
}

fun installDiffGutter(field: EditorTextField, rows: List<DiffLineNumbers.Row>) {
    val ed = field.getEditor(true) ?: return
    ed.settings.isLineNumbersShown = false
    ed.gutter.closeAllAnnotations()
    ed.gutter.registerTextAnnotation(DiffGutter(rows))
}

private const val FIGURE = '\u2007'

private class DiffGutter(private val rows: List<DiffLineNumbers.Row>) : TextAnnotationGutterProvider {
    private val oldWidth = width { it.old }
    private val newWidth = width { it.new }

    override fun getLineText(line: Int, editor: Editor): String? {
        val row = rows.getOrNull(line) ?: return null
        // The gutter paints with a proportional font, so pad with the figure space (digit-width)
        // to right-align both columns. Each column keeps a fixed width even when a side is blank,
        // and trailing figure spaces add a right inset before the code text.
        return "${col(row.old, oldWidth)}$FIGURE${col(row.new, newWidth)}$FIGURE$FIGURE"
    }

    override fun getToolTip(line: Int, editor: Editor): String? = null

    override fun getStyle(line: Int, editor: Editor): EditorFontType = EditorFontType.PLAIN

    override fun getColor(line: Int, editor: Editor): ColorKey? = null

    override fun getBgColor(line: Int, editor: Editor): Color? = null

    override fun gutterClosed() = Unit

    override fun getPopupActions(line: Int, editor: Editor): List<AnAction>? = null

    override fun useMargin(): Boolean = false

    private fun width(pick: (DiffLineNumbers.Row) -> Int?): Int =
        rows.mapNotNull(pick).maxOrNull()?.toString()?.length ?: 1

    private fun col(value: Int?, width: Int): String = value?.toString().orEmpty().padStart(width, FIGURE)
}
