package ai.kilocode.client.ui.md

import com.intellij.openapi.util.TextRange
import java.awt.Rectangle
import javax.swing.JComponent

internal const val MAX_SEARCH_HIGHLIGHTS = 500

/**
 * Optional search surface contract for rendered prose.
 *
 * It is deliberately separate from [MdView] so the main renderer interface stays focused; only
 * renderers that expose conversation prose implement it. All methods are EDT-only.
 */
interface MdSearchView {
    /** Monotonically increasing when rendered searchable text or its documents change. */
    fun searchRevision(): Long = 0

    /** Rendered prose blocks in display order. Each block owns its own highlighting. */
    fun searchBlocks(): List<SearchBlock> = emptyList()

    fun clearSearchHighlights() {
        searchBlocks().forEach { it.clearHighlights() }
    }

    fun addSearchListener(listener: SearchListener) = Unit

    fun removeSearchListener(listener: SearchListener) = Unit

    /** One rendered prose block that can highlight ranges inside its own text. */
    interface SearchBlock {
        val id: Int
        val component: JComponent
        val text: String
        val excluded: List<TextRange>
        val revision: Long

        fun applyHighlights(ranges: List<TextRange>, current: TextRange?)

        fun clearHighlights()

        fun rect(range: TextRange): Rectangle?

        fun scrollIntoView(range: TextRange)
    }

    fun interface SearchListener {
        fun onSearchChanged()
    }
}
